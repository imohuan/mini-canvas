# mini-canvas AI 后台 × 前端插件无缝对接 — 实施计划

日期：2026-09-04
状态：待计划审核
目标文件：见 scratchpad PLAN.md

---

## 一、最终形态（用户要的样子，逐条锁定）

1. **一个后台服务**（`@mini-canvas/mcp-server`）= 画布数据唯一权威 + 任务管理中心。
2. **前端画布 UI 通过一个非侵入插件**（参考 storage / auto-save 的 Cordis 式插件）与后台通讯：
   - 自动云端保存（用户改动自动上报后台，无需手点「保存」）；
   - 实时接收后台画布变化 + 任务进度（SSE），无损无感更新本地 VueFlow。
3. 把 `canvas-core/src/nodes/image/imageModels.ts` 的「模型能力声明 + run 契约」逻辑**移植到后台**：
   - 后台提供模型注册表；每个模型声明支持的配置（比例/分辨率/可带参考图等）+ 一个 `run`；
   - `run` 返回**对象** = 同步完成；返回**函数(PollFn)** = 异步，后台定时轮询直至结束；
   - 结果/进度通过 **SSE** 广播给客户端。
4. **后台 MCP 工具简洁高可用**，画布/节点/连线三类都支持**批量**增删改查，且可**合并进一次执行**：
   `{ add: [...], delete: [id,...], update: [{ id, ... }] }`。
5. **任务获取（Task Manager）**在后台单独实现：
   - 创建节点即任务入口；节点 = 文本/图片/视频/音频；
   - 创建时可带上「输入端口所链接节点的信息」便于后台自动快速连线；
   - 创建 image 节点二选一：指定要显示的图片路径（预览节点），或提供生成配置（创建时即提交任务）。
   - 前端 `ImageBottomToolbar` 的属性（model/ratio/resolution/prompt/参考图等）在创建时一并发送。
6. **SSE 实时播报**正在运行的任务进度；创建节点返回 **nodeId**，可用 nodeId 查任务状态。
7. AI 经 MCP 建节点 → 后台更新画布 → 前端 UI 经 SSE 实时看到最新画布（无损无感实时更新/保存）。
8. **参考图/资源自动建预览节点并连线**：后台查询画布中是否存在「绝对地址相同的图片预览节点」；有则直接连线，没有则自动创建一个图片节点并与目标连线。由后台决定。之后提供 prompt 即可创建节点（创建即提交任务）。
   - MCP 形如 `create_node {type:'image', args:{ referenceImages:[绝对路径], prompt }}`（生成任务）
   - `create_node {type:'image', args:{ path: '绝对路径' }}`（仅预览）
9. 测试用 **Chrome MCP**（前端热重载，不新建无谓任务）。

---

## 二、现状盘点（已实读验证）

### 已有（都是真实现）
| 能力 | 位置 | 说明 |
|---|---|---|
| 无头 GraphModel | `packages/mcp-server/src/graph/GraphModel.ts` | 画布=taskId；节点/连线 CRUD + 事件总线 + graphVersion；**逐条**非批量 |
| REST+SSE | `src/http/CanvasHttpServer.ts` | `/api/*` + `/events` SSE；节点/连线/画布逐条端点；上传/proxy-media |
| 落盘 | `src/storage/NodeStorage.ts` | `workspace/project-{id}/canvas.json`，sanitizeForSave 同构 |
| TaskManager | `src/tasks/TaskManager.ts` | createTask→pending→runner→回写节点；runner 目前是 **占位 mock** |
| MCP server | `src/mcp/server.ts` | 18 个逐条工具 + task.create/task.status |
| 前端插件体系 | `canvas-core/plugins/*` + PluginContext + CanvasRuntime | Cordis 式：可装可卸、事件总线、registry、依赖注入 |
| storage/auto-save 插件 | `canvas-core/plugins/{storage,auto-save}` | 用户点名参考：自动保存范式 |
| 前端模型层 | `canvas-core/src/nodes/image/imageModels.ts` | **要移植的那套**：ImageModelCapability + ImageModelProvider + executeRun（run 返回对象=同步 / PollFn=异步），当前 LOCAL 是 mock provider |
| web2api（真实生成后台） | 外部项目 `D:\Code\Git\web2api`，localhost:8033 | 已是 MCP server：doubao/apimart/chatgpt 图、seedance 视频、doubao 音乐，统一 TaskManager 队列。**mcp-server 应作为其 MCP 客户端转发真实生成** |

