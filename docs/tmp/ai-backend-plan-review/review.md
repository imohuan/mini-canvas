# AI 后台插件实施计划 — 后台部分评审

日期：2026-09-04
评审范围：只评后台（批量 applyBatch、ModelRegistry/executeModelRun、TaskManager 真实 runner、create_node、web2api client、MCP 工具集、SSE task 事件）。
依据均为**实读源码**，未臆测。不改业务代码。

实读文件：
- `packages/mcp-server/src/graph/GraphModel.ts`、`graph/types.ts`
- `packages/mcp-server/src/tasks/TaskManager.ts`
- `packages/mcp-server/src/mcp/server.ts`
- `packages/mcp-server/src/http/CanvasHttpServer.ts`
- `packages/mcp-server/src/storage/NodeStorage.ts`、`storage/sanitize.ts`
- `packages/mcp-server/src/server.ts`
- `packages/mcp-server/scripts/{probe-web2api,mcp-client,mcp-http-client}.ts`
- `packages/mcp-server/e2e/{stdio-e2e,task-e2e,sse-e2e}.ts`
- `packages/canvas-core/src/nodes/image/{imageModels,ImageNodePlugin,ImageNode,ImageBottomToolbar}.ts/.vue`
- SDK 实际版本 `1.30.0`（node_modules 实测）
- 参考 `docs/tmp/ai-backend-web2api-client/research.md`

---

## 关键事实前提（评审判据）

1. **前端 image 节点的「展示图」字段是 `data.imageUrl`，不是 `src`/`url`/`path`。**
   - `ImageNode.vue`：`v-if="data?.imageUrl"` → `<img :src="data.imageUrl">`。图片资产另有 `data.assetId`、`data.imageName`、`imageWidth/Height`、`cardWidth/cardHeight`。
   - `ImageNodePlugin.ts`（handleImageAddSource/createResultNode）建节点都带 `nodeType:'image'` + `imageUrl` + `imageName` + `assetId` + 尺寸。
2. **handle / 端口命名**：前端固定 `sourcePosition:'right'`、`targetPosition:'left'`、`sourceHandle:'source'`、`targetHandle:'target'`（`ImageNodePlugin.ts` 179-185）。
3. **参考图送往 run 的字段**：工具栏收集上游连线节点的 media → `GenerationResource { id, kind, name, url }` → `resources`（含 `url`）传给 `executeRun`。不是绝对路径。
4. **运行态前端不落 data**：`ImageNode.vue` 用内部 ref `runProgress/runError`，生成完成只 `notifySuccess(images)`，**不写 `data.imageUrl`、不写 `data.status/progress/result`**。
5. **SSE 在线上不分事件名**：`CanvasHttpServer` 所有事件统一 `stream.writeSSE({ data: JSON.stringify(event) })`（行 245），wire 上是 `message` 型事件，类型在 `data.type`。`sse-e2e` 靠解析 `data.type` 断言 `node:added`（line 99）。→ 计划里「新增 task:* 事件」若只是往 GraphEvent 加 type 再走同一 emit，前端 EventSource 收到仍是统一 `message`，靠 data 分派即可，可行；但注意 `canvasId` 过滤。
6. **TaskManager 现状**：`createTask` 立即 `updateNode(data:{status:'rendering',progress:0})` 然后 `setTimeout(process)`；`process` 里 `runner.run(task, onProgress)` 一次跑完，onProgress 回写节点。runner 契约是 `run(task, onProgress): Promise<unknown>`（回调式），**不是** PollFn。
7. **工具/事件打点**：逐条工具（create_node/create_edge/update_node/set_node_position/task.create/task.status 等）与 e2e（mcp-client/mcp-http-client/stdio-e2e/task-e2e）**深度耦合**，mcp-client 与 stdio-e2e 都断言「工具数量 = 18 / >= 18」，stdio-e2e 断言 `=== 18`。

---

## 评审问题清单

### 问题 1（P0）：`create_node` 的预览/参考图节点「去重 + 前端可渲染」字段对不上前端

