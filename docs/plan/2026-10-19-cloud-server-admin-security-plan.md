# cloud-server 管理面安全加固方案（Token + 请求边界 + 审计）

> 状态：待实施（本文档是执行依据，不含已落地代码）
> 适用范围：`packages/cloud-server`，以及调用它的 `packages/plugins/plugin-manager`、`packages/plugins/plugin-hot-reload-demo/scripts/watch.mjs`
> 参考：DeepSeek Harness（DSH）的浏览器令牌 + Host/Origin 校验 + 安装显式授权，见 `deepseek-harness/packages/client/connection/README.zh.md`

## 一、目标

把「任意网页 / 任意本地脚本都能调用后台管理接口」这个敞口收掉，按性价比分三层：

| 层 | 解决什么 | 改动量 | 优先级 |
|---|---|---|---|
| 1. 审计日志 | 出了事查得到：谁、何时、装了什么、哈希多少 | 约 60 行 | P0 |
| 2. 管理令牌（Token） | 非授权来源不能装/卸后台插件 | 约 90 行 | P0 |
| 3. 请求边界（Host/Origin） | 恶意网页的跨站请求直接 403 | 约 60 行 | P1 |

完成后能防住：

1. 任意网页向 `127.0.0.1:8865` 发 POST 安装恶意后台插件；
2. 局域网内其它机器（服务若监听 `0.0.0.0`）直接调管理接口；
3. DNS 重绑定攻击（攻击者域名解析到 127.0.0.1）；
4. 事后无法追溯安装行为。

仍然防不住（与 DSH 同级，行业现实）：

1. 用户亲手确认安装恶意插件；
2. 已取得本机文件读写权限的攻击者（能同时改 token 文件与审计日志）；
3. 插件在进程内滥用宿主权限（没有插件级沙箱）；
4. 第三方依赖供应链投毒。

## 二、现状与证据（改之前的事实）

### 2.1 攻击面最大的路由

`packages/cloud-server/src/routes/serverPlugins.ts`

- `POST /api/server-plugins/install`（第 106 行）接受 `code` 文本并写入 `server-plugins/` 目录；
- `POST /api/server-plugins/uninstall`（第 161 行）删除对应文件；
- 已有防线：`confirm: true`（第 111 行）、origin 检查（第 115 行，靠 body 里的 `origin` 字段）、id 白名单（第 123 行）、服务端可信 sha256 比对（第 136-143 行）；
- **缺口**：`body.origin` 是调用方自己填的字符串，不是 HTTP 头的 `Origin`，伪造即可绕过；没有任何调用方身份校验。

### 2.2 全局中间件位置

`packages/cloud-server/src/server.ts`

```ts
// 第 445 行
app.use('*', cors())
```

所有路由在这之后注册（Hono 首次 fetch 后冻结，见第 443 行注释）。新的请求边界中间件必须紧跟在 `cors()` 之后。

### 2.3 前端调用点

`packages/plugins/plugin-manager/src/pluginManagerService.ts` 第 501 行发起 `POST /api/server-plugins/install`，body 为 `{ id, code, sha256, confirm: true, origin }`。加 token 后这里要带上请求头。

### 2.4 启动日志位置

`packages/cloud-server/src/cli.ts` 第 184-206 行打印服务信息，适合在这里打印一次 token。

## 三、总体设计

```
浏览器/脚本请求
   │
   ├─ ① 请求边界中间件（所有 /api）
   │     Host 必须是 loopback/白名单；带 Origin 时必须是同源；cross-site 一律 403
   │
   ├─ ② 管理鉴权（仅管理类路由）
   │     校验 x-admin-token 头，失败 403 并记审计
   │
   └─ ③ 业务路由（保持现状）
         kv / canvases / assets / agent / mcp …
```

设计原则：

