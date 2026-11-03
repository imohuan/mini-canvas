# 计划：NPM 插件市场对接（前后台插件闭环）

日期：2026-10-04 ｜ 前置：2026-10-04-server-plugin-system.md（已完成的本地安装链路）

## 〇、目标（用户口径）

1. 插件库分**前端**与**后台**两个版本（一个插件可以只有前半、只有后半、或成对）。
2. 后台新增一个**「插件展示」示例服务插件**：带 UI 界面，展示插件用法，能演示**在线注册**与**卸载**（实时生效）。
3. 把演示插件**发布到 NPM**，cloud-server 对接 NPM 拉取与安装，并支持**更新**。
4. 闭环 = NPM 上的包 → cloud-server 安装 → 前端界面出现 → 卸载 → 再更新。

非目标：不做 NPM 搜索聚合页（本期只装指定包/指定版本）；不做私有 registry 自建。

## 一、现状与关键结论（已核实）

- 安装链路：前端半走 UMD script 标签（umdLoader）；后台半走 POST /api/server-plugins/install
  （confirm:true + 服务端可信 sha256 锚点 + id 白名单 + 只落盘不执行，重启由 loader 执行）。
  **后台插件重启生效** —— 这是现有安全设计，不是缺陷；「更新」天然也是重启生效。