**问题**
计划 D4 说：建预览节点时「找画布中已存在 `data.src/url/path === 该绝对路径` 的图片节点去重」「找不到就自动建预览节点并记录 path」。D3b 又说生成结果 URL 写 `data.imageUrl` 前端才能显示。字段名混乱：`data.src`/`data.url`/`data.path` 都不是前端渲染图用的字段。

**依据**
- `ImageNode.vue` 渲染只认 `data.imageUrl`；`sanitize.ts` 里 `src`/`url`/`path` 都**不在** RUNTIME/MEDIA 白名单，落盘清洗既不删也不保，属无字段。
- 前端媒体模型 `GenerationResource.url` 是参考图送 run 的字段，但也**不直接等于节点 data 里的字段**。

**建议**
- 统一：后台预览节点持久化字段 = `data.imageUrl`（存可访问 URL：`/api/files/...` 或 `/api/proxy-media?path=...`）+ `data.imageName` + `assetId`（如有）+ `cardWidth/cardHeight`。去重键用 **`data.imageUrl`**（归一化成可访问 URL 后再比对，别拿原始绝对路径比对，否则 `/a/b.png` 与 `/api/proxy-media?path=/a/b.png` 不相等）。
- 若要按「绝对路径」去重，需单独在 data 存一个后台内部字段（如 `data.path` 保留原始绝对路径）专用于去重比对，同时 `data.imageUrl` 给前端渲染。二者都存、role 分清，别让渲染字段兼任去重键。

---

### 问题 2（P0）：`create_node` 生成节点的 data 里写 `status/progress/result`，但前端 ImageNode 根本不在 data 读这些，SSE「就地更新」落空

**问题**
计划数据流（图、D6、D7.4）假设「后台把 `node.data.progress/status/result` 更新 → SSE `node:updated` → 前端 ImageNode 就地显进度/出图」。但当前前端运行态根本不读这些字段。

**依据**
- `ImageNode.vue` 运行态全走内部 ref（`runProgress/runError`），不读 `props.data.status/progress`，出图走 `notifySuccess` toast 不写 `data.imageUrl`。
- 计划 D3b 自己也承认「ImageNode 必须补一个读 data 的落点」并把补丁归到 S5——但 S5 是「前端 BackendSyncPlugin」，它按 `node:updated` diff 应用节点 data；**VueFlow 节点 data 变了，ImageNode 不读也不会渲染**。S5 若只做「同步 data」而不给 ImageNode/渲染加读 data 的代码，进度/出图 UI 依然空白。

**建议**
- 把「ImageNode 增补读 data.status/progress/imageUrl/result 的渲染」从 S5 里**提前并独立成 S2/S4 的一等任务**（含 ImageBottomToolbar 生成后把结果 url 回写 `data.imageUrl`），否则整条「SSE→节点出图」链路断在末端。
- 至少明确：ImageNode 渲染图优先 `data.imageUrl`（覆盖 run 后更新的 data），本地预览 blob 优先级逻辑并存。列出 ImageNode.vue / ImageNodePlugin 需改的具体点，避免 S5 里「顺手补」漏掉。

---

### 问题 3（P0）：TaskManager runner 契约与 executeModelRun 的 PollFn 契约不兼容，需明确改造方向

**问题**
计划 D3 要 `executeModelRun` 返回对象=同步 / PollFn=异步；D5 说 web2api 工具「同步返回 taskId → 后台周期查」。但 `TaskManager.process` 现在是一次 `runner.run(task,onProgress)` 回调式、一次跑完，回写也是回调内做。两者是**两套驱动模型**：回调式 vs PollFn 轮询。

**依据**
- `TaskManager.TaskRunner.run(task, onProgress): Promise<unknown>`，process 内一次性 `await runner.run`。
- `imageModels.RunOutcome = GenerationResult | PollFn`，`executeRun` 自己 `while` 循环按 interval 调 PollFn（300s 超时），与 TaskManager 解耦、无关联。
- 计划文件里两个层（TaskManager、executeModelRun）**都出现却没说谁驱动谁**，文件清单里 `models/executors/web2apiRunner.ts` 与 `tasks/TaskManager.ts(改)` 分工不清。

