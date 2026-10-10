# 内置服务与存储布局

**一句话定位**：cloud-server 自带的那些接口（画布存取、KV、任务、历史、Agent……）不是散装代码，而是 16 个「内置后台插件」用与外挂插件**同一套机制**注册进来的。这篇讲清 adopt 与 mount 的区别、宿主把哪些服务摆上了货架、数据根目录里每样东西存哪，以及最常用的路由速查表。

## 这篇能让你做什么

读完本篇你会：

- 知道 `/api/*` 那一大堆接口从哪来（16 个内置插件），以及它们和「丢进去的外挂插件」走的是同一条路；
- 分清 `ctx.routes.adopt()` 与 `ctx.routes.mount()` 各适合什么；
- 能用 `need<T>(ctx, S.xxx)` 在自己的插件里取宿主服务（比如把画布数据读出来）；
- 拿到一张数据根目录的「藏宝图」：每类数据在磁盘的哪个文件里。

## 具体做法

### ① 内置插件长什么样：health 最简样例

最简单的内置插件只有一个路由（`packages/cloud-server/src/plugins/builtin/health.ts`）：

```ts
// 文件：packages/cloud-server/src/plugins/builtin/health.ts
// 格式：TypeScript 模块（内置后台插件样板）
// 作用：注册 GET /health，行为与原来 server.ts 手写的一字不变

export const name = 'health'

export function apply(ctx: Context): void {
  ctx.routes.get('/health', (c) => c.json({ ok: true }));
}

export const healthPlugin: PluginModule = { name, apply };
```

其余 15 个照这个形状写，只是 `apply` 里调用的是 `ctx.routes.adopt(...)`。

### ② adopt 与 mount 的区别

两个都是「把一组现成路由变成插件路由」，但工作方式不同：

| | `mount(prefix, subApp)` | `adopt(subApp)` |
| --- | --- | --- |
| 注册形态 | **整段转发**：请求打进 Hono 后，剥掉前缀转给子应用自己处理 | **逐条摊平**：把子应用里的每条路由原样抄进注册场 |
| path 写法 | 子应用内部只写相对 path，前缀由 mount 统一给 | 子应用里就写全路径（如 `/api/kv/:type/:key`） |
| 顺序约束 | 子应用路由必须在 **mount 之前**建齐（Hono `route()` 的固有行为） | 严格保持子应用原本的注册顺序（顺序一反，静态路由会被动态路由吃掉） |
| 适用场景 | 新写的、带统一前缀的子模块 | **接老代码**：那些 `xxxRoutes(依赖)` 工厂本来就把路径写全了 |

内置插件全部用 adopt —— 因为 12 组路由工厂已经过测试、路径本来就写全了，重写只会引入回归风险。`kv.ts` 是个典型：

```ts
// 文件：packages/cloud-server/src/plugins/builtin/routes.ts（节选，kv 插件）
// 格式：TypeScript 模块（内置后台插件）
// 作用：把既有 kvRoutes 工厂的路由逐条摊平成插件路由

export const kvPlugin: PluginModule = {
  name: 'kv',
  inject: [S.kvStore],                       // ① 硬依赖：缺 kvStore 就挂起不启动
  apply(ctx) {
    ctx.routes.adopt(kvRoutes(need<KvStore>(ctx, S.kvStore)));   // ② 摊平进来
  },
};
```

- ① `S` 是服务名常量表（`plugins/builtin/routes.ts` 顶部定义），和 `server.ts` 的 `ctx.inject('名', 实例)` 一一对应，改名要两边一起改。
- ② `need` 是取服务的小助手：`ctx.tryGet` 拿不到就抛「缺少服务 xxx」的明确错误，不静默 undefined。

### ③ 宿主摆上货架的服务清单（ctx 里能取到的）

宿主在 `server.ts` 装配期用 `host.ctx.inject(...)` 上架这些服务，插件里用 `need<T>(ctx, S.xxx)` 取：

| 服务名（S 常量） | 类型 | 管什么 |
| --- | --- | --- |
| `kvStore` | `KvStore` | 设置 / 快捷键这类零碎小数据（落 `settings.json`） |
| `canvasStore` | `CanvasStore` | 画布本体与索引（一个画布一个文件夹） |
| `canvasResources` | `CanvasResourceStore` | 画布资源（生成图、上传附件，内容寻址去重） |
| `projectStore` | `ProjectStore` | 项目注册表 + 画布索引（项目 → 画布的归属） |
| `assetStore` | `AssetStore` | 资产目录（生成产物登记 + 上传字节） |
| `doc` | `CanvasDocument` | 默认画布的文档门面（MCP 与网页读写的同一份） |
| `providerRegistry` | `ProviderRegistry` | 平台提供方注册表（生成任务的动作清单） |
| `taskManager` | `TaskManager` | 生成任务（下单 / 轮询 / 撤单） |
| `history` | `HistoryStore` | 生成历史归档（`history.json`） |
| `pluginsDir` / `serverPluginsDir` | `string` | 插件目录 / 后台插件目录的绝对路径 |
| `selfOrigin` | `string` | 本服务 origin（如 `http://127.0.0.1:8865`），跨源检查用 |

