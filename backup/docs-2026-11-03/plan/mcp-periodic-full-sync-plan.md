# Cloud 画布同步改"定时全量推送"计划

日期：2026-09-04 · 分支：代码优化 · 目标视图：`#/cloud`（CloudCanvasView + BackendSyncPlugin，用户拍板）
间隔：3 秒一轮全量同步。

## 一、用户诉求（本轮原话 + 拍板）

> 能不能做成几秒钟同步一下的效果就行了呀？几秒钟一轮，执行全部同步；关闭画布、切换画布的时候先同步一次。

用户拍板：**只改 `/cloud`**，**3 秒一轮**。

## 二、现状与根因（源码 + Chrome 定论）

`#/cloud` 用 `BackendSyncPlugin`（`packages/canvas-core/src/plugins/backend-sync/`），自动保存靠**事件级增量**：
- 上行只监听 `nodesChange`(add/remove/position)、`edgesChange`(remove)、`nodeDragStop`、`connect`，把它们塞进 `pending`，防抖 400ms 后 `flushNow()` 走 `rest.batchNodes/batchEdges`。
- **致命缺口**：ImageNode/ImageBottomToolbar 改 `data.options`（prompt/模型）、设图片 `data.imageUrl` 走的是 VueFlow `updateNode(id, {data})`，**不会触发 nodesChange** → 这些 data 改动永远不上行。
- flush 的 update 只带 `position`（`pending.nodePos`），没有 data 通道。

结论：`/cloud` 对"工具栏配置 / 图片设置"这类 data 改动完全不自动保存，正是用户报的问题。用户建议的"定时全量推送"（整画布含 data 每 3 秒推一次 + 离开/切换补推）正好覆盖——不依赖具体事件，把含 options/imageUrl 的整节点推给后台。

## 三、改动方案（在 BackendSyncPlugin 内加"定时全量推送"）

原则：**保留**现有事件增量（添加/删除/拖拽/连线即时性好），**新增**一条"定时全量 data 同步"补上 data 缺口；不加事件总线新事件、不引入复杂 data 监听。

### 1. BackendSyncPlugin 加定时全量推送
- 新增配置 `fullSyncMs?: number`（默认 3000，3 秒一轮）。
- 连上且选了画布后，启动 `setInterval(fullSyncTick, fullSyncMs)`；断开/卸载时 `clearInterval`。
- 每轮做一次"全量 data 对齐"：
  - 取本地当前所有节点 `actions.getNodes()`，对**每个节点**算一个"同步指纹" = `JSON.stringify({ position, data })`（data 先做上行归一：去 `selected` 等运行时字段、去本地 blob/相对 URL 脏值可另议）。
  - 与"上次已成功推送的节点指纹"比对，**只 diff 出有变化的节点**，走现有 `rest.batchNodes(update: [{ id, patch:{ data } }])`（后端 updateNode 对 data 是浅合并 `{...old,...patch.data}`，故 patch.data 传该节点整份 data 即可，options/imageUrl 这类顶层 key 会完整覆盖）。
  - **防止下行覆盖回滚**：仅同步由"本地改动导致"的变化。做法：记录"上次从后台应用下来的 data 快照"，指纹比对的基准是本地当前 data vs 上次下行写进本地的 data，二者不一致才上行——避免后台任务写回 runState 又被本地"误当本地改动"推回去。
    - 更简单的等价实现：下行 `applyRemoteEvent` / `replaceAll` 应用后，把该节点此刻的本地 data（含绝对化 URL）记为 `serverDataCache[id]`；定时 tick 用"本地现 data 归一后"与 `serverDataCache[id]` 比对，diff 出的字段才批到后台并更新 cache。
  - 添加/删除/拖拽仍走现有事件路径；定时 tick 只负责 data/options 这类事件路径收不到的部分。
- 失败静默（下次 tick 自然重试），不弹错不丢。

### 2. 切画布 / 卸载前补推一次
- `switchCanvas` / `connect` 切换到新画布前：先 `await` 一轮全量推送（把当前画布本地改动推干净再离开）。
- `disconnect` / `uninstall`：断开前触发一次全量推送（尽力而为）。

### 3. 去重 & 防回环
- 复用现有 `applyingRemote` 抑制：下行 applyRemoteEvent/replaceAll 期间及之后刷新 `serverDataCache`，确保 tick 不会把刚下行回来的 runState 当"本地改动"再推回去（避免前后台死循环）。
- interval 回调带防重叠：上一轮推送未完成则本轮跳过。

## 四、边界与注意
- 只改 `/cloud` 的 `BackendSyncPlugin`；`/mcp` 那套（useMcpClient）本轮不动。
- data 里本地瞬态字段（blob: URL、`_overlay`、maskUrl、大图 dataUrl）需在上行前归一/剔除，避免把超大本地态推给后台；具体按现有 `normalizeNodeForUp` 语义对齐。
- 后端当前未带 `--web2api`，任务 error 属预期，本轮不涉生成链。
- canvas-2026-09-01 是用户真实画布；测试在 `/cloud` 上用，结束复原。

## 五、测试方案
1. app 侧 `node node_modules/vue-tsc/bin/vue-tsc.js -p tsconfig.app.json` exit 0（前端类型）。
2. Chrome `/cloud` 实测（选 canvas-2026-09-01 的"图片"节点）：
   - 改工具栏 prompt / 换模型 → 不点任何保存，**3 秒内**抓包见 POST `/batch-nodes`（带新 options）→ 后台 getCanvas 拉到新 options。
   - 图片节点设图（imageUrl）→ 3 秒内同步到后台。
   - 拖节点 → 仍即时同步（事件路径不回归）。
   - 触发后台写 runState（SSE 下行）→ 本地不把它当"本地改动"推回（无死循环、无多余 POST）。
   - 切画布/刷新 → 离开前有推送。
   - 结束复原测试值。

## 六、改动文件
- `packages/canvas-core/src/plugins/backend-sync/BackendSyncPlugin.ts`（核心：全量指纹 + 定时推送 + 离开补推 + serverDataCache）
- `src/views/CloudCanvasView.vue`（传 `fullSyncMs: 3000` 选项，说明文案）
- 视需要 `packages/canvas-core/src/plugins/backend-sync/rest.ts`（如需给 batch update 加 data 能力——实测现有 batchNodes 已支持 update.patch.data，不必改）
