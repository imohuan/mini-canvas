# 前端 canvas-core 非侵入 BackendSyncPlugin 设计评审

> 评审人：code-developer｜日期：2026-09-04
> 范围：只评**前端插件部分**（plan 的 D6 事件、D7 插件、D3b data 现状、S5/S6）。
> 依据：全部经实读代码核对（见每节「依据」路径），非臆测。不改业务代码，只出结论与修复建议。
> 评审对象：`D:/Code/Git/mini-canvas/docs/plan/ai-backend-plugin-plan.md`

---

## 结论速览（最重要问题）

| # | 问题 | 优先级 |
|---|------|--------|
| 1 | **ImageNode 完全不读 data，progress/result 只活在组件本地 ref**，且成功即复位；plan 说「补一个读 data 渲染落点（复用 NodeRunIndicator）」——但 **NodeRunIndicator 组件不存在**，现成只有 ImageRunIndicator，且它只吃 ref 传入的 props，不读 node.data。非侵入在技术上做不到，必须改 ImageNode.vue | **P0** |
| 2 | **`node:updated` SSE 只带 `{nodeId, patch}`，patch.data 是浅合并片段**；而 VueFlow `updateNode` 的 data 是整对象替换语义（本项目代码到处 `{...旧data}` 手补）。「按 patch 就地 update」直接会把未在 patch 里的字段丢光 | **P0** |
| 3 | **上行=auto-save 全量 / 下行=增量，两套写路径没有来源/来源抑制协调**，且 plan 建议「本端非来源才应用」「字段真变化才 update」在现有事件体系下**无法实现可靠防环**：EventBus 没有本地来源标记，SSE 回播也带不出「是谁写的」 | **P0** |
| 4 | **plan 把 BackendSyncPlugin 依赖写成 `['storage']`「可选弱化」——与现状冲突**：依赖是数组硬逻辑，storage 装了它自动 autoConnect；且 McpCanvasView 已同时装了 StoragePlugin + AutoSavePlugin，会双写 localStorage + 后台 | **P0（连后台入口必现）** |
| 5 | 插件 install 时机：`createContext` 返回的 actions 已绑定 vueFlowInstance，install 里可安全 addNodes/updateNode；**但首次全量 load 不能放 install 同步段，且要处理 skipDefaultLoad** | P1 |
| 6 | VueFlow 运行时 updateNode 重置节点组件内部 ref：不重置（组件常驻），但 ImageNode 的 toolbarConfig 用 ref 只初始化一次，外部改 data.options 靠 watch 同步——需验证新增 data.status 驱动的路径不会与本地 runGeneration 双跑 | P1 |
| 7 | configureImageModels 切换在 plan 里「由插件连接状态决定」，但 executeRun 轮询是**前端在跑**，切到 BackendProvider 后若走「后台已提交任务+SSE」而非 PollFn，会与 ImageNode.runGeneration 本地轮询双重驱动同一节点 | **P0/P1** |
| 8 | hot reload / 重复 install 泄漏：Canvas.vue 卸载走 manager.uninstall（有 uninstall 钩子），但 **SSE EventSource 挂在 window/DOM 上、事件总线订阅若用 `context.on` 返回的 off** 需全部回收；且 EventSource 断线重连无法在页面卸载后被 GC | P1 |

---

## 1. 插件拿 canvasId / actions / vueFlow 的时机 & 现有 actions 够不够

**依据**
- `types.ts` L189-226：`PluginContext` 在 install 时已带 `canvasId`（= `'main-canvas'`，来自 `Canvas.vue` L423）、`actions`（addNodes/removeNodes/updateNode/getNodes/addEdges/removeEdges/updateEdge/…）、`viewport`、`dom`、`getPluginAPI`。
- `PluginContext.ts` L565-604 `createActions`：每个方法内部包 `try/catch` 并直接调 `vf.addNodes(...)`/`vf.updateNode(...)`/`getNodes.value`。即 **install(context) 时 actions 已闭包绑定 vueFlowInstance，install 内可直接 addNodes/updateNode/getNodes**——下行增量同步所需能力齐全。
- `Canvas.vue` L416-437：manager.install 在 `onMounted` 里执行，install 拿到的是完整 context。