**建议**
- 定一个**唯一驱动层**。推荐：TaskManager 是调度主体，把「一次 run」抽象为返回 `PollState` 的轮询函数并自己 while 驱动（间隔/超时可配）。即把 `executeModelRun` 的轮询 while 并入 TaskManager.process 的一个新 loop：
  1. runner 返回 `GenerationResult`（同步）→ 直接写 done；
  2. runner 返回 `PollFn`（含 web2api 场景：PollFn 每次调 web2api `system/get-task` 返回 running/done）→ TaskManager 定时调直到 done/超时。
  → `TaskRunner` 接口从回调式改成「返回 RunOutcome / PollFn」，onProgress 由 TaskManager 内部根据 PollState.running 统一转成回写 + SSE。
- 明确「web2api 返回 taskId 后周期查」也应落在这个 PollFn 内（第一次 poll 返回 running+taskId，之后每次查 get-task）。避免 TaskManager 和 web2apiRunner 各自起轮询造成双时钟。

---

### 问题 4（P1）：SSE task:* 事件 + TaskManager「自触发 node:updated」会造成事件风暴 / 双写 / 漏事件，批量语义也被削弱

**问题**
- `CanvasHttpServer` 已订阅 GraphModel 广播所有 `node:*`/`edge:*`。TaskManager 回写节点走 `model.updateNode` → 已自动触发 `node:updated` SSE。若再单独发 `task:progress/done/error`，同一进度会被 `node:updated` + `task:*` **发两遍**（前端若都订阅就重复刷新）。
- `task:progress` 若由 TaskManager 每 2s 自己 emit，而回写 updateNode 也 emit，两路各自为政。

**依据**
- `CanvasHttpServer` constructor 里 `model.on((e)=>broadcast(e))` 广播所有 GraphEvent；`TaskManager.process` 的回写都走 `model.updateNode`。
- 计划 D6 新增 task:* 事件又想让 `node:updated` 也够驱动进度——自相矛盾地可能双发。

**建议**
- **单一事实源**：task 进度统一表现为「节点 data 更新」（status/progress/message/result），一次 `updateNode` 触发 `node:updated` 就够了。`task:*` 事件可选，但应定位为**元数据增强**，且发它时不重复 updateNode。做法：GraphModel 的 `emit` 已带 patch，前端插件从 `node:updated.patch.data` 就能拿到 progress/message——**task:* 可以不做**，SSE 事件模型基本无需扩（省一整套类型与前端订阅）。若确实要进度面板聚合任务列表，再加 `task:*`，并在 updateNode 同一 tick 只发其一（或 task 事件只承载 taskId→canvasId/nodeId 映射，不发重复进度）。
- 若保留 `batch:done` 之类批量完成事件，让前端知道「这一批结束、可以整体 compare 兜底」。

---

### 问题 5（P1）：applyBatch 的「先整批预校验再顺序 emit」可行，但实现有 3 个坑

**问题/坑**
1. **id 冲突**：add 里手动指定 id 与同批/已存在节点撞 id。GraphModel `createNode` 现在 `canvas.nodes.set(id,node)` **静默覆盖**（不查重）。预校验必须检查 add 的显式 id 是否已存在、批内是否重复，否则覆盖丢节点。
2. **batch 里 update 引用同批新 add 的节点**：预校验若「先全量校验 add 引用」就校验不到「update 目标是本批刚 add 的 id」这类合法组合；反之先 add 后 update 又和「整批拒绝」矛盾。需定义清楚依赖顺序（推荐：校验只看存量 + 批内新增集合，应用顺序 = delete → add → update，允许 update 引用同批 add）。
3. **delete 牵连 edges**：`deleteNode` 会连带删关联 edges 并发 edge:removed。批量 delete 里 A 的删除把 B 要留的边删了、或同批 update 的节点被 delete——这类关联副作用要在预校验里推演，别应用时才爆。

**依据**：GraphModel createNode 无 id 查重直接 set（行 137）；deleteNode 级联删边（行 145-159）。

