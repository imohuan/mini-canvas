# 计划：ImageBottomToolbar 改用后台模型配置（去掉本地 mock 数据）

日期：2026-09-04 · 状态：已实施并 Chrome 实测通过（方案 A）

## 背景（现状）
- `packages/canvas-core/src/nodes/image/ImageBottomToolbar.vue` 的下拉数据（模型列表、ratio、resolution、模板）
  来自本地 `imageModels.ts` 里写死的 `LOCAL_MODELS` / `LOCAL_TEMPLATES`。
- 点「发送」→ `ImageNode.runGeneration` → `executeRun` → `LOCAL_IMAGE_MODEL_PROVIDER.run`（本地 MOCK，画一张渐变假图）。
- 架构已留好切换缝：UI 只调 `listModelOptions/getModel/executeRun` 等稳定函数，换后台 = 注入一个实现了
  `ImageModelProvider` 的后台 provider 并调 `configureImageModels(provider)`。**工具栏本身零改动即可**。
- 后台模型元数据在 `packages/mcp-server/src/models/ModelRegistry.ts`（5 个图片模型，经 web2api 真生成），
  目前只经 **MCP `models.list`** 暴露，**没有 REST `/api/models`**，前端拿不到。
- 前端 ImageNode 已支持「外部 runState 只读驱动」（AI/MCP 经 SSE 建的生成节点、进度、结果能显示）——这条通路已通。
  缺的是：**前端工具栏直接发的「发送」走后台**（现在本地 mock）。

## 目标（用户要的）
工具栏不再用本地写死的模型数据；改为用后台 `models` 提供的配置信息（模型列表/能力），
且点「发送」由后台真正执行生成，结果/进度经 SSE 实时回到画布。

## 方案（最小改动，复用现有缝）
1. 后端：`CanvasHttpServer` 加 `GET /api/models`（返回 `ModelRegistry.listModels()`，即能力数组，与 MCP models.list 同源）。
2. 前端新增 `backendImageModelProvider`（在 canvas-core 或 src），实现 `ImageModelProvider`：
   - `listModelOptions/getCapability/listTemplates/acceptsInput`：异步拉一次 `/api/models` 后缓存/快照；
   - `run(payload)`：把当前画布 + 当前图片节点 id 一起提交后台 `/api/tasks`，返回 **PollFn**（轮询 `/api/tasks/:taskId`，
     把 progress/message 映射回 UI，done 时取 urls 作为结果）。
   - 因为 provider 是模块级、不带 per-node 上下文，`run` 需要的 nodeId/canvasId 由注入时提供「上下文 getter」：
     页面（/cloud、/mcp）连接并选定画布时，把 `{ baseUrl, getCanvasId, getNodeId }` 注入进去。
3. 接线：`/cloud`、`/mcp` 两个页面在 `onMounted`（连接后台后）调 `configureImageModels(backendProvider)`；
   backend-sync 插件也可在 `backend-sync:canvas` 事件里同步画布 id。
4. 兼容：未连后台 / 注入前仍用本地 mock（离线可用）；连上后台后切后台。模型 id 与 data.options.selectedModel 持久化一致，
   刷新后仍能还原（现有 initToolbarFromData 机制不变）。

## 待你拍板的 1 个关键点
后台 `/api/tasks` 需要 `canvasId + targetNodeId`。设计上：
- **A（推荐）**：前端「发送」也走后台任务（后台在目标节点写 runState、SSE 广播进度）——即前后端都归后台驱动，
  与 AI/MCP 建节点同一套通路，画布数据/进度来源唯一。ImageNode 本地 mock 路径随之废弃或仅作离线兜底。
- B：仅把「下拉模型数据」换成后台的，点发送仍走本地 mock（不推荐，自相矛盾）。

> 说明：无论 A/B，前端 ImageBottomToolbar 组件本身都不需要改（它只依赖 imageModels 稳定函数 + data.options），
> 改动集中在「新 provider + 后端 /api/models + 页面注入」。

## 实施步骤（每步 commit）
1. 后端加 `GET /api/models`（+ 冒烟测试 curl）。
2. 前端写 `backendImageModelProvider.ts`（list 拉后台 + run 走 /api/tasks + PollFn）。
3. 页面 /cloud、/mcp 注入后台 provider（含 canvasId/nodeId 上下文 getter）。
4. 单测/冒烟：无后台回落本地；有后台下拉来自 /api/models；点发送 → 后台任务 → 进度经 SSE 回画布。
5. code review + Chrome 实测（后台若无 --web2api，任务会 error，确认链路通、报错合理）。

## 风险 / 注意
- 运行后台需重启才含 /api/models。
- 前端"发送"若与 AI 已提交的 runState 并发需互斥（ImageNode 已有 R6 清 runState 逻辑，可复用）。
- 生成结果 URL 相对后台，需绝对化（前端 withAbsolutizedUrls 已有）。

## 实施记录（方案 A 已完成并实测）
- 后端：`GET /api/models`（CanvasHttpServer，源 ModelRegistry.listModels）。commit b145e05。
- 前端 provider：新增 `packages/canvas-core/src/nodes/image/backendImageModels.ts`
  （`BackendImageModelProvider`：数据面拉 /api/models；run 提交 POST /api/tasks 并返回 PollFn 轮询 /api/tasks/:id）。
- 缝扩展：`imageModels.executeRun` 增 `nodeId` 透传，`ImageModelProvider.run(payload, {nodeId})`；ImageNode 发送带上 nodeId。
- 导出：canvas-core index 导出 configureImageModels / BackendImageModelProvider 等。
- 接线：/cloud、/mcp 在 connected && canvasId 时 `setCanvasId + configureImageModels(backend)`；断连回落本地。
- 实测（Chrome，#/mcp，canvas-2026-09-01「图片」节点）：
  - 模型下拉出现后台 5 模型（含 APIMart/ChatGPT/Seedream×3）；选中 APIMart 出现「分辨率」下拉 → 能力来自后台。
  - 点「发送」→ 出现 POST /api/tasks → GET /api/canvases（SSE 全量刷新）→ GET /api/tasks/:id 轮询；
    node.status 确认任务 id、runState error（因后台未带 --web2api）；节点显示错误浮层。链路通、后端无真实生成时合理报错。
- 待后台带 `--web2api` 起，发送即可真出图（进度经 SSE 回画布）。
