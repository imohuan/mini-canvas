# cloud-server 管理面安全加固方案（最终版）

> 状态：待实施。本文档是执行依据，不含已落地代码。
> 适用：`packages/cloud-server`、`packages/plugins/plugin-manager`、`packages/ui`。
> 参照：DeepSeek Harness（DSH）的浏览器令牌与请求信任边界（`deepseek-harness/packages/client/connection/README.zh.md`、`src/api-request-trust.ts`）。

## 一、为什么做这件事

后台跑在 `127.0.0.1:8865`，而**浏览器里任何一个网页**都能向这个地址发 POST。于是：

1. 你开着画布、顺手点开一个恶意网页，它就能调 `POST /api/server-plugins/install`，把一段以服务端权限运行的 JS 写进 `server-plugins/`；
2. 它还能调 `POST /api/agent/mcp`，用 `kind: 'stdio'` 直接让后台执行任意命令（比装插件更直接）；
3. 现有 install 路由的“同源检查”读的是 **JSON body 里的 `origin` 字段**，那是调用方自己填的，伪造即可绕过；
4. 装了什么、何时装的、代码哈希多少，装完没有任何记录。

这套改动要堵住第 1、2、3 条，并为第 4 条留账。

## 二、边界（先说清楚能防什么）

**能防住**

| 威胁 | 手段 |
|---|---|
| 任意网页向本机后台投递代码/命令 | 管理令牌 + 请求边界 |
| 局域网其它机器（若监听 0.0.0.0） | Host 白名单 + 令牌 |
| DNS 重绑定 | Host 头必须为本机/白名单 |
| 跨站浏览器请求（CSRF） | Origin 必须等于 Host；`sec-fetch-site: cross-site` 拒绝 |
| 事后无法追溯 | JSONL 审计日志 |

**防不住（与 DSH 同级，属行业现实）**

1. 用户自己确认安装的恶意插件；
2. 已获得本机文件读写权限的攻击者（可同时改令牌文件与审计日志）；
3. 插件在进程内滥用宿主权限（没有插件级沙箱）；
4. 第三方依赖供应链投毒；
5. 已授权的插件通过合法 API 读取画布数据（越权之外的行为管不了）。

> 结论：这套改动把“别人塞进来”这条路堵死；“装进来之后能干什么”要靠后续的进程隔离与能力收窄。

## 三、现状证据（改动前的真实代码）

| 位置 | 事实 |
|---|---|
| `routes/serverPlugins.ts:106` | `POST /api/server-plugins/install` 接受 `code` 文本写盘 |
| 同上 `:111` | 仅要求 body `confirm === true` |
| 同上 `:115-119` | “同源检查”读的是 **body.origin 字符串**，可伪造 |
| 同上 `:123` | id 白名单 `[A-Za-z0-9_-]{1,64}`，防路径穿越 |
| 同上 `:136-143` | 服务端可信 sha256 比对（防传输篡改） |
| `routes/npmPlugins.ts:366/379/410` | NPM 安装/更新/卸载，同样只需 `confirm: true` |
| `routes/agent.ts:161` | `POST /api/agent/mcp` 支持 `kind: 'stdio'` + `command` + `args` → **执行任意命令**（`agent/config.ts:969-972`） |
| `routes/agent.ts:144` | `POST /api/agent/skills/import` 按路径读目录并落盘技能 |
| `routes/agent.ts:210/230/248/269/298` | 改写系统提示词、模板、prompts、标题模型、策略 |
| `routes/agentSessions.ts` | 会话创建/改/删/中止/队列/goal/审批等 15+ 个写接口 |
| `routes/canvasOps.ts`、`routes/canvases.ts`、`routes/projects.ts`、`routes/assets.ts`、`routes/history.ts`、`routes/kv.ts` | 大量写接口（画布、项目、资产、历史、KV） |
| `server.ts:445` | `app.use('*', cors())` —— hono 默认 `origin: '*'`（见 `node_modules/.pnpm/hono@4.13.5/.../cors/index.js:4`），即当前**对所有来源开放 CORS** |
| `routes/mcp.ts:42` | `app.all('/mcp')` 无任何鉴权，MCP 工具可批量改画布 |
| `routes/agentChat.ts:77` | `POST /api/agent/chat/completion` 无鉴权（可被网页当作免费模型代理） |
| `cli.ts:184-206` | 启动日志位置，适合打印令牌 |