### 已知缺口（要做的事）
1. GraphModel / MCP / REST 都只有**逐条** CRUD → 需加批量原子执行 + `{add,delete,update}` 合并工具。
2. TaskManager runner 是占位 mock → 需接 **ModelRegistry(run/PollFn) + web2api MCP client** 真实 runner，且进度要细分阶段 + SSE task 事件。
3. 后端无「语义化 `create_node`」（自动建预览节点/自动连线/查 nodeId 对应任务）。
4. 前端目前是 `McpCanvasView` 手写 useMcpClient + **手动保存按钮** + 整画布 reload → 要改成**非侵入插件**：自动保存、SSE 增量同步、任务进度 UI。
5. 前端 image 工具栏还在用本地 mock provider；后台接管后要 `configureImageModels(backendProvider)` 切换（或创建节点即后台提交任务，前端只负责展示/连线/配置回填）。

---

## 三、目标架构

```
┌────────────────────────── AI (Claude/Codex…经 MCP) ──────────────────────────┐
│  create_node / canvas.batch / node.batch / edge.batch / task.status …        │
└──────────────────────────────────┬───────────────────────────────────────────┘
                            Streamable HTTP /stdio (MCP tools)
                                   ▼
┌────────────────────── 后台 @mini-canvas/mcp-server (唯一权威) ───────────────┐
│  GraphModel(headless 批量 CRUD)  ─▶ NodeStorage(落盘)                        │
│  ModelRegistry (移植 imageModels 的 capability+run/PollFn)                   │
│  TaskManager (真 runner：创建→ web2api MCP client → 轮询 → 回写节点)         │
│  SSE 广播：graph:* 变更事件 + task:progress/state 事件                         │
└───────┬──────────────────────────────────────────────┬───────────────────────┘
        │ REST /api/*                          SSE /events
        ▼                                           ▼
┌─────────────────── 前端 mini-canvas (Canvas) ────────────────────────────────┐
│  非侵入插件 BackendSyncPlugin(Cordis 式)                                      │
│    · 连接后台 / 建/选画布                                                     │
│    · SSE → 增量应用到 VueFlow(无损无感实时) + 任务进度面板                     │
│    · 本地用户改动 → 自动上报后台(自动保存，免手点)                             │
│  图片节点工具栏 经 configureImageModels(BackendProvider) 或直接后台提交任务     │
└──────────────────────────────────────────────────────────────────────────────┘
```

**数据流向**
- AI 建节点 = 后台提交任务：`create_node` 先自动建预览节点+连线，再建生成节点并 `TaskManager.createTask`，返回生成节点 nodeId。
- 任务执行：后台 runner 调 web2api MCP → web2api 自己轮询平台 → 后台周期性 poll web2api task → 更新 `node.data.status/progress/result` → SSE `node:updated` + `task:progress` → 前端插件就地更新该节点（进度条/出图），全程不动其他节点，无损。
- 前端手动拖动/连线 → 插件经 REST 批量上报后台（自动保存），后台落盘 + SSE 回播 → 其它端实时一致。

---

## 四、关键设计决策

### D1. 批量 CRUD + 合并执行（后台 API/MCP 统一）
新增一个**通用批量执行器**，三类资源共用一套形状，保证"批量 + 增删改合并到一次执行 + 原子性 + 结果报告 + 事件推送"：