1. **最小权限**：token 只保护「会引入可执行代码」的接口，不保护普通读写（否则前端每个请求都要带 token，改动面过大）。
2. **失败关闭**：任何校验拿不到结论都拒绝（403），不放行。
3. **默认安全、可显式关闭**：默认开启；提供 `--no-admin-auth` / `MINI_CANVAS_NO_ADMIN_AUTH=1` 作为逃生口（测试与本地排障用），启动时打印警告。
4. **先记账再执行**：审计写入在动作之前，避免中途崩溃导致无痕。

## 四、详细设计

### 4.1 审计日志（先做）

#### 文件

新增 `packages/cloud-server/src/audit.ts`：

```ts
export type AuditAction =
  | 'server-plugin/install'
  | 'server-plugin/uninstall'
  | 'admin/auth-failed'
  | 'admin/auth-ok'

export interface AuditEntry {
  at: string          // ISO 时间
  action: AuditAction
  id?: string         // 插件 id
  sha256?: string     // 插件代码哈希（完整）
  size?: number       // 代码字节数
  origin?: string     // HTTP Origin 头（有则记）
  host?: string       // HTTP Host 头
  remote?: string     // 连接来源地址（取得到则记）
  token?: 'ok' | 'missing' | 'bad'
  result?: 'attempt' | 'ok' | 'rejected'
  reason?: string
}

export function createAuditLog(filePath: string): {
  append(entry: Omit<AuditEntry, 'at'>): Promise<void>
}
```

实现要点：

- 路径：`{dataDir}/audit.log`，JSONL（一行一条 JSON）；
- `append` 用 `fs.appendFile`，失败只 `console.warn`，**不阻断主流程**；
- 目录不存在时 `mkdir -p`；
- token 绝不写入日志（只写 `ok/missing/bad`）。

#### 记录点

| 事件 | 时机 | 字段 |
|---|---|---|
| `server-plugin/install` | 进路由后、校验前，`result:'attempt'` | id、sha256（算出的）、size、origin、host |
| 同上 | 校验失败 | `result:'rejected'`、`reason` |
| 同上 | 落盘成功后 | `result:'ok'` |
| `server-plugin/uninstall` | 删除前/后 | id |
| `admin/auth-failed` | token 缺失或不符 | path、origin、host、token |

#### 查看方式

文档给用户：`type .mini-canvas\audit.log`（Windows）或 `tail -f .mini-canvas/audit.log`。不提供 HTTP 接口——那等于把日志暴露给网页。

### 4.2 管理令牌（Token）

#### 文件与生命周期

新增 `packages/cloud-server/src/adminAuth.ts`：

```ts
export interface AdminAuthOptions {
  dataDir: string
  /** false 时整体关闭鉴权（逃生口），启动时必须打印警告 */
  enabled: boolean
}

export interface AdminAuth {
  /** 当前 token（启动时生成或从文件读取） */
  readonly token: string
  /** 校验一个请求头值；恒定时间比较 */
  verify(headerValue: string | undefined): 'ok' | 'missing' | 'bad'
  /** 文件路径（供日志/诊断） */
  readonly tokenFile: string
}

export async function createAdminAuth(opts: AdminAuthOptions): Promise<AdminAuth>
```

规则：

1. token 文件：`{dataDir}/admin-token`，内容为 64 位十六进制（32 字节 `crypto.randomBytes`）；
2. 文件存在则读取（trim）；不存在则生成并写入，权限尽量 `0o600`（Windows 上忽略）；
3. 内容长度不合法（少于 32 字符）时**重新生成**并记一条警告；
4. 比较用 `crypto.timingSafeEqual`（长度不等先返回 `bad`）；
5. 请求头名：`x-admin-token`。

#### 保护哪些路由