## 四、最终设计

### 4.1 总原则

1. **分级保护，先封「能执行代码」的路口**：首版只对「会引入可执行代码或执行命令」的接口要令牌（清单见第十三节，共 23 个入口，含插件运行时注册的路由），而不是对所有写接口。原因见第十三节：视觉节点的沙箱 iframe 拿不到令牌，全量按方法保护会打断正常功能。后续升级到「所有写方法都要令牌」，那时先做宿主代发。
2. **读接口与画布数据写接口用请求边界保护**：`/api/*` 全部经过 Host/Origin 检查（GET 也要），只对同源浏览器与 curl 本机放行。
3. **失败关闭**：校验拿不到结论一律 403。
4. **逃生口要显式**：`--no-admin-auth` 仅在同时设置 `MINI_CANVAS_ALLOW_INSECURE=1` 时生效，且启动打印醒目警告。
5. **令牌不出现在页面可读的位置**：不用 `<meta>` 注入，改 HttpOnly cookie 或手动输入。
6. **首版与终态分开写清楚**：第十三节给出首版范围，升级路径在第十二节之后说明。

### 4.2 审计日志（P0）

新增 `packages/cloud-server/src/audit.ts`：

```ts
export type AuditAction =
  | 'write'            // 受保护入口的写请求（首版只记第十三节那些）
  | 'server-plugin/install'
  | 'server-plugin/uninstall'
  | 'npm-plugin/install'   | 'npm-plugin/update' | 'npm-plugin/uninstall'
  | 'agent/mcp-add'    | 'agent/mcp-remove'
  | 'auth-failed'

export interface AuditEntry {
  at: string        // ISO8601
  action: AuditAction
  method: string
  path: string
  id?: string
  sha256?: string
  size?: number
  origin?: string
  host?: string
  token: 'ok' | 'missing' | 'bad' | 'disabled'
  result: 'attempt' | 'ok' | 'rejected'
  reason?: string
  prev?: string     // 上一条记录的 hash（防篡改链）
  hash?: string     // 本条记录内容的 sha256
}

export function createAuditLog(filePath: string): {
  append(e: Omit<AuditEntry, 'at' | 'prev' | 'hash'>): Promise<void>
}
```

实现要点：

- 路径 `{dataDir}/audit.log`，JSONL；
- 每条记录计算 `hash = sha256(去掉 hash 字段后的 JSON)`，`prev` 取上一条的 `hash`，形成链；被删改后链会断，可检测（但不能阻止）；
- `fs.appendFile` 失败只 `console.warn`，不阻断；
- 绝不记录令牌原文；
- 写入顺序：**进入写路由先记 attempt → 执行 → 成功后补一条 ok**（失败补 rejected）。

不提供 HTTP 读取接口——那等于把日志暴露给网页。查看方式写进文档：`type .mini-canvas\audit.log`。

### 4.3 管理令牌（P0）

新增 `packages/cloud-server/src/adminAuth.ts`：

```ts
export interface AdminAuth {
  readonly token: string
  readonly tokenFile: string
  verify(v: string | undefined): 'ok' | 'missing' | 'bad'
}
export async function createAdminAuth(opts: {
  dataDir: string
  enabled: boolean
  fixedToken?: string   // MINI_CANVAS_ADMIN_TOKEN
}): Promise<AdminAuth>
```

规则：

1. 文件 `{dataDir}/admin-token`，内容 64 位 hex（`randomBytes(32)`）；存在则读，长度不足 32 或非 hex 则重新生成并警告；
2. 比较用 `crypto.timingSafeEqual`；
3. 请求头 `x-admin-token`；
4. **首版保护范围**（方案 C，见第十三节）：只匹配下列前缀，一律要令牌：

   ```
   /api/server-plugins/     /api/npm-plugins/
   /api/agent/mcp           /api/agent/skills
   /api/agent/system-prompt /api/agent/template/
   /api/agent/prompts       /api/agent/policy
   /api/agent/title-model
   ```

   这些是「能引入可执行代码或执行命令」的全部入口（第十三节有逐条依据）。