**结论**：actions 能力够做「按 nodeId update/add/remove」与「上行全量 save」。计划 D7 可行。
需要补的点：
- **上游本地监听的事件已存在**：`Canvas.vue` L652-659 把 `@nodes-change`/`@edges-change`/`@node-drag-stop`/`@connect` 转发成 eventBus 事件（nodesChange/edgesChange/nodeDragStop/connect）——AutoSavePlugin L92-95 正是这么监听的。**但注意 `nodesChange` 里 Canvas.vue 已在 onNodesChange 过滤了纯拖拽 position change**（L190-196，`isDragPositionChange` 直接 return，不 emit nodesChange），所以**节点拖拽过程中的逐帧位移不会出现在 nodesChange 事件里**，只有 `nodeDragStop` 有最终位置。上行同步必须监听 nodeDragStop（而非 nodesChange）才能拿到拖拽后的最新坐标——plan 已写监听 nodeDragStop，正确，但要在实现里强调不要指望 nodesChange 给拖拽中坐标。
- **remove 只到节点级，边/节点联动删除**：上行按 diff 时，后台删节点会级联删边（GraphModel L145-159），后端 `node:removed` 事件**不会单独再发 `edge:removed`**（是前端 deleteNode 内部循环 emit 到 SSE？见问题 2 说明，注意这导致 SSE 事件不一致）。前端上行要自己处理：本地删一个被边连接的点，需同时上报删边，否则后台残留悬空边。GraphModel.deleteNode 会清理关联边，前端靠 SSE 会收到 node:removed（+可能若干 edge:removed，取决于后端是否转发）；**两端对「删点连带删边」的事件覆盖要拉齐**，否则前端靠 SSE 增量的图上会留下孤儿边。

---

## 2.（P0）SSE `node:updated` 只带 patch 且是浅合并 —— 增量应用会丢字段

**依据**
- `mcp-server/src/graph/GraphModel.ts` L163-179 `updateNode`：`patch.data` 是 `{...old.data, ...patch.data}` 的**浅合并片段**，然后 `emit({ type:'node:updated', nodeId, patch })`——SSE 带出去的还是那个**部分 patch**（不是合并后全量 data）。
- 前端 `PluginContext.ts` createActions 的 updateNode 直接调 `vf.updateNode(id, data)`；本项目调用方（ImageNode.vue L164、ImageNodePlugin L219、StoragePlugin L171、Canvas.vue L228）**一律手写 `{ ...旧data, 新字段 }` 展开**——这是 VueFlow `updateNode(id, {data})` 里 data 是**整对象替换**语义的旁证（他们从不敢只传片段，否则会把 node.data 里没写的字段清掉）。

**风险推演（会返工）**：后台跑任务只改 `data.progress`，SSE 发 `node:updated {nodeId, patch:{data:{progress:42}}}`。前端若照 plan「增量 update」直接 `actions.updateNode(nodeId, patch)`，VueFlow 会把该节点 data 整体替换成只剩 `{progress:42}` → label/options/imageUrl/cardWidth… 全丢 → 图直接崩。
- 同理 `node:updated` 里 `position` 也是片段 `{...old, ...patch.position}` 的局部坐标，前端整 set 没问题（position 整覆盖通常可接受），**data 才是坑**。

**修复建议**
- 前端收到 `node:updated` 时**不能直接用 patch**，要拿本地现有节点 `actions.getNodes()` 找到 id，做 `updateNode(id, { ...该节点, ...patch, data: { ...现data, ...patch.data } })` 的**手工合并**（即「全量重构成完整 node 再 set」）。
- 或后端 SSE 直接广播**合并后的全量 node**（推荐）：D6 把 `node:updated` 的 payload 改成带完整 `node`，前端无脑 `setNodes` 单点替换即可，语义最稳。若保留 patch 广播，前端必须实现字段级合并，并把这条写明进 S5。

---

## 2b.（P0，连后台必现）SSE 事件与前端覆盖不一致 / node:added 形状缺 data 所需字段