- 前端半**实时生效**：umdLoader 装上即跑；卸载走宿主 pluginManager 的 uninstall（内核作用域回收）。
- catalog：扫 packages/* 的 miniCanvas.installable 包产出 /plugin-catalog.json，
  条目含 url / globalName / server{url,sha256,permissions} / version。
- vite-plugin-lib 的 HOST_GLOBALS 是打包外部全局的单一事实源（有守卫测试）。
- cloud-server 打包内联工作区包（esbuild），npm 依赖保持 external。

## 二、包结构设计（发布到 NPM 的形态）

每个插件一个 npm 包，**发布的是打包产物**（单文件 UMD + 单文件 server.js），不带依赖树：

    @mini-canvas/plugin-<name>/
    ├── package.json     ← files 只含 dist/；main 指产物；miniCanvas 元数据段
    └── dist/
        ├── web.js       ← 前端半（UMD，css 内联）
        └── server.js    ← 后台半（esbuild 单文件；没有则不发布后台标记）

package.json 的 miniCanvas 段：

    "miniCanvas": {
      "installable": true,
      "title": "插件展示", "description": "...", "pluginName": "showcase",
      "web":    { "entry": "dist/web.js", "globalName": "MiniCanvasPluginShowcase" },
      "server": { "entry": "dist/server.js" },
      "permissions": []
    }

**为什么放 package.json**：npm registry 的 packument API 直接返回整个 package.json，
cloud-server 取到包就能读到全部元数据，不用再发明清单格式。

## 三、任务分解

### Task 1 —— 演示插件：plugin-showcase（前后台成对）

**Step 1**（后台半 server.js）：
- 注册路由：GET /api/showcase/hello（问候 + 已登记插件列表）、
  POST /api/showcase/echo（回显请求体，演示路由注册）。
- 用 ctx.jobs 注册每分钟打点任务（演示 jobs）；ctx.store 写一条自述（演示命名空间存储）。
- 代码注释写清每一小段各演示什么能力 —— 它本身就是教学样例。

**Step 2**（前端半 web.js）：
- 注册「插件展示」面板（插槽机制与现有面板一致），面板里：
  - 调 GET /api/showcase/hello 展示后台路由效果；
  - 一个 echo 按钮演示 POST；
  - 展示本插件 manifest（名称/版本/能力清单）。

**Step 3**：单测：路由级（fetch 直测 hello/echo）、前端纯逻辑（面板数据装配）。
**验收**：pnpm -C packages/plugins/plugin-showcase test 全绿；构建产出两个单文件产物。

### Task 2 —— 「在线注册 / 卸载实时生效」演示路径

- **Step 1**：showcase 前端半在 install 时向后台注册一次性路由 /api/showcase/instance-<ts>，
  界面可点开验证存在；卸载后该路由随内核作用域回收消失（前端半实时生效的直观演示）。
- **Step 2**：卸载演示：前端卸载清 intent；文档写明后台半重启生效（管理页 server 状态灯反映）。
**验收**：装 → 面板出现且路由可用；卸 → 面板消失、一次性路由 404、重启后后台半消失。

### Task 3 —— NPM registry 客户端（cloud-server 侧，零新依赖）

**Step 1** npmClient.ts（Node 内置 fetch，不引 npm SDK）：
  - npmFetchPackument(name)：GET https://registry.npmjs.org/<name>（dist-tags.latest + versions）；
  - npmDownloadTarball(tarballUrl)：下载 tgz 到临时文件；
  - 解包用 child_process 调系统 tar -xzf（Node 无内置 tar；Win10+/Linux/macOS 自带）。
**Step 2** extractNpmMeta(pkgJson)：读 miniCanvas 段 → 归一成 catalog 条目同构（web/server 标记）。
**Step 3** 单测：假 tarball 本地解包为主；真 registry 只读请求 1 条（避免 CI 强依赖网络）。

### Task 4 —— 安装/更新路由（cloud-server）

**Step 1** 新内置插件 npm-plugins 挂四条路由：
  - POST /api/npm-plugins/install，body { package, version? }：取 packument → 定版本 → 下载解包 → 校验：
    a) miniCanvas.installable === true；
    b) web 产物存在且 parseUmdGlobalName 能解析；
    c) server 产物存在 → 服务端自己算 sha256（复用现有可信锚点语义；落盘代码与手动安装抽公共函数）；
    → 前端半复制进插件托管目录，后台半落 server-plugins 目录。
  - POST /api/npm-plugins/update：按 dist-tags.latest 与已装版本比对，新则覆盖并记录。
  - GET /api/npm-plugins/installed：列 NPM 来源插件及版本（source: "npm"）。
  - GET /api/npm-plugins/search?q=<关键词>：**搜索**。npm registry 本体只有按名精确取包，
    搜索走 npmjs.com 的公开搜索端点 https://registry.npmjs.org/-/v1/search?text=<q>&size=20
    （同域名、GET 只读、无鉴权；服务端代查，避开浏览器 CORS/UA 限制）。
    返回后**二次过滤**：只留 miniCanvas.installable === true 且 scope 在白名单内的包 ——
    界面上不出现"装了也没用"的包。每条结果带：包名、描述、最新版本、发布时间、是否含 server 半。
**Step 2** 安全：装 NPM 包 = 服务端代码执行 → **必须 confirm:true**（与手动安装同一确认语义）；
  包名校验 @scope/name；**默认限制 @mini-canvas/ scope**（后续可配置放开）。
**Step 3** 路由级测试：本地假 registry（http server 吐 packument/tarball）装→列→更→卸全流程。

### Task 5 —— 前端插件管理页接 NPM 源

- **Step 1** PluginManagerPage 加来源分区：本地目录 / NPM 市场。NPM 区顶部是**搜索框**
  （防抖 300ms，走 /api/npm-plugins/search），下方依次：搜索结果（可安装）、
  已安装列表（版本号 + 「有更新」灯 + 更新/卸载按钮）。
- **Step 2** NPM 区操作：安装（含 server 半时弹同款服务端权限确认）、更新、卸载。
- **Step 3** 服务层加 searchNpmPlugins(q) / installFromNpm(pkg, version?) / checkNpmUpdates()；
  intent 持久化键加来源前缀防串。
- **Step 4** 单测：服务层假 fetch 全流程。

### Task 6 —— 发布演示包到 NPM（真实闭环）

**Step 1** plugin-showcase 接发布脚本；npm pack 内容检查：只有 dist + package.json。
**Step 2** 用用户已登录的 npm 执行 npm publish --access public（**发布前向用户展示包名+版本并确认**）。
**Step 3** 端到端（真 NPM）：
  1. 界面搜索「@imohuan/plugin-showcase」（精确包名）→ 搜到它；
  2. 点安装 → 成功 → 面板出现 → hello/echo 可用（在线注册演示）；
  3. 卸载 → 面板消失、一次性路由 404；
  4. 改版本重发（1.0.1，改文案）→ 搜索结果显示「有更新」→ 点更新 → 界面显示新版本（更新闭环）。

### Task 7 —— 文档与守卫

- docs/plugin-dev/ 加「发布到 NPM」一篇（照抄能跑：包结构、miniCanvas 段、publish、更新流程）。
- 守卫测试：NPM 来源条目与本地 catalog 条目同构；KNOWN_GLOBALS 守卫覆盖 showcase 的 globalName。

## 四、顺序与依赖

Task 1 → 2 →（6 步骤 1 打包，先不发布）→ 3 → 4 → 5 →（6 步骤 2 发布 + 端到端）→ 7。
其中 3/4/5 依次依赖（client → 路由 → 界面）；发布动作放在链路代码验证通过之后，避免来回重发版本。

## 五、验收清单（全绿才算完）

1. pnpm -C packages/plugins/plugin-showcase test ✅
2. pnpm -C packages/cloud-server test（含 npm 路由级测试）✅
3. pnpm -C packages/plugins/plugin-cloud-client test（含 NPM 源服务层测试）✅
4. 真实 NPM：搜索命中 → 安装 → 演示 → 卸载 → 更新，全程记录 ✅
5. npm pack 内容检查：只有 dist + package.json ✅
6. 全程零新运行时依赖 ✅

## 六、风险与决策记录

| 决策 | 理由 |
|---|---|
| NPM 元数据放 package.json 的 miniCanvas 段 | registry API 免费返回，不发明第二清单 |
| 后台半重启生效（不热载） | 现有安全设计（落盘/执行分离），保持；管理页已有状态灯 |
| tar 用系统 tar 命令解 | Node 无内置 tar；Win10+/Linux/macOS 全自带，零依赖 |
| 默认允许 @mini-canvas/ 与 @imohuan/ | 装 NPM 包 = 代码执行，白名单起步；可用 MINI_CANVAS_NPM_SCOPES 配置放开 |
| 发布到 @imohuan/ scope | @mini-canvas 不属于本账号（registry 维护者是他人），npm 拒绝跨 scope 发布 |
| 搜索加"精确包名直查" | npm 搜索按热度排序，刚发布 0 下载的包排不进结果（实测 top 250 都无），必须直查补上 |
| confirm 语义复用 | 装远程包风险不低于手动粘贴，必须同款确认 |
| 发布动作放在链路就绪之后 | 真发一次就是一个版本号，避免验证过程刷版本 |

## 附录 A：showcase 后台 API 完整设计

本附录是 Task 1 Step 1（后台半 server.js）的完整接口设计。每个示例资源（todos、notes、
heartbeat 等）都只为演示一种 ctx 能力，代码注释里写清「这一段演示什么」。

### A.0 通用约定

**响应信封**：全部端点统一返回：

    成功：{ "ok": true,  "demo": "<能力组id>", ...载荷 }
    失败：{ "ok": false, "demo": "<能力组id>", "error": "<人类可读原因>" }

`demo` 字段取值固定为 `meta / routes / store / jobs / mcp / agent`。
前端「在线测试」面板**按 demo 字段分组渲染**：一个能力组一栏，每栏内按端点列表生成
可点击的测试按钮（方法+路径+示例参数由 `GET /api/showcase/endpoints` 下发，面板不写死）。

**错误码表**（HTTP 状态码 + error 文案，error 前缀 `showcase/`）：

| 状态 | error 前缀 | 场景 |
|---|---|---|
| 400 | showcase/invalid-body | body 不是合法 JSON、缺必填字段、字段类型不对 |
| 404 | showcase/not-found | todo / key / 资源不存在 |
| 409 | showcase/already-running | heartbeat 已在跑（重复启动） |
| 409 | showcase/already-registered | MCP 工具 / 中间件已注册 |
| 500 | showcase/internal | 未预期异常（handler 内兜底捕获） |

**能力边界（设计已按现状校准，实现时别超出）**：

- `ctx.routes` 的路由**必须在 apply() 里同步注册**（装载期）：Hono 首次请求后路由表冻结，
  运行期新注册的 path 没有代理、会 404。所以本附录所有端点路径都是静态的。
- `ctx.store` 一个插件一个命名空间（`plugin-data/<ns>.json`），**卸载即清**。
- `ctx.jobs` 是进程内定时器：重启即丢、最小间隔 50ms（框架强制下限）、异常自动包住不崩定时器。
- `ctx.mcp.tool` 与 `ctx.agent.tool` 落**同一张注册场表**（server/mcp-tool）；中间件落
  server/agent-mw。注册条目归 showcase 插件，卸载自动摘除。MCP/中间件注册不跨重启。
  `PluginModule` 没有 version 字段，自描述信息（版本号等）用插件模块内的常量。

### A.1 组 meta —— 状态与诊断（2 条）

演示点：插件自描述。**ctx 用法：纯模块常量 + apply 时刻记录，不需要 ctx 特殊能力**。

#### GET /api/showcase/meta

自描述：版本、能力清单、启动时间。前端面板顶部用它渲染「这个后台半是谁、能干什么」。

    响应 200：
    {
      "ok": true, "demo": "meta",
      "name": "showcase",
      "version": "1.0.0",
      "capabilities": ["routes", "store", "jobs", "mcp", "agent"],
      "startedAt": "2026-10-04T04:00:00.000Z",
      "uptimeMs": 65000
    }

`startedAt` = apply() 执行时刻（Date.now() 换 ISO 串）；`uptimeMs` = 响应时现算。
错误：无（本端点永远 200）。

#### GET /api/showcase/endpoints

能力索引：本插件全部演示端点，按能力组分组。前端在线测试面板**唯一的数据源**。

    响应 200：
    {
      "ok": true, "demo": "meta",
      "groups": [
        { "id": "routes", "title": "路由注册", "ctxUsage": "ctx.routes.get/post/put/delete",
          "items": [
            { "method": "GET",    "path": "/api/showcase/hello", "desc": "问候 + 已登记插件列表" },
            { "method": "POST",   "path": "/api/showcase/echo",  "desc": "回显请求体",
              "sampleBody": { "any": "值原样返回" } }
          ] },
        { "id": "store", "title": "命名空间存储", "ctxUsage": "ctx.store.namespace('notes')", "items": [ "…同构…" ] },
        { "id": "jobs",  "title": "定时任务",     "ctxUsage": "ctx.jobs.every / store 回读", "items": [ "…" ] },
        { "id": "mcp",   "title": "MCP 工具",     "ctxUsage": "ctx.mcp.tool(def)", "items": [ "…" ] },
        { "id": "agent", "title": "Agent 中间件", "ctxUsage": "ctx.agent.use / systemPrompt", "items": [ "…" ] }
      ]
    }

这张表在 server.js 里就是一个常量数组，与实际注册的路由手写对齐（简单任务不值得反射生成）。
错误：无。

### A.2 组 routes —— 路由注册（6 条）

演示点：GET/POST/PUT/DELETE 四种方法注册。**ctx 用法：`ctx.routes.get/post/put/delete(path, handler)`**，
handler 即 Hono 处理函数。示例资源 = 待办清单（内存 Map，**刻意不持久化**——持久化是 store 组的事）。

#### GET /api/showcase/hello

问候 + 已登记插件列表（Task 1 Step 1 原始需求）。插件列表 = 从路由注册场
`ctx.registryOf('server/route')` 的条目 id 去重得到——每个后台插件都在这张表里。

    响应 200：
    { "ok": true, "demo": "routes", "message": "hello from showcase",
      "plugins": ["health", "events", "canvases", "showcase"] }

错误：无。

#### POST /api/showcase/echo

回显请求体。前端面板的 echo 按钮打它。

    请求体：{ "text": "你好", "n": 1 }
    响应 200：
    { "ok": true, "demo": "routes", "echoed": { "text": "你好", "n": 1 },
      "receivedAt": "2026-10-04T04:01:00.000Z" }

错误：400（body 不是合法 JSON / 不是对象）。

#### GET /api/showcase/todos

    响应 200：
    { "ok": true, "demo": "routes",
      "todos": [ { "id": "t1", "title": "装 showcase 插件", "done": false, "createdAt": "…" } ] }

错误：无（空列表也是 200）。

#### POST /api/showcase/todos

    请求体：{ "title": "写一篇周报" }
    响应 201：
    { "ok": true, "demo": "routes", "todo": { "id": "t2", "title": "写一篇周报", "done": false, "createdAt": "…" } }

错误：400（缺 title / title 不是非空字符串）。

#### PUT /api/showcase/todos/:id

    请求体：{ "done": true }          ← title / done 均可选，至少给一个
    响应 200：
    { "ok": true, "demo": "routes", "todo": { "id": "t2", "title": "写一篇周报", "done": true, "createdAt": "…" } }

错误：400（body 不是对象 / 字段类型不对）；404（id 不存在）。

#### DELETE /api/showcase/todos/:id

    响应 200：{ "ok": true, "demo": "routes", "deleted": true }

错误：404（id 不存在）。

### A.3 组 store —— 命名空间读写删列（4 条）

演示点：插件私有持久化。**ctx 用法：`ctx.store.namespace('notes')`**（apply 里取一次存进模块状态；
同一命名空间多次取是同一份）。示例资源 = notes（任意 JSON 值的键值对）。
数据生命周期：**跨重启保留**（文件持久化），**卸载插件才清**（整个命名空间随 ctx.effect 回收）——
正是"插件私有数据完整生命周期"的演示。

#### GET /api/showcase/store/notes

列出键（对应 `ns.keys()`）：

    响应 200：
    { "ok": true, "demo": "store", "keys": ["greeting", "lastSeen"], "total": 2 }

错误：无。

#### GET /api/showcase/store/notes/:key

    响应 200：
    { "ok": true, "demo": "store", "key": "greeting", "value": { "text": "我是 showcase 写进来的" } }

错误：404（key 不存在）。

#### PUT /api/showcase/store/notes/:key

写（对应 `ns.set`；value 必须可 JSON 化）：

    请求体：{ "value": { "text": "改一下" } }
    响应 200：{ "ok": true, "demo": "store", "key": "greeting", "saved": true }

错误：400（body 缺 value / value 不可序列化——JSON.parse 已挡住大部分）。

#### DELETE /api/showcase/store/notes/:key

删（对应 `ns.delete`，返回 boolean）：

    响应 200：{ "ok": true, "demo": "store", "key": "greeting", "deleted": false }

deleted=false 表示 key 本来就不存在（`ns.delete` 的返回值原样透出，算成功不算错）。
错误：无。

### A.4 组 jobs —— 定时任务与执行历史（3 条）

演示点：注册定时任务 + 查询执行历史。**ctx 用法：`ctx.jobs.every(intervalMs, fn)`**；
执行历史没有现成 API（jobs 是进程内轻量调度，不持久），所以**用 ctx.store 自己记账**：
每次 tick 往 `notes` 命名空间写 `heartbeat` 键（计数 + 最近 20 条日志，超出丢最旧）。
这本身就是教学点：jobs 出状态、store 存状态。

#### POST /api/showcase/jobs/heartbeat

启动心跳任务（幂等守卫：已在跑返回 409）。

    请求体：{ "intervalMs": 5000 }     ← 可省略；框架强制最小 50ms，本插件建议下限 1000ms
    响应 200：
    { "ok": true, "demo": "jobs", "running": true, "intervalMs": 5000, "ticks": 0 }

每个 tick 做的事：`ticks += 1`；`lastTickAt = new Date().toISOString()`；日志追加
`{ at, tick }` 并裁到最近 20 条；整体写回 store。tick 函数抛错由框架包住（记日志、定时器不死）。
错误：400（intervalMs 不是正数）；409（showcase/already-running，已在跑）。
ticks 语义（审核明确）：**POST 启动不清零 store 里的旧计数** —— 新 tick 从旧值继续累加。
这样 GET 看到 ticks > 0 且 running: true 就是"延续上次会话"的直观证据；重启后 running: false
+ ticks 停在旧值 = "内存态丢了、账还在"的证据。单测按此断言。

#### GET /api/showcase/jobs/heartbeat

状态 + 执行历史。运行态来自内存句柄；计数与日志读 store（**重启后内存态丢了，但 store 里
最后一次快照还在**，实现时把两者合并返回，`running: false` + 有历史 = 重启过的直观证据）。

    响应 200：
    { "ok": true, "demo": "jobs", "running": true, "intervalMs": 5000, "ticks": 12,
      "lastTickAt": "2026-10-04T04:02:00.000Z",
      "recent": [ { "at": "2026-10-04T04:02:00.000Z", "tick": 12 },
                  { "at": "2026-10-04T04:01:55.000Z", "tick": 11 } ] }

错误：无（从未启动过 → `{ running: false, ticks: 0, recent: [] }`）。

#### DELETE /api/showcase/jobs/heartbeat

停（对应 `handle.cancel()`，幂等）：

    响应 200：{ "ok": true, "demo": "jobs", "cancelled": true, "running": false }

cancelled=false = 本来就没在跑。错误：无。

### A.5 组 mcp —— 注册 MCP 工具（2 条）

演示点：给 AI 加工具。**ctx 用法：`ctx.mcp.tool(def)`**——def 收朴素参数简表
`input: { 参数名: 'string'|'number'|'boolean' }`，宿主翻译成 zod；工具名建议
`插件名.动作` 形式防撞名。示例工具固定为 `showcase.add`（两个数相加，最直观）。

#### POST /api/showcase/mcp/tools

注册示例工具（幂等：同插件同名重复注册 = 替换自己那条，注册场语义免费送）。

    请求体：{ }      ← 本演示不接受参数，注册的工具固定为 showcase.add
    响应 200：
    { "ok": true, "demo": "mcp",
      "tool": { "name": "showcase.add", "description": "两个数相加（showcase 演示工具）",
                "input": { "a": "number", "b": "number" }, "required": ["a", "b"] } }

注册后用任意 MCP 客户端连本服务的 /mcp 即可调用（AI 工具链天然可用）。
错误：409（showcase/already-registered，仅在实现选择「不覆盖、报冲突」策略时出现——二选一，写进测试）。

#### GET /api/showcase/mcp/tools

列出本插件已注册的工具（从插件自己的登记状态读，不反向扫注册场）：

    响应 200：
    { "ok": true, "demo": "mcp",
      "tools": [ { "name": "showcase.add", "description": "两个数相加（showcase 演示工具）",
                   "input": { "a": "number", "b": "number" }, "required": ["a", "b"] } ],
      "total": 1 }

错误：无（未注册 → total: 0）。注：注册不跨重启，重启后需重新 POST——面板上正好
可以展示「重启后 AI 工具消失」这个生命周期事实。

### A.6 组 agent —— 注册中间件（3 条）

演示点：拦截 / 改写一次 Agent 轮次。**ctx 用法：`ctx.agent.use(mw, { order })`**（koa 洋葱：
`next()` 放行、不调即拦截；order 小者在外层）+ `ctx.agent.systemPrompt(text)`（追加系统提示，
内部就是一段特殊中间件）。示例中间件行为：在进入模型的文本前加一行标签
`[showcase] 本轮经 showcase 中间件加工`——能从 Agent 回复里肉眼看到生效。

#### POST /api/showcase/agent/middleware

注册示例中间件 + 一段示例系统提示（一并演示两个 API；已注册返回 409）。

    请求体：{ }      ← 固定行为，不接受参数
    响应 200：
    { "ok": true, "demo": "agent", "registered": true, "order": 0,
      "effect": "文本前追加 [showcase] 标签 + 系统提示追加一句" }

错误：409（showcase/already-registered）。

#### GET /api/showcase/agent/middleware

    响应 200：{ "ok": true, "demo": "agent", "registered": false }

错误：无。注册态是内存布尔（注册不跨重启，与 mcp 组同理）。

#### DELETE /api/showcase/agent/middleware

注销。`use()` 没有返回句柄，真正摘除只有两条路：注册时把中间件写在插件模块闭包里，
注销即置 registered=false 并跳过加工；或直接声明「本演示只注册、注销靠卸载插件」。
**推荐后者**：更短，且顺带演示「卸载即摘」。若选后者，DELETE 语义 = 幂等声明 + 404 守卫：
（诊断面语义备注：若选"置 registered=false 并跳过加工"方案，注册场里那条 server/agent-mw 条目
在插件存活期间**仍在场、只是不再加工**，卸载才真正摘除 —— GET 与注册场状态短暂不一致是预期的。）

    响应 200：{ "ok": true, "demo": "agent", "unregistered": true }

错误：404（showcase/not-found，未注册时调 DELETE）。

### A.7 端点总数与实现顺序

| 组 | 端点数 | 端点 |
|---|---|---|
| meta | 2 | GET /api/showcase/meta、GET /api/showcase/endpoints |
| routes | 6 | GET hello、POST echo、GET/POST/PUT/DELETE todos |
| store | 4 | GET/PUT/DELETE store/notes/:key、GET store/notes |
| jobs | 3 | POST/GET/DELETE jobs/heartbeat |
| mcp | 2 | POST/GET mcp/tools |
| agent | 3 | POST/GET/DELETE agent/middleware |
| **合计** | **20** | |

实现顺序建议：meta → routes（最简单，先跑通 fetch 直测）→ store → jobs → mcp → agent
（agent 依赖真实 Agent 轮次才能肉眼验证，放最后；单测只测注册/注销与 runAgentMiddleware
的空链/命中路径即可）。Task 1 Step 3 的路由级测试覆盖 A.1–A.6 全部 20 条。

## 附录 B：showcase 前端面板设计（在线测试 + 在线文档）

> 本附录是 Task 1 Step 2（前端半 web.js）的完整界面设计，与附录 A 的 20 条端点配套。
> 铁律只有一条：**面板的分组与端点列表全部来自 `GET /api/showcase/endpoints` 动态下发，
> 面板里不写死任何端点**。后端改了演示端点，面板零改动跟上。

### B.0 定位与插槽

面板 = **在线服务测试台 + 在线文档** 二合一：每个能力组既有「看文档」（fetch 示例代码），
又有「做测试」（真调接口）。看文档即测试，测试即文档。

插槽选**设置面板**，与 plugin-manager 完全同款的注册方式（见
`plugin-cloud-client/src/manager/pluginManagerPlugin.ts`）：

1. `ctx.slots.register('settingsNav', { id: '插件展示', order: 7, component: ShowcaseNav, meta: { title: '插件展示' } })`
   —— 设置面板左导航一级项；
2. `ctx.slots.register('settingsGroup/插件展示', { id: 'showcase-page', order: 7, component: markRaw(ShowcasePage) })`
   —— 整页正文由本组件负责渲染。

为什么选设置面板整页、不选 overlay/浮层：内容是「5 个区块 × 6 组端点 × 请求响应代码块」的
长页面，需要整页纵向滚动；浮层槽适合一屏内放得下的短交互，塞这份内容会把浮层撑破。

服务照 plugin-manager 的做法：`ctx.inject('showcase', reactive(createShowcaseService(ctx)))`，
组件经 `ctx.get('showcase')` 读状态、调动作。**请求逻辑全在服务层**，组件只画界面
不自己发请求——纯逻辑才好单测。

### B.1 服务层（showcaseService.ts）

```ts
interface ShowcaseState {
  meta?: ShowcaseMeta                 // GET /api/showcase/meta 的结果（名称/版本/能力/启动时间）
  groups: EndpointGroup[]             // GET /api/showcase/endpoints 原样下发，唯一布局依据
  results: Record<string, RunResult>  // key = "<method> <path>"，一条端点一份结果
  jobsTicks?: number                  // jobs GET 最近一次的 ticks（在线注册区的活计数；
                                      // 运行中每 2s 轮询 GET heartbeat 刷新，停止时停轮询）
  fetchingIndex: boolean
  indexError?: string
  selfTest: SelfTestState             // 三盏灯，见 B.5
}

interface RunResult {
  state: 'ok' | 'fail'
  httpStatus?: number        // 网络层异常时没有
  demo: string               // 响应里的 demo 字段，徽章旁标注能力组
  request: { method: string; path: string; body?: unknown }
  response: unknown          // JSON 原样
  error?: string             // ok:false 的 error 字段，或网络错误原因
  durationMs: number
}

service.refreshIndex(): Promise<void>   // 拉 meta + endpoints，页面打开时跑一次
service.run(item: EndpointItem, body?: unknown): Promise<void>
service.runGroup(group: EndpointGroup): Promise<void>  // 组内串行全跑
service.registerDemo(): void            // 在线注册演示，见 B.4
service.unregisterDemo(): void
```

要点：

- **baseUrl 解析**：优先 `settings.get('cloudClientBaseUrl')`（与云客户端同一个开关，用户改一处
  两边都换），没配则用同源。代码块示例里的地址也用它，保证「示例即真实」。
- **结果 key 用 `'<method> <path>'`**：同一路径不同方法是两条独立结果，不互相覆盖。
  注意 key 用端点**模板路径**（:id 未替换前的形态），一条端点一行结果，不随参数漂移。
- **响应里的 `demo` 字段只用于徽章旁的能力组标注**，不作为布局依据——布局唯一依据是
  endpoints 索引；索引里没有的组即使响应里出现也不渲染成组卡（防脏数据撑出鬼卡）。

### B.2 区块布局（从上到下）

整页 flex column，gap 12px（设置面板页内距标准）。五个区块：

| # | 区块 | 验证什么 | 数据来源 |
|---|---|---|---|
| ① | 前端自测区 | 前端半自己活着：脚本加载了、全局对象在、面板挂上了 | 三盏灯（B.5） |
| ② | 后台名片 | 后台半活着且能自述：叫什么、跑了多久、能干什么 | GET /api/showcase/meta |
| ③ | 在线测试台 | 20 条端点逐条真调，请求/响应摆出来看 | GET /api/showcase/endpoints |
| ④ | 在线注册演示区 | 注册场实时增删 + 卸载自动回收（机制见 B.4） | ctx.slots 注册场 |
| ⑤ | 生命周期说明 | 哪一半实时、哪一半要重启（静态文字防误解） | 模块常量 |

区块⑤固定放页尾三行字：前端半装上即生效、卸载即消失；后台半重启后生效/消失；
管理页（插件页）的「后台已装」状态灯反映后台半的真实状态。

### B.3 在线测试台（区块③）

**每组一张折叠卡**（默认收起，点开渲染），卡头从左到右：

- 组标题：索引下发的 `group.title`（如「路由注册」）；
- ctx 用法一行：`group.ctxUsage`（如 `ctx.routes.get/post/put/delete`）——这是文档的一半；
  `group.id` 与响应 `demo` 字段同源（meta/routes/store/jobs/mcp/agent），前端只做标注对齐、不做布局依据。
- 运行结果计数胶囊：`2/6 生效`（该组跑过才显示）；
- 「全部运行」小按钮（组内端点**串行**跑——POST 建、PUT 改、DELETE 删有先后依赖，并行会翻车）。

卡内每条端点一行（行高与设置面板既有列表行一致）：

```
[方法徽章] /api/showcase/hello    问候 + 已登记插件列表        [运行]
```

- 方法徽章：GET/POST/PUT 用灰底灰字（`--fill-subtle` + `--text-muted`），DELETE 用危险红字款
  （风格规范里删类动作就是红，一眼分清「这条动了数据」）。
- 带 `sampleBody` 的端点：行内放一个小输入框预填示例 JSON（`JSON.stringify(sampleBody)`），
  用户可改；改坏 JSON 点运行时前端直接报红「请求体不是合法 JSON」，不发请求。
  本面板不提供改路径/自由 body 的编辑——端点清单来自索引，偏离索引就断了「测试即文档」。
- **路径参数 `:id` 的取值链**：索引里 PUT/DELETE 的 path 是模板形。面板按「先用同组前面端点
  刚跑出的响应里的 id（POST 建 todo → 拿 id → PUT/DELETE 打它），没有就提示先跑 GET」替换。
  这是全面板唯一一处必须串起来的交互（详见 B.9）。

**运行后该行下方展开结果块**（内嵌白卡，风格规范 §3.9：圆角 10、1px 发丝边、e1 阴影、
0.22s 回弹展开）：

- 状态徽章：响应 `ok === true` → **青色款「生效」**；`ok === false` 或网络异常 → **危险红款「失败」**
  + `error` 文案 + HTTP 状态码；请求中 → 「运行」按钮 disabled + 旋转图标，结果区显示一行灰字「请求中…」。
  **注意：风格规范 §2.1 的语义色没有绿色**，本面板按现行规范用「青=生效、红=失败」（青就是规范里
  「可用/当前」的语义色）；如果坚持要绿色，先改 docs/design/ui-style-guide.md 加 token，再改面板。
  网络异常（fetch 抛错）与 HTTP 失败都算「失败」，但文案区分：「网络错误：<原因>」vs
  「接口返回失败：<error>（HTTP 状态码）」。
  请求/响应 JSON：左右两栏（窄屏上下堆叠）的 <pre>，等宽 11px、--fill-quiet 底、圆角 8、
  横向可滚。JSON.stringify(v, null, 2)，单块超 4000 字符截断加尾注「已截断」（20 条全跑不撑爆页面）。

**fetch 代码块（在线文档）**：每组底部再一张折叠区（默认收起），点开是该组端点的 fetch 示例：

```js
const res = await fetch('<baseUrl>/api/showcase/echo', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: '你好', n: 1 }),
})
const data = await res.json()
console.log(data)   // { ok: true, demo: 'routes', echoed: {...}, receivedAt: '…' }
```

- 由纯函数 `fetchSnippet(item, baseUrl)` 按当前端点生成（GET 无 body 分支、DELETE 无 header 分支）；
  `baseUrl` 用面板实际请求用的同一个地址——用户复制出去的代码和面板行为一字不差。
  示例 body 优先取索引里的 sampleBody，没有就用空对象。
  右上角「复制」图标按钮：写剪贴板后原位变「已复制」1.5 秒还原（原位反馈，不弹层）。
- 样式：`<pre><code>` 等宽 11px、`--fill-quiet` 底、1px 发丝边、圆角 8；**无语法高亮**
  （高亮要引依赖，演示价值配不上，不为本期引入）。

### B.4 在线注册演示区（区块④）——机制选型

后端结论（附录 A.0）：ctx.routes 必须在 apply() 装载期同步注册，Hono 首次请求后路由表冻结，
运行期注册的路径没有代理、必然 404；而后台半本身是重启生效的。所以「装插件 → 一次性路由
立刻出现」在后台半上演示不出来。

**选型：前端半注册进既有注册场（ctx.slots），放弃运行期一次性路由。** 琇由：

1. 注册场是内核一等机制：运行期可增可删、插件卸载随作用域自动回收——「在线注册 + 实时生效」
   它天然就有，零新机制；
2. 面板本身就是第一份证据：showcase 装上的那一刻，设置面板左导航立刻多出「插件展示」（UMD 实时
   装载 + slots 注册），用户先看见注册生效，再在演示区亲手玩一遍增删；
3. 一次性路由的两个前提（路由表冻结、后台重启生效）决定它演示不出「实时」，硬做要给 cloud-server
   加运行期动态路由机制——为一个演示动后端，不值。

演示区交互：

- 一行说明 + 「注册演示条目」「注销」两个按钮。点注册 → 调 `ctx.slots.register('overlay', ...)` 挂一张
  半透明小浮条（写明注册场名、条目 id、注册时刻，id 带 timestamp 防重），界面立即出现——这就是
  「注册实时生效」的肉眼证据；点注销 → 浮条消失；插件卸载 → 随内核作用域自动回收（不留残影）。
  后台半的「实时性」用 jobs 组补足：heartbeat 启动后，jobs 组卡头显示「已运行 N tick」活计数
  （来自 GET /api/showcase/jobs/heartbeat 的 ticks，数字自己会涨）——后台活着这件事用数据说话。
  说明文字明示：**后台半的路由重启后才生效，卸载重启后才消失**（与区块⑤口径一致）。

### B.5 前端自测区（区块①）

三盏灯横排，全部通过追加一枚青色「自检通过」徽章；任一失败转红并给一行原因：

| 灯 | 检查什么 | 怎么查 | 失败意味着 |
|---|---|---|---|
| 脚本加载 | UMD script 标签执行完成 | umdLoader resolve 成功（服务构造时记录） | 网络挂了 / 产物 404 |
| 全局对象 | `window['MiniCanvasPluginShowcase']` 存在且能挑出插件模块 | 复用 pickPluginModule 的挑选逻辑（自带一份小实现） | globalName 与打包名对不上 |
| 面板挂载 | 本组件 onMounted 已跑 | 组件挂载即调 service.markMounted() 置位 | 槽位没注册上 / 渲染报错 |

三项判定收在 showcaseSelfTest.ts 纯函数里（输入 window 快照 + 挂载标记，输出三布尔），
单测直接喂假 window。

### B.6 状态与空态

| 场景 | 呈现 |
|---|---|
| 索引拉取中 | 名片区放灰条骨架行（不整页转圈） |
| 索引拉取失败 | 名片区转错误卡：错误文案 + 「重试」按钮 |
| 组内无端点 | 该组卡显示「该组暂无演示端点」 |
| 端点未运行 | 行右侧只有「运行」，不显示结果块 |
| 运行中 | 按钮 disabled + 旋转图标；单行互不拦，可并行点（「全部运行」仍串行） |
| fetch 抛异常 | 结果块红色「网络错误：<原因>」（这不是 HTTP 4xx/5xx，别混进 error 前缀） |
| meta 缺失但索引在 | 名片区显示「后台未自述（meta 拉取失败）」，测试台照常可用 |

### B.7 组件与打包

```
src/showcasePlugin.ts        # 模块入口：name/inject/apply，注册槽 + 注入服务
src/showcaseService.ts       # 服务层（fetch/状态机/结果簿记）
src/showcaseSelfTest.ts      # 三盏灯判定纯函数
src/showcaseCodegen.ts       # fetchSnippet 纯函数
src/ShowcaseNav.vue          # 左导航项（照 PluginManagerNav 的最小结构）
src/ShowcasePage.vue         # 整页（五区块纵向排）
```

- 打包照 plugin-align-guide：`pluginLibBuild(import.meta.url, { name: 'MiniCanvasPluginShowcase' })`
  + `cssInjectedByJs()`（样式内联进 UMD）。globalName 必须与 package.json
  miniCanvas.web.globalName 一致（KNOWN_GLOBALS 守卫测试会查，Task 7）。
  图标用**内联线性 SVG**（风格规范 §3.11 本就推荐，且不赌 lucide 是否在 UMD 外部全局表里）。
  单测落点（Task 1 Step 3）：showcaseCodegen.test.ts（GET/POST/DELETE 三形态 + baseUrl 拼接）、
  showcaseSelfTest.test.ts（假 window 三态）、服务层假 fetch（索引拉取、run 记账、串行组跑、:id 取值链）。

### B.8 风格 token 落点（对照 docs/design/ui-style-guide.md）

- 组卡 = 内嵌白卡（圆角 10、1px `--line-hair` 发丝边、e1 阴影）；展开态圆角 12。
  徽章 = §3.4 规格：生效青款（#0891b2 字 + 0.12 青底）、失败危险款（红字 + 0.1 红底）。
  代码块等宽栈用 §2.3（ui-monospace, SFMono-Regular, Menlo, Consolas, monospace）。
  按钮四态齐全（hover/disabled/active scale(.97)/focus-visible 青环）；运行中 disabled。
- 结果块展开 0.22s `--ease-back`；全部动画带 prefers-reduced-motion 降级。
  a11y：折叠卡头用 <button> + aria-expanded；结果区 aria-live="polite"（读屏听得到结果回来）；
  复制按钮 title + aria-label；JSON 输入框有 aria-label，不靠 placeholder。

### B.9 实现时最需要注意的坑

**路径参数 `:id` 的取值链**。索引里 PUT/DELETE 的 path 是模板形（`/api/showcase/todos/:id`），
面板必须把它换成真实 id 才跑得通：优先用同组前面端点刚跑出的响应里的 id（POST 建好 → 拿 id →
改它删它），取不到就明确提示「先运行 GET /api/showcase/todos 拿一个 id」。如果偷懒写死 t1，
后台内存 Map 一重启就是 404，演示当场翻车——这是全面板唯一一处「必须串起来」的交互，
服务层测试要专门覆盖「GET 拿 id → PUT/DELETE 用它」这条链。