**建议**：applyBatch 校验阶段输出「净效果」：先克隆性推演 add（分配/校验 id）→ delete（推演级联删边集合）→ update（校验目标存在），全部通过才真正 mutate + emit；提供 batch:done。在计划 S1 就写清执行序与冲突语义。

---

### 问题 6（P1）：事件粒度 vs SSE 客户端重建

**问题**
现状批量是「逐条单事件」，前端做「增量无 reload」靠的是逐条 `node:added/removed/updated` 够细。计划 D1 说批量「顺序 emit 保持 SSE 兼容」——这是对的，别用「一个大 graph:changed + 全量快照」代替逐条事件，否则前端无法局部应用。

**依据**：`types.ts` GraphEvent 全为单对象事件；SSE `/events` 无版本号重放、无历史缓冲，客户端断开后重连只会收到后续增量，无法补齐漏掉的中间态（如 node:added 之后立刻 update，重连者只有 update 没有 add，本地 diff 会落空）。

**建议**
- 批量执行**内部逐条 emit**（每 add/update/delete 各发其事件）+ 末尾一个 `batch:done {canvasId}`（P1，帮助前端做一次 reconcile 兜底，而非唯一机制）。不要用全量 `graph:changed` 取代逐条。
- **断开重连补全**：SSE 断线重连后不能只靠增量。给 `/events` 增加「按 graphVersion 从 x 重放」或前端重连时先 GET `/api/canvases/:id` 全量 + 本地 reconcile。这是「无损无感」能否成立的关键，计划只提「节流+防死循环」没覆盖断线窗口。P1 偏 P0（关系到前端一致性）。

---

### 问题 7（P1）：`create_node` 自动铺开的坐标策略与前端 auto-layout 会打架，且自动连线需显式 handles

**问题**
计划「参考图在上/左、生成节点在下」「准确无所谓」。但：
- 前端节点渲染需要 `cardWidth/cardHeight`，后台若只给 x/y，节点可能无尺寸显示异常；而前端插件一般自带位置管理，后台硬铺的坐标未必被尊重（若 BackendSyncPlugin 增量应用 position 到 VueFlow，会盖掉用户手动摆位）。
- 自动连线若**不显式传 sourceHandle/targetHandle='source'/'target'**，前端 VueFlow 自定义 handle 需精确匹配才吸附；GraphModel.createEdge 的 sourceHandle/targetHandle 是可选，漏传则前端边不会连到 handle、渲染不出。

**依据**：`ImageNodePlugin` 建参考节点到生成节点连线**必须** `sourceHandle:'source', targetHandle:'target'`（行 179-185）；GraphModel.createEdge 不强制 handles。VueFlow 自定义节点需要 position（handle 在节点模板里，不依赖 data 尺寸但需要位置）。

**建议**
- `create_node` 自动连线**一律显式传** `sourceHandle:'source'`、`targetHandle:'target'`（D3b 已提一句，但要在实现里写死，别留给调用方）。
- 坐标铺开做成「默认值 + 可被上游前端插件覆盖」：后台生成节点给 position 作为初值，但明确 BackendSyncPlugin 应用 node:added 时不强行覆盖本地已有布局偏好；生成节点的尺寸字段（cardWidth/cardHeight）由后台估算并写入 data，避免前端拿不到尺寸。

---

### 问题 8（P1）：web2api client 的 SDK 用法与版本 —— 同进程既 server 又 client 是否冲突

**依据（重要澄清）**
- 同 SDK `1.30.0` 里 server 和 client 完全独立类，`StreamableHTTPClientTransport` 是纯出站（new URL 指向远端），与本地作为 server 的 `WebStandardStreamableHTTPServerTransport`/stdio 无端口/transport 冲突。计划 D5 + research.md A 结论正确，`scripts/probe-web2api.ts` 就是现成模板。
- 但需注意 **client 生命周期**：作为 server 进程内发起出站 HTTP 连接，要管理单例、断线重连、以及 server 关闭时 close client，避免泄漏。