```
batchEdit(resource: 'canvas'|'node'|'edge', taskId, {
  add:    [],   // canvas:{taskId,name}; node:{type,position,data,options,id?}; edge:{source,target,...}
  delete: [],   // id 列表（canvas 用 taskId；node/edge 用自身 id）
  update: [],   // { id, ...patch }（canvas 很少 update；node/edge 用）
})
→ { ok, added:[…newId], deleted:[…], updated:[…], errors:[…] }
```
- 画布无"update 内容合并"，重点 add/delete（taskId 即 id）。
- 单次执行内：先校验全部（不存在、重复、source/target 存在），任一失败则整批不落（或部分成功+errors 报告，见 D1a）。
- 每次 mutation 走 GraphModel 原 emit（保持 SSE 兼容）。

**D1a 原子性策略**：先整批预校验（add 的 node 引用、delete 的存在性、edge 两端存在），预校验失败 → 整批拒绝返回错误（不给半成品）。预校验通过 → 顺序应用并 emit。这样既"一次执行"又不会出现只加了删除失败的脏状态。

### D2. MCP 工具集（简洁高可用）
保留语义清晰的少量工具，新增/合并：
- `canvas.batch`（画布 add/delete，附 name）
- `node.batch`（node add/delete/update，type/position/data/options/id）
- `edge.batch`（edge add/delete/update，source/target/handles/id）
- `create_node`（语义化，见 D4）→ 返回生成节点 nodeId + 关联 taskId + 自动建的预览节点/连线
- `node.status` 或 `task.status`：**用 nodeId 查该节点当前任务状态**（返回 status/progress/message/result/error）
- `list_nodes/list_edges/list_canvases/export_json/save` 保留作为只读/管理
- `models.list`（可空新增）：列出后台支持的模型与能力，供 AI 端发现可生成什么
删除/收敛冗杂的逐条 create_node/create_edge/update_node/set_node_position/delete 系列（可用 batch 覆盖）；保留 set_viewport。

### D3. ModelRegistry 移植（后台）
把 imageModels.ts 里**纯数据/契约**部分搬到后台并做成可扩展注册表：
- `ModelCapability`（model/label/ratio/resolution/supportsInput/templates/…，可 JSON 序列化）
- `ModelRunner`（provider 接口）：`run(req): RunOutcome`，`RunOutcome = GenerationResult | PollFn`
- `executeModelRun`：统一驱动（对象=同步；函数=定时轮询，间隔 2s，超时可配），与前端 executeRun 同语义。
- 预置 models：
  - image: apimart-gpt-image-2, chatgpt-gpt-image-2, doubao-seedream-5lite/45/40（沿用前端 5 个的 ratio/resolution/supportsInput 声明）
  - video/audio 后续同样可挂（web2api 提供 seedance、doubao music）。
- run 实现 = web2api MCP client 封装（见 D5），返回 PollFn：每次 poll 查 web2api task.status，把它的阶段/progress 映射回来，done 时取 url 数组作为结果。

### D3b. 前端 data 现状（侦察结论，决定下行同步落点）
- VueFlow 渲染 type 恒为 `custom`，靠 `data.nodeType='image'|'video'|…` 区分。
- image 节点 `data`：基础(label/cardWidth/…) + 图片字段(imageUrl/imageName/assetId/…) + **动态 `options`**（ToolbarConfig：`promptText/promptDoc/selectedModel/selectedRatio/selectedResolution/selectedTemplate`，保存不 strip、会落盘）。
- **当前 image 运行态不进 data**：ImageNode 内部 ref 保存 status/progress；生成结果只 notify toast，**不写回 data.imageUrl**。所以要让"后台跑任务 → 前端节点显进度/出图"，**前端 ImageNode 必须补一个"读 data.status/progress/result 渲染"的落点**（NodeRunIndicator 等已有组件可复用），或走 MCP 场景由 BackendSyncPlugin 按 data 字段驱动。计划 S5 补。
- 建节点+自动连线范式已存在：`handleImageAddSource`（addNodes sourcePosition:'right'/targetPosition:'left' + addEdges sourceHandle:'source'→targetHandle:'target'）。后台 create_node 自动连线对齐这套 handle 命名，前端即可渲染。
- `configureImageModels` 预留但**未接线**；`executeRun` 仅 ImageNode.vue 一处调用。切后台 provider 可行（后端暴露同语义 run 契约，前端零改 ImageNode）。

