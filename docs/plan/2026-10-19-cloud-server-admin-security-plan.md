# cloud-server 管理面安全加固方案（最终版 v2）

> 状态：**待实施**。本文档是执行依据，不含已落地代码。
> 适用：`packages/cloud-server`、`packages/plugins/plugin-manager`、`packages/plugins/plugin-agent`、`packages/plugins/plugin-node-ui`、`packages/ui`。
> 参照：DeepSeek Harness（DSH）的浏览器令牌与请求信任边界（`deepseek-harness/packages/client/connection/README.zh.md`、`src/api-request-trust.ts`）。
> **v2 的关键变化**（2026-10-19 用真浏览器 + 真服务复核后修订）：
> 1. 原「给 `Origin: null` 开例外」的方案被实测推翻——沙箱 iframe 永远报 `cross-site`，且任何网页都能造出同样的请求。改为宿主代发；
> 2. 新增 P0：匿名上传的 `.svg` 会在同源执行脚本，直接读走令牌；
> 3. `POST /api/canvases/:id/*` 用 `text/plain` 简单请求就能打到（真服务实测写入成功），已并入首版清单；
> 4. 跨源 `PUT /api/canvases/:id` 当前能整张覆盖画布，因此「收紧 CORS + Host 白名单」必须与令牌同批完成（第八节 commit 4）；
> 5. 「任何网页都能装后台插件」被修正：安装接口有可信哈希把关，实测自造 code 被拒。
> 6. 运行期生成的图/视频也受影响：`POST /api/jobs` 无鉴权，跨源简单请求实测能进 handler（配真实 actionId 就会消耗额度），已并入清单。
> 7. 新增第二十节：上传没有大小上限，200MB 文件被匿名写入成功（会打满磁盘/内存）。
>
> 全部结论可用 `.scratch/header-probe/` 下的脚本复现（清单见该目录 README）。

## 一、为什么做这件事

后台默认跑在 `127.0.0.1:8865`，而 `app.use('*', cors())` 用的是 hono 默认的 `origin: '*'`。实测后果比「能发 POST」更重：**任何网页都能完整读写后台，包括读到响应体**（本地方案见下）。于是：

1. 恶意网页能改画布、删资产、列出你所有画布（`POST /api/canvases/:id/nodes`、`DELETE /api/assets/:id`、`GET /api/canvases`）；
2. 它能匿名上传资源。上传的 `.svg` 会被后台当**同源文档**回读，脚本在后台自己的源上执行，进而读走前端存的令牌（第十九节，已实测）；
3. 它能调 `POST /api/agent/mcp`，用 `kind: 'stdio'` 让后台执行任意命令；
4. 它还能通过 `/mcp`（完全无鉴权）批量改画布；
5. 装了什么、何时装的、代码哈希多少，装完没有任何记录。

这套改动要堵住这五条。

### 实测基线（2026-10-19，真实 `cloud-server` 8932 端口）

| 请求 | 结果 |
|---|---|
| `GET /api/canvases`，`Origin: http://evil.test:9999` | 200，`access-control-allow-origin: *`，body 里直接列出画布 |
| `POST /api/server-plugins/install`（无 Origin、无令牌、自造 code） | 400，**被可信哈希挡住**（这条比预想的更安全，见第三节修正） |
| `POST /api/canvases/default/resources?name=probe.svg`（匿名） | 200，落盘 |
| `GET` 该 SVG | 200，`content-type: image/svg+xml`，**无 CSP、无 nosniff**，脚本原样返回 |
| `POST /mcp` `tools/list` | 200，返回全部 MCP 工具 |

> 一条重要的现实修正：**「任何网页都能装后台插件」这个说法过重了**。`serverPlugins.ts:136-143` 会拿服务端自己的可信 sha256 比对，不传对的内容会被拒。真正没拦住的是「外部网页改画布/传资源/跑命令/调 MCP」。安装入口仍要令牌，因为它绕不过「插件目录里的文件被替换」这一类攻击，但不该被写成最危险的那条。

### 一条容易误判的点：CORS 只挡「读」，不挡「做」

实测（`run5-pna.mjs`，Chrome 153，从 `http://evil.test:<端口>` 打 `127.0.0.1:<后台>`）：

- 目标服务**完全不放 CORS** 时，恶意页面里三个 `fetch` 全部报 `Failed to fetch`，但服务端收到了**全部三个**请求（含带 `application/json` 那个）。其中 `text/plain` 和 `GET` 不触发预检；带 `application/json` 的只发了预检 `OPTIONS`，预检未通过，所以真正的 POST **没有发出**——这个区别很重要：

```
simple POST (text/plain)  → 直接到达服务端，副作用发生
json POST                 → 只到一个 OPTIONS，预检失败，POST 没发
GET                       → 直接到达（但读不到响应）
```
- 也就是说：`POST /api/canvases/:id/nodes` 这类写接口，**副作用已经发生**，浏览器只是不让脚本读响应；
- 本项目现在是 `origin: '*'`，预检会通过，所以 **JSON 写请求也能完整发出并读到响应**（`run6-wildcard.mjs` 实测：写接口 200 且读到 body）。

结论：**收紧 CORS 挡不住「简单请求」**，而简单请求恰恰能改到东西。JSON 写请求只在 `origin: '*'` 这种放开状态下才发得出去（因为预检会通过）；一旦收紧 CORS，JSON 写就发不出了，但 `text/plain` / form / FormData 这类不需要预检的写请求照样直达。所以 CORS 是必要的一层，但**不能当唯一防线**。

### 关于「浏览器会自动拦公网打本机」的澄清

Private Network Access（PNA）在 2026 年的 Chrome 里**并没有拦住这条**。实测（`.scratch/header-probe/run13-b-rebase.mjs`，Chrome 153，页面在 `http://evil.test:<端口>`，目标 `http://127.0.0.1:8936`）：

```
GET  /api/canvases       → 200，读到 body
POST /api/canvas/nodes   → 200（写进去了）
请求头里没有 Access-Control-Request-Private-Network
```

所以第一节的「任何网页都能打本机后台」在当前浏览器上成立，不能指望浏览器兜底。**Host 白名单 + 令牌**是不可省的。

> 实施时要把「哪些写接口能用简单请求打通」逐条过一遍（`content-type` 不是 `application/json` 的 POST、以及所有 PUT 的预检行为）。实测里 `text/plain` 的 POST 确实直达。

**这条已在真实服务上验完，不是理论**（`.scratch/header-probe/run11-real-simple.mjs`，8934 端口，`Origin: http://evil.test:9999` + `content-type: text/plain`）：

```
POST /api/canvases/default/resources?name=simple.txt → 200，文件落盘
POST /api/canvases/default/nodes                     → 200 {"ok":true,"added":["evil-1"]}
回读 /api/canvases/default                            → 真的包含 evil-1
```

也就是说：**攻击者可以把一段 `text/plain` 的 JSON 文本 POST 到节点写接口，节点就进了你的画布**。路由只 `JSON.parse` body，不看 `content-type`（`canvasOps.ts:253-277`）。

这一条直接影响首版范围，并且要纠正一个直觉：**收紧 CORS 并不能阻止它**。CORS 只决定「脚本能不能读响应」，简单请求照样送达、副作用照样发生。能挡住它的是两样东西：

- **请求边界**（`requestTrust` 在 handler 之前直接 403）——但这条路会连带打坏视觉节点的沙箱 iframe（第十六节）；
- **令牌**（写接口要求 `x-admin-token`）——简单请求带不上自定义头（带了就触发预检，预检不过就发不出去），所以令牌对简单请求是有效的。

结论：方案 C 里「画布数据写接口暂缓」这条**不能原样保留**。要么把 `POST /api/canvases/:id/nodes`、`POST /api/canvases/:id/resources` 这类「简单请求可达」的写接口一起加令牌，要么先把请求边界做完并解决视觉节点的例外。**两样都不做，等于画布谁都能改。**

> 简单请求清单（实测）：`POST text/plain`、`POST application/x-www-form-urlencoded`、`POST FormData` 都直达；`PUT`（任意 body 类型）与带自定义头的请求都会先发预检，预检不过就发不出去。也就是说，**POST 类写接口风险最高**。

### 「暂缓」不等于安全：资产 / 项目 / 历史 / KV 同样能被简单请求改

在真实服务（8938 端口）上逐条打了一遍，全部带 `Origin: http://evil.test:9999` + `content-type: text/plain`：

```
POST /api/projects {name:'evil'}      → 200，项目真的建出来了（返回了 id）
POST /api/assets?name=x.txt           → 200，资产真的存进去了（返回了 url）
POST /api/history/batch-delete {ids:[]} → 400（只是业务校验：ids 为空）
PUT  /api/kv/config/k {value:1}       → 200，KV 真的写进去了
```

所以「首版暂缓保护资产/项目/历史/KV」这句话，**只有在 CORS + Host 白名单也生效的前提下才成立**。注意 `PUT /api/kv/...` 是 PUT：它会先发预检，CORS 放开就通、收紧就断；而 `POST /api/projects`、`POST /api/assets` 是简单请求，CORS 收紧也照打。