**依据**
- GraphModel emit 的事件：`node:added` 带全量 node（L139）、`node:removed` 只带 nodeId（L157）、`node:updated` 带 patch（L176）、`edge:*` 类似。**task 级回写 status/progress 最终都落成 `node:updated`（patch.data）**——即 plan D6 设想的「前端插件按 node:updated 增量 diff 即可无损」依赖这条链路。但正因为事件只带 patch，前端要还原全量就必然回到问题 2 的合并。
- `node:removed` 只带 `nodeId`，前端删点是增量安全；但 `node:added` 的 node.data 里若后端没带齐渲染字段（label/cardWidth/imageUrl 等只在 create_node 语义层补齐），前端 add 出来会是缺字段节点。D4/S4 创建生成节点必须由后端补全 `data` 到与 `createResultNode`/`handleImageAddSource` 相同的字段集（nodeType/label/options/cardWidth/cardHeight/…），否则图渲染坏。

---

## 3.（P0）防死循环的「来源抑制/字段比对」在现有体系里不成立

**依据**
- plan 说「只应用本端非来源变更 / 节点字段真变化才 update / 上行 REST 后 SSE 回播带同字段值本地比对相等跳过」。
- 现实：
  1. **本地事件没有来源标记**：EventBus 里 nodesChange/connect 事件（AutoSavePlugin L92-95）是纯本地变化广播，没有「是否由插件 SSE 应用产生」字段。而**用 `actions.updateNode`/`addNodes` 本身就会触发 VueFlow 的 nodes-change 再广播一次 nodesChange**（Canvas.vue L655）→ 只要上行监听 nodesChange，SSE 应用写回本地 → 再触发 nodesChange → 再上行 → 后台再回播 → 无限循环。
  2. **SSE 回播不带「来源」**：后台 `node:updated` 事件没记录是哪个客户端/操作产生的，前端无法区分「我自己的上行回播」vs「AI/别的客户端改的」。plan 的「本端非来源」无从判定。
  3. 字段比对只能防「同值重复写」这一层，防不住「我拖到 A 位置上报 → 后台回播 position:A → 前端比对发现本地已是 A 跳过」——这条其实是对的；但若比对只做 node 整体、而本地拖拽中多次上报，回播到达次序与本地编辑交错，仍可能覆盖刚改的值（竞态），plan 风险 1 自己也承认。

**修复建议（最小可行模型，写进 S5）**
- **上行与下行共用同一个「脏标记」关口**：上行改用一个独立状态（如 `localEditVersion` 递增），下行 SSE 应用前先判断「该 patch 是否是上行刚发出去的对应回播」——最可靠做法是**上行带 `_clientTag`/version 并在 SSE 应用时比对**；做不到就给下行 SSE 应用也打标记，应用过程中置 `suppressLocal=true`，使上行监听器忽略该次 nodesChange（参考 AutoSavePlugin L36 的 `isHistoryRestoring` 同款抑制开关，现成范式）。
- 具体建议：**下行只处理 `task:*`/由后台任务写回的 `node:updated`（本端没在编辑的目标节点）**，做字段比对（同字段同值 skip）；**上行只监听 nodesChange/connect/nodeDragStop 且在一个 `applyingRemote` 标志为 false 时才 markDirty**。把「SSE 应用」和「本地上行」两段都用 `applyingRemote` 包起来，等于给回播一段安静期，能切断主要回环。**注意：不要靠「本端非来源」这种在现有后端事件里根本取不到的字段。**

---

## 4.（P0）D7 依赖 `['storage']`、McpCanvasView 双写、进默认集与否

**依据**
- `McpCanvasView.vue` L34-40 已同时加载 `AutoSavePlugin` + `StoragePlugin` + 全套，再加 `skipDefaultLoad:true`（L104）。当前 useMcpClient 自己保存（整画布 reload，L69-80、L117-131）与 storage 无关。
- `AutoSavePlugin` `dependencies:['storage']`（L22），install 即 `storage.tryRestore()`（StoragePlugin L549-558 默认 autoConnect）→ **McpCanvasView 当前已经**在 local 落了 storage + auto-save（虽然 UI 没手点保存，auto-save 在页面隐藏也会 flush 到 localStorage）。若连后台后不关掉这两个插件，localStorage + 后台双份权威，刷新恢复哪个存疑。
- plan D8 说「storage/auto-save 仍负责本地，后台为权威，二者并存不冲突」——**这是矛盾**：auto-save 会定时把本地全量写进 localStorage（AutoSavePlugin performSave → storage.saveCanvas），而 storage 又会在 loadInitialCanvas/restore 时把 localStorage 内容灌回 VueFlow（bootstrap.loadInitialCanvas，Canvas.vue L451）。连后台场景会把后台数据又被 local 覆盖回去，产生「刷新后又变回旧 local 快照」。