Agent 打开时（默认开）还有 7 个：`agentConfig`（全局配置）、`agentSessions`（会话存储）、`agentRuntime`（对话轮次运行时）、`agentBranches`（分支）、`agentHub`（后台对话事件通道）、`agentQueue`（队列调度）、`agentGoal`（目标运行时）。另外 `serverPluginsLoaded` 是一个字符串数组（已登记外挂插件名，热装热卸会实时增删）。

### ④ 数据根目录的存储布局

数据根缺省是 `./.mini-canvas/`（`-d` 可换）。磁盘上长这样：

```text
.mini-canvas/                      # 数据根（cli.ts DEFAULT_DATA_DIR）
├── settings.json                  # KV：config / shortcut 两桶小数据（kvStore.ts）
├── projects.json                  # 项目注册表（projectStore.ts）
├── canvases/                      # 画布（canvasStore.ts + canvasPaths.ts）
│   ├── index.json                 #   画布索引（id → 名字 / 所属项目）
│   └── <canvasId>/                #   一个画布一个文件夹
│       ├── canvas.json            #     画布本体（节点 + 边）
│       ├── view.json              #     视口状态
│       ├── history.json           #     任务记录
│       ├── resources/             #     画布资源（生成图 / 附件，内容寻址）
│       └── agent/                 #     Agent 会话数据（agentSessions）
├── assets/                        # 资产目录（assetStore.ts）
│   ├── index.json                 #   资产登记（生成的指回画布资源，不复制字节）
│   ├── folders.json               #   资产文件夹树
│   └── files/<hash>               #   自己上传的字节（内容寻址去重）
├── providers/                     # 平台提供方投递箱（providers/load.ts）
├── server-plugins/                # 外挂后台插件目录（pluginLoader.ts 扫这里）
│   └── .npm-installed.json        #   NPM 安装来源记录（pkg / version / sha256）
└── plugin-data/                   # 插件私有存储（store.ts；<命名空间>.json）
    └── notes.json                 #   例如 showcase 的 notes 命名空间
```

- 画布 id / 资产名都要过白名单（字母数字下划线连字符，点号不在表内），`..` 路径穿越天然被拒 —— 拼路径和查安全绑在同一层（`canvasPaths.ts`）。
- KV 只装真正的配置类小数据；画布与资源不在这里（大数据、按画布分家）。

### ⑤ 常用内置路由速查

- 全部来自 `src/routes/` 各文件（经内置插件 adopt 进来），速查如下：

- `GET` / `PUT` / `DELETE /api/kv/:type/:key` — KV 小数据读写删，源文件 `routes/kv.ts`
- `GET /api/kv/events` — SSE 实时通道（KV / 画布写事件推送），源文件 `routes/events.ts`
- `GET /api/canvases`、`GET` / `PUT /api/canvases/:id` — 画布清单与本体读写，源文件 `routes/canvases.ts`
- `POST /api/canvases/:id/resources` — 画布资源上传，源文件 `routes/canvases.ts`
- `POST /api/canvas/nodes`、`POST /api/canvases/:id/nodes` — 增量写节点，源文件 `routes/canvasOps.ts`
- `GET` / `POST /api/projects`、`PATCH` / `DELETE /api/projects/:id` — 项目管理，源文件 `routes/projects.ts`
- `GET` / `POST /api/assets`、`PATCH` / `DELETE /api/assets/:id` — 资产目录，源文件 `routes/assets.ts`
- `GET /api/actions` — 动作清单（前端菜单数据源），源文件 `routes/actions.ts`
- `POST /api/jobs`、`GET /api/jobs/:id`、`POST /api/jobs/:id/cancel` — 生成任务下单 / 查单 / 撤单，源文件 `routes/jobs.ts`
- `GET /api/history`、`POST /api/history/batch-*` — 生成历史与批量操作，源文件 `routes/history.ts`
- `GET /api/agent/config` 等 — Agent 全局配置（模型 / 技能 / MCP / 审批），源文件 `routes/agent.ts`
- `GET` / `POST /api/agent/canvases/:id/sessions` 等 — Agent 会话（队列 / 目标 / 分支），源文件 `routes/agentSessions.ts`
- `GET` / `POST /api/server-plugins`、`POST /api/server-plugins/install` 与 `uninstall` — 后台插件管理，源文件 `routes/serverPlugins.ts`
- `GET /api/npm-plugins/browse`、`GET /api/npm-plugins/search`、`GET /api/npm-plugins/installed` — NPM 插件市场查询，源文件 `routes/npmPlugins.ts`
- `POST /api/npm-plugins/install`、`POST /api/npm-plugins/update`、`POST /api/npm-plugins/uninstall` — NPM 插件安装 / 更新 / 卸载，源文件 `routes/npmPlugins.ts`
- `GET /plugin-manifest.json`、`GET /plugin-catalog.json` — 前端插件清单 / 插件管理清单，源文件 `static.ts`
- `ALL /mcp` — MCP 接口（AI 客户端连这里），源文件 `routes/mcp.ts`（直挂，非插件）