结论：**简单请求这一层必须靠令牌解决，不能靠 CORS。** 首版清单里 `POST` 开头的写接口（画布、jobs、projects、assets、history）要么加令牌，要么明确写进「已知未覆盖」，不要用「暂缓」让它看起来没事。

### 更狠的一条：`PUT /api/canvases/:id` 能整张覆盖画布

实测（`run12-real-put.mjs`，真实服务 8935 端口，`Origin: http://evil.test:9999`）：

```
预检 OPTIONS → 204，allow-origin: *，allow-methods 含 PUT
PUT /api/canvases/default {nodes:[{id:'hacked',...}], edges:[]} → 200 {"ok":true}
回读 GET /api/canvases/default → 节点 id 只剩 ["hacked"]
```

也就是说，**当前状态下任何网页都能把你整张画布替换掉**，比「加一个节点」严重得多。它需要预检，所以**收紧 CORS 之后浏览器跨源就打不出去了**；但 DNS 重绑定页面（第十六节、4.5）会被浏览器当成同源，照样打得出去——所以 **Host 白名单是这条的实际防线**。

首版把 `PUT /api/canvases/:id` 留在令牌之外是可行的，前提是 **Host 白名单 + 收紧 CORS 两件都做了**。这两件只要缺一件，整画布覆盖就是通的。

## 二、边界（先说清楚能防什么）

> 先说一个**容易误以为是安全机制**的东西：插件 `package.json` 里的 `miniCanvas.serverPermissions`。它现在只是清单字段——`plugins/catalog.ts:267-290` 把它原样塞进目录条目，`:343/:420` 读出来展示，**没有任何地方据此限制能力**。`plugin-style-library` 写的是 `"serverPermissions": []`，它的后台照样能读任意文件、能把根目录改到任意路径。所以本轮方案不依赖它；真正要收紧权限，见第十七节末的三档手段。

**能防住**

| 威胁 | 手段 |
|---|---|
| 任意网页向本机后台投递代码/命令 | 管理令牌 + 请求边界 |
| 局域网其它机器（若监听 0.0.0.0） | Host 白名单 + 令牌 |
| DNS 重绑定 | Host 头必须为本机/白名单 |
| 跨站浏览器请求（CSRF） | Origin 必须等于 Host；`sec-fetch-site: cross-site` 拒绝。**JSON 写请求会被挡住，简单请求（`text/plain`）挡不住**（见第一节实测） |
| 网页改画布 / 整张覆盖 | 画布 POST 走令牌；`PUT /api/canvases/:id` 靠 Host 白名单 + 收紧 CORS（第一节、4.5 实测） |
| 网页匿名传 SVG 后执行脚本偷令牌 | 资源回读加 `CSP: sandbox`（第十九节，已实测挡得住） |
| 网页灌大文件打满磁盘 / 内存 | 上传大小上限（第二十节，实测 200MB 可写入） |
| 网页让 Agent 跑命令、烧模型额度 | 会话写接口加令牌（第十八节） |
| 网页下生成单（消耗平台额度） | `POST /api/jobs` 同样没有鉴权；实测跨源简单请求能到路由（`400 未找到动作` = 已进 handler），配上真实 actionId 就会消耗额度 |
| 网页间接执行代码（节点脚本 / MCP stdio） | `/api/task/`、`/api/agent/mcp` 加令牌 |
| 事后无法追溯 | JSONL 审计日志 |
| 网页调 `/mcp` 批量改画布 | 首版**不做**（第十一节第 3 条）；能挡它的只有 Host 白名单 + 收紧 CORS。实测见下 |

这几条是「先封最贵的」：执行代码 > 改画布 > 花钱 > 读数据。不在表里的威胁要么代价小，要么挡不住（见下）。

**`/mcp` 的实测边界**（`.scratch/header-probe/run15-mcp.mjs`，真实服务）：

- 跨源预检：`204`，`access-control-allow-origin: *`；
- 跨源 + `application/json`：**200，工具列表直接返回**；
- 跨源 + `text/plain`（简单请求）：`415`，因为它强制要求 `application/json`；
- 无 Origin（curl）：200。

也就是说：`/mcp` 不能用「简单请求」偷打，但它对**任何网页**开放（只要 CORS 放开）。收紧 CORS + Host 白名单之后，浏览器跨源与 DNS 重绑定都会被挡住，`/mcp` 这一侧才算有基本边界；独立的令牌鉴权仍留到下一版。

**但这条边界有个前提要写清楚**：`/mcp` 不在 `/api/*` 下，`requestTrust` 只作用于 `/api/*`。所以 commit 4 的中间件**必须把 `/mcp` 也纳入**（按 Host 判定，不要求令牌），否则收紧 CORS 之后 `/mcp` 的 Host 检查仍然缺位，DNS 重绑定页面照样能调它。

**防不住（与 DSH 同级，属行业现实）**

1. 用户自己确认安装的恶意插件；
2. 已获得本机文件读写权限的攻击者（可同时改令牌文件与审计日志）；
3. 插件在进程内滥用宿主权限（没有插件级沙箱）；
4. 第三方依赖供应链投毒；
5. 已授权的插件通过合法 API 读取画布数据（越权之外的行为管不了）。

还有一条**本次不解决、但要说清楚**的：

6. **同源 XSS**。只要后台源上能执行任意脚本（例如上传的 SVG，见第十九节），令牌放哪都不安全。这类问题不能靠令牌解决，只能靠 CSP 与内容类型收敛。

> 结论：这套改动把“别人塞进来”这条路堵死；“装进来之后能干什么”要靠后续的进程隔离与能力收窄。

## 三、现状证据（改动前的真实代码）

| 位置 | 事实 |
|---|---|
| `routes/serverPlugins.ts:106` | `POST /api/server-plugins/install` 接受 `code` 文本写盘，**但有可信哈希把关**（`:136-143`）——实测自造 code 会被 400 拒绝 |
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
| `store/canvasResources.ts:97-111` + `routes/canvases.ts:120-129` | 上传只收白名单扩展名，但 `.svg` 在名单里（`store/mime.ts:17`）；回读时按扩展名给 `image/svg+xml`，**无 CSP**（第十九节） |
| `server.ts:445` | `app.use('*', cors())` —— hono 默认 `origin: '*'`（见 `node_modules/.pnpm/hono@4.13.5/.../cors/index.js:4`），即当前**对所有来源开放 CORS** |
| `routes/mcp.ts:42` | `app.all('/mcp')` 无任何鉴权，MCP 工具可批量改画布 |
| `routes/agentChat.ts:77` | `POST /api/agent/chat/completion` 无鉴权（可被网页当作免费模型代理） |
| `cli.ts:184-206` | 启动日志位置，适合打印令牌 |

## 四、最终设计

### 4.1 总原则

1. **分级保护，先封「能执行代码」「能改画布」「能花钱」三类路口**：首版对「会引入可执行代码 / 执行命令」的接口要令牌（第十三节：42 个单条入口，另加 `/api/showcase/`、`/api/agent/canvases/` 两个前缀组），**外加 `POST /api/canvases/:id/*`、`POST /api/canvas/*`、`POST /api/jobs*`**（简单请求可达，见第一节实测）。不是对所有写接口一刀切：资产、项目、历史、KV 仍暂缓。原因见第十三节：视觉节点的沙箱 iframe 拿不到令牌，全量按方法保护会打断正常功能。后续升级到「所有写方法都要令牌」，那时先做宿主代发。
2. **读接口与暂未加令牌的写接口用请求边界保护**：`/api/*` 全部经过 Host/Origin 检查（GET 也要）。要注意请求边界**挡不住简单请求之外的副作用**（第一节实测），所以它只是补充；真正的门槛是 Host 白名单 + 令牌。
3. **失败关闭**：校验拿不到结论一律 403。
4. **逃生口要显式**：`--no-admin-auth` 仅在同时设置 `MINI_CANVAS_ALLOW_INSECURE=1` 时生效，且启动打印醒目警告。
5. **令牌不做被动泄露**：不用 `<meta>` 注入、不写进任何接口响应。首版用手动输入存 `localStorage`——注意它挡得住「别的网站」，挡不住「同源的前端插件」（见 4.4 末尾）；真要做到页面读不到，只有 HttpOnly cookie 一条路。
6. **首版与终态分开写清楚**：第十三节给出首版范围，升级路径在第十二节之后说明。

### 4.2 审计日志（P0）

新增 `packages/cloud-server/src/audit.ts`：

```ts
export type AuditAction =
  | 'write'            // 受保护入口的写请求（首版只记第十三节那些）
  | 'canvas/write'     // POST /api/canvases/:id/*
  | 'canvas/overwrite' // PUT /api/canvases/:id（首版只记，不拦）
  | 'agent/session-write'
  | 'task/call'
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
  /** 校验整条链：返回第一处断裂（没有断就 undefined）。只读，供测试与排查用。 */
  verify(): Promise<{ ok: true } | { ok: false; line: number; reason: string }>
}
```

实现要点：