5. **暂不保护**：`GET/HEAD` 读接口；画布 / 资产 / 项目 / 历史 / KV 等数据写接口（靠 4.5 的请求边界保护）；`/mcp`（单独议题）。升级到全量方法保护时，这些再一起加。

覆盖方式：在 `server.ts` 的 `cors()` 之后挂一个中间件，而不是逐个路由改：

```ts
app.use('/api/*', async (c, next) => {
  if (!isAdminPath(c.req.path)) return next()      // 首版：只拦第十三节的后缀白名单
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return next()
  const verdict = auth.verify(c.req.header('x-admin-token'))
  if (verdict !== 'ok') { await audit.append({ ...result:'rejected' }); return c.json({...}, 403) }
  await next()
})
```

### 4.4 令牌如何到达前端

三选一，**推荐 A 为主 + B 兜底**：

**A. 手动输入（安全，推荐默认）**

- 插件管理页新增「管理令牌」输入框，存 `localStorage`；
- 访问第十三节清单里那些入口时带 `x-admin-token`（其余请求不需要）。

**B. 托管页写入 HttpOnly cookie（自动，需服务端配合）**

- 服务端在 `GET /` 返回时设置 `Set-Cookie: mc_admin=...; HttpOnly; SameSite=Strict; Path=/`；
- 前端 JS 读不到，但浏览器自动带上；
- 服务端校验时先看 `x-admin-token`，没有再看 cookie；
- 前提：画布页与接口同源（托管模式满足；dev :5288 不满足，走 A）。

**C. 环境变量（dev / CI）**

- 服务端 `MINI_CANVAS_ADMIN_TOKEN` 指定固定令牌；
- 前端 `VITE_ADMIN_TOKEN` 在 dev 下写入请求头。

**明确不做**：把令牌注入 `<meta>` 标签。画布里加载的任何第三方前端插件都能读到它。

### 4.5 请求边界（P1）

新增 `packages/cloud-server/src/requestTrust.ts`：

```ts
export function requestTrust(opts: {
  trustedHosts: string[]      // 如 ['127.0.0.1:8865', 'localhost:8865']
  trustedOrigins?: string[]   // 显式追加，如 dev 代理
})
```

规则（任一失败 403）：

1. `Host` 必须等于 `trustedHosts` 中一项（默认由启动时 `hostname:port` 生成，支持 port=0 实际端口）；
2. 带 `Origin` 时，必须等于 Host 的 origin 或在 `trustedOrigins`；
3. `sec-fetch-site: cross-site` 一律 403；
4. 只作用于 `/api/*`。

挂载：`server.ts` 第 445 行 `cors()` 之后。

**dev 代理的处理**：

- 默认**不**把 5288 写进白名单（避免任意本地项目占端口就获得权限）；
- 需要时用 `--trusted-origin http://localhost:5288` 显式开启，或设置 `MINI_CANVAS_TRUSTED_ORIGINS`；
- 文档给出启动命令示例。

**CORS 也要收紧**：当前 `cors()` 默认 `origin: '*'`。改为同源（与 Host 一致）或显式白名单；`allowMethods` 保留需要的集合。

## 五、接口契约

### 5.1 新增请求头

```
x-admin-token: <64 位 hex>
```

第十三节清单里的入口必需（除非 `--no-admin-auth` + `ALLOW_INSECURE`）。

### 5.2 错误响应

| 情况 | 状态 | body |
|---|---|---|
| 缺令牌 | 403 | `{ ok:false, error:'需要管理令牌（x-admin-token）；见启动日志或 <dataDir>/admin-token' }` |
| 令牌错 | 403 | 与上同（不区分缺失/错误，避免探测） |
| Host/Origin 不可信 | 403 | `{ ok:false, error:'请求来源不受信任' }` |

### 5.3 开关