| 路由 | 是否要 token | 理由 |
|---|---|---|
| `POST /api/server-plugins/install` | ✅ | 引入可执行代码 |
| `POST /api/server-plugins/uninstall` | ✅ | 删除/热卸代码 |
| `POST /api/npm-plugins/install|uninstall|update` | ✅ | 同上 |
| `POST /api/server-plugins/register`（若后续新增） | ✅ | 注册路径读取权 |
| `PUT/DELETE /api/kv/*` | ❌ | 画布前端高频调用 |
| `POST /api/canvases/*` | ❌ | 画布数据写入 |
| `GET *` | ❌ | 读操作 |
| MCP `/mcp` | ❌（建议后续单独加） | 已有独立鉴权设计空间 |

实现方式：不改每个路由的内部逻辑，而是在路由注册时包一层：

```ts
// 在 serverPlugins.ts 的 app 内，或统一的 guard 包装器
app.use('/api/server-plugins/*', adminGuard(auth, audit))
app.use('/api/npm-plugins/*', adminGuard(auth, audit))
```

`adminGuard` 只拦 POST；GET 放行。

#### 前端如何拿到 token（三选一）

推荐 **B + C 兜底**：

**A. 设置面板手动粘贴（保底）**

- 插件管理页新增一个输入框「管理令牌」，存 `localStorage`；
- 安装后台插件时把值放进 `x-admin-token` 请求头。

**B. 托管页面自动注入（推荐，零操作）**

- `server.ts` 的 `uiRoutes(uiDist)` 目前已经会往 `index.html` 注入 `<meta name="mini-canvas-host">`（见 `static.ts` 的 `injectHostFlag`）；
- 在同一处再注入一行 `<meta name="mini-canvas-admin-token" content="<token>">`；
- 前端读这个 meta，放进请求头；
- 安全性：只有能读到这个 HTML 的人才拿得到 token，而能读到就说明它已经在你同源页面里；跨源网页读不到响应体。
- 注意：**只有托管模式注入**；`packages/ui dev`（:5288）不是 cloud-server 托管，拿不到 meta，走 A 或 C。

**C. 环境变量（给 dev / 脚本）**

- cloud-server 支持 `MINI_CANVAS_ADMIN_TOKEN` 指定固定 token（不生成文件），方便 dev 与 CI；
- 前端 dev 用 `VITE_ADMIN_TOKEN`，写进请求头。

#### 启动打印

`cli.ts` 第 184 行之后加：

```
  管理令牌  <token>
            已写入 <dataDir>/admin-token（安装后台插件时使用）
```

`--no-admin-auth` 时改为打印黄色警告：`管理鉴权已关闭（仅限本地排障）`。

### 4.3 请求边界（Host / Origin）

新增 `packages/cloud-server/src/requestTrust.ts`：

```ts
export interface RequestTrustOptions {
  /** 允许的 Host authority，如 ['127.0.0.1:8865', 'localhost:8865']；端口由调用方拼 */
  trustedHosts: string[]
  /** 额外允许的 Origin（dev 代理场景，如 http://localhost:5288） */
  trustedOrigins?: string[]
}

export function requestTrust(opts: RequestTrustOptions) {
  // 返回 Hono 中间件
}
```

规则（按顺序，任一失败即 403）：

1. `Host` 头必须存在，且（去掉默认端口后）等于 `trustedHosts` 中任一项，或等于 `127.0.0.1` / `localhost` 的任意端口（本机）;
2. 若请求带 `Origin`，其 authority 必须等于 Host，或在 `trustedOrigins` 白名单里；
3. 若 `sec-fetch-site` 头等于 `cross-site`，一律 403；
4. 规则只作用于 `/api/*`；静态资源与 `/mcp` 先保持现状。

挂载位置（`server.ts` 第 445 行之后）：

```ts
app.use('*', cors())
app.use('/api/*', requestTrust({ trustedHosts: [...], trustedOrigins: [...] }))
```

#### dev 代理的坑（必须写进实现）

`packages/ui/vite.config.ts` 的 `/api` 代理默认不改写 Host。dev 页面在 `localhost:5288`，请求到 8865 时：