- 路径 `{dataDir}/audit.log`，JSONL；
- 每条记录计算 `hash = sha256(去掉 hash 字段后的 JSON)`，`prev` 取上一条的 `hash`，形成链；被删改后链会断，可检测（但不能阻止）；
- `fs.appendFile` 失败只 `console.warn`，不阻断；
- 绝不记录令牌原文；
- 写入顺序：**进入写路由先记 attempt → 执行 → 成功后补一条 ok**（失败补 rejected）。

`verify()` 是这套机制的价值所在——只写不验，链就只是「多算了几次 hash」。它要能回答三件事：某行 hash 与内容不符（被改）、某行 `prev` 与上一行 `hash` 不衔接（被删或被插）、以及首行 `prev` 不为空（文件被截断重写）。CLI 加一个 `audit-verify` 子命令（不开服务、只读文件），比让人手算 sha256 现实得多。

**必须串行写，否则链会分叉**：`prev` 依赖「上一条的 hash」，而 HTTP 请求是并发的。两个请求同时进来、各自读到同一个 `lastHash`，就会写出两条 `prev` 相同的记录——链结构从那一刻起不再是一条线，后面再也验不出「哪条被删了」。实现上要有一个**单写者**：把所有 `append` 丢进一个 promise 链（`this.tail = this.tail.then(() => write(e))`），保证「读上一跳 → 算 hash → 落盘」三步不交错。这条不加，hash 链等于白做。

**日志会无限增长**：JSONL 只追加，没有轮转。按每天几百条算一年是几十 MB，不算大；但如果有人用脚本刷 `/api/task/call`，日志可以被撑爆——而它和令牌文件在同一个数据目录，写满之后画布保存也会失败（与第二十节是同一个「磁盘占满」结局）。建议加一个简单的轮转（超过 N MB 就 `audit.log` → `audit.log.1`），或在启动时打印当前文件大小。

**`result` 的三个值要按实际语义用**：

- `attempt`：已经通过校验、准备执行；
- `ok`：执行完成；
- `rejected`：**没通过校验**（令牌/来源）。不要用它表示「业务层拒绝了请求」（比如画布不存在），那种是 `ok` + `reason`——混在一起会让「攻击尝试」和「用户操作失误」看起来一样。

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

   # 简单请求可直达的画布写接口（第一节实测：text/plain POST 能直接改节点）
   # 这几条与「视觉节点沙箱」正面冲突，二选一，见 4.3 下方说明
   /api/canvases/            （仅 POST：nodes / edges / resources / duplicate）
   /api/canvas/              （仅 POST：nodes / edges；老接口，改默认画布）
   /api/jobs                 （下单 = 花钱；/cancel 也一起）
   ```

这些是「能引入可执行代码、执行命令、改变服务端出网目标、直接改画布、或花钱」的全部入口，共 42 条具体路由（第十三节有逐条清单，第十四、十五节与第一节有来源说明）。其中：

   - `/api/agent/mcp` 这条前缀同时覆盖 `POST /api/agent/mcp/probe`（它会去拉起已配置的 stdio 命令）；
   - `/api/effect-library/` 与 `/api/style-library/` 是**同一段代码用两份规格各注册一遍**（`LIBRARIES` 数组，`plugin-style-library/src/server.ts:80-97`），只保护一个会漏掉另一个；
   - `/api/showcase/` 是一条前缀组，覆盖 `plugin-showcase` 注册的 11 个写接口。
5. **暂不保护**：`GET/HEAD` 读接口；资产 / 项目 / 历史 / KV 写接口（靠 4.5 的请求边界保护）；`/mcp`（单独议题）。升级到全量方法保护时，这些再一起加。

覆盖方式：在 `server.ts` 的 `cors()` 之后挂一个中间件，而不是逐个路由改。**必须挂在 `await host.start()` 之前**——插件路由是在 `start()` 时一次性 flush 成 Hono 代理的，晚于它挂的 `use` 不会作用到那些代理上。

```ts
app.use('/api/*', async (c, next) => {
  // OPTIONS 必须放行：预检不带令牌，拦住它等于让所有带自定义头的跨源请求连预检都过不了
  if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') return next()
  // 注意要传 method：/api/canvases/ 与 /api/canvas/ 只拦 POST，PUT 是整画布保存、不在首版范围
  if (!isAdminPath(c.req.method, c.req.path)) return next()
  const verdict = auth.verify(c.req.header('x-admin-token'))
  if (verdict !== 'ok') { await audit.append({ ...result:'rejected' }); return c.json({...}, 403) }
  await next()
})
```

`isAdminPath(method, path)` 的形状建议：

```ts
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const ALL_WRITE_PREFIXES = [/* 第十三节里「任意写方法」那批 */]
const POST_ONLY_PREFIXES = ['/api/canvases/', '/api/canvas/']

export function isAdminPath(method: string, path: string): boolean {
  if (!WRITE_METHODS.has(method)) return false
  if (ALL_WRITE_PREFIXES.some((p) => path === p.replace(/\/$/, '') || path.startsWith(p))) return true
  if (method === 'POST' && POST_ONLY_PREFIXES.some((p) => path === p.replace(/\/$/, '') || path.startsWith(p))) return true
  return false
}
```

> 这里用 `startsWith` 而不是精确匹配，是为了让「新增子路由自动受保护」；前缀里带结尾斜杠，所以 `/api/tasks`、`/api/taskfoo` 不会命中（`path-probe2.mjs` 已逐条验过）。写单测时把这两条锁住。

**路径归一化的实测结果**（`.scratch/header-probe/path-probe2.mjs`，同版本 Hono）：

| 请求路径 | `c.req.path` | 是否被 `startsWith` 命中 |
|---|---|---|
| `/api/./task/call` | `/api/task/call` | ✅ |
| `/api/task/%63all` | `/api/task/call` | ✅（已解码） |
| `/api/task//call` | `/api/task//call` | ✅ 前缀是 `/api/task/`，`/api/task//call` 仍以它开头，能命中（双斜杠不折叠，但不影响前缀判定） |
| `/API/task/call` | `/API/task/call` | ❌ 不命中；业务路由本身也区分大小写，这条请求会 404 |

结论：**不需要自己做 URL 解码或 path 归一化**，也不要用小写化去「兼容」——那会和 Hono 的路由匹配语义打架（`/API/...` 本来就没有对应路由，放行它也不会执行任何东西）。

> 两处实测确认（`.scratch/header-probe/guard-probe.mjs`，同版本 Hono）：
> 1. **挂在业务路由之前能拦住插件代理路由**——`use` 先于路由注册时，跨源/无令牌的 `/api/task/call` 被 403，业务 handler 一次都没跑；
> 2. **预检必须放行**，且 `cors()` 的 `allowHeaders` 要包含 `x-admin-token`；否则前端带令牌的跨源请求会在预检阶段就失败（浏览器只报 `Failed to fetch`，看不出原因）。

还有一条容易写错的：**GET 放行意味着「用 GET 干写事」的接口完全没有保护**。本方案的首版清单里只列写方法，实施时要把这条当检查项：清单里每个路径下若存在「GET 但会改状态」的路由，必须单独处理（比如 `/api/task/events` 是 SSE 没问题，但插件新加的 GET 路由不一定）。

**`/api/canvases/` 这一条是二选一，必须当场定**：

- 选 A（加令牌）：简单请求被挡住，画布安全；但视觉节点的 `CanvasUI.save()`（正是 `POST /api/canvases/:id/resources`）会 403，视觉节点**保存产物**功能坏掉；
- 选 B（不加）：画布写接口对任何网页开放（实测可改节点），必须靠请求边界兜底，而请求边界又会误伤视觉节点（第十六节）——等于把问题挪到第十六节。

首版建议选 A，并把视觉节点的上传**改成宿主代发**（第十六节方案 ② 的最小切片：只代发 `resources` 上传这一条）。这条改动比整包代发小得多，却是「安全」与「视觉节点可用」之间唯一不打架的组合。

**同一个冲突还有第二个调用方**：`plugin-cloud-client`（后台客户端）。它写画布也是走 `/api/canvases/:id/nodes`、`/edges`、`/resources`（`src/api.ts:155/218/228`）。它在**前端页面里**跑，同源，能读 localStorage，所以给它带令牌就行；但如果它在 `plugin-node-ui` 的沙箱里跑（目前不会），就会遇到同一个问题。实施时按「同源宿主代码」处理它。

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

**令牌的存储键要定死一处**：方案里用 `mc_admin_token`，`plugin-manager`（输入框）、`agentApi.ts`、`cloud-client` 三处都必须读同一个键。散成三个名字的话，用户填了面板却在对话里 403，表现是「有时候能用」。建议加一个极小模块 `packages/ui/src/adminToken.ts`（或在 `canvas-base` 里导出），只做 `get/set/clear`，三处都 import 它。

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
4. 作用于 `/api/*` **与 `/mcp`**（后者不要求令牌，但要做 Host/Origin 判定——否则 DNS 重绑定页面仍能调 MCP）。

**第 1 条（Host 白名单）和令牌是仅有的两道承重墙。** 第 2、3 条只能挡「懒得伪装」的浏览器请求，因为：

- 攻击者可以从一个**恶意域名**发起，再用 `Host` 头声称自己是 `127.0.0.1:8865`——非浏览器程序发 HTTP 时可以随便写 Host；
- 或者做 DNS 重绑定：让 `evil.test` 先解析到自己的服务器（页面正常加载），再解析到 `127.0.0.1`。浏览器认为「同源」，服务端看到的 Host 就是 `evil.test:8865`。