| 开关 | 作用 |
|---|---|
| `--no-admin-auth` + `MINI_CANVAS_ALLOW_INSECURE=1` | 关闭令牌与请求边界（审计仍记），启动警告 |
| `MINI_CANVAS_ADMIN_TOKEN` | 固定令牌 |
| `MINI_CANVAS_TRUSTED_ORIGINS` | 额外 Origin 白名单（逗号分隔） |

## 六、要同步修改的调用方

| 位置 | 改什么 |
|---|---|
| `packages/plugins/plugin-manager/src/pluginManagerService.ts` | 对第十三节清单里的入口（install/uninstall/update、NPM 操作、Agent 配置写）带 `x-admin-token`；403 时提示“请先在设置里填写管理令牌” |
| `packages/plugins/plugin-manager/src/components/settings/PluginManagerPage.vue` | 新增令牌输入框（密码类型），存 localStorage |
| `packages/ui/src/**` 其它写请求 | 首版**不需要**令牌（不在第十三节清单里）；等升级到全量方法保护时，统一用 `adminFetch()` 加头 |
| `packages/cloud-server/src/__tests__/serverPluginsRoute.test.ts` | 全部写请求补令牌；新增缺失/错误 403 用例 |
| `packages/cloud-server/e2e/*.ts` | 起服务时传入固定令牌 |
| `packages/plugins/plugin-hot-reload-demo/scripts/watch.mjs` | 只 PUT KV；**首版 KV 不在保护范围，无需改**。升级到全量写保护时，再改为从环境变量读取并带 `x-admin-token` |

> 注意：`watch.mjs` 给 KV 写门铃。首版不保护 KV，所以热重载不受影响；**一旦升级到全量写保护，必须同步改它，否则热重载会 403**。这里提前记下，避免升级时漏改。

## 七、测试计划

### 7.1 新增单测

| 文件 | 用例 |
|---|---|
| `src/__tests__/adminAuth.test.ts` | 生成/读取一致；长度异常重建；`timingSafeEqual` 分支；不泄露令牌 |
| `src/__tests__/audit.test.ts` | JSONL 追加；目录自动创建；hash 链连续；写失败不抛；不含令牌 |
| `src/__tests__/requestTrust.test.ts` | 合法 Host 放行；非法 Host 403；Origin≠Host 403；cross-site 403；trustedOrigins 放行；非 /api 不拦 |
| `src/__tests__/adminGuard.test.ts` | GET 放行；POST/PUT/PATCH/DELETE 无令牌 403；有令牌放行 |

### 7.2 路由测试（改）

`serverPluginsRoute.test.ts` 与 `npmPluginsRoute.test.ts`：

1. 无令牌 → 403，文件未写入；
2. 错令牌 → 403；
3. 正确令牌 → 200；
4. 审计日志出现 attempt/ok。

### 7.3 回归命令

```bash
pnpm -C packages/cloud-server test
pnpm -C packages/cloud-server typecheck
pnpm -C packages/ui test
pnpm -C packages/ui typecheck
```

### 7.4 真机验收（逐条执行）

```bash
# 1. 起服务，记录令牌
pnpm -C packages/cloud-server serve

# 2. 无令牌写接口 → 403
curl -i -X POST http://127.0.0.1:8865/api/server-plugins/install -d '{}'

# 3. 带令牌 → 非 403（缺 confirm 等业务 400 也算通过校验）
curl -i -X POST http://127.0.0.1:8865/api/server-plugins/install \
  -H 'x-admin-token: <TOKEN>' -d '{}'

# 4. 恶意 Origin → 403
curl -i -X POST http://127.0.0.1:8865/api/server-plugins/install \
  -H 'Origin: http://evil.example' -d '{}'

# 5. 读接口不要求令牌
curl -i http://127.0.0.1:8865/api/kv/config/settings

# 6. 审计日志
type .mini-canvas\audit.log
```

## 八、实施步骤（四个 commit）

| # | 内容 | 验收 |
|---|---|---|
| 1 | `adminAuth.ts` + 中间件（**首版路径白名单**）+ `--no-admin-auth` + 单测 | 第十三节的 23 个入口无令牌 403；画布/资产写接口不受影响 |
| 2 | `audit.ts` + 接入写路由 + hash 链 + 单测 | 日志出现 attempt/ok，链连续 |
| 3 | `requestTrust.ts` + 收紧 CORS + 单测 | 恶意 Origin 403，正常浏览器通过 |
| 4 | 前端 `adminFetch()`（仅受保护入口）+ 面板令牌输入 + 改测试 | 面板能装插件，热重载不受影响 |