```
Host: localhost:5288      ← vite 透传
Origin: http://localhost:5288
```

按规则 1 会被拒。两种做法：

**做法一（推荐）**：vite 代理加 `changeOrigin: true`，并让 cloud-server 把 `http://localhost:5288` 加入 `trustedOrigins`（通过环境变量或检测端口）。

**做法二**：cloud-server 启动时把 `trustedOrigins` 默认包含 `http://localhost:5288` 与 `http://127.0.0.1:5288`。

文档选定：**做法二**（零配置，dev 开箱可用），并在实现里写注释说明边界（只放行本机 dev 端口）。

## 五、接口契约变化

### 5.1 新增请求头

```
x-admin-token: <64 位 hex>
```

只对管理类 POST 必需。

### 5.2 错误响应

| 情况 | 状态码 | body |
|---|---|---|
| 缺 token | 403 | `{ ok:false, error:'需要管理令牌（x-admin-token）；见服务启动日志或 <dataDir>/admin-token' }` |
| token 错 | 403 | 同上（不提示“错了”与“缺失”的区别，避免探测） |
| Host/Origin 不合法 | 403 | `{ ok:false, error:'请求来源不受信任' }` |

### 5.3 兼容性开关

| 开关 | 作用 |
|---|---|
| `--no-admin-auth` / `MINI_CANVAS_NO_ADMIN_AUTH=1` | 关闭 token 与 Host/Origin 校验（审计仍记录），启动打印警告 |
| `MINI_CANVAS_ADMIN_TOKEN` | 指定固定 token（不读/写文件） |
| `MINI_CANVAS_TRUSTED_ORIGINS` | 逗号分隔的额外 Origin 白名单 |

## 六、需要同步修改的调用方

### 6.1 插件管理面板（必改）

`packages/plugins/plugin-manager/src/pluginManagerService.ts`：

1. 新增 `adminToken` 状态（从 `localStorage` 或注入 meta 读取）；
2. `installServerHalf` / `uninstallServerHalf` 的 `doFetch` 加 `x-admin-token` 头；
3. 403 时把错误文案翻译成「请先在设置里填写管理令牌」；
4. 设置面板加一个密码输入框（`PluginManagerPage.vue`），只存本地。

### 6.2 watch 工具（不改）

`plugin-hot-reload-demo/scripts/watch.mjs` 只 PUT KV，不属于管理接口，无需 token。

### 6.3 测试与 e2e（必改）

`packages/cloud-server/src/__tests__/serverPluginsRoute.test.ts` 的所有 install/uninstall 请求需要：

1. 创建服务时传入固定 token（`createAdminAuth` 可注入），或使用 `--no-admin-auth` 等价选项；
2. 断言缺 token 时 403；
3. 新增「带 token 成功」与「token 错 403」两条用例。

`packages/cloud-server/e2e/*.ts` 若调用管理接口，同样处理。

## 七、测试计划

### 7.1 单元测试（新增）

| 文件 | 用例 |
|---|---|
| `src/__tests__/adminAuth.test.ts` | 首次生成并落盘 / 二次读取一致 / token 缺失→missing / 错值→bad / 长度异常重新生成 / 恒定时间比较不回显 |
| `src/__tests__/audit.test.ts` | 追加一行 JSONL / 目录不存在自动建 / 写入失败不抛 / 不含 token 原文 |
| `src/__tests__/requestTrust.test.ts` | 合法 Host 放行 / 非法 Host 403 / Origin≠Host 403 / cross-site 403 / trustedOrigins 放行 / 非 /api 不拦 |

### 7.2 路由测试（改）

`serverPluginsRoute.test.ts` 增加：

1. 无 token → 403，且文件未写入；
2. 错 token → 403；
3. 正确 token → 200 且文件写入；
4. 审计日志出现 attempt/ok 两条。

### 7.3 回归