实测（`.scratch/header-probe/run8-rebind.mjs`，Chrome 153 + `--host-resolver-rules`）：把 `rebind.test` 指到 `127.0.0.1`，页面用相对路径 fetch，服务端收到的 `host: rebind.test:<端口>`，请求**成功**。
说明只写「Origin 必须等于 Host」时，重绑定页面的 Origin 也是 `rebind.test`，两者相等，规则通过。

所以 Host 白名单不能写成「等于 `127.0.0.1:8865` 或 `localhost:8865`」再附加「其它也放行」；它必须是**白名单**：不认识的 Host 直接 403。这一条不做，DNS 重绑定就是通的路。

> 本轮实测还发现：`Server` 启动时如果监听 `0.0.0.0`，Host 头可以是任意内网 IP。Host 白名单要按「启动时实际绑定的 hostname + port」生成，并在 `--host 0.0.0.0` 时显式打印警告。

**Host 头的读取方式已实测确认**（`.scratch/header-probe/host-probe.mjs`，`@hono/node-server` + 原生 http）：

- `c.req.header('host')` 与 `new URL(c.req.url).host` 读到的是**同一个值**；
- 用原生 http 伪造 `host: evil.test:8865`，两者都变成 `evil.test:8865`（说明**不能只信 URL**，要显式查 Host）；
- Host 为空时，Node 会自动填成实际的 `127.0.0.1:<port>`，所以「空 Host」不是绕过口。

结论：白名单判断写成 `trustedHosts.includes(c.req.header('host') ?? '')` 即可，不要用 `c.req.url` 里的 host 做同等判断（两者同源，但显式查 Host 更不容易被中间层改写影响）。

还有一条实际部署时才会遇到的：**如果服务前面加了反向代理**（nginx/Caddy），Host 会变成域名，`x-forwarded-host` 才是原始值。方案要求「显式配置 trustedHosts」正是为了这个——不要为了省事写成「任意 Host 都放行」或「看 x-forwarded-host」。

挂载：`server.ts` 第 445 行 `cors()` 之后。`/mcp` 是直挂在 `app.route('/', mcpRoutes(...))`（`server.ts:569-571`），不是插件路由，所以**也必须在 `host.start()` 之前挂**；`app.use` 对随后 `app.route` 注册上去的路由生效。

**dev 代理的处理**：

- 默认**不**把 5288 写进白名单（避免任意本地项目占端口就获得权限）；
- 需要时用 `--trusted-origin http://localhost:5288` 显式开启，或设置 `MINI_CANVAS_TRUSTED_ORIGINS`；
- 文档给出启动命令示例。

**dev 代理多了一个主机名**（实测读 `packages/ui/vite.config.ts`）：vite 的 `/api` 代理 target 是 `http://localhost:8865`，且 `changeOrigin: true`。也就是说，从 `:5288` 发起的请求，到了后台时 `Origin` 是 `http://localhost:5288`，而 `Host` 会变成 `localhost:8865`（不是 `127.0.0.1:8865`）。所以 dev 场景下 `trustedHosts` 必须同时包含 `127.0.0.1:<port>` 与 `localhost:<port>`，`trustedOrigins` 要显式加 `http://localhost:5288`。

> 顺带一个与安全无关、但实施时必踩的点：vite dev 的 `configure` 里手动把 `access-control-allow-origin` 改成了 `'*'`。收紧 CORS 之后，这段必须一起改，否则 dev 会把后台的严格头覆盖成 `*`，看起来像「改了没生效」。

**CORS 也要收紧**：当前 `cors()` 默认 `origin: '*'`。改为同源（与 Host 一致）或显式白名单；`allowMethods` 保留需要的集合。

**还有一条不能忘**：收紧 CORS 之后，**错误响应也要带 CORS 头**。否则跨源请求被 403 时，浏览器不会把 403 交给前端脚本（前端只看到 `Failed to fetch`），插件面板就无法提示「请先填令牌」。实测（`guard-probe.mjs`）：同源请求被 403 时带 ACAO，跨源请求被 403 时**不带**——后者前端拿不到错误体。

**`trustedOrigins` 里写的是什么，要精确**：Origin 是 `scheme://host:port`，**不带路径、不带尾斜杠**。`http://localhost:5288` 对，`http://localhost:5288/` 与 `localhost:5288` 都不对。Host 白名单同理（`127.0.0.1:8865`，不带 scheme）。这两处配错的表现都是「所有请求都 403」，查起来像中间件坏了。

**启动时要打印实际生效的白名单**，而不是只打印配置项。用户把 `--trusted-origin` 写错了却看到「已启用」，比不打印更糟。

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

> 前端怎么区分「令牌没填」和「服务没起」：403 + 这批固定文案 = 要令牌；网络错误或 5xx = 服务问题。插件面板按这个判断提示。

### 5.3 开关

| 开关 | 作用 |
|---|---|
| `--no-admin-auth` + `MINI_CANVAS_ALLOW_INSECURE=1` | 关闭令牌与请求边界（审计仍记），启动警告 |
| `MINI_CANVAS_ADMIN_TOKEN` | 固定令牌 |
| `MINI_CANVAS_TRUSTED_ORIGINS` | 额外 Origin 白名单（逗号分隔） |
| `--trusted-host <host:port>` | 额外 Host 白名单（反代 / dev 代理实例用），可重复 |

具体命令（dev 起前端时）：

```bash
# 终端 1：后台。同时信任 127.0.0.1 与 localhost 两种写法（vite 代理把 Host 改成 localhost）
pnpm -C packages/cloud-server serve \
  --trusted-host localhost:8865 \
  --trusted-origin http://localhost:5288

# 终端 2：前端
pnpm -C packages/ui dev
```

## 六、要同步修改的调用方

| 位置 | 改什么 |
|---|---|
| `packages/plugins/plugin-manager/src/pluginManagerService.ts` | 对第十三节清单里的入口（install/uninstall/update、NPM 操作、Agent 配置写）带 `x-admin-token`；403 时提示“请先在设置里填写管理令牌” |
| `packages/plugins/plugin-manager/src/components/settings/PluginManagerPage.vue` | 新增令牌输入框（密码类型），存 localStorage |
| `packages/plugins/plugin-agent/src/agentApi.ts` | 这个文件把**所有** Agent 请求都走 `json()`（`:202`）；对话面板的所有会话写请求都从这里出去。在 `json()` 里统一加 `x-admin-token` 即可一次覆盖，不用逐个调用点改 |
| `packages/ui/src` 的画布页宿主 | 页面本身不需要令牌（它不调受保护入口）；但 `agentApi.ts` 的 `json()` 需要拿到令牌，来源同插件面板（localStorage） |
| `packages/ui/src/**` 其它写请求 | 首版**不需要**令牌（不在第十三节清单里）；等升级到全量方法保护时，统一用 `adminFetch()` 加头 |
| `packages/cloud-server/src/__tests__/serverPluginsRoute.test.ts` | 全部写请求补令牌；新增缺失/错误 403 用例 |
| `packages/cloud-server/e2e/*.ts` | 起服务时传入固定令牌 |
| `packages/plugins/plugin-hot-reload-demo/scripts/watch.mjs` | 只 PUT KV；**首版 KV 不在保护范围，无需改**。升级到全量写保护时，再改为从环境变量读取并带 `x-admin-token` |
| `packages/plugins/plugin-manager/src/**` 的「市场」 | 它调 `/api/npm-plugins/browse`、`/search` 是 **GET**，首版不受影响；`install/update/uninstall` 是 POST，要带令牌 |
| `packages/cloud-server/e2e/queue-goal-probe.mjs`、`src/__tests__/agentSessions*.test.ts` | 这些用的是 `/api/agent/canvases/...`（会话语）；首版要补令牌，否则测试会 403 |
| `packages/ui/e2e/_check-*.mjs` | 页面里直接 `fetch('/api/agent/canvases/' + canvas + '/sessions')`；这些是浏览器内脚本，补令牌时一起改 |

> 注意：`watch.mjs` 给 KV 写门铃。首版不保护 KV，所以热重载不受影响；**一旦升级到全量写保护，必须同步改它，否则热重载会 403**。这里提前记下，避免升级时漏改。

## 七、测试计划

### 7.1 新增单测

| 文件 | 用例 |
|---|---|
| `src/__tests__/adminAuth.test.ts` | 生成/读取一致；长度异常重建；`timingSafeEqual` 分支；不泄露令牌 |
| `src/__tests__/audit.test.ts` | JSONL 追加；目录自动创建；hash 链连续；写失败不抛；不含令牌 |
| `src/__tests__/requestTrust.test.ts` | 合法 Host 放行；非法 Host 403；Origin≠Host 403；cross-site 403；trustedOrigins 放行；非 /api 不拦 |
| `src/__tests__/adminGuard.test.ts` | GET 放行；POST/PUT/PATCH/DELETE 无令牌 403；有令牌放行 |
| `src/__tests__/adminGuard.canvas.test.ts` | `/api/canvases/` 只拦 POST：PUT/GET 放行；`/api/agent/canvases/` 拦 POST 但不拦 GET stream |
| `src/__tests__/svgReadback.test.ts` | 回读 SVG 带 `content-security-policy: sandbox`；带脚本的 SVG 响应体原样，但头不变 |
| `plugin-node-ui/src/__tests__/hostProxyUpload.test.ts` | iframe 发 `type:'save'` → 宿主代发被调用；失败时回 `output` 带错误 |

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