先做 1（真正堵洞），再做 2（留痕），3 与 4 紧随。

## 九、风险与回滚

| 风险 | 缓解 |
|---|---|
| 前端写请求被 403 | 首版只拦 23 个入口，画布数据与 watch 门铃都不受影响；只有插件面板需要带令牌 |
| dev 代理被 Origin 拦 | 显式 `--trusted-origin`，文档给命令 |
| 旧脚本/测试未带令牌 | 测试统一固定令牌；文档列全调用点 |
| 令牌泄露 | 不注入 meta；cookie 用 HttpOnly；不写日志 |
| 审计日志被插件删除 | hash 链可发现；日志与数据目录分开可再加强 |

回滚：`--no-admin-auth` + `MINI_CANVAS_ALLOW_INSECURE=1` 一次性关闭；按 commit revert。

## 十、验收清单

- [ ] 无令牌调第十三节清单里的任一入口返回 403（含 `/api/task/call`）
- [ ] 正确令牌调这些入口通过校验
- [ ] 画布/资产/项目/KV 的写接口**不**要求令牌（首版）
- [ ] GET 接口不需要令牌
- [ ] `Origin: http://evil.example` 被 403
- [ ] `sec-fetch-site: cross-site` 被 403
- [ ] 托管页面（同源）写请求正常
- [ ] dev 页面（显式 trusted-origin）写请求正常
- [ ] `audit.log` 记录 attempt / ok / auth-failed，hash 链连续
- [ ] 启动日志打印令牌与文件位置
- [ ] `--no-admin-auth` 单独使用无效，必须配合 `MINI_CANVAS_ALLOW_INSECURE=1`
- [ ] cloud-server 测试与 typecheck 全绿
- [ ] ui 测试与 typecheck 全绿
- [ ] 插件管理面板能装/卸后台插件
- [ ] plugin-hot-reload 的 watch 门铃仍能送达
- [ ] 受保护入口清单（23 条）与 `adminAuth` 里的前缀表逐条一致（有测试锁住）
- [ ] 新增插件注册后台路由时，能通过统一声明标记鉴权等级（长期机制，见第十四节）

## 十一、不在本次范围

1. 后端插件 worker / 子进程隔离；
2. 插件权限声明与能力注入；
3. `/mcp` 独立鉴权（建议下一步单独做：MCP 工具能批量改画布，且当前完全无鉴权）；
4. `/api/agent/chat/completion` 的成本控制（当前可被网页当免费代理）；
5. 审计日志 Web 查看界面；
6. 依赖与供应链扫描。

## 十二、后续建议（按价值排序）

1. **`/mcp` 鉴权**：它现在无任何校验，能改任意画布，暴露面比安装接口更大；
2. **`chat/completion` 限流/鉴权**：防止被网页当免费模型代理；
3. **后端插件 worker 隔离**：缩小爆炸半径；
4. **审计日志与数据目录分离**：插件拿不到日志文件。

## 十三、实施前必须解决的一个冲突（重要）

按方法保护（所有 POST/PUT/PATCH/DELETE 要令牌）能堵住所有洞，但会**打断一批正常功能**。这些写请求来自不同位置，令牌不一定拿得到：

| 调用方 | 写请求 | 能否带令牌 |
|---|---|---|
| `packages/ui` 自身的画布保存、主题、项目、资产 | `method: 'POST/PUT/DELETE'`（约 12 处，已扫描） | ✅ 同源，能带 |
| `plugin-manager` 面板 | 插件安装/卸载、NPM 操作 | ✅ 同源，能带 |
| `plugin-cloud-client`（后台客户端） | 画布增量写、资源上传、KV 写（`/n/...` 为 `/api/...` 的别名） | ⏸ 首版不需要改（都不在 23 个入口里）；升级全量保护时再加令牌 |
| 视觉节点 iframe（`sandbox="allow-scripts"`，不透明源） | AI 生成的界面里的上传/写请求 | ❌ **拿不到令牌**（跨源、读不到 localStorage、也没有同源 cookie） |
| 外部 MCP 客户端 | `/mcp` 的写工具 | ❌ 不在 `/api` 下，当前无鉴权 |
| `watch.mjs` | KV 门铃 | ⏸ 首版不受影响；升级全量保护时才需要令牌 |