**建议（非阻塞）**
- 起一个 `web2apiClient` 单例，封装 connect/重连（指数退避 + 心跳/按需重连），失败时 ModelRegistry 的 run 返回明确 error（计划已有，OK），不要把 error 吞成 mock。
- 配置项用 `--web2api`（URL），未配置就返回「未配置 web2api」的明确错误。mock 开关默认关——正确。
- 真连接前跑 `probe-web2api.ts` 拿**权威 inputSchema**（research.md B 也强调 web2api 当前没跑，schema 只能启动后复核），别照抄 research 里 8-31 的旧 schema。

---

### 问题 9（P1）：参考图「绝对路径 → URL」传递链条在计划里不完整，web2api 拿不到可访问 URL

**问题**
计划 D4/D5：referenceImages 传「绝对路径」，后台「先经 /api/proxy-media 转 URL」。但 web2api 是**另一个进程**（localhost:8033），它调用的平台要的是「可被平台/上游抓取的公网 URL」。`/api/proxy-media?path=` 是本机 mcp-server 的端点，web2api 若在另一台/另一沙箱拿不到；即便同机，web2api 也不认 mini-canvas 的 proxy 域名约定。

**依据**：imageModels 参考图走 `GenerationResource.url`；proxy-media 是 mini-canvas 自己的端点（CanvasHttpServer 行 174），与 web2api 无契约。

**建议**
- 明确参考图的 URL 形态由 **web2api 的 inputSchema 决定**（它 schema 里 `referenceImages` 期望什么，如 base64 / 公网 URL / 它自己的 /api/files）。mcp-server 转发时应把本地绝对路径转成「web2api 能访问」的形式：能 public 就把 mini-canvas 起在 web2api 可达的地址并传 `http://mini-canvas-host/api/proxy-media?...`，或直接把文件字节/数据 URL 传给 web2api（若其支持）。启动 web2api 后实测 schema 再定，别在计划里写死「/api/proxy-media」。

---

### 问题 10（P1）：MCP 工具收敛成 batch/create_node 会让现有 4 个脚本/e2e 全 break，计划没给迁移方案

**依据（实读）**
- `mcp-client.ts` 断言行 `tools.length >= 18`，调用 `canvas.create_canvas/create_node/create_edge/set_node_position/export_json/save/load/task.create/task.status`。
- `stdio-e2e.ts` **断言 `tools.length === 18`**（严格），并调用逐条 create_node/create_edge/set_node_position/save/load/export_json。
- `task-e2e.ts` 调用 `canvas.create_node` + `task.create` + `canvas.get_node`。
- `mcp-http-client.ts` 调用 `canvas.create_canvas` + `canvas.create_node`（只读探活，最轻）。
- 删除/收敛逐条 create_node/create_edge/update_node/delete 系列 → 上述全部无法跑或断言数不符。

**建议**
- S1/S2 落地**同步改**这 4 个脚本 + 把「工具数量断言」从硬编码数字改为「≥ 关键工具存在 + 无逐条重复」之类语义断言，避免每次收敛都改一次数量魔数。
- e2e 改走 batch/create_node 新路径，保留少量只读（export_json/list_*）与 batch 的回归覆盖。计划 S5「联测 MCP client 发 create_node」隐含用了旧工具名，要统一到新名。

---

### 问题 11（P1）：REST `/api/batch` + SSE task 事件要扩展 GraphEvent 联合类型与 CanvasHttpServer 广播/过滤，容易漏类型

**依据**
- `CanvasHttpServer.broadcast` 对每个 client 用 `canvasId` 过滤（`client.canvasId !== event.canvasId` 跳过）。若新增 task:* 事件带 `canvasId` 字段，broadcast 的过滤逻辑**仍能用**，但 GraphEvent 是 union，加新成员要同步改 `types.ts` + broadcast 访问 `event.canvasId`（若 task 事件 canvasId 可选，广播里可选字段的判断需留意空值）。
- SSE `/events` 现在只在 HTTP transport 启动时 `model.on` 订阅一次（constructor），新增事件源（TaskManager）需**挂到同一个 model** 或给 broadcast 额外注入 task 事件源，别另起一条广播线导致前端要连两个 SSE。