### D4. 语义化 create_node（后台逻辑，前端 UI 无需管连线）
`create_node { canvasId, type, args }`
- type=image：
  - 若 `args.path`（预览）：查画布是否已有 `data.src/url/path === 该绝对路径` 的图片节点，有→返回既有节点（不重复建，不建预览）；无→创建一个图片预览节点(position 可空/默认 auto 偏移)。不提交任务。
  - 若 `args.prompt`(+可选 referenceImages/model/ratio/resolution)（生成）：
    1. 对每个 referenceImages 绝对路径：找画布中图片预览节点 `data` 记录该路径的 → 有则作为该参考图的源节点；没有则**自动创建一个预览节点**并记录 path。
    2. 创建"生成节点"（image，含 prompt 等 options），**自动连线**：每个参考图源节点 → 生成节点（source 端口 → 目标输入端口）。
    3. 生成节点创建后即 `TaskManager.createTask` 提交（runner 拿到 payload：model/ratio/resolution/prompt/referenceImageUrls）。
    4. 返回：`{ nodeId: 生成节点id, taskId, previewNodeIds:[…], edgeIds:[…] }`。**用 nodeId 可查任务状态**（后台在节点 data 记 taskId，`node.status` 反查）。
- type=text/video/audio 同理二选一（展示路径 vs 生成配置）。type 校验失败/args 缺参返回明确错误。
- 坐标：可传 position；不传后台自动铺开（参考图源在上/左，生成节点在下，避免重叠），"准确无所谓"。

**生成配置字段对齐前端 ImageBottomToolbar options**：model / ratio / resolution / promptText(+promptDoc) / 参考图绝对路径列表。后台把 referenceImages 绝对路径先经 `/api/proxy-media` 形式转 URL（因为平台生成需要可访问 url；web2api 场景可在后台本地代理读文件）。

### D5. 真实 runner：mcp-server 作为 web2api 的 MCP 客户端
- 在 mcp-server 启动时（可选配置 `--web2api http://localhost:8033/mcp`）建立 `StreamableHTTPClientTransport` 客户端。
- ModelRegistry 里 image 类 run：调 web2api `apimart/generate-image` / `chatgpt/generate-image` / `doubao/generate-image-chat`（按 mcpTool 映射），传 model/ratio/resolution/prompt/referenceImageUrls。
- web2api 的工具本身同步返回一个 taskId，再轮询 web2api `system/get-task`/`get-task` 得到进度/结果 → 映射成后台 PollFn。
- 若未配置 web2api 或调用失败：run 返回明确 error（而非静默 mock）。开发期可保留一个显式 `mock` 开关便于无网联调，但默认关闭。

### D6. SSE 事件扩展
现有 GraphEvent 已含 node:added/removed/updated、edge:added/removed、graph:changed。**新增**任务相关事件（仍走同一 `/events`，前端插件可订阅）：
- `task:progress { taskId, nodeId, canvasId, status, progress, message, step }`
- `task:done / task:error { taskId, nodeId, result/error }`
为让前端只按 nodeId 就地更新节点，`node:updated` 已够驱动进度条；task:* 事件供进度面板/详情用。前端插件按 `node:updated` + 增量 diff 应用即可无损。

