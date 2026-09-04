# 后端 models 使用情况 + backend-sync 现场测试结论（Chrome 实测）

日期：2026-09-04 · 环境：运行后台 8765（`mcp start --transport sse --port 8765 --dir ./workspace`，**未带 --web2api**），前端 5173。

## 一、用户两个问题

1. `packages/mcp-server/src/models` 前端到底用没用？感觉好多没实现。
2. 用 Chrome 调试 `#/mcp` 测 backend-sync，感觉完全没有效果。

## 二、models 使用情况（代码结论）

- `mcp-server/src/models/` = `types.ts` + `ModelRegistry.ts` + `executors/web2apiRunner.ts`。
  被引用链：`server.ts setupGeneration()`（--web2api 时注册 runner）→ `TaskManager.executeModelRun`（统一驱动 对象/PollFn）→ `mcp/models.list` + REST /api/tasks。
- **web2apiRunner 已实现**（93 行：callTool 提交 + 返回 PollFn 轮询 get-task），web2apiClient 146 行，非空壳。
- **为什么"看起来没实现"**：真实生成必须连 `--web2api` 生成后台。当前运行的后台没带该参数 → 任何生成任务落 `error`（"未配置 web2api 生成后台"）。即：链路通，但没有真实执行器时任务报错，观感像没实现。
- **前端是否用 backend 的 models？→ 没用**。前端图片生成走 `canvas-core/src/nodes/image/imageModels.ts`（本地 `LOCAL_IMAGE_MODEL_PROVIDER` 假执行，返回 PollFn 模拟）。`configureImageModels(provider)` 存在但**没有任何地方用 backend provider 覆盖**。所以 ImageBottomToolbar「发送」目前仍是本地模拟，不转发后台。
  - 前端 ImageNode 已支持"外部后台 runState 只读驱动"（AI/MCP 建节点后经 SSE 的 data.runState 显示进度/结果）——这条"后台 AI 生成 → 前端 UI 显示"的通路是通的、且是设计目标；缺的是把"前端本地发送"切到后台那一步（D5 的 configureImageModels(backendProvider)）。

## 三、backend-sync 实测（Chrome，真实结果）

**backend-sync 插件只挂在 `/cloud`（CloudCanvasView，"云端画布（后台同步）"）。`/mcp` 页用的是另一套 useMcpClient（手动"保存"按钮），根本没装 backend-sync。**

实测（都成功）：
- `/cloud`（BackendSyncPlugin）：后台 `canvas.batch_nodes` 加节点 → 页面**实时出现**（node:added 下行）；后台删节点 → 页面实时消失。SSE 订阅、applyRemoteEvent、addNodes 链路 OK。
- `/mcp`（useMcpClient）：后台加节点 → 页面也实时出现（它靠 SSE 全量 reload）。
- 上行自动保存：/cloud 插件 `nodesChange/nodeDragStop → scheduleFlush → batch up`（测试中后端节点坐标被前端 fitView 改动自动回写，间接证明上行自动保存生效）。

**"完全没有效果"的最可能原因（按概率）**：
1. 在 `/mcp` 上测，但 backend-sync 在 `/cloud`，/mcp 没有自动保存（拖了不自动存、要手动点"保存"）。→ 最可能。
2. 画布不一致：在 A 画布建节点/发请求，页面当前停 B 画布（后台按 canvasId 过滤，属于正常行为，但观感像不生效）。
3. 后端未带 --web2api：AI 走 create_node 生成 → 任务 error，没有进度/出图，观感像没实现。

## 四、排查时发现的附带问题（供后续决定，非本轮改）

- `/mcp`(useMcpClient) 与 `/cloud`(BackendSyncPlugin) 两套并存，且共用 VueFlow `main-canvas`，SPA 内 hash 路由切换可能残留 EventSource/插件实例，造成跨画布状态串扰（本轮测试多次遇到"页面显示 A 画布却收到/漏收 B 画布事件"的困惑）。建议后续收敛成一套（backend-sync），/mcp 页改造为后端插件驱动，避免两套机制打架。
- "只渲染可见"开启时，DOM 节点数 ≠ 后台节点数（屏外节点不渲染），易误判"没同步"。

## 五、我的清理
- 测试中向 auto-1788184120283 与 canvas-2026-09-01 加的临时节点均已删除；两画布已恢复 2 / 3 节点。
- canvas-2026-09-01 节点坐标曾被我 fitView/自动保存改动，已按前端记忆布局（localStorage canvas-ai:project:default）回写恢复。