# 7. SVG 不再执行脚本（第十九节；这一步不依赖令牌，commit 0 就能验）
curl -s -X POST 'http://127.0.0.1:8865/api/canvases/default/resources?name=x.svg' \
  -H 'content-type: image/svg+xml' \
  --data-binary '<svg xmlns="http://www.w3.org/2000/svg"><script>document.title="PWNED"</script></svg>'
# 打开返回的 url（用浏览器），标题不应变成 PWNED；响应头应含 content-security-policy

# 8. DNS 重绑定面（Host 白名单）
curl -i -H 'Host: evil.test:8865' http://127.0.0.1:8865/api/canvases
# 期望 403，而不是 200

# 9. 预检不被令牌拦住
curl -i -X OPTIONS http://127.0.0.1:8865/api/server-plugins/install \
  -H 'Origin: http://127.0.0.1:8865' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: x-admin-token,content-type'
# 期望 204，且 access-control-allow-headers 含 x-admin-token

# 10. 简单请求改画布（第一节的手法；加令牌后应当 403）
curl -i -X POST http://127.0.0.1:8865/api/canvases/default/nodes \
  -H 'Origin: http://evil.test:9999' -H 'content-type: text/plain' \
  --data-binary '{"add":[{"id":"x","type":"text","position":{"x":0,"y":0},"data":{}}]}'

# 11. 上传超限（第二十节；commit 0 之后应当是 413）
# Windows 没有 /dev/zero，用 PowerShell 生成 100MB 再传：
#   fsutil file createnew big.bin 104857600
curl -i -X POST 'http://127.0.0.1:8865/api/canvases/default/resources?name=big.bin' \
  -H 'content-type: application/octet-stream' --data-binary @big.bin