**建议**
- 若加 task:* 事件，扩 `GraphEvent` union（taskId/nodeId/canvasId 全带上），并让 TaskManager 通过注入的 `model.emit` 或独立但并入 CanvasHttpServer 的 source 统一走 `/events`，确保单一 SSE 通道。
- 按问题 4 结论：优先考虑**不加** task:*，只靠 node:updated（含 patch.data）即可，降低改动面。

---

### 问题 12（P2）：`canvas.load`/`fromJSON` 走全量覆盖，与 batch 增量语义冲突（数据一致性）

**依据**：`mcp/server.ts` 的 `canvas.load` 用 `model.fromJSON` 整画布覆盖（GraphModel.fromJSON 直接重建 nodes/edges Map 并只发 graph:changed）。`/api/canvases/:id/save` 在传了 body 时也 fromJSON 整覆盖。

**建议**：S5 前端「增量上报 + 后台落盘」若偶尔把全量 diff 当 save 发，会触发整画布 fromJSON 覆盖 → 前端收 graph:changed。要么给 save 一个「仅落盘不回灌 fromJSON」的干净路径（现状 save 无 body 时只存内存现状，OK），要么前端始终走 batch 增量、save 只做落盘。明确 REST save 与 batch 的分工，避免 fromJSON 整覆盖破坏「无损」。

---

### 问题 13（P2）：port/transport 干扰确认 + 结论

**结论（非问题）**：mcp-server 同进程既当 MCP server（stdio 或 /mcp）又当 web2api 的 MCP client，**不冲突**——client transport 指向远端 8033，server transport 是本地 stdio 或本地 HTTP。共用同一 GraphModel/SSE 无干扰。唯一注意：别把 web2api client 的 URL 配成指向自己（8765 /mcp），否则回环自调用死循环。计划里 `--web2api http://localhost:8033/mcp` 正确。

---

## 优先级汇总

**P0（会造成功能不成立/返工）**
1. create_node 去重/渲染字段对不上前端（`imageUrl` vs `src/url/path`）→ 统一 imageUrl + 独立 path 去重键。
2. 前端 ImageNode 不读 data.status/progress/imageUrl → 「SSE→节点出图」链路断末端；把 ImageNode 增补读 data 独立成任务，别塞 S5。
3. TaskManager（回调式一次跑完）与 executeModelRun（PollFn 轮询）两套驱动未统一 → 定唯一驱动层，runner 改返回 PollFn/Outcome。
4. 断线重连窗口无补全机制 → /events 重放 或 重连全量 GET + reconcile。

**P1（应修，避免返工/不一致）**
5. applyBatch：id 查重缺失、delete 级联删边副作用、update 引用批内 add 的顺序 → 预校验做净效果推演 + 定执行序。
6. 事件模型：批量逐条 emit + batch:done；task:progress 与 node:updated 双发重复 → 单一事实源优先 node:updated。
7. create_node 自动连线必须显式 handles + 坐标铺开字段含 cardWidth/cardHeight + 不覆盖前端布局。
8. web2api client：单例/断线重连/关闭；真连前跑 probe 拿权威 schema，别照抄旧文档。
9. 参考图 URL 形态取决于 web2api schema，别写死 /api/proxy-media。
10. 工具收敛会让 4 个脚本/e2e 全 break → 同步改 + 断言去数字魔数。
11. GraphEvent union / SSE 广播 / TaskManager 事件源需统一进单通道、扩类型。
12. canvas.load / save 的 fromJSON 整覆盖与批量增量冲突 → 明确 save 分工。

**P2**
13. port/transport 结论：不冲突（记录即可，非改动）。

---

## 一句话结论
计划整体方向正确（同 SDK 1.30 出站 client 可行、批量复用逐条 emit 可行、SSE 单通道可行），但有 4 处 P0 会在实现末端断链或返工：**前后端 data 字段不对齐、前端不读 data 运行态、TaskManager 与 PollFn 驱动未统一、SSE 断线无补全**。建议改完计划再进 S1。