**修复建议**
- **BackendSyncPlugin 不要依赖 storage**（`dependencies:[]`）。它的「保存归后台」是独立 REST 路径，不需要 storage。plan 里「依赖 storage 可选弱化」在类型上实现不了（dependencies 是 string[]，无「可选」），要么空依赖、要么真去 storage 拿项目 id。
- **连后台入口必须去掉 AutoSavePlugin + StoragePlugin（或禁掉其 autoConnect + auto-save）**：McpCanvasView 用 BackendSyncPlugin 取代 auto-save 作为唯一保存者；`Canvas` 传入的插件列表去掉 storage/auto-save，仍用 `skipDefaultLoad:true`。
- **进默认集 vs 只进 Mcp 入口**：建议 **BackendSyncPlugin 不进 canvas-core 默认插件集、只由连后台的入口（McpCanvasView）显式加载**，与 plan「默认 CanvasView 不引入」一致。且 `Canvas` 组件 props 里无 default 集、完全由调用方 `:plugins` 决定，方案天然成立——只需在 Mcp 入口显式加 BackendSyncPlugin、去掉 storage/auto-save。

---

## 5.（P1）插件 install 与首次 load / skipDefaultLoad 时序

**依据**
- `Canvas.vue` L399-453：manager.install 发生在 onMounted，随后 `if(!props.skipDefaultLoad) bootstrap.loadInitialCanvas()`。MCP 模式设了 skipDefaultLoad=true，所以**不会从 storage/localStorage 灌默认**，画布内容必须由插件 load。
- install 是异步钩子（可 await），但首次全量 load 依赖 VueFlow 已就绪；actions 绑定的是 vueFlowInstance（闭包已存在），install 里同步 addNodes 通常可用，但**从后台 fetch 全量是异步的**，建议放到 `activate()`（生命周期见 types.ts L185 `activate?`）或 install 内的 `void` 异步段 + ready 后再塞节点，避免竞态。

**建议**：把「首次全量 load」设计成 install 里的异步步骤并在 onMounted 之后执行（或直接走 activate），且用 actions.setNodes 不行——**context.actions 没有 setNodes/setEdges**（types.ts CanvasActions 只有 add/remove/update）。首次全量替换画布（要清掉旧图）需要 `removeNodes(getAllNodes ids)` + `addNodes`，或经 viewport/其它入口拿 raw vueFlowInstance.setNodes。**S5 要补一个「整体替换」能力**，否则 loadOnConnect 只能 add 叠加、切画布时清不干净。

---

## 6.（P1）ImageNode 完全不自 data 渲染进度/结果；且 NodeRunIndicator 不存在 → 「非侵入」前提不成立

**依据（重点，直接否定 D3b 的乐观表述）**
- `research.md` §1.3 / §8 已核实：**image node 的 data 无 status/progress/result 字段**，运行态只在 `ImageNode.vue` 本地 ref（runStatus/runProgress/runError，L173-177）。
- `ImageNode.vue`：
  - L200-238 `runGeneration`：成功后 `runStatus.value='idle'`（立即复位），**不 updateNode 写回 data**；失败置 error + notify；urls 只进 `notifySuccess`（toast）。
  - 渲染 L327-333：`ImageRunIndicator :running="isRunning" :progress="runProgress"`——**ImageRunIndicator 吃的是 props 传入的 ref，不读 node.data.status**。