### D7. 前端非侵入插件 BackendSyncPlugin（canvas-core 内，Cordis 式）
放 `canvas-core/src/plugins/backend-sync/`，作为一个标准 CanvasPlugin（dependencies: ['storage'] 可选弱化）：
- options：`{ baseUrl, canvasId?, autoSave=true, loadOnConnect=true }`
- 职责：
  1. **加载**：connect 拉画布列表 →（若指定/恢复）把后台画布 fromObject 到 VueFlow（首次全量）。
  2. **下行同步（SSE→本地，无损无感）**：订阅 `/events`；收到 `node:updated`/`node:added`/`node:removed`/`edge:*` 时，对 VueFlow **增量**应用（add/update/remove），**不整画布 reload**，避免覆盖用户正在编辑的状态。
     - 关键：只应用"本端非来源"的变更？简化：本地操作引发的 SSE 回播是幂等的（updateNode 同样 patch），加一个 source 标记（`graph:changed` 的事件不整 reload，逐条 diff 已有 node 状态），避免循环。提供事件节流 + 仅处理外部变更（对比 data 是否真变）防死循环。
  3. **上行同步（本地→后台，自动保存）**：监听 nodesChange/edgesChange/nodeDragStop/connect（参考 auto-save 的 markDirty），防抖后把**增量/全量** diff 上报后台 `node.batch`/`edge.batch`/`canvas.save`（后台落盘）。这样无需手点保存。
  4. **任务进度**：SSE task:* / node.status 变化 → 更新选中/相关节点 UI + 可选的轻量进度面板（把 node.data.progress 已驱动 ImageNode 进度条，复用现有渲染）。
  5. 暴露 API：`getPluginAPI('backend-sync')` → `{ connected, canvasId, saveNow, applyBatch, onNodeStatus }`。
  6. 配置 `configureImageModels(BackendProvider)`：把图片节点"发送"从本地 mock 切到后台（后台建生成节点+提交任务+SSE 回进度）。或更符合用户设想：**前端只负责展示/拖拽/连线/配置**，真正的"创建=任务"由 AI 经 MCP 触发；前端插件保证任何后台变更实时上屏。二者都做，但以前者（展示/同步）为核心。
- 关键：**不侵入** —— 不改 ImageNode/ImageBottomToolbar，不破坏离线本地单机用法；只在启用插件并连接后台时才启用云同步。默认 CanvasView 不引入（保离线），新增入口/加装到默认画布可选。

### D8. 自动保存与本地单机兼容
- StoragePlugin/auto-save 仍负责本地（离线可编辑）。
- BackendSyncPlugin 连接后台后接管"保存归后台"：本地改动上行 + 后台落盘。二者并存不冲突：后台为权威，本地作为回退快照。
- 组件卸载/页面隐藏前 flush 一次（参考 auto-save 的 beforeunload/visibilitychange）。

---

## 五、文件清单

### 后台 packages/mcp-server/src
- `graph/GraphModel.ts`（改）加批量原子执行器 `applyBatch`（内部复用现有 emit）。
- `models/types.ts`（新）ModelCapability / RunRequest / GenerationResult / PollState / PollFn / RunOutcome / RunProgress（由前端 imageModels 平移成纯数据版）。
- `models/ModelRegistry.ts`（新）注册表 + executeModelRun + 预置 image models（能力声明）。
- `models/executors/web2apiRunner.ts`（新）把 web2api MCP 客户端封装成 PollFn（mcpTool 映射 + poll）。
- `client/web2apiClient.ts`（新）StreamableHTTPClientTransport 单例：callTool + getTask + 断线重连。
- `tasks/TaskManager.ts`（改）runner 由 registry.run 驱动；细化 progress/message；发射 task:* 事件（挂在 GraphModel 或自带 emitter，SSE 订阅）。
- `mcp/server.ts`（改）收敛工具集：canvas.batch / node.batch / edge.batch / create_node / node.status / list_* / export_json / save / set_viewport / models.list（+ 删除冗杂逐条）。
- `http/CanvasHttpServer.ts`（改）REST 加 `/api/batch`(node/edge/canvas)；SSE 加 task:* 事件；proxy 已够用。
- `types.ts`/`cli.ts`（改）加 web2api 等配置项。
- 单测：GraphModel.applyBatch、ModelRegistry/executeModelRun、TaskManager（mock runner）。

### 前端 canvas-core
- `src/plugins/backend-sync/BackendSyncPlugin.ts`（新）主插件。
- `src/plugins/backend-sync/sse.ts`（新）EventSource 封装（重连/过滤 canvasId/解析）。
- `src/plugins/backend-sync/rest.ts`（新）REST 封装（batch/upload）。
- `src/plugins/backend-sync/BackendProvider.ts`（新）实现 ImageModelProvider → 走后台。
- `src/plugins/backend-sync/index.ts` + index.ts 导出 BackendSyncPlugin。
- 进度面板组件（轻，可选 `TaskProgress.vue`）挂到 Canvas 层。
- 前端测试样例视图：加一个路由/入口启用该插件（或用现有 McpCanvasView 重构为经插件），手动验证。