### 瓶颈：不透明源 iframe

`packages/plugins/plugin-node-ui/src/uiOrigin.ts` 的注释写明：节点里的页面住在 `sandbox="allow-scripts"` 的 iframe 里，请求全算跨源（`Origin: null`）。这类请求：

1. 读不到 `localStorage`（不透明源）；
2. 带不上 HttpOnly cookie（跨源，且 SameSite=Strict 会拒）；
3. 只能走 `postMessage` 让宿主代发。

所以若严格按方法保护，**视觉节点里的上传和写操作会全部 403**。

### 三个可选解法

**方案 A：宿主代发（推荐）**

- iframe 通过 `postMessage` 把请求交给宿主，宿主用令牌代发；
- 优点：安全模型完整，iframe 永远拿不到令牌；
- 代价：要改 `plugin-node-ui` 的桥接层，工作量中等。

**方案 B：给 iframe 一类只读/受限令牌**

- 服务端签发短期、限路径的令牌给 iframe；
- 复杂度高，容易做错，不推荐首版。

**方案 C：按前缀分级保护（务实）**

- 只保护**会引入代码/执行命令**的接口：`/api/server-plugins/*`、`/api/npm-plugins/*`、`/api/agent/mcp*`、`/api/agent/skills/*`、`/api/agent/system-prompt`、`/api/agent/template/*`、`/api/agent/prompts`、`/api/agent/policy`、`/api/agent/title-model`、`/api/task/*`、`/api/node-packages/*`、`/api/node-ui/debug-*`、`/api/style-library/reload`；
- 画布数据、资产、项目、KV 等高频写接口暂不加令牌，只靠请求边界（Host/Origin）保护；
- 优点：改动小，不破坏视觉节点；缺点：仍留一条“网页可写画布数据”的路（危害远小于执行代码）。

### 建议

**首版走方案 C**：先把「能执行代码」的口子全部封死（这是真正的投毒路径），画布数据类写接口暂缓。等方案 A 的宿主代发做好，再升级到按方法全保护。

这样第一步能在一两天内落地，且不会把现有画布功能打残。

### 首版受保护接口清单（方案 C 的准确范围）

```
POST /api/server-plugins/install
POST /api/server-plugins/uninstall
POST /api/npm-plugins/install
POST /api/npm-plugins/update
POST /api/npm-plugins/uninstall
POST /api/agent/mcp
DELETE /api/agent/mcp
POST /api/agent/skills/import
DELETE /api/agent/skills/:name
PUT  /api/agent/system-prompt
POST /api/agent/template/restore
PUT  /api/agent/prompts
PUT  /api/agent/policy
PUT  /api/agent/title-model
POST /api/task/call
POST /api/node-packages/build
POST /api/node-packages/save
POST /api/node-packages/export
POST /api/node-packages/inspect
POST /api/node-packages/import
POST /api/node-ui/debug-accept
POST /api/node-ui/debug-result
POST /api/style-library/reload
```

清单靠**路径前缀匹配**实现（`/api/server-plugins/`、`/api/npm-plugins/`、`/api/agent/mcp`、`/api/agent/skills`、`/api/agent/system-prompt`、`/api/agent/template/`、`/api/agent/prompts`、`/api/agent/policy`、`/api/agent/title-model`、`/api/task/`、`/api/node-packages/`、`/api/node-ui/debug-`、`/api/style-library/reload`），不逐个写死方法。

> 后 9 条来自第十四节：它们是**插件运行时注册**的路由（`ctx.routes.*`），静态扫描看不到。`/api/task/call` 能执行任意脚本，是这批里最危险的。

同时必须改：