- `ImageRunIndicator.vue` 实读：props 只有 running/progress/error/percent，模板只按 props 渲。**没有任何组件读 `node.data.status/progress/result`**。
- 全工程 `grep NodeRunIndicator` = **0 命中**（含 canvas-core 与 app src）。plan D3b/L134 说「NodeRunIndicator 等已有组件可复用」——**该组件不存在**，这是 plan 的硬错误。现成可复用的只有 `ImageRunIndicator.vue`（已用）+ `NodeToolbar.vue`（定位浮层）。
- 关键推论：**「后台写 node.data.progress/result → 前端节点自动显进度/出图」在 ImageNode 零改动下不会发生**。ImageNode 既不读 data.status，结果也不写 data.imageUrl。

**修复建议（最小改动落点，避免破坏本地 mock provider 交互）**
1. 新增 data 字段命名约定（与后端对齐）写入 sanitize 白名单：建议 `data.runState = {status:'running'|'done'|'error', progress?, message?, resultUrl?|imageUrl, error?}`（单对象，便于浅合并与比对，避免多个并列字段竞态）。
2. **ImageNode.vue 增加一个「读 data.runState」的并行渲染态**，与现有本地 runStatus 互斥且后者优先：
   - 新增 computed：`externalRun = props.data?.runState`；本地 `isRunning`/`runStatus` 只反映「本地/工具栏发起的 executeRun」。
   - 模板 NodeToolbar 的显示条件扩成 `showRunIndicator || isExternalRunning || isExternalError`，浮层数据源在「本地 ref」与「data.runState」二选一。
   - 这样**本地 mock provider 交互（用户点发送 → executeRun → 本地 ref）完全不动**；外部后台 SSE 写 `data.runState` 时走另一条只读渲染路径，二者不打架。改动范围集中在 ImageNode.vue + 一个可复用 indicator（可新建泛化 `NodeRunIndicator.vue` 或继续用 ImageRunIndicator，但传入参数改成可从 data 读取）。
3. **结果写图落点**：后台 done 时把 `data.imageUrl/imageName/imageWidth/imageHeight` 写全（对齐 handleImageUpload L219-229 就地写图范式），或按 createResultNode 建下游节点——两者都已被现有代码验证，ImageNode 无需为此改渲染（img 标签直接吃 data.imageUrl，L274-280）。**不要只写 result 字段**，要让 `data.imageUrl` 真的指向可渲染 url。

---

## 7.（P0/P1）configureImageModels(BackendProvider) 与本地轮询双重驱动

**依据**
- `imageModels.ts` L279-327：LOCAL provider run 返回 PollFn，前端 `executeRun`（L415-447）在**前端浏览器**里每 interval 轮询。UI（ImageNode）把 executeRun 当唯一驱动。
- research §8：`configureImageModels` 目前**零调用点**，是预留端口。
- plan D7.6 想「configureImageModels(BackendProvider)：把图片节点发送从本地 mock 切到后台（后台建生成节点+提交任务+SSE 回进度）」。

**坑**
- 若 BackendProvider.run 只是把一次发送转成「后台 create_node+轮询」并返回 PollFn，executeRun 就会在前端继续轮询（多一个 650ms 定时器），同时后台 SSE 又在写 `data.runState` → 同一节点两个进度源。executeRun 轮询超时 120s 若后台任务超长，前端先判超时失败（ImageNode 置 error），但后台仍跑 → 双状态错乱。
- 且用户真正点「发送」时，ImageNode.runGeneration 是本地发起 executeRun；而 AI 端是后台 create_node 建的节点，前端 ImageNode 并不会为它跑 executeRun——两种来源必须走两套语义。

**修复建议**
- **收窄 scope**：connect 后台且节点有后台任务时，**ImageNode 的本地 executeRun 轮询应短路径化**：BackendProvider.run 尽量「同步提交即返回 done/或极短轮询」把轮询主导权交给后台 SSE，或提供配置让 executeRun 只发一次提交不再本地 650ms 长轮询。
- 明确双路径互斥：**用户本地点发送走 executeRun（PollFn→SSE 驱动）**，**AI 建节点走 BackendSyncPlugin 收 SSE 写 runState**；二者在 ImageNode 用问题 6 的互斥渲染化解。ImageBottomToolbar 依赖的是统一函数接口（getModel/listModelOptions/…），确实零改动成立（research §8），但「发送=本地 executeRun」这条**留在 ImageNode**，切 provider 只是换 run 后端，ImageNode 本身不换渲染来源的话仍靠本地 ref + executeRun。**要么接受「进度走本地 executeRun 轮询（后端 run 内部轮询后台任务）」，要么接受「进度走 data.runState（改 ImageNode 渲染）」——二选一，别两头都做。**