### 根 / 配置
- vite 环境 / 常量后台地址（默认 http://localhost:8765）。

---

## 六、实施步骤（每步可独立验证 + commit；每阶段末 commit）

### S1 后台批量 CRUD（GraphModel.applyBatch + MCP/REST batch）
- [ ] GraphModel 加通用 `applyBatch(resource, taskId, ops)`，含预校验 + 顺序 emit + 结果/错误报告。
- [ ] 单测：node/edge/canvas 批量、合并 add/delete/update、冲突/缺引用整批拒绝。
- [ ] MCP 加 `canvas.batch/node.batch/edge.batch`；REST `/api/batch`。
- [ ] commit；本地起服务用 mcp client/curl 验证一次合并执行。

### S2 后台 ModelRegistry + executeModelRun + TaskManager 真实 runner
- [ ] 平移纯数据契约 → models/types.ts；ModelRegistry + executeModelRun（对象/PollFn 分派，单测用假 PollFn）。
- [ ] TaskManager 改：createTask(kind, canvasId, nodeId, payload) 走 registry；progress/message 细化；发射 task:* 事件；回写节点 status/progress/result。
- [ ] 单测：TaskManager 假 registry 全链路（pending→…→done/error 回写节点）。
- [ ] commit。

### S3 真实生成：web2api MCP client + runner
- [ ] web2apiClient.ts（StreamableHTTPClientTransport，list/call/getTask，断线提示）。
- [ ] web2apiRunner：image 类 run → PollFn；比例/分辨率/参考图映射；本地绝对路径转 proxy URL。
- [ ] cli/config 加 `--web2api`；启动时若可用则连。未配置/失败给明确错误，保留 mock 开关(默认关)。
- [ ] 用真实 web2api 联测一次小图生成（仅测试，必要一次），确认节点回写出 url、SSE 推进度。commit。

### S4 语义化 create_node + node.status + SSE task 事件
- [ ] `create_node`：预览建节点(去重 by path)、参考图自动建预览节点+自动连线、生成节点+提交任务；返回 nodeId/taskId/预览/连线；坐标自动铺开。
- [ ] `node.status`：nodeId → 反查任务状态。
- [ ] HTTP/SSE 加 task:* 广播。
- [ ] 单测 create_node 的图结构逻辑（去重、连线、双模式）；联测 MCP 端调用。commit。

### S5 前端 BackendSyncPlugin（非侵入）
- [ ] rest/sse 封装 + 插件骨架：连接/建选画布/首次 load。
- [ ] 下行增量同步（node/edge 事件→VueFlow 增量应用，节流+防循环）。
- [ ] 上行自动保存（本地变化防抖 → 后台 batch/save）。无手点。
- [ ] 任务进度在节点上呈现（复用 node.data.progress 驱动现有渲染），可选进度面板。
- [ ] configureImageModels 切 BackendProvider（图片节点"发送"走后台）。兼容离线(不连后台用本地 provider)。
- [ ] 新增/复用前端验证入口，把 imageModels/工具栏交互打通。commit。

### S6 端到端 + code review + 测试
- [ ] Chrome MCP：前端热重载；起后台；AI 端用 MCP client 发 create_node(image, path) 看前端实时出现预览节点；发 create_node(image, {prompt}) 看前端实时出现生成节点+进度+出图；手动拖拽/连线自动保存；刷新不丢。
- [ ] code review 插件 + 后台代码；修复。
- [ ] 收尾 README/文档。

---

## 七、测试方案
- **单元（Vitest，mcp-server）**：applyBatch、executeModelRun、TaskManager、create_node 图结构。
- **集成**：stdio/HTTP client 调 batch/create_node 全链路。
- **真实生成**：web2api 一次小图（必要时才跑，控制成本）。
- **端到端（Chrome MCP）**：见 S6。