## 每一步在干什么

- **为什么内置接口也要收敛成插件**：不只是整齐。收敛后每组接口获得「可装卸、可回收」的能力 —— 卸载 kv 插件，`/api/kv/*` 这组路由就随注册场消失，不需要任何额外清理代码。行为一字不变（health 的注释原话），因为路由体复用的还是原来的工厂。
- **注入顺序**：`server.ts` 先把服务实例 `ctx.inject` 上架，再 `ctx.plugin(内置插件)` 登记 —— 插件的 `inject` 才取得到东西。16 个内置插件在 `BUILTIN_PLUGINS` 数组里排好序：**顺序即路由优先级**（events 必须排在 kv 前，否则 `/api/kv/events` 会被 `/api/kv/:type` 吃掉）。
- **MCP 是唯一例外**：`/mcp` 没有收敛成插件 —— 它是 SDK transport，与「代理 handler」模型不兼容，由 `server.ts` 直接挂载。

## 源码出处

| 这篇里的说法 | 真实文件 | 真实行为 |
| --- | --- | --- |
| 16 个内置插件 | `packages/cloud-server/src/plugins/builtin/routes.ts` 末尾 `BUILTIN_PLUGINS` | health / events / plugin-watch / projects / canvases / assets / actions / jobs / history / kv / canvas-ops / agent-routes / agent-sessions / plugin-routes / server-plugins / npm-plugins |
| adopt 保持原顺序 | 同上文件内 `createRouteRegistrar` 的 adopt | 逐条登记子应用路由并严格保持原序（静态 / 动态同层冲突的实测原因写在注释里） |
| 服务名常量表 S | 同上文件顶部 | `S.kvStore = 'kvStore'` 等，与 server.ts 的 inject 一一对应 |
| need 取服务缺了就抛 | 同上 `need` 助手 | `tryGet` 得 undefined 时抛「缺少服务 xxx」，不静默 |
| 宿主上架服务 | `packages/cloud-server/src/server.ts`（② 段） | `host.ctx.inject(...)` 12 个服务 + agent 相关 7 个（按开关） |
| 插件私有数据 | `packages/cloud-server/src/serverFramework/store.ts` | `数据根/plugin-data/命名空间.json`，卸载即清 |
| 数据根与打印 | `packages/cloud-server/src/cli.ts` + server.ts 的 paths | 默认 `.mini-canvas/`；启动日志逐行打印 kv / canvases / providers / server-plugins 落点 |
| 路由优先级实例 | `packages/cloud-server/src/routes/jobs.ts` | `/api/jobs/active` 必须先于 `/api/jobs/:jobId` 注册（文件内注释） |

## 常见坑

1. **把 adopt 当 mount 用**：adopt 不会加前缀 —— 子应用里写的什么路径就是什么路径。想要 `/myapi/xxx` 这种统一前缀，用 `mount('/myapi', 子应用)`，并且子应用路由要在 mount 之前建齐。
2. **自己建能力层时忘了传 root**：`createServerCapabilityLayer` 的 store root 缺省用 `process.cwd()`，插件私有数据会落错地方。cloud-server 真实服务传的是数据根（`serverFramework/index.ts` 里 `root: dataDir`），别在测试里踩这个。
3. **以为服务名随便起**：S 表是「一处改名、处处要改」的约定 —— `server.ts` 的 inject 与 `plugins/builtin/routes.ts` 的 inject 必须一致，你的自定义插件取服务也用同一套名字。取不到时 `need` 会抛出指路错误，别绕开它静默 undefined。
4. **在插件里直接 fs 读画布文件**：路径拼接散在各处迟早出穿越事故。读画布数据走 `canvasStore` 或 `doc` 服务（它们内部做过 id 白名单校验），别自己拼画布路径。