---

## 8.（P1）hot reload / 重复 install 泄漏与 EventSource 生命周期

**依据**
- `Canvas.vue` onUnmounted（L607-631）会按加载顺序**逆序 manager.uninstall**，每个插件若有 `uninstall` 会被调用（AutoSavePlugin L129-145 是范本：清 timer、removeEventListener、off 所有 eventBus）。所以插件重复 install 时，**上一份 canvas 已卸载**——真正风险不在「同页重复 install」，而在：热重载（HMR）会重新执行 `Canvas.vue` setup / `useMcpClient`，此时上一个 VueFlow 实例的 useVueFlow('main-canvas') 若未随旧组件卸载而释放，可能产生**两个并存 canvasId='main-canvas' 实例 / 两个 SSE 连接 / 两个 useVueFlow 状态**。
- `useMcpClient.ts` L153-155 只在 onUnmounted 关 eventSource；若 McpCanvasView 组件没被 Vue 卸载就 HMR 重挂，旧 eventSource 不会 close（泄漏一个常驻连接）。
- 计划文件放 canvas-core 内时，**SSE EventSource 是全局对象**（非 Vue 响应式），uninstall 若不主动 close，即使插件对象被替换也关不掉旧 socket。

**修复建议（S5 明确写进实现）**
- BackendSyncPlugin 把「连接/事件源/监听器」生命周期都收进 uninstall：`install` 返回 `{api, uninstall}`，uninstall 里 `eventSource?.close()`、清空节流 timer、`context.on` 返回的 off 逐个调（AutoSavePlugin L133-142 就是现成正确范本）、移除 window/document/visibilitychange 监听。
- EventSource 封装（sse.ts）做成**幂等单连接**：`connect` 前先 close 旧的；提供 `reconnect` 与 `close`；并把 canvasId 过滤做进实例。**约定 HMR/重挂必须先走 onUnmounted → manager.uninstall**，插件侧不要依赖外部。
- sse.ts 的断线重连：EventSource 自带重连（useMcpClient L63-65 注释），但要用 canvasId 过滤（收到非当前 canvas 事件丢弃），并在插件 deactivate/uninstall 时真正 close，避免「断线重连的 EventSource 在页面后台无限重连」。

---

## 附：S5/S6 需在实现前补明确的决策项（避免返工）

1. **SSE `node:updated` 是否改广播全量 node**：强烈建议 D6 同时把 node:updated payload 扩成含完整 `node`（最省前端合并）；否则前端做字段级合并且必须逐条测试。→ P0 决定。
2. **data 里运行态字段的最终命名与 sanitize 白名单**：定 `runState`（或 status/progress/result 并列），并把它加进 storage `sanitizeForSave` 的保留字段（现在 RUNTIME 只 strip `_overlay` 等，`options` 保留——research §7；**若用并列 progress/status 字段默认会被 sanitize 保留？需确认，不能丢**）。→ P1。
3. **本地上行的节流粒度**：auto-save 全量快照（200ms+ 防抖）对后台 batch 也 OK，但连后台画布可能大；要定是「全量 toObject 上报」还是「本地收集 diff（nodesChange 里带 change 对象）上报 batch」。建议首版用**全量 save**（useMcpClient L122 已有 `vf.toObject()` 现成范式），第二版再优化成 diff——避免首版就为 diff 的复杂来源标记买单。→ P1。
4. **前端首版验收门槛（S6）**：Chrome MCP 里拖拽一个节点，观察是否出现「SSE 回播覆盖正在拖的手」的抖动；这是「无损无感」的核心验收，计划 S6 已有此测试，务必列为**必过**项。

---

*本评审不修改任何业务代码；仅出结论，供 S5/S6 前修正 plan 用。*