---

## 八、风险 / 开放问题
1. **无损同步的循环/竞态**：本地操作经 REST 上报后台 → 后台 SSE 回播 → 前端再应用，若比对不当会重复/覆盖。对策：SSE 应用前做 diff（同一节点同字段值相同则跳过），本地上报与 SSE 应用共用一套幂等 patch；必要用 canvasId+source 过滤。风险中。计划在 S5 用最小模型(节点整体 compare)实现并留注释。
2. **整画布 reload 会覆盖编辑**：现有 McpCanvasView 是 reload 全量；插件必须**增量**应用。这是"无损"核心，S5 重点。
3. **web2api 出网/账号/配额**：真实生成依赖 web2api 平台账号 cookie；可能不可用/限流。规划里显式错误 + 可控 mock 开关，避免测试阶段烧钱。
4. **imageModels 前端 provider 切换**：切到后台后，离线/单机模式需回落本地 mock；要保证 ImageBottomToolbar 零改动（它只依赖统一函数接口）。可行，前端 provider 由 BackendSyncPlugin 连接状态决定。
5. **type 语义后端 vs 前端渲染**：后端 create_node 用语义 type('image'…)，GraphModel 已自动转 type:'custom'+data.nodeType，前端可渲染 —— 已对齐，无碍。

## 九、计划修订（双评审后 — 决策已定，覆盖上文有出入处）

> 评审源：docs/tmp/ai-backend-plan-review/{review,frontend-review}.md
> 原则：下列修订**覆盖**正文里与之冲突的表述。

### R1【P0·字段对齐】后端 data 统一用 imageUrl，path 只作去重键
- 前端 image 节点渲染只认 `data.imageUrl`（img src）；**不用** src/url/path。
- 后台预览/生成节点持久化：`data.imageUrl`(可访问 URL) + `data.imageName` + `cardWidth/cardHeight` +（后台内部去重用）`data.sourcePath`(原始绝对路径)。
- 去重键：**预览节点按 `data.sourcePath`（归一化绝对路径）比对**；有→直接复用并连线；无→新建并记 sourcePath。
- generate 参考图节点也走同规则（存在同名预览节点即连线，不再建）。

### R2【P0·运行态落点】前端用 data.runState 单对象 + ImageNode 补只读渲染
- 后台任务进度/结果写 `data.runState = { status:'running'|'done'|'error', progress?, message?, taskId?, imageUrl?, error? }`（单对象便于整补与比对）。
- **ImageNode 加只读渲染路径**：computed 读 `data.runState`，模板在「本地 ref(runProgress)」与「data.runState」**二选一**显示；本地 mock executeRun 交互完全不动，后台写 runState 走另一条。结果把 `data.imageUrl` 写全让 `<img>` 吃。
- 删去计划里错误的"复用 NodeRunIndicator"表述：该组件不存在，用现有 ImageRunIndicator 或参数化。
- runState 需确认不被 sanitize 剥离（options 保留，其它非 RUNTIME 字段默认保留，实测确认）。

### R3【P0·统一驱动】唯一驱动层 = TaskManager 轮询 PollFn
- 改 `TaskRunner` 契约为 `run(task): RunOutcome`（RunOutcome = GenerationResult | PollFn），TaskManager 内部 while 定时调 PollFn（间隔/超时可配）直到 done，把 running 的 progress/message 转成回写节点 + 广播。
- web2api 场景：run 首次返回 `running{taskId}`，之后 PollFn 每次查 web2api task → running/done。**不在 runner 外另起轮询**，避免双时钟。
- executeModelRun 的 while 逻辑并入 TaskManager；ModelRegistry 只做"选 runner + 传参"，TaskManager 做调度。