- `plugin-manager` 面板的写请求带令牌；
- `watch.mjs` 首版不用改（KV 不在保护范围）。升级到全量写保护时，再给它加令牌；
- `plugin-cloud-client` 首版不用改：它写的是画布数据与 KV，都不在 23 个入口里。升级全量写保护时再加令牌。

## 十四、动态攻击面：插件自己注册的后台路由（补充）

前面第十三节只扫了 `packages/cloud-server/src` 里的固定路由。但后台插件可以**在运行时注册自己的路由**，这部分对静态扫描不可见：

```ts
ctx.routes.post('/api/xxx', handler)   // 插件后台半，热装后立刻可用
```

实际扫到的例子（`plugin-node-ui` 的后台半）：

| 路由 | 能力 | 证据 |
|---|---|---|
| `POST /api/task/call` | **执行节点脚本**：`import(scriptURL)` 跑任意 Node 代码，脚本里可 `import('node:fs')` 读写本机文件 | `task/routes.ts:243`、`task/runner.ts:58/114` |
| `POST /api/node-packages/export` | 打包并**写到本机下载目录** | `task/packRoutes.ts:199` |
| `POST /api/node-packages/save` | 打包并写入资产库 | `task/packRoutes.ts:177` |
| `POST /api/node-packages/import` | 导入包并落地 | `task/importRoutes.ts:106` |
| `POST /api/node-ui/debug-accept` / `debug-result` | 调试会话通道 | `server.ts:1270/1359` |
| `POST /api/style-library/reload` 等 | 后台插件自己的写接口 | `plugin-style-library/src/server.ts` |

### 风险等级

`/api/task/call` 比 `/api/agent/mcp` **更危险**：

1. 它不需要改配置，一条 POST 就能执行脚本；
2. 脚本子进程里 `import('node:fs')` 是**完整 fs**，不限于 dataRoot；
3. 唯一的门是 `authorizeScriptCall`：要求调用方**自己填的 nodeId** 对应的节点，其 `data.uiScripts` 里声明了要跑的脚本名。

这意味着：**只要能改画布节点数据**（`POST /api/canvases/:id/nodes` 目前不需要令牌），攻击者就能先给某个节点写上 `uiScripts` 声明，再调 `/api/task/call` 执行。这条链绕过了我们首版的所有保护。

### 处理办法（按务实程度排序）

**首版（必须做）**：把 `/api/task/call`、`/api/node-packages/*/*` 加进第十三节的白名单。它们都是「能执行代码或写本机文件」的入口。

**同时**：由于 `authorizeScriptCall` 依赖节点数据，而节点数据可被网页改，需要在首版里把「写节点数据」也纳入保护，否则链仍然通。两个选择：

- 让 `POST /api/canvases/:id/nodes` 也要求令牌（会打断视觉节点的自动写回，需同步做宿主代发）；
- 或者给 `/api/task/call` 加一个**独立的脚本执行令牌**（只允许持令牌的宿主调用，iframe 永远拿不到）。

推荐第二个：影响面小，且和「视觉节点不该能执行任意脚本」的设计意图一致。

**升级版**：给插件注册的路由加**统一的注册时声明**（如 `ctx.routes.post(path, handler, { auth: 'admin' })`），由内核统一套鉴权，而不是每个插件自己记得。这需要改 `serverFramework/routes.ts`，属于架构改动。

### 对首版清单的修订

第十三节的主清单已并入下面这些（共 23 个入口）：

```
现有 14 个
+ POST /api/task/call
+ POST /api/node-packages/build
+ POST /api/node-packages/save
+ POST /api/node-packages/export
+ POST /api/node-packages/inspect
+ POST /api/node-packages/import
+ POST /api/node-ui/debug-accept
+ POST /api/node-ui/debug-result
+ POST /api/style-library/reload
```

并加一条**长期机制**：插件注册后台路由时声明鉴权等级，避免今后新增插件又漏。

### 为什么这条之前没写进文档

之前的方案只扫了 `packages/cloud-server/src/routes`，没有扫 `packages/plugins/*/src` 里的 `ctx.routes.*`。这类路由是**运行时注册**的，静态清单不可能穷举——所以最终必须落到「注册时声明鉴权」，而不是继续补白名单。