```bash
pnpm -C packages/cloud-server test
pnpm -C packages/cloud-server typecheck
pnpm -C packages/ui test
pnpm -C packages/ui typecheck
```

### 7.4 真机验证

1. 启动服务，记下 token；
2. `curl` 不带 token 调 install → 403；
3. 带正确 token → 200；
4. `curl -H 'Origin: http://evil.example'` → 403；
5. 看 `audit.log` 有完整记录；
6. 画布面板装后台插件（注入 token）→ 成功；
7. `--no-admin-auth` 启动 → 打印警告且接口可用。

## 八、实施步骤（建议分三个 commit）

### 步骤 1：审计日志

1. 新建 `src/audit.ts` + 单测；
2. 在 `server.ts` 创建 `audit = createAuditLog(path.join(dataDir, 'audit.log'))`，挂到 `CloudServer` 返回对象或通过 `ctx.inject('audit')`；
3. 在 `serverPlugins.ts` 的 install/uninstall 写入 attempt/rejected/ok；
4. 跑测试、提交。

验收：审计文件出现，安装/卸载各有一条记录，token 不落盘。

### 步骤 2：管理令牌

1. 新建 `src/adminAuth.ts` + 单测；
2. `createCloudServer` 里创建（读 `opts.adminAuth ?? true`）；
3. `server.ts` 在 `/api/server-plugins/*`、`/api/npm-plugins/*` 挂 `adminGuard`；
4. `cli.ts` 打印 token；
5. 改 `serverPluginsRoute.test.ts`；
6. 前端插件管理面板加 token 输入与请求头；
7. 跑测试、提交。

验收：不带 token 403，带 token 200，面板能装插件。

### 步骤 3：请求边界

1. 新建 `src/requestTrust.ts` + 单测；
2. `server.ts` 在 `cors()` 后挂 `/api/*` 中间件；
3. 默认 `trustedOrigins` 包含 `http://localhost:5288`、`http://127.0.0.1:5288`；
4. 跑测试与真机验证（含 dev 代理）；
5. 提交。

验收：恶意 Origin 403，正常浏览器与 dev 页面正常。

## 九、风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| 前端 dev 被 Origin 校验误拦 | 画布打不开数据 | 默认白名单 5288；失败时用 `--no-admin-auth` 排障 |
| 旧脚本/测试未带 token | CI 变红 | 测试统一传入固定 token；文档列出调用点 |
| token 泄露到页面 HTML | 同源页面可读 | 只在本机 loopback 托管时注入；不监听 0.0.0.0 |
| 审计日志变大 | 占磁盘 | JSONL 文本，单条几百字节；后续可加按大小滚动 |
| 用户忘记 token | 装不了后台插件 | 启动日志打印 + 文件位置提示 + 面板引导 |

回滚：三层都可用 `--no-admin-auth` 一次性关闭；代码按 commit 粒度可单独 revert。

## 十、验收清单

- [ ] 无 token 调 install 返回 403，文件未写入
- [ ] 正确 token 调 install 返回 200，文件写入并热装
- [ ] 错误 token 返回 403，审计记 `admin/auth-failed`
- [ ] `Origin: http://evil.example` 被 403
- [ ] `sec-fetch-site: cross-site` 被 403
- [ ] `http://localhost:5288`（dev 代理）正常
- [ ] `audit.log` 能看到每次安装的 id / sha256 / 来源 / 结果
- [ ] 启动日志打印 token 与文件位置
- [ ] `--no-admin-auth` 打印警告且接口恢复可用
- [ ] cloud-server 全量测试与 typecheck 通过
- [ ] ui 全量测试与 typecheck 通过

## 十一、明确不在本次范围

1. 后端插件 worker/子进程隔离（见对话中的评估，等功能变多再做）；
2. 插件权限声明字段的强制执行；
3. MCP 端点的独立鉴权；
4. 依赖/供应链扫描；
5. 审计日志的 Web 查看界面。