### R4【P0·SSE 广播全量 node】node:updated 带全量 node，避免前端丢字段
- GraphModel.updateNode 的 emit 增带合并后**完整 node**；`node:added` 已带全量。SSE 下行只按事件**单点替换**该节点（VueFlow updateNode 用 `{...现data, ...新data}` 手工合并或整 node set），不做只带 patch 的增量，杜绝把 label/options/imageUrl 清空。
- 简化：**不加 task:* 独立事件**（避免与 node:updated 双发）。进度/结果都表现为 node.data.runState 更新 → node:updated(全量) → 前端就地刷新。若后续要任务列表聚合面板，再在 task:* 只承载 taskId→nodeId 映射，不与进度双发。

### R5【P0·防环】applyingRemote 抑制标志 + 同值跳过，不用"本端非来源"
- 现有事件无来源标记 → 不能靠它防环。上行/下行共用 `applyingRemote` 抑制开关（参考 AutoSavePlugin.isHistoryRestoring 范式）：下行 SSE 应用节点时置 true，使上行监听(nodesChange/connect)忽略；上行时也包一段。
- 再做"字段同值比对跳过"（同 runState/position 值相同则不 update）。切断主要回环。

### R6【P0·双写】BackendSyncPlugin 空依赖；连后台入口去掉 storage/auto-save
- BackendSyncPlugin `dependencies: []`（不依赖 storage）。
- McpCanvasView（或等价连后台入口）用 BackendSyncPlugin **取代** AutoSavePlugin+StoragePlugin；Canvas 插件列表去掉 storage/auto-save，保留 skipDefaultLoad:true。
- **不进默认 CanvasView 插件集**（保持离线本地单机不破坏）。

### R7【P1】事件粒度与断线重连
- 批量执行**内部逐条 emit**（add/update/delete 各发事件）+ 末尾 `batch:done{canvasId}`（前端一次 reconcile 兜底，不作唯一机制）。
- SSE 断线窗口补全：前端重连后先 `GET /api/canvases/:id` 全量 + 本地 reconcile（首版够用），不引入 /events 历史重放。

### R8【P1】create_node 细节
- 自动连线**一律显式传** `sourceHandle:'source'`、`targetHandle:'target'`（对齐前端 ImageNodePlugin 范式）。
- 生成/预览节点 position 给默认初值 + 写入 `data.cardWidth/cardHeight`（后台估算），供前端有尺寸渲染；不强制覆盖前端布局偏好。
- 参考图 URL 形态：**取决于 web2api inputSchema**（启动后实测），转发时把 sourcePath 转成 web2api 能访问形式；计划里"写死 /api/proxy-media"仅为兜底思路，非定案。
- 保留 nodeId ↔ taskId 映射：create_node 返回 `{ nodeId, taskId, previewNodeIds, edgeIds }`；`node.status`/`task.status` 用 nodeId 反查任务。

### R9【P1】applyBatch 语义
- 执行序：delete → add → update（允许 update 引用同批新增 id）。
- 校验阶段做"净效果推演"：add 显式 id 查重（与存量+批内）；delete 推演级联删边集合；update 校验目标存在。全通过才真正 mutate+emit。
- REST save（落盘）只存后台内存现状，**不做 fromJSON 整覆盖回灌**（避免覆盖增量）；前端首版用"全量 save 上报"(vf.toObject，useMcpClient 现有范式)，后续优化成 diff batch。

### R10【P1】测试/脚本同步
- 工具收敛会让 mcp-client/mcp-http-client/stdio-e2e/task-e2e break（stdio-e2e 硬断言工具数===18）→ S1/S2 同步改，数量断言改语义断言（关键工具存在、无逐条重复）。

### R11【P1】web2api client 生命周期
- 单例 + 断线重连(退避) + server 关闭时 close；`--web2api` 配置未配置则 run 返回明确错误；mock 默认关。启动 web2api 后先跑 probe-web2api.ts 拿权威 schema 再定 URL 传递。

---

## 十、范围说明（本轮不做的，后续轮次再扩）
- 视频/音频的"真实生成"run 先按同构预留（video/audio models 可注册但真实 exec 优先级低于 image）；先打通 image 端到端闭环，再按同一套扩展。
- 前端完整任务进度面板/列表 UI 做基础版即可；重点是节点内进度与自动同步。
- web2api 之外的生成供应商接入留扩展点。
