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

1. **分级保护，先封「能执行代码」的路口**：首版只对「会引入可执行代码或执行命令」的接口要令牌（清单见第十三节：34 个单条入口，另加 `/api/showcase/` 与 `/api/agent/canvases/` 两个前缀组），而不是对所有写接口。原因见第十三节：视觉节点的沙箱 iframe 拿不到令牌，全量按方法保护会打断正常功能。后续升级到「所有写方法都要令牌」，那时先做宿主代发。
2. **读接口与画布数据写接口用请求边界保护**：`/api/*` 全部经过 Host/Origin 检查（GET 也要），只对同源浏览器与 curl 本机放行。
3. **失败关闭**：校验拿不到结论一律 403。
4. **逃生口要显式**：`--no-admin-auth` 仅在同时设置 `MINI_CANVAS_ALLOW_INSECURE=1` 时生效，且启动打印醒目警告。
5. **令牌不做被动泄露**：不用 `<meta>` 注入、不写进任何接口响应。首版用手动输入存 `localStorage`——注意它挡得住「别的网站」，挡不住「同源的前端插件」（见 4.4 末尾）；真要做到页面读不到，只有 HttpOnly cookie 一条路。
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
   # 安装 / 执行代码
   /api/server-plugins/      /api/npm-plugins/
   /api/agent/mcp            /api/agent/skills
   /api/task/                /api/node-packages/

   # 改服务端行为（提示词 / 模板 / 策略 / 出网目标）
   /api/agent/system-prompt  /api/agent/template/
   /api/agent/prompts        /api/agent/policy
   /api/agent/title-model    /api/agent/models
   /api/agent/chat/completion

   # 写本机文件 / 改读取根目录 / 调试通道
   /api/node-ui/debug-       /api/style-library/
   /api/effect-library/      /api/showcase/

   # Agent 会话（间接执行命令 + 花钱）
   /api/agent/canvases/
   ```

   这些是「能引入可执行代码、执行命令、或改变服务端出网目标」的全部入口，共 34 条具体路由（第十三节有逐条清单，第十四、十五节有来源说明）。
   `/api/agent/mcp` 这条前缀同时覆盖 `POST /api/agent/mcp/probe`（它会去拉起已配置的 stdio 命令）。
   `/api/effect-library/` 与 `/api/style-library/` 是**同一段代码用两份规格各注册一遍**（`LIBRARIES` 数组，`plugin-style-library/src/server.ts:80-97`），只保护一个会漏掉另一个。
   注意 `/api/showcase/` 是一条前缀组，覆盖 `plugin-showcase` 注册的 11 个写接口。
5. **暂不保护**：`GET/HEAD` 读接口；画布 / 资产 / 项目 / 历史 / KV 等数据写接口（靠 4.5 的请求边界保护）；`/mcp`（单独议题）。升级到全量方法保护时，这些再一起加。

覆盖方式：在 `server.ts` 的 `cors()` 之后挂一个中间件，而不是逐个路由改。**必须挂在 `await host.start()` 之前**——插件路由是在 `start()` 时一次性 flush 成 Hono 代理的，晚于它挂的 `use` 不会作用到那些代理上。

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

**A 方案也有同一个弱点，要说清楚**：`localStorage` 是**同源共享**的。任何装进画布的前端插件都和画布页面同源，都能 `localStorage.getItem('mc_admin_token')` 把令牌读走，然后自己去装后台插件。

所以「不注入 meta」只挡住了「随手就能读到的被动泄露」，挡不住「主动去读」。真正的分界在第二节那张表：

- 防得住：**别的网站**（不同源，读不到 localStorage）；
- 防不住：**已经装进画布的插件**（同源，能做页面能做的一切）。

想把这一层也收紧，只有 B（HttpOnly cookie）能做到——JS 读不到，只能由浏览器自动带上。代价是要多一层 CSRF 校验（Origin/Host 检查已经在 4.5 里了，正好够用），且 dev :5288 跨源拿不到 cookie，仍得回落到 A。

首版建议：按 A 做（简单、dev 也能用），并在插件管理页写明「令牌存在本机浏览器，装了不可信插件等于把令牌交给它」。

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
2. 带 `Origin` 时，必须等于 Host 的 origin 或在 `trustedOrigins`；**`Origin: null` 一律拒绝**——详见第十六节（实测证明「给 null 开例外」等于对所有网页开例外）；
3. `sec-fetch-site: cross-site` 一律 403；
4. 只作用于 `/api/*`。

**第 1 条（Host 白名单）和令牌是仅有的两道承重墙。** 第 2、3 条只能挡「懒得伪装」的浏览器请求，因为：

- 攻击者可以从一个**恶意域名**发起，再用 `Host` 头声称自己是 `127.0.0.1:8865`——非浏览器程序发 HTTP 时可以随便写 Host；
- 或者做 DNS 重绑定：让 `evil.test` 先解析到自己的服务器（页面正常加载），再解析到 `127.0.0.1`。浏览器认为「同源」，服务端看到的 Host 就是 `evil.test:8865`。

实测（`.scratch/header-probe/run8-rebind.mjs`，Chrome 153 + `--host-resolver-rules`）：把 `rebind.test` 指到 `127.0.0.1`，页面用相对路径 fetch，服务端收到的 `host: rebind.test:<端口>`，请求**成功**。
说明只写「Origin 必须等于 Host」时，重绑定页面的 Origin 也是 `rebind.test`，两者相等，规则通过。

所以 Host 白名单不能写成「等于 `127.0.0.1:8865` 或 `localhost:8865`」再附加「其它也放行」；它必须是**白名单**：不认识的 Host 直接 403。这一条不做，DNS 重绑定就是通的路。

> 本轮实测还发现：`Server` 启动时如果监听 `0.0.0.0`，Host 头可以是任意内网 IP。Host 白名单要按「启动时实际绑定的 hostname + port」生成，并在 `--host 0.0.0.0` 时显式打印警告。

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
| `packages/plugins/plugin-agent/src/agentApi.ts` | 这个文件把**所有** Agent 请求都走 `json()`（`:202`）；对话面板的所有会话写请求都从这里出去。在 `json()` 里统一加 `x-admin-token` 即可一次覆盖，不用逐个调用点改 |
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

## 八、实施步骤（五个 commit）

| # | 内容 | 验收 |
|---|---|---|
| 0 | 资源回读加 `CSP: sandbox` + `X-Content-Type-Options: nosniff`（第十九节） | 带脚本的 SVG 打开后不执行；`<img>` 引用仍正常 |
| 1 | `adminAuth.ts` + 中间件（**首版路径白名单**）+ `--no-admin-auth` + 单测 | 第十三节的 34 个入口 + `/api/showcase/`、`/api/agent/canvases/` 两组无令牌 403；画布/资产写接口不受影响 |
| 2 | `audit.ts` + 接入写路由 + hash 链 + 单测 | 日志出现 attempt/ok，链连续 |
| 3 | `requestTrust.ts` + 收紧 CORS + 单测 | 恶意 Origin 403；第三方站点自造 sandbox iframe 仍被拒；视觉节点的处理按第十六节结论 |
| 4 | 前端 `adminFetch()`（仅受保护入口）+ 面板令牌输入 + **对话面板会话写请求** + 改测试 | 面板能装插件、能对话，热重载不受影响 |

顺序理由：**commit 0 最先**。只要同源 SVG 还能执行脚本，令牌就是「偷得到的东西」，后面的加固等于白做。然后做 1（堵洞）、2（留痕）、3 与 4。

> 3 与 1 的先后可以换，但**不要**在视觉节点还没处理的前提下先上线 3：它会让视觉节点直接坏掉。第十六节给了三条路，首版建议按「只放行 `/api/node-ui/info` 与素材上传」那一段做最小集。

## 九、风险与回滚

| 风险 | 缓解 |
|---|---|
| 前端写请求被 403 | 首版只拦 34 个入口加 showcase、agent-canvases 两组，画布数据与 watch 门铃都不受影响；插件面板与对话面板需要带令牌 |
| dev 代理被 Origin 拦 | 显式 `--trusted-origin`，文档给命令 |
| 旧脚本/测试未带令牌 | 测试统一固定令牌；文档列全调用点 |
| 令牌泄露 | 不注入 meta；cookie 用 HttpOnly；不写日志 |
| 回读 SVG 执行脚本 | 第十九节：CSP + nosniff，放进 commit 0 |
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
- [ ] 受保护入口清单（34 条，另加 `/api/showcase/` 前缀组共 11 个写接口）与 `adminAuth` 里的前缀表逐条一致（有测试锁住）
- [ ] 新增插件注册后台路由时，能通过统一声明标记鉴权等级（长期机制，见第十四节）
- [ ] `POST /api/agent/models` 无令牌返回 403（SSRF 入口）
- [ ] `baseUrl` 指向 `169.254.169.254` / `127.0.0.1` / 内网段时被拒绝（若本版实现内网拦截）
- [ ] `POST /api/agent/chat/completion` 无令牌返回 403
- [ ] 视觉节点（沙箱 iframe）能正常加载并上传素材（第十六节：靠票据，不是靠 Origin 例外）
- [ ] 视觉节点里的 `CanvasUI.task()` **仍被 `/api/task/call` 的令牌挡住**（它走的是同一路径，不能因为加例外而放行）
- [ ] 无票据的 `Origin: null` 请求一律 403（给 null 开例外 = 对所有网页开例外）
- [ ] Host 头写成别的域名（如 `evil.test:8865`）被 403（DNS 重绑定，实测见 4.5）
- [ ] 第三方网页**自造 sandbox iframe** 打 `/api/*` 仍被拒绝（实测手法，见第十六节）
- [ ] 带脚本的 SVG 从 `/api/canvases/*/resources/*` 打开后不执行（第十九节）
- [ ] 对话面板能发消息、能点审批（`/api/agent/canvases/` 写请求带令牌）
- [ ] 会话列表、转录、SSE 流**不需要**令牌（读请求不受影响）

> 这两条互相牵制，实施时要一起验：视觉节点的 `CanvasUI.task()`（`plugin-node-ui/src/uiData.ts:610-630`）是**从沙箱 iframe 直接 POST `/api/task/call`** 的。
> 第十六节给 sandbox 开的例外如果写成「`Origin: null` 就放行」，这条路径会顺带被放开——等于把第十四节最危险的洞又打开了。
> 必须让「Origin 例外」只作用于读接口与素材上传，`/api/task/` 这类入口始终要令牌。

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
| `plugin-cloud-client`（后台客户端） | 画布增量写、资源上传、KV 写，全部走 `/api/canvases/...`、`/api/kv/...`（`src/api.ts:139/155/218/228/248`） | ⏸ 首版不需要改（都不在保护清单里）；升级全量保护时再加令牌 |
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
POST /api/agent/mcp/probe
POST /api/agent/skills/import
DELETE /api/agent/skills/:name
PUT  /api/agent/system-prompt
POST /api/agent/template/restore
PUT  /api/agent/prompts
PUT  /api/agent/policy
PUT  /api/agent/title-model
POST   /api/agent/models
DELETE /api/agent/models
PUT    /api/agent/models/bulk
POST   /api/agent/models/:kind
POST   /api/agent/models/available
POST   /api/agent/chat/completion
POST /api/task/call
POST /api/node-packages/build
POST /api/node-packages/save
POST /api/node-packages/export
POST /api/node-packages/inspect
POST /api/node-packages/import
POST /api/node-ui/debug-accept
POST /api/node-ui/debug-result
POST /api/task/cancel
PUT  /api/style-library/settings
POST /api/style-library/reload
PUT  /api/effect-library/settings
POST /api/effect-library/reload
POST/PUT/DELETE /api/showcase/*
POST/PUT/PATCH/DELETE /api/agent/canvases/*      ← 第十八节：间接执行命令 + 花钱
```

清单靠**路径前缀匹配**实现（`/api/server-plugins/`、`/api/npm-plugins/`、`/api/agent/mcp`、`/api/agent/skills`、`/api/agent/system-prompt`、`/api/agent/template/`、`/api/agent/prompts`、`/api/agent/policy`、`/api/agent/title-model`、`/api/agent/models`、`/api/agent/chat/completion`、`/api/task/`、`/api/node-packages/`、`/api/node-ui/debug-`、`/api/style-library/`、`/api/effect-library/`、`/api/showcase/`、`/api/agent/canvases/`），不逐个写死方法。

> `/api/agent/canvases/` 的**读**请求不受影响（中间件只看写方法），所以会话列表、转录、SSE 流照常；被拦的是发消息、改审批、加队列、设目标这些写操作。

> 清单后一半来自后续两节：第十四节的插件运行时注册路由（`ctx.routes.*`，静态扫描看不到）与第十五节的 SSRF 入口。`/api/task/call` 能执行任意脚本，是这批里最危险的；`PUT /api/style-library/settings` 与 `PUT /api/effect-library/settings` 能把读取目录改到任意路径，是第二梯队。

> 两处按前缀匹配而不是按单条路由匹配：`/api/agent/mcp` 会一并保护 `/api/agent/mcp/probe`（探测会拉起已配置的 stdio 命令）；`/api/style-library/` 与 `/api/effect-library/` 整段保护，避免以后新增子路由漏掉。

同时必须改：

- `plugin-manager` 面板的写请求带令牌；
- `plugin-agent` 的 `agentApi.ts` 在 `json()` 里统一带头（一处覆盖所有会话写请求）；
- `watch.mjs` 首版不用改（KV 不在保护范围）。升级到全量写保护时，再给它加令牌；
- `plugin-cloud-client` 首版不用改：它写的是画布数据与 KV，都不在保护清单里。升级全量写保护时再加令牌。

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
| `PUT /api/style-library/settings` | **把风格库根目录改成任意路径**（随后 `GET /file` 可从该目录读文件） | `plugin-style-library/src/server.ts:484` |
| `POST /api/style-library/reload` | 重扫风格库目录 | `plugin-style-library/src/server.ts:505` |
| `POST /api/task/cancel` | 取消任务（可打断别人在跑的任务） | `task/routes.ts:329` |
| `POST/PUT/DELETE /api/showcase/*` | 示例插件的 todo / store / heartbeat / middleware 写接口 | `plugin-showcase/src/server.ts:154-326` |

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

第十三节的主清单是这三块合并的结果：

```
14 条固定路由（server-plugins 2 + npm-plugins 3 + agent 配置 9）
+ 6 条 SSRF 入口（agent/models 5 + chat/completion 1）        → 20
+ 14 条（13 条插件运行时路由 + 1 条固定路由）：
    /api/task/call、/api/task/cancel
    /api/node-packages/{build,save,export,inspect,import}
    /api/node-ui/debug-{accept,result}
    /api/style-library/{settings,reload}
    /api/effect-library/{settings,reload}
    /api/agent/mcp/probe（固定路由，但会拉起已配置的 stdio 命令）
                                                              → 34
+ /api/showcase/ 前缀组（plugin-showcase 的 11 个写接口）
```

`/api/agent/mcp/probe` 容易被漏掉：它只是「检查连接」，但实现是真的去连一次——配置里若有 `stdio` 服务，这一步就会把那个命令跑起来。

`/api/effect-library/*` 容易被漏掉：它和 `/api/style-library/*` 是同一段代码用两份规格注册的（`LIBRARIES` 数组），扫代码时只看到一个前缀名。

并加一条**长期机制**：插件注册后台路由时声明鉴权等级，避免今后新增插件又漏。

### 为什么这条之前没写进文档

之前的方案只扫了 `packages/cloud-server/src/routes`，没有扫 `packages/plugins/*/src` 里的 `ctx.routes.*`。这类路由是**运行时注册**的，静态清单不可能穷举——所以最终必须落到「注册时声明鉴权」，而不是继续补白名单。

## 十五、SSRF 链路（补充确认）

`/api/agent/models` 允许写入任意 `baseUrl`，而 `assertHttpUrl` 只检查协议是 http/https：

```ts
// packages/cloud-server/src/agent/config.ts:1295
export function assertHttpUrl(raw: string): string {
  const parsed = new URL(raw)              // 只校验能解析
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw ...
  return raw                               // 不拦 127.0.0.1 / 169.254.169.254 / 内网段
}
```

配合无鉴权的 `POST /api/agent/chat/completion`，形成完整 SSRF：

```
1. POST /api/agent/models { provider: 'evil', modelId: 'x', baseUrl: 'http://169.254.169.254/latest' }
2. POST /api/agent/chat/completion { model: 'evil/x', messages: [...] }
3. 服务端带着你的 API Key 去请求那个地址，把响应（或错误）回显出来
```

这能打到：云厂商元数据服务、内网管理面板、本机其它端口，也可以拿它做端口扫描（错误信息能区分连接拒绝/超时）。

### 处理办法

1. **首选：把 `/api/agent/models*` 和 `/api/agent/chat/completion` 都纳入令牌保护**（它们本来就应该在第十三节清单里——写模型配置等同于改服务端出网目标）；
2. **同时给 `assertHttpUrl` 加内网拦截**：解析出 hostname 后，拒绝 `127.0.0.0/8`、`10/8`、`172.16/12`、`192.168/16`、`169.254/16`、`::1`、`fc00::/7`；注意还要处理 DNS 解析到内网与重定向（请求时二次校验或禁止跟随重定向）；
3. 如果确实需要连本机模型（如本地 ollama），用一个显式白名单 `allowedLocalHosts`，而不是全放开。

### 对首版清单的影响

在第十三节的清单上追加下面 6 条（SSRF 入口）：

```
POST   /api/agent/models
DELETE /api/agent/models
PUT    /api/agent/models/bulk
POST   /api/agent/models/:kind
POST   /api/agent/models/available
POST   /api/agent/chat/completion
```

合计 34 条（另加 `/api/showcase/` 前缀组）。

### 为什么这条之前没写

之前只把 `/api/agent/*` 当成「配置类接口」，没意识到 `baseUrl` 直接决定服务端出网目标。配置类接口的价值不在它本身，而在它**改变了后续请求的去向**——这类间接影响需要单独列一节。

## 十六、请求边界会误伤沙箱 iframe（必须处理）

4.5 的请求边界规则是「带 Origin 时必须等于 Host」。但视觉节点的生成页面住在 `sandbox="allow-scripts"` 的 iframe 里——**不透明源**，它发出的请求 `Origin: null`。

证据：`packages/plugins/plugin-node-ui/src/uiOrigin.ts:6` 明确写着「节点里渲染的页面住在**不透明源**的 iframe 沙箱里（`sandbox="allow-scripts"`），它发出的请求全算跨源（`Origin: null`）」；`uiData.ts:341` 也写着 CSP 的 `connect-src` 只放行「页面自己的源与后台的源」，说明它确实会直接请求后台。

所以按 4.5 的字面规则，这些请求会被判成「跨源」而 403。会坏掉的功能：

1. 视觉节点首次加载时 `GET /api/node-ui/info` 拿后台地址（`uiOrigin.ts:56`）；
2. 生成页面自己上传素材、写节点字段；
3. 调试 SDK 连后台 ws。

### 怎么改规则

不能简单地「Origin 为 null 就放行」——那等于把跨源防护关掉，因为普通网页在 `no-cors` 场景也会发 `Origin: null`。

正确做法是**区分「同源页面的导航请求」与「不透明源 iframe 的请求」**，用 `Sec-Fetch-Site` 和 `Sec-Fetch-Mode`：

| 请求特征 | 含义 | 处理 |
|---|---|---|
| `Origin: <同源>` | 同源页面发起的 fetch | 放行 |
| `Origin: null` + `Sec-Fetch-Site: cross-site` | 第三方网页 / 沙箱 iframe | **默认拒绝** |
| （不存在）`Origin: null` + `Sec-Fetch-Site: same-origin` | —— | 实测没有这种组合，见下 |
| 无 `Origin`（curl / 非浏览器） | 本地工具 | 按 Host 校验放行 |

### 实测结论（2026-10-19，Chrome 153）

上面那张表的第三行是**错的**。用真浏览器抓了四种请求：

| 场景 | Origin | Sec-Fetch-Site | Sec-Fetch-Mode |
|---|---|---|---|
| 画布页自己 fetch（同源） | `http://127.0.0.1:<端口>` | `same-origin` | `cors` |
| 视觉节点：`sandbox="allow-scripts"` + `srcdoc` | `null` | **`cross-site`** | `cors` |
| 第三方站点自己造一个同样的 sandbox iframe | `null` | **`cross-site`** | `cors` |
| 第三方站点直接 fetch | 它自己的源 | `same-site`（同为 127.0.0.1 时） | `cors` |

三点结论：

1. **不透明源永远报 `cross-site`**，不会出现 `same-origin`。所以「`Origin: null` + `same-origin` 才放行」这条判断一次都不会命中，视觉节点照样 403。
2. **沙箱 iframe 不是视觉节点独有的**。任何网页都能 `document.createElement('iframe')` + `sandbox="allow-scripts"` + srcdoc，打出来的请求头和视觉节点一模一样。实测里恶意页面通过这个手法拿到了目标接口的完整 JSON 响应。
3. 因此「按 `Origin: null` 给例外」= **对所有网页开例外**，等于没做防护。

> 复现脚本：`.scratch/header-probe/run2.mjs`（同源 vs 沙箱 vs 第三方）、`run3.mjs`（恶意页面自造 sandbox iframe）。这两个目录不入库，跑法见文件头注释。

### 改后的做法

**视觉节点的请求必须带一个只有宿主能造的凭证，不能靠 Origin 判断。** 三条路，按推荐顺序：

**① 短时票据（推荐）**

- 宿主渲染 iframe 时，向后台要一个 `uiTicket`（绑定 `canvasId + nodeId`，有效期几分钟，一次性或限次）；
- 票据通过 `srcdoc` 里的 `window.__CANVAS_UI__.ticket` 注进去（本来就有一个 `__CANVAS_UI__` 全局，见 `uiData.ts:451`）；
- 沙箱页面所有请求带 `x-mc-ui-ticket: <票据>`；
- 服务端只放行「票据有效」的不透明源请求，且**只放行读接口与素材上传**，不放行 `/api/task/*`、`/api/agent/*`、`/api/server-plugins/*`。

这样恶意页面即使造出同样的 iframe，也拿不到票据——票据是宿主在渲染时注入的，不是猜出来的。

**② 宿主代发（最彻底，工作量大）**

- iframe 不发 HTTP，全走 `postMessage` 交给宿主；宿主带令牌代发；
- 好处：iframe 永远碰不到网络层，也就不存在「它能不能自己请求」的问题；
- 代价：`plugin-node-ui` 的桥接层要重写，且视觉节点的调试 SDK 也要跟着改。

**③ 把视觉节点挪到独立源（结构最优，改动最大）**

- 给生成页面一个独立域名/端口（如 `127.0.0.1:8866`），与后台不同源；
- 这样它天然是跨源，可以直接用正常 CORS 白名单管理，不必给「null 源」开洞；
- 代价：要再起一个静态服务，部署与打包都变复杂。

### 首版怎么办

首版不做视觉节点的票据（工作量与风险都不小），而是**明确接受一个已知缺口**：

- 请求边界（Host/Origin）**只用于挡住「第三方站点直接打接口」**，对沙箱 iframe 一律拒绝；
- 视觉节点在首版会**失去直接请求后台的能力**——它的上传、写节点字段会失败；
- 这让视觉节点暂时不可用（或只能显示、不能保存），必须在上线前说清楚。

如果首版必须保住视觉节点，就**只给它一条专用通路**：

```
GET  /api/node-ui/info              免令牌（只回 origin 字符串，不含敏感信息）
POST /api/canvases/:id/resources    免令牌，但只允许 slot 上传、限大小、限扩展名
```

并在服务端对这两条做**来源判定升级**：不认 `Origin: null`，改认「请求里带的 `slot` 值属于该画布真实存在的节点」。这是业务校验，不是来源校验——伪造者得先知道节点 id，而节点 id 需要读画布才能拿到，读画布又需要同源。

### 对方案的影响

1. **4.5 的规则要删掉「`Origin: null` + `same-origin` 放行」这一行**，它不存在；
2. **实施顺序**：请求边界（第三 commit）之前必须先确认视觉节点仍能工作；
3. **验证清单**要加两条：视觉节点能加载并上传；第三方网页自造 sandbox iframe **仍被拒绝**。
4. **不要**用 `X-MiniCanvas-Ui: 1` 这类自定义头当门槛——网页也能加，挡不住；它只能当「减少误伤」的提示，不能当鉴权。

### 对方案的影响

1. **4.5 的规则要按上表细化**，不能只写「Origin 必须等于 Host」；
2. **实施顺序**：请求边界（第三 commit）之前必须先确认视觉节点仍能工作，否则会把画布功能打坏；
3. **验证清单**要加一条：视觉节点能正常加载并上传（用真机，不是单测）。

### 一个绕不开的取舍

沙箱 iframe 与后台之间必须有一条**可被不透明源访问的通路**。这本身就是攻击面：任何能在这个 iframe 里执行脚本的东西（包括 AI 生成的页面、调试 SDK）都能调后台。

所以这条通路的权限必须最小：

- 只允许 `GET /api/node-ui/info` 与素材上传，不允许调管理接口；
- 上传走独立的、限大小的路径；
- 生成页面永远拿不到管理令牌。

这也是为什么第十四节推荐「给 `/api/task/call` 加独立脚本执行令牌」——沙箱里的页面可以上传素材，但不该能执行任意脚本。

## 十七、`/api/task/call` 的隔离边界（补充确认）

第十四节说 `/api/task/call` 能执行任意脚本。这里补一句容易被误解的地方：它**已经有进程隔离，但没有权限隔离**。两件事经常被混为一谈。

### 已有什么

`packages/plugins/plugin-node-ui/src/task/runner.ts:344` 用 `spawn(process.execPath, ...)` 起一个**独立子进程**（非 Windows 上 `detached: true` 自成进程组，`stdio` 第四条是 `ipc`，结果经 `process.send` 回传），`:258` 在收尾时用 `taskkill /PID <pid> /T /F` 结束整棵进程树。

所以：

- 脚本死循环、崩溃、把 CPU 打满，不会把后台主进程带死；
- 取消任务时能把子进程和它再起的孙进程一起收掉。

### 没有什么

子进程跑的仍然是**同一个 Node、同一个用户、同一份文件系统权限**：

1. `runner.ts:58` 已经 import 了完整的 `node:fs`，脚本自己也能 `import('node:fs')`；
2. 没有 Node 的 `--experimental-permission`，也没有 `--allow-fs-read` / `--allow-fs-write` 限制；
3. 子进程里可以再 `spawn` 别的程序，可以随意出网；
4. 没有容器、没有 microVM、没有单独的系统用户。

也就是说：**进程隔离解决「崩不崩」，不解决「能不能干坏事」**。脚本能读你的 SSH key、能改 `admin-token`、能删数据目录——只要当前用户有权限。

这与第二节「防不住：插件在进程内滥用宿主权限」是同一条根因，只是表现形式从「同进程」变成「子进程」。

### 对本次方案的含义

1. 首版把 `/api/task/call` 纳入令牌保护，挡住的是「外部网页偷偷调它」；挡不住「已授权的调用方传一个恶意脚本」；
2. 第十四节建议的「独立脚本执行令牌」只解决调用方身份，不解决脚本能力；
3. 真正收紧要另开一版，手段（按代价从低到高）：

| 手段 | 挡住什么 | 代价 |
|---|---|---|
| Node 24 `--experimental-permission --allow-fs-read=... --allow-fs-write=...` | 越界读写文件 | 小；但子进程启动参数要改，且部分依赖会报错 |
| 禁 `child_process` + 限制出网（`--allow-net` 或防火墙规则） | 再起进程、外联 | 中；可能影响需要联网的任务 |
| 独立系统用户 / 容器 / microVM | 上面全部 | 大；部署与调试复杂度上一个台阶 |

这三条都**不在本次范围**（第十一节第 1 条已列）。这里写清楚是为了避免实施时误以为「加了令牌就安全了」。

### 验收时怎么区分

- 令牌测试：不带 `x-admin-token` 调 `/api/task/call` → 403。这验证的是「门锁上了」；
- 隔离测试（本版不做）：带正确令牌提交一个 `import('node:fs').writeFileSync('C:/temp/pwn.txt','x')` 的脚本 → 应当失败。现在会成功。

## 十八、Agent 会话也能间接执行命令（首版漏网的一条链）

首版清单保护了「改配置」，但没保护 `agentSessions.ts` 里那批会话写接口。而它们能把命令跑起来：

```
1. POST /api/agent/canvases/:id/sessions              → 建一个会话（无鉴权）
2. POST /api/agent/canvases/:id/sessions/:sid/messages → 让模型干活（无鉴权）
3. 模型决定调 exec_command                            → 触发审批
4. POST /api/agent/canvases/:id/sessions/:sid/approvals/:aid → 允许（无鉴权）
```

第 4 步不需要知道审批内容，`decision` 缺省就是 `allow`（`agentSessions.ts:818`）。整条链的「门」只有第 3 步那个模型要不要用命令——而模型会被提示词影响。

另外两个副作用不需要模型配合：

- `POST /messages` 每调一次就是一轮真实模型调用，**花的是你的钱**；
- `POST /sessions/:sid/queue`、`/goal`、`/compact`、`/fork` 都能反复触发运行。

### 怎么办

**首版的最小补法**：把下面几条也加进清单（它们是「花钱」与「间接执行命令」的关键）：

```
POST   /api/agent/canvases/:canvasId/sessions
POST   /api/agent/canvases/:canvasId/sessions/:sessionId/messages
POST   /api/agent/canvases/:canvasId/sessions/:sessionId/approvals/:approvalId
POST   /api/agent/canvases/:canvasId/sessions/:sessionId/queue
POST   /api/agent/canvases/:canvasId/sessions/:sessionId/goal
```

全部 `/api/agent/canvases/` 下的写方法一起保护更简单，且这里没有沙箱 iframe 的麻烦——会话面板和画布同源，能带令牌。

### 这会打坏什么

画布右侧的对话面板在 `packages/ui` 里，和页面同源，加令牌可行；但要改它所有会话写请求（约 15 处），属于第四个 commit 的增量工作。

**如果这一版不做**：至少要承认「任何人仍能让你的 Agent 跑命令、烧你的 token」，并在文档和启动日志里写明。这与第二节「防不住：用户自己确认安装的恶意插件」不是一回事，不要混在一条里。

## 十九、同源上传的 SVG 会执行脚本（实测确认，优先级 P0）

这一条比前面所有「外部网页打后台」更严重：它**不需要跨源**，也不需要令牌。

### 复现（本地实测通过）

后台允许上传资源，回读时按扩展名给 `content-type`。`.svg` 在白名单里（`store/mime.ts:17`），回读时设 `image/svg+xml`（`routes/canvases.ts:120-129`），且**没有任何** `Content-Security-Policy` 或 `X-Content-Type-Options`。

于是：

```
1. 匿名 POST /api/canvases/default/resources?name=payload.svg
   请求体 = 一段带 <script> 的 SVG（不需要令牌，不需要 confirm）
2. 拿到返回的 /api/canvases/default/resources/<hash>.svg
3. 用户打开这个地址（或它被嵌进画布资源预览）
4. SVG 里的脚本在**后台自己的源**上执行
5. 它能读 localStorage 里的管理令牌、能以同源身份调所有接口
```

实测输出（Chrome 153，脚本 `.scratch/header-probe/run7-svg.mjs`）：

```
匿名上传 → 200
回读 content-type: image/svg+xml；CSP: 无；X-Content-Type-Options: 无
打开该地址 → document.title 变成 XSS-RAN token=FAKE-TOKEN-ABCDEF
同源脚本读到 localStorage: {"token":"FAKE-TOKEN-ABCDEF"}
```

所以：**只要令牌存在 localStorage，任何能上传 SVG 的人都能把它读走**。而上传接口在首版清单之外（它属于画布数据写入，方案 C 不保护）。

### 三条独立的修法，必须至少做第一条

1. **回读时禁止 SVG 当文档执行**：给 `/api/canvases/:id/resources/*` 与 `/api/assets/files/*` 加 `Content-Security-Policy: sandbox`（可再加 `script-src 'none'`）。这一条最省事：不改存储、不改上传，只改响应头。

> 实测（`run9-csp.mjs`，Chrome 153）：`sandbox`、`default-src 'none'`、`script-src 'none'` 三种写法都能挡住内联脚本；且**它们都不影响 `<img src="x.svg">` 的正常显示**（120×40 正常渲染）。
> 注意别把 `nosniff` 当成这一条的主力：`nosniff` 只影响浏览器「要不要按声明类型解析」，对已经声明成 `image/svg+xml` 的响应没有额外帮助。它该加，但不是这里的解法。
2. **把 `.svg` 从「可直接回读为文档」的名单里摘出来**：回读统一给 `application/octet-stream` + `Content-Disposition: attachment`；需要显示时由前端用 `<img src>` 引用（`<img>` 不执行脚本）。
3. **上传分离到独立源**：与第十六节第 ③ 条同思路，资源从另一个端口提供，天然隔离。

### 与令牌方案的关系（很重要）

这一条说明 **localStorage 存令牌有实际后果**，不只是理论风险：

- 只要有一个 XSS（SVG，或任何同源注入），令牌就会被读走；
- HttpOnly cookie 能挡住「读」，挡不住「用它发请求」（XSS 可以直接 fetch）；
- 所以真正的分界不是「令牌放哪」，而是**有没有同源 XSS**。

结论：第 1 条应当**提到第一个 commit**，与令牌同批上线。否则令牌只是把「别人装插件」换成「别人先偷令牌再装插件」。

### 同类位置要一起查

- `/api/assets/files/:name`：`routes/assets.ts:45` 同样用 `mimeFromName`，白名单同样含 `.svg`；
- 风格库 `/api/style-library/file`：`plugin-style-library/src/server.ts:457`，`MEDIA_EXTS` 也含 `svg`（`:60`），同样直接 `c.body(...)`；
- 画布资源槽位：`slot-*.svg` 同样可上传（扩展名走 `ALLOWED_EXT`）。

三处受同一条影响，修法一致。

### 验收

- [ ] 上传一个带 `<script>document.title='x'</script>` 的 SVG，直接打开该地址，标题**不变**、控制台报 CSP 拦截；
- [ ] 同一地址的响应头包含 `content-security-policy` 与 `x-content-type-options: nosniff`；
- [ ] 用 `<img src="...svg">` 引用同一文件，仍能正常显示；
- [ ] `/api/assets/files/*`、`/api/style-library/file` 同上。