# 12. 审计链校验（有了 audit-verify 之后）
#   node packages/cloud-server/dist/cli.js audit-verify -d .mini-canvas
```

## 八、实施步骤（六个 commit，顺序是硬约束）

顺序不是随便排的：**有两处「一上线就会立刻打坏功能」的依赖**，必须按这个次序做。

| 序 | 内容 | 验收 |
|---|---|---|
| 0 | 资源回读加 `CSP: sandbox`（第十九节）+ 上传大小上限（第二十节） | 带脚本的 SVG 打开后不执行、`<img>` 仍正常；超限上传返回 413 且无残留 |
| 1 | **视觉节点上传改宿主代发**（`save`；顺带 `task` 也走桥）+ `UiContent.vue` 代发实现 | 视觉节点保存正常；iframe 内 Network 面板看不到 `/api/canvases/*/resources` |
| 2 | `adminAuth.ts` + 中间件（首版白名单）+ `--no-admin-auth` + 单测 | 第十三节的 42 个入口 + 两组前缀无令牌 403；资产/项目/KV 写接口不受影响 |
| 3 | 前端带令牌：`plugin-manager`、`plugin-agent` 的 `json()`、`plugin-cloud-client` 的 `doFetch`、面板输入框 | 面板能装插件、能对话、cloud-client 能写画布 |
| 4 | `requestTrust.ts` + 收紧 CORS + 单测（**放在 1 之后**） | 恶意 Origin 403；DNS 重绑定 Host 403；视觉节点仍可保存 |
| 5 | `audit.ts` + 接入 + hash 链 + 单测 | 日志出现 attempt/ok，链连续 |

为什么是这个顺序：

1. **0 最先**：只要同源 SVG 还能执行脚本，令牌就是「偷得到的东西」，后面的加固等于白做；
2. **1 在 2 之前**：commit 2 给 `/api/canvases/:id/resources` 加令牌，视觉节点的保存会立刻 403。必须先把上传改成宿主代发，再加令牌。反过来做，两个 commit 之间视觉节点是坏的；
3. **4 在 1 之后**：请求边界会拒绝 `Origin: null`，而视觉节点的所有请求都是 `Origin: null`。commit 1 做完之后它已经不发请求了，4 才安全；
4. **4 不能拖到最后**：它是 `PUT /api/canvases/:id`（整画布覆盖）的实际防线（第一节实测：当前跨源可整张覆盖）。0→1→2→3 之后必须紧接着做 4；
5. **5（审计）最后**：它只记录、不改变权限，放最后不阻塞任何东西。

> 如果只想上一部分：**0 + 1 + 2 + 3 + 4** 是最小的「能防住主要威胁」组合。2 不加 3 的话功能会坏（面板/对话/cloud-client 全 403），所以两个必须一起；5 可以下一版补，代价是这段时间没有审计。

每一 commit 完成后都要跑的四条（全绿才算过）：

```bash
pnpm -C packages/cloud-server test && pnpm -C packages/cloud-server typecheck
pnpm -C packages/plugins/plugin-node-ui test && pnpm -C packages/ui typecheck
```

commit 0 与 1 还要各跑一次真机确认（单测测不出「浏览器怎么处理 CSP」和「postMessage 传不传得动字节」）：

- 0：上传带脚本的 SVG，直接打开，标题不变；再用 `<img>` 引用，能显示；
- 1：打开一个视觉节点，画一笔，确认产物保存成功、且 iframe 自己的 Network 里没有 `/resources` 请求。

## 九、风险与回滚

| 风险 | 缓解 |
|---|---|
| 前端写请求被 403 | 首版拦 42 个入口加两组前缀；插件面板、对话面板、cloud-client 画布写都要带令牌。watch 门铃（KV）不受影响 |
| dev 代理被 Origin/Host 拦 | 显式 `--trusted-origin` + `--trusted-host`，5.3 有命令 |
| 旧脚本/测试未带令牌 | 测试统一固定令牌；文档列全调用点 |
| 令牌泄露 | 不注入 meta；cookie 用 HttpOnly；不写日志 |
| 回读 SVG 执行脚本 | 第十九节：`CSP: sandbox`（实测挡得住且不影响 `<img>`），放进 commit 0 |
| 审计日志被插件删除 | hash 链可发现；日志与数据目录分开可再加强 |
| 令牌文件被插件读取 | **挡不住**：插件能 `ctx.store` 到 `plugin-data/`、能用完整 fs；令牌文件在同一数据根下。只能靠「不装不可信插件」 |

回滚：`--no-admin-auth` + `MINI_CANVAS_ALLOW_INSECURE=1` 一次性关闭；按 commit revert。

## 十、验收清单

- [ ] 无令牌调第十三节清单里的任一入口返回 403（含 `/api/task/call`）
- [ ] 正确令牌调这些入口通过校验
- [ ] 资产/项目/历史/KV 的写接口**不**要求令牌（首版；前提是 CORS + Host 白名单生效，见第一节「暂缓不等于安全」）
- [ ] `POST /api/canvases/:id/{nodes,edges,resources,duplicate}` 无令牌 403，带令牌通过
- [ ] `PUT /api/canvases/:id`（整画布保存）仍**不**要求令牌（首版不在范围，注意它是 PUT 而非 POST）
- [ ] 跨源 `PUT /api/canvases/:id` 被挡住（前提：CORS 收紧 + Host 白名单都已生效；实测它当前能整张覆盖）
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
- [ ] 受保护入口清单（42 条，另加 `/api/showcase/` 前缀组共 11 个写接口）与 `adminAuth` 里的前缀表逐条一致（有测试锁住）
- [ ] 已知未覆盖的写接口有明确清单（资产 / 项目 / 历史 / KV / `PUT /api/canvases/:id`），并写进发布说明，不假装已保护
- [ ] 新增插件注册后台路由时，能通过统一声明标记鉴权等级（长期机制，见第十四节）
- [ ] `POST /api/agent/models` 无令牌返回 403（SSRF 入口）
- [ ] `baseUrl` 指向 `169.254.169.254` / `127.0.0.1` / 内网段时被拒绝（若本版实现内网拦截）
- [ ] `POST /api/agent/chat/completion` 无令牌返回 403
- [ ] 视觉节点（沙箱 iframe）能正常加载并**保存产物**（第十六节：宿主代发上传）
- [ ] 视觉节点里的 `CanvasUI.save()` 不再自己 fetch（检查 iframe 内 Network 面板无 `/api/canvases/*/resources` 请求）
- [ ] `Origin: null` 请求一律 403（不设例外）
- [ ] Host 头写成别的域名（如 `evil.test:8865`）被 403（DNS 重绑定，实测见 4.5）
- [ ] 第三方网页**自造 sandbox iframe** 打 `/api/*` 仍被拒绝（实测手法，见第十六节）
- [ ] 带脚本的 SVG 从 `/api/canvases/*/resources/*` 打开后不执行（第十九节）
- [ ] 对话面板能发消息、能点审批（`/api/agent/canvases/` 写请求带令牌）
- [ ] 底栏生成按钮 / cloud-client 下单能正常工作（`/api/jobs` 带令牌；不带时 403）
- [ ] 会话列表、转录、SSE 流**不需要**令牌（读请求不受影响）

> 这几条互相牵制，实施时要一起验：视觉节点的 `CanvasUI.task()`（`plugin-node-ui/src/uiData.ts:610-630`）是**从沙箱 iframe 直接 POST `/api/task/call`** 的。首版给 `/api/task/` 加令牌之后，**这条 API 会坏**。两条路：
> ① 一并改成宿主代发（和 `save` 同一套机制，`type:'task'` 分支）；
> ② 接受它坏掉，并在 `guide.md` 里写明「首版请用 MCP / 宿主侧调用，不要用 `CanvasUI.task`」。
> 首版建议选 ①：同一套桥已经为 `save` 做了，顺手加一个 `task` 分支成本很低。**不要**为了保住它给 `Origin: null` 开例外。

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
| `packages/ui` 自身的画布保存、主题、项目、资产 | `method: 'POST/PUT/DELETE'`（约 12 处，已扫描） | ✅ 同源，能带；但首版只有画布 POST 需要，其余暂缓 |
| `plugin-manager` 面板 | 插件安装/卸载、NPM 操作 | ✅ 同源，能带 |
| `plugin-cloud-client`（后台客户端） | 画布增量写、资源上传，走 `/api/canvases/:id/{nodes,edges,resources}`（`src/api.ts:155/218/228`） | ⚠️ **首版要带令牌**：这几条已进清单 |
| `plugin-cloud-client` 的 KV 写 | `/api/kv/...`（`src/api.ts` 多处） | ⏸ 首版不需要（KV 不在清单里） |
| `plugin-bottom-bar` 的生成按钮 / `plugin-cloud-client` 下单 | `POST /api/jobs`（`cloud-client/src/api.ts:76`） | ⚠️ **首版要带令牌**：`/api/jobs/` 已进清单（花钱） |
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

- 只保护**会引入代码/执行命令**的接口：`/api/server-plugins/*`、`/api/npm-plugins/*`、`/api/agent/mcp*`、`/api/agent/skills/*`、`/api/agent/system-prompt`、`/api/agent/template/*`、`/api/agent/prompts`、`/api/agent/policy`、`/api/agent/title-model`、`/api/task/*`、`/api/node-packages/*`、`/api/node-ui/debug-*`、`/api/style-library/*`；
- 画布数据、资产、项目、KV 等高频写接口**首版一律不加令牌**——这一条**不成立**：实测（第一节）`POST /api/canvases/:id/nodes` 用 `text/plain` 简单请求就能改，所以画布 POST 已并入清单（见 4.3 的二选一）；
- 优点：改动小；缺点：**视觉节点保存会坏**（如果补上画布写保护），或**画布对任何网页开放**（如果不补）。两个缺点必须选一个，不存在「都不破坏」的版本。

### 建议

**首版走方案 C，但必须补一条**：在「能执行代码」的入口之外，把 `POST /api/canvases/:id/*` 也加上，同时把视觉节点的素材上传改成宿主代发（4.3 的二选一，选 A）。理由：只封执行代码、放着画布写不管，等于把「改你的画布」这条留在外面，而它正是视觉节点 XSS 的落点（第十九节也是走这条路上传）。

这样第一步大概 3~4 天，而不是一两天；但它是「要么安全、要么方便」的选择题里，唯一不会自相矛盾的组合。

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
POST /api/canvas/nodes                           ← 老接口，同样能改默认画布
POST /api/canvas/edges
POST /api/canvases/:id/nodes                     ← 第一节实测：简单请求可直接改
POST /api/canvases/:id/edges
POST /api/canvases/:id/resources
POST /api/canvases/:id/duplicate
POST /api/jobs                                    ← 下生成单（花钱）
POST /api/jobs/:jobId/cancel
```

清单靠**「方法 + 路径前缀」匹配**实现，不逐个写死完整路径。**实现时以上面这份逐条清单为准**（它是需求），下面这份前缀表只是等价的实现形式（便于少写几十条）；两者出现分歧时，按逐条清单补齐前缀：

```
任意写方法：/api/server-plugins/  /api/npm-plugins/  /api/agent/mcp  /api/agent/skills
           /api/agent/system-prompt  /api/agent/template/  /api/agent/prompts
           /api/agent/policy  /api/agent/title-model  /api/agent/models
           /api/agent/chat/completion  /api/task/  /api/node-packages/
           /api/node-ui/debug-  /api/style-library/  /api/effect-library/
           /api/showcase/  /api/agent/canvases/
           /api/jobs/        ← 下生成单 = 花钱；跨源简单请求实测能进 handler
仅 POST：   /api/canvases/    /api/canvas/     ← 后者是老接口，同样能改默认画布
```

> `/api/agent/canvases/` 与 `/api/canvases/` 的**读**请求不受影响（中间件只看写方法），所以会话列表、转录、SSE 流、画布读取照常；被拦的是写操作。

> **注意 `/api/canvases/` 与 `/api/canvas/` 只保护 POST**，不要写成一整段前缀：`PUT /api/canvases/:id` 是整画布保存（前端高频），`GET` 是读；它们不在首版范围。实现时要按「方法 + 前缀」匹配，不能只看路径。

> `/api/canvas/nodes`、`/api/canvas/edges`（没有 `s`）是同一份路由里针对默认画布的老接口（`canvasOps.ts:199/226`），和 `/api/canvases/:id/*` 干的是同一件事，别漏。

> 同理 `/api/agent/canvases/` 虽然整段写成「任意写方法」，但它只覆盖 `POST/PATCH/DELETE`；`GET .../stream` 是 SSE 读，不受影响。

> 清单后一半来自后续两节：第十四节的插件运行时注册路由（`ctx.routes.*`，静态扫描看不到）与第十五节的 SSRF 入口。`/api/task/call` 能执行任意脚本，是这批里最危险的；`PUT /api/style-library/settings` 与 `PUT /api/effect-library/settings` 能把读取目录改到任意路径，是第二梯队。

> 两处按前缀匹配而不是按单条路由匹配：`/api/agent/mcp` 会一并保护 `/api/agent/mcp/probe`（探测会拉起已配置的 stdio 命令）；`/api/style-library/` 与 `/api/effect-library/` 整段保护，避免以后新增子路由漏掉。

同时必须改：

- `plugin-manager` 面板的写请求带令牌；
- `plugin-agent` 的 `agentApi.ts` 在 `json()` 里统一带头（一处覆盖所有会话写请求）；
- `watch.mjs` 首版不用改（KV 不在保护范围）。升级到全量写保护时，再给它加令牌；
- `plugin-cloud-client` **首版必须改**：它写画布走 `/api/canvases/:id/nodes`、`/edges`、`/resources`（`src/api.ts:155/218/228`），而这几条现在要令牌了。它的 `CloudApi` 是唯一出口（`absolute()` 拼地址），在 `doFetch` 处统一带 `x-admin-token` 即可；令牌来源同插件面板（localStorage），拿不到时提示去设置。
- 下单也要带：同一个 `CloudApi` 里的 `createJob`（`src/api.ts:76`）打 `/api/jobs`，现在在清单里。**一处 `doFetch` 统一加头就全覆盖**，不要逐方法改（否则漏一个就变成"偶尔 403"）。

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

### 顺手验过：NPM 包的 tar 解压有没有路径穿越

`npmClient.extractTarball`（`npm/npmClient.ts:138-145`）用的是 `tar -xzf <tgz> -C <tmp> --strip-components=1`。手工构造一个含 `../escape.txt` 与 `../../escape2.txt` 条目的 tar（本机 bsdtar 3.8.4）：

- `../escape.txt` 被 `--strip-components=1` 剥掉一层后落成 `<tmp>/escape.txt`，**没有**写到 tmp 之外；
- `../../escape2.txt` 报错、没有落盘；
- 目标目录的父目录里没有出现任何越界文件。

结论：**这条不是路径穿越漏洞**（至少 bsdtar 如此）。真正的风险在「包内容本身是代码」——与第二节「用户自己确认安装的恶意插件」同一条。

> 复现：`.scratch/header-probe/tar-probe2.mjs`（手写 tar 头，因为 bsdtar 打包时会自己拒绝 `../` 条目）。

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

第十三节的 42 条主清单，按来源可以拆成四块：

```
A. cloud-server 固定路由 21 条
   /api/server-plugins/{install,uninstall}            2
   /api/npm-plugins/{install,update,uninstall}        3
   /api/agent/mcp（POST、DELETE、probe）               3
   /api/agent/skills/{import, DELETE :name}            2
   /api/agent/{system-prompt,template/restore,prompts,policy,title-model}  5
   /api/agent/models（POST、DELETE、bulk、:kind、available） 5
   /api/agent/chat/completion                          1

B. 插件运行时注册的路由 13 条（第十四节）
   /api/task/{call,cancel}                             2
   /api/node-packages/{build,save,export,inspect,import} 5
   /api/node-ui/debug-{accept,result}                  2
   /api/style-library/{settings,reload}                2
   /api/effect-library/{settings,reload}               2

C. 画布写接口 6 条（第一节实测：简单请求可直达）
   /api/canvas/{nodes,edges}                           2
   /api/canvases/:id/{nodes,edges,resources,duplicate}  4

D. 生成任务 2 条（同样能花钱）
   /api/jobs、/api/jobs/:jobId/cancel                  2

合计 21 + 13 + 6 + 2 = 42
另加两个前缀组：/api/showcase/（11 个写接口）、/api/agent/canvases/（会话语）
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

### 属于首版清单的 6 条（SSRF 入口）

下面这 6 条已经并进第十三节的总清单，单独列出来是为了说明它们的来源：

```
POST   /api/agent/models
DELETE /api/agent/models
PUT    /api/agent/models/bulk
POST   /api/agent/models/:kind
POST   /api/agent/models/available
POST   /api/agent/chat/completion
```

它们属于第十三节 42 条中的一部分，不额外增加计数。

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

> 复现脚本：`.scratch/header-probe/run2.mjs`（同源 vs 沙箱 vs 第三方）、`run3.mjs`（恶意页面自造 sandbox iframe）。脚本已随本方案提交，跑法见文件头注释。

### 改后的做法

**视觉节点不该再自己发请求。** 三条路，按推荐顺序：

**① 短时票据（中长期推荐，首版不做）**

- 宿主渲染 iframe 时，向后台要一个 `uiTicket`（绑定 `canvasId + nodeId`，有效期几分钟，一次性或限次）；
- 票据通过 `srcdoc` 里的 `window.__CANVAS_UI__.ticket` 注进去（本来就有一个 `__CANVAS_UI__` 全局，见 `uiData.ts:451`）；
- 沙箱页面所有请求带 `x-mc-ui-ticket: <票据>`；
- 服务端只放行「票据有效」的不透明源请求，且**只放行读接口与素材上传**，不放行 `/api/task/*`、`/api/agent/*`、`/api/server-plugins/*`。

这样恶意页面即使造出同样的 iframe，也拿不到票据——票据是宿主在渲染时注入的，不是猜出来的。

**② 宿主代发（最彻底；首版做它的最小切片）**

- iframe 不发 HTTP，全走 `postMessage` 交给宿主；宿主带令牌代发；
- 好处：iframe 永远碰不到网络层，也就不存在「它能不能自己请求」的问题；
- 代价：`plugin-node-ui` 的桥接层要重写，且视觉节点的调试 SDK 也要跟着改；**但不需要改 `buildSrcdoc` 的 CSP**（它本来就在 `connect-src` 里放行了后台，改完之后那条可以收紧）。

> 顺带说明当前 CSP 的实际形状（`uiData.ts:352-370`）：`default-src 'none'`、`img-src * data: blob:`、`script-src 'unsafe-inline' 'unsafe-eval'`、`connect-src` 只列允许的源。也就是说沙箱页**只能连被放行的后台源**，这一点已经比「什么都不限」好——但它挡不住「页面自己主动 fetch 后台」，因为后台就在放行列表里。代发做完之后，`connect-src` 可以缩到 `'none'`。

**③ 把视觉节点挪到独立源（结构最优，改动最大）**

- 给生成页面一个独立域名/端口（如 `127.0.0.1:8866`），与后台不同源；
- 这样它天然是跨源，可以直接用正常 CORS 白名单管理，不必给「null 源」开洞；
- 代价：要再起一个静态服务，部署与打包都变复杂。

### 首版怎么办

首版不做完整的票据体系，但**不能不管视觉节点**。原因是两条很实的依赖：

1. 它的保存产物走 `POST /api/canvases/:id/resources`（`uiData.ts:590-593`），而这已经在首版清单里（第十三条，简单请求可达）；
2. 关闭这条通路就等于「视觉节点只能看不能存」，功能是坏的。

所以首版做**最小切片**：宿主代发上传（第十六节方案 ② 的最小形态）。具体：

```
iframe 里 CanvasUI.save(bytes) 不再 fetch，改成 postMessage({__canvasUi:1, type:'save', bytes})
宿主收到后用自己同源的 fetch 带 x-admin-token 转发到 POST /api/canvases/:id/resources
宿主是 packages/ui 里的 UiContent.vue（它本来就在监听 __canvasUi 消息）
```

这样：

- 沙箱 iframe 永远不需要直接访问 `/api/*`；
- 视觉节点保存照常工作；
- 不需要票据，也不需要给 `Origin: null` 开例外。

`postMessage` 传字节：`Uint8Array` 可被结构化克隆，不需要 base64（当前 `uiData.ts` 里的注释也提到结构化克隆；传 `ArrayBuffer` 最省）。

改动点已经定位清楚（实施时照这两处改）：

| 文件 | 现在做什么 | 改成 |
|---|---|---|
| `plugin-node-ui/src/uiData.ts:583-604`（`CanvasUI.save`） | 自己 `fetch(.../resources?slot=...)` 上传，成功后 `post({type:'output', url})` | 不 fetch；`post({__canvasUi:1, type:'save', bytes, name})`，等宿主回传 `output` |
| `plugin-node-ui/src/UiContent.vue:599`（`onBridgeMessage`） | 只处理 `ready` / `state` / `output` | 增加分支 `type === 'save'`：取 `m.bytes`，用带令牌的 fetch 上传，成功后走原有的 `output` 写入逻辑 |

宿主那条 fetch 需要一个令牌来源。`UiContent.vue` 跑在 `packages/ui` 里，和令牌输入框同源，读 localStorage 即可。

另有一处不在 iframe 里、但也直连后台：后台任务脚本的 `ctx.save`。它跑在 Node 子进程里（`task/runner.ts:137` 拼 `/resources?slot=`），用 `fetch` 直接打后台。加令牌之后脚本侧也要带——但**不要把管理令牌传给子进程**（那等于把最高权限交给每个脚本）。做法：给脚本发一个只允许写本节点槽位的短时令牌，或让脚本把字节回传给父进程、由父进程带管理令牌写盘。这是第十七节「权限隔离」的同一个问题，首版至少要先选一条。

**剩下要单独放行的只有一条**：

```
GET  /api/node-ui/info              免令牌（只回一个 origin 字符串，不含任何敏感信息）
```

这条没有副作用（只是告诉沙箱页「后台在哪」），放行的风险很小；它也该限制成只回本服务的 origin。

> 如果连这条也不想放：沙箱页的 `baseUrl` 可以由宿主通过 `srcdoc` 的 `__CANVAS_UI__` 直接注入（现在就是这么做的），`/api/node-ui/info` 只是兜底。那就把这条也关掉。

### 对方案的影响

1. **4.5 的规则要删掉「`Origin: null` + `same-origin` 放行」这一行**，它不存在；
2. **实施顺序**：请求边界（第八节 commit 4）之前必须先确认视觉节点仍能工作；
3. **验证清单**要加两条：视觉节点能加载并上传；第三方网页自造 sandbox iframe **仍被拒绝**。
4. **不要**用 `X-MiniCanvas-Ui: 1` 这类自定义头当门槛——网页也能加，挡不住；它只能当「减少误伤」的提示，不能当鉴权。

### 一个绕不开的取舍

沙箱 iframe 与后台之间必须有一条**可被不透明源访问的通路**。这本身就是攻击面：任何能在这个 iframe 里执行脚本的东西（包括 AI 生成的页面、调试 SDK）都能调后台。

所以这条通路的权限必须最小：

- 沙箱页只被允许拿 `baseUrl`（`GET /api/node-ui/info`），其余一律经宿主代发；
- 上传限大小、限扩展名（第十九节的 CSP 也要一起加）；
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
| Node 24 `--permission --allow-fs-read=... --allow-fs-write=...` | 越界读写文件 | 小；但子进程启动参数要改，且部分依赖会报错 |
| `--permission` 下不给 `--allow-child-process`（默认就是禁的） | 再起进程 | 小；只需要确认任务脚本不需要 spawn |
| 限制出网（系统防火墙 / 容器网络策略） | 外联 | 中；可能影响需要联网的任务（生成类任务通常要出网，要按用途白名单） |
| 独立系统用户 / 容器 / microVM | 上面全部 | 大；部署与调试复杂度上一个台阶 |

这三条都**不在本次范围**（第十一节第 1 条已列）。这里写清楚是为了避免实施时误以为「加了令牌就安全了」。

**第一档已在本机实测可用**（Node v24.15.0）：

```
node --permission --allow-fs-read=<dir> --allow-fs-write=<dir> a.mjs
  → 目录内写：WROTE OK
  → 目录外写（同一脚本写到父目录）：BLOCKED ERR_ACCESS_DENIED
```

注意标志名是 `--permission`（不是早先的 `--experimental-permission`）。本机 Node 24.15 的 `--help` 里**没有** `--allow-net`，但有 `--allow-child-process`、`--allow-worker`、`--allow-addons`——也就是说这一版能用它挡住「再起进程、开线程、加载原生模块」，**出网仍要靠系统防火墙或容器**。实施前先跑 `node --help | findstr allow-` 确认版本支持面，不要照抄别的版本的参数。

**`--permission` 有一条必须提前想到**：开了它之后，**读文件也要在白名单里**。任务脚本要读它自己的 `.mjs`、要读上游素材（画布资源在数据目录下）、Node 自己还要读依赖——白名单写窄了，脚本会在「连自己都加载不了」的地方失败，报错还很像业务错误。建议先用 `--allow-fs-read=<dataDir> --allow-fs-read=<task-scripts 目录> --allow-fs-read=<node_modules>` 起步，跑通真实任务之后再逐步收窄。

### 验收时怎么区分

- 令牌测试：不带 `x-admin-token` 调 `/api/task/call` → 403。这验证的是「门锁上了」；
- 隔离测试（本版不做）：带正确令牌提交一个 `import('node:fs').writeFileSync('C:/temp/pwn.txt','x')` 的脚本 → 应当失败。现在会成功。

## 十八、Agent 会话也能间接执行命令（首版漏网的一条链）

**没有这条，首版是有洞的**：清单保护了「改配置」，但没保护 `agentSessions.ts` 里那批会话写接口，而它们能把命令跑起来：

**先确认工具面**：`@prismshadow/penguin-core` 的内置工具默认就包含 `exec_command`（跑 shell）与 `write_file`（写任意文件），见 `dist/index.js:721` 与 `:700`，二者 `permission: 'rw'`。所以「模型会不会用命令」不是理论问题——工具就在那儿，只有审批策略拦着。

而审批策略默认是「`exec_command` / `write_file` 要问」（`agent/approval.ts:37-45`），但那条「问」是**通过无鉴权的 HTTP 回答的**：

```
1. POST /api/agent/canvases/:id/sessions              → 建一个会话（无鉴权）
2. POST /api/agent/canvases/:id/sessions/:sid/messages → 让模型干活（无鉴权）
3. 模型决定调 exec_command                            → 触发审批
4. POST /api/agent/canvases/:id/sessions/:sid/approvals/:aid → 允许（无鉴权）
```

第 4 步不需要知道审批内容：`decision` 只要不是 `'deny'` 就是 `allow`（`agentSessions.ts:818`）。整条链剩下的「门」只有第 3 步那个模型要不要用命令——而模型会被提示词影响，提示词又能通过 `PUT /api/agent/system-prompt`、`/api/agent/prompts` 改。这两条在首版清单里，所以**首版上线后，攻击者改不了提示词**；但第 1、2、4 步的会话接口如果在首版没保护，链条里的「新会话 → 发消息 → 点允许」仍然通。

另外两个副作用不需要模型配合：

- `POST /messages` 每调一次就是一轮真实模型调用，**花的是你的钱**（这也是为什么这组接口必须进首版清单：即使模型拒绝用命令，钱也已经花了）；
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

画布右侧的对话面板走 `plugin-agent/src/agentApi.ts`，和页面同源，加令牌可行；在它的 `json()` 里统一加头即可（不用改 15 处），属于第八节 commit 3 的工作。

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

实测输出（Chrome 153）。**两次都做了**：一次是对自建的等价 mock（`run7-svg.mjs`），一次是对**真实 cloud-server**（`real-browser-svg.mjs`，8932 端口，真实上传接口）：

```
匿名上传 → 200
回读 content-type: image/svg+xml；CSP: 无；X-Content-Type-Options: 无
打开该地址 → document.title 变成 XSS-RAN token=FAKE-TOKEN-ABCDEF
同源脚本读到 localStorage: {"token":"FAKE-TOKEN-ABCDEF"}
```

真实服务的输出（第二次）：

```
匿名上传: 200 {"ok":true,"url":"/api/canvases/default/resources/b24cf55614321569.svg",...}
打开 SVG 后 document.title = PWNED:REAL-FAKE-TOKEN-1234
同源上下文读到 = {"origin":"http://127.0.0.1:8932","token":"REAL-FAKE-TOKEN-1234"}
```

这说明它不是 mock 造出来的：真实服务的回读确实不带 CSP，脚本确实在 `127.0.0.1:8932` 这个源上执行，并能读到同源 localStorage。

所以：**只要令牌存在 localStorage，任何能上传 SVG 的人都能把它读走**。上传接口 `POST /api/canvases/:id/resources` 在首版清单里（见第十三节），所以首版上线后这条路会先被令牌挡住；但**commit 0 必须独立于令牌先做**——因为 `POST` 之外还有别的同源写入点（例如 `slot` 覆盖、以及任何人只要拿到过一次令牌），把令牌当成唯一防线是不够的。

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

结论：第 1 条应当**提到 commit 0**（第八节），与令牌同批上线。否则令牌只是把「别人装插件」换成「别人先偷令牌再装插件」。

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

## 二十、上传没有大小上限（实测确认，资源耗尽风险）

资源上传路由把整个请求体读进内存再写盘（`routes/canvases.ts:96` 的 `await c.req.arrayBuffer()`），**没有任何大小检查**；`server.ts` 也没挂 body limit，`@hono/node-server` 默认同样不限制。

> 注意别和另一条混淆：画布的**节点增量写**（`canvasOps.ts`）是有上限的——`MAX_BODY_BYTES = 16MB`（`:37`），17MB 实测返回 `413 body 过大`。**只有资源/资产上传这条路没有上限。** 修复时也要分别处理：节点写那条已经够了，不用动。

实测（`.scratch/header-probe/run16-upload-limit.mjs`，真实服务，写的是临时数据目录）：

```
POST /api/canvases/default/resources?name=big.bin
  Origin: http://evil.test:9999
  content-length: 209715200（200MB）
→ 200 {"ok":true,"size":209715200,...}
```

也就是说，匿名请求可以往磁盘写任意大的文件；内存在读取阶段会有一个约等于文件大小的峰值。

### 为什么这是安全问题（不只是性能）

1. **磁盘占满**：写满数据盘之后，画布保存、历史、审计日志一起失败——这是拒绝服务，不是「慢一点」；
2. **内存峰值**：`arrayBuffer()` 把整个文件读进内存，几个并发大文件就能把后台顶到 OOM；
3. **和其他缺口叠加**：上传接口对跨源简单请求开放（`text/plain` 体可以是任意字节），配合「没有令牌」就是「谁都能灌」。

### 怎么修（建议放进 commit 0，与 CSP 同批）

1. **先看 `content-length`**：超过上限直接 `413`，连 body 都不读；
2. **读的时候也计数**：`content-length` 可以撒谎（或分块传输没有它），要边读边累加，超了立刻中断连接；
3. **边读边写临时文件**，不要 `arrayBuffer()` 全量进内存；写完再 rename（现有 `saveSlot` 已经是这个模式，上传路由可以复用）；
4. **给默认上限**（例如 50MB），并允许环境变量覆盖；`assets` 上传（`routes/assets.ts:31-37`）同样没有上限——实测 50MB 返回 200、资产真的建出来了；
5. **可选但建议**：每张画布的总占用设一个配额，防止「每个文件都不超上限、加起来把盘写满」。

### 验收

- [ ] 上传超过上限的文件返回 413，且磁盘上没有残留文件；
- [ ] 正常大小的文件上传仍成功，回读正常；
- [ ] `content-length` 撒谎（声明小、实际大）时也会被中断；
- [ ] `/api/assets` 上传同样受限。

---

## 附：本文结论的证据清单

| 结论 | 证据 |
|---|---|
| 不透明源报 `cross-site`，不存在 `same-origin` | `run2.mjs` |
| 恶意页可自造 sandbox iframe 打后台 | `run3.mjs` |
| `cors()` 默认 `origin: '*'` 时能读写 | `run6-wildcard.mjs` |
| 匿名 SVG 同源执行脚本、读 localStorage | `run7-svg.mjs`（mock）+ `real-browser-svg.mjs`（真实服务） |
| DNS 重绑定可绕过「Origin == Host」 | `run8-rebind.mjs` |
| CSP `sandbox` 挡脚本且不影响 `<img>` | `run9-csp.mjs` |
| 简单请求（`text/plain`）可改画布 | `run10-simple.mjs` + `run11-real-simple.mjs`（真实服务） |
| 简单请求也能改项目 / 资产 / KV | `run14-real-others.mjs`（真实服务） |
| 上传没有大小上限（200MB 被接受） | `run16-upload-limit.mjs`（真实服务） |
| 跨源 `PUT /api/canvases/:id` 能整张覆盖 | `run12-real-put.mjs`（真实服务） |
| `/mcp` 跨源可调、简单请求打不进 | `run15-mcp.mjs`（真实服务） |
| 公网页面打 127.0.0.1 未被 PNA 拦 | `run13-b-rebase.mjs` |
| 中间件顺序 / 预检 / 403 的 CORS 头 | `guard-probe.mjs` |
| Host 头读取与伪造 | `host-probe.mjs` |
| 前缀白名单没有被路径写法绕过 | `path-probe.mjs` |
| 前缀判定的边界与归一化 | `path-probe2.mjs` |
| NPM tar 解压没有路径穿越（bsdtar） | `tar-probe2.mjs` |
| Node 权限模型可用、越界写被拒 | 见第十七节命令（Node 24.15） |

所有脚本在 `.scratch/header-probe/`，用法见该目录 README。
