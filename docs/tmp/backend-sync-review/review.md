# S5 前端"后台云同步"改动 code review

- 审查范围：`git range 9f1776e..HEAD`
  - `c77767e` feat(canvas-core): BackendSyncPlugin 非侵入云同步插件 + ImageNode 支持后台 data.runState 渲染
  - `a7dfcbc` fix(backend-sync): 云画布自动连接 + 后端节点连线渲染
- 审查文件：BackendSyncPlugin.ts / rest.ts / sse.ts / backend-sync/index.ts、ImageNode.vue、ImageNodePlugin.ts、canvas-core index.ts、CloudCanvasView.vue、router/index.ts
- 审查方式：codegraph MCP 建立索引并检索 + Read 全量读 diff + 一次 `vue-tsc -b --force`（exit 0）
- 规格来源：`docs/plan/ai-backend-plugin-plan.md`（尤其第九节 R1–R11 决策，R2/R4/R5/R6/R7 直接约束本改动）
- 标准来源：仓库无独立 CODING_STANDARDS，参照同类插件范式（`AutoSavePlugin.ts` / `StoragePlugin`）+ `tsconfig.app.json`（noUnusedLocals / noUnusedParameters / erasableSyntaxOnly / noFallthroughCasesInSwitch）+ 领域类型 `types/CanvasNodeData.ts` + Fowler smell 基线

---

## Standards 轴

### 结论概览
- 通过项：类型约束全部满足（`vue-tsc -b --force` exit 0，无 noUnusedLocals/erasableSyntaxOnly 违规）。插件骨架（install 返回 `{api,uninstall}`、externalListeners Map、context.on 订阅并返回解绑、syncControl、`get connected()` 只读访问器）与 AutoSavePlugin 风格高度一致，命名清晰、注释到位，属本仓库的既有范式。
- 违规/疑点：3 条（均 P2，judgement call 居多）。

### 逐条
**[S1 · P2] `data.runState` 契约未落入领域类型 `CanvasNodeData`，ImageNode 内自行 `interface` + 断言**
- 位置：ImageNode.vue:52（本地 `interface ExternalRunState`）、:190（`as ExternalRunState`）、:259；缺失处：`packages/canvas-core/src/types/CanvasNodeData.ts`（BaseCanvasNodeData / ImageNodeData 均无 `runState` 字段）。
- 问题：`runState` 是一个跨「后台 → 插件 → ImageNode」的数据契约，但它只存在于 ImageNode.vue 一个文件里（类型私有），未并入 `CanvasNodeData` 判别联合，也未被插件端复用。ImageNode 靠 `props.data?.runState as ExternalRunState` 绕过类型系统。
- 这是 **Mysterious/未声明契约** 类：契约没有单一权威定义，后续其它节点类型（video/audio）要做同样 read-only runState 渲染时只能复制粘贴这套 interface，未来字段演进（如新增 step/阶段）容易在复制中漂移。
- 对照：仓库对 imageUrl/videoUrl 等跨组件契约都收进 `CanvasNodeData.ts` 并注释用途。runState 未遵循同样做法。
- 修复建议：把 runState 形状提为 `CanvasNodeData` 上的可选字段（`runState?: ExternalRunState`，或按类型收窄），供 ImageNode 与后端插件共享 import；顺带让 sanitize 决策（R2：runState 需保留）在类型上可见。
- (judgement：VueFlow `NodeProps.data` 当前无强类型，故未形成编译错误；非硬性违约，但违背仓库"契约字段集中声明"的惯例。)

**[S2 · P2] SSE 层用 `console.error`，与插件其余用 `context.logger` 不一致**
- 位置：`sse.ts:769`（onerror 内）`console.error('[backend-sync] SSE 连接失败:')`。类 `BackendSse` 无 logger 句柄，fallback 到全局 console。
- 对照：AutoSavePlugin/BackendSyncPlugin 主逻辑一律 `context.logger.error(...)`。SSE 封装若能透传 logger 会更一致；sse.ts 是纯封装类无 context，属可接受的 judgement call，但值得统一。

**[S3 · P2] 大量 `any`（事件负载、rest 返回、API 返回）**
- 位置：BackendSyncPlugin.ts（`changes:any[]`、`applyRemoteEvent(evt:any)`、`emitBus(event,payload:unknown)`、`api.createNode(...): Promise<any>`、`nodeStatus(...): Promise<any>`）；rest.ts `getCanvas():{nodes:any[];edges:any[]}`；sse.ts `node:any`。
- 这是本仓库插件的既有做法（AutoSave 也用 `(...args:any[])`），不算硬违规。但 `applyRemoteEvent` 是整个下行同步的枢纽，`evt:any` 让 switch 分支的字段缺失（如 `evt.node` 未带）无法被编译器捕获 —— 见 Spec 轴 F2/F3。属 judgement call：事件反序列化处用 `any` 可接受，但建议至少在类型层面约束 `BackendEvent`（sse.ts 已定义 union，可让 handler 参数引用它）。

---

## Spec 轴

### 结论概览
- 匹配项（R 决策）：
  - R6：`dependencies:[]`、CloudCanvasView 用 BackendSyncPlugin 取代 storage/auto-save、插件列表去掉二者、`skip-default-load=true`、未加入默认 CanvasView 插件集 —— 全部落实。
  - R2：ImageNode 增加 read-only runState 渲染路径，local executeRun 与外部 runState 双轨并存 —— 结构上落实，见 F4 的互斥缺口。
  - R4：`node:updated` 按事件"单点更新"、data 用 `{...local.data, ...data}` 合并、position 就地更新、不整 reload —— 落实；`batch:done`/`graph:changed` 仅作 reconcile 提示不整 reload（default 分支留空），符合 R7/R9。
  - R5：`applyingRemote` 抑制标志 + 同值/存在性去重（add 前查重、update 前查节点是否存在）—— 落实且严密，见 F1 肯定。
  - R7：SSE 断线 → EventSource 内置重连 → `openHandler(true)` → reconcile 全量 + replaceAll —— 落实。
- 与 Spec 不符或实现偏弱：4 条（P1×1、P2×3），详见下。

### 逐条发现

**[F1 · 肯定项 / 防环严密性] `applyingRemote` 防环 + 存在性去重设计正确**
- 位置：BackendSyncPlugin.ts:117（replaceAll）、:169（applyRemoteEvent）。
- `replaceAll` 和 `applyRemoteEvent` 都在 mutation 前 `applyingRemote=true`、`finally` 复位；上行四类订阅（nodesChange/edgesChange/nodeDragStop/connect）首行都 `if (applyingRemote || !connected) return`。下行动作（addNodes/removeNodes/updateNode/addEdges）若触发本地 change 事件会被上行监听忽略 → 切断了 SSE→本地→上行 的主回环。
- `node:added`/`edge:added`/`node:removed`/`edge:removed` 均先查本地是否存在再动作，是幂等增删。
- ImageNode 侧：runState done → 写 `data.imageUrl` 的 watch 不会回灌后台（上行只监听 nodesChange 的 add/remove/position、nodeDragStop、connect，**不监听纯 data 变更**），`isExternalImageShown` 又挡住了同值重复写 → 无二级回环。
- 结论：防环层面严密，未见漏改/回环。**唯一残余窗口见 F3（SSE 重连后 pending 上行与 reconcile 并发的次序），非防环设计缺陷。**

**[F2 · P1] 刷新/重连后，后台已完成节点（runState=done）图片不显示 —— 违背 S6"刷新不丢"**
- 位置：ImageNode.vue:296-310（watch）。
- 现象：`<img>` 只绑 `data.imageUrl`（ImageNode.vue:348 `:src="data.imageUrl"`）。而把结果从 `runState.imageUrl/urls` "抬升"到顶层 `data.imageUrl` 的逻辑只在 **watch `() => externalRun.value?.status` 且状态"发生 done 转变"** 时执行（:300 `if (status !== 'done') return`，watch 默认非 immediate）。
- 问题场景：后台持久化结果时（按 R2/计划，后台把结果写进 `data.runState`，顶层 imageUrl 由前端 ImageNode 负责抬升）只落 `runState.imageUrl`，**顶层 imageUrl 并不会被前端上传回后台**（上行不监听纯 data 变更）。于是：
  1. 本地新页面 load / SSE 重连 reconcile（`replaceAll`）拉回的后台节点，其 data 里只有 `runState.imageUrl`，没有顶层 imageUrl；
  2. ImageNode 首次挂载时 watch 不 immediate，`status` 初始已是 'done'，没有"转变"，watch 永不触发；
  3. → 已完成的生成节点刷新后 `<img>` 空白，进度/结果丢失，与计划 §6「刷新不丢」直接冲突。
- 修复建议：watch 加 `{ immediate: true }`（或改用一个同时把"已 done"纳入的初始化归一逻辑），让挂载即已 done 的节点也被抬升 imageUrl；或模板/指示器直接以 `runState.imageUrl` 作为兜底展示源。需在 S6 e2e「刷新不丢」用例里覆盖"已完成节点刷新仍出图"。

**[F3 · P2] `flushNow` 先清 pending 再 await，失败即丢改动（与日志文案矛盾）**
- 位置：BackendSyncPlugin.ts:238-253（尤其 :243 清空在 :246/:249 `await` 之前；catch :251-253 只打日志）。
- 问题：catch 注释/日志写"数据仅本地保留，稍后重试"，但 pending 五个容器在发起请求前已被 `.clear()`。若 `rest.batchNodes`/`batchEdges` 抛错（后台掉线、400/500），本次改动已从 pending 蒸发，且没有任何重试或重新入队 → **上行静默丢失**（本地 VueFlow 还在，但不会再被 flush）。计划 R9/§风险 2 期望"上行失败可重试"。
- 严重度 P2：网络/后台短暂不可用时才触发，且下次 reconcile/手动改动不会自动补偿；配合 F2 的"只信任后台"会造成双端不一致。
- 修复建议：仅成功后清空对应分片；或 catch 里把快照回填 pending（注意去重）。同时把 batchNodes 与 batchEdges 的失败独立处理，避免 nodes 成功但 edges 失败时把 nodes 也回滚重发。

**[F4 · P2] add 后再 remove 同一节点（防抖窗口内）→ 上行同时发 add+delete，后台按 delete→add 排序产生幽灵节点**
- 位置：BackendSyncPlugin.ts:272（nodeAdd.set）、:275（nodeRemove.add）；flushNow :238-242 同时取 nodeAdd 与 nodeRemove。
- 问题：`pending.nodeAdd` 与 `pending.nodeRemove` 是两个独立容器，remove 分支不清空 nodeAdd。用户在防抖窗口内"新建节点又删除"（或历史回放/批量脚本先 add 后 remove），flush 会同时产出 `{add:[A], delete:[A]}`。R9 定义后台执行序 delete→add → A 先被删（本地尚不存在，通常无害）再被 add → **A 以幽灵节点重生**，并经 SSE 回播出现在前端（已被用户删除的节点复活）。
- 修复建议：remove 分支里同时 `pending.nodeAdd.delete(id)`、`pending.nodePos.delete(id)`；或 flushNow 前把交集从 add/pos 剔除（以 delete 为准）。

**[F5 · P2] 本地 executeRun 与外部 runState 的"互斥展示"有缺口：本地发送不先清除外部 error 态**
- 位置：ImageNode.vue:225（`runGeneration` 仅 `if (isRunning.value) return`，不清 data.runState）、:226-233（本地状态）、:75/:69（showRunIndicator/hasExternalRun 外部优先）、:80（indicatorIsExternal）。
- 问题：若某节点挂着后台 runState.error（hasExternalRun=true → indicatorIsExternal=true），用户对该节点点本地"发送"：`runGeneration` 启动本地 executeRun 并把 runStatus 置 running，但**不清除 data.runState** → hasExternalRun 仍 true → indicatorRunning 仍取 external（:82 `externalRun.status==='running'`? 否，是 'error'）→ 指示器继续显示外部 error，本地新一轮 running 进度被"外部优先"遮住，直到本轮 done/error 才切换。双轨互斥只在"展示层二选一"，未在"触发层"互斥。
- 修复建议：`runGeneration` 起始处若 `hasExternalRun` 则先 `updateNode` 清掉 runState（与 resetRun 同法）；或干脆禁止在外部任务态下本地发送。本地重置走 resetRun 已能清 runState（:188-192），但 send 路径没走 resetRun。

---

## 是否符合 / 汇总

### Standards
- 符合项：类型约束（noUnusedLocals/erasableSyntaxOnly/noUnusedParameters）、Vue 组合式写法、插件结构、代码注释质量。一次 `vue-tsc -b --force` 通过。
- 主要保留项：`data.runState` 契约未收进 `CanvasNodeData.ts`（P2，跨文件契约无权威定义）；sse 用 console.error、事件/rest 大量 any（P2，均 judgement call）。
- Standards 轴最差项：无 P0/P1，仅 P2（runState 契约落位 + 类型收窄）。

### Spec
- 符合项：R2/R4/R5/R6/R7 主体实现均到位；防环设计与幂等增删严密（F1）。
- 不符/缺口：F2（P1，刷新/重连后已完成节点不出图，违 S6"刷新不丢"）；F3（上行失败静默丢改动，P2）；F4（add+remove 幽灵节点，P2）；F5（本地/外部运行互斥在触发层有缺口，P2）。
- Spec 轴最差项：F2 —— P1。

> 注：两轴刻意不互相合排名次，结论按轴各自给出。F2 同时在 Standards（runState 契约未落类型，导致抬升逻辑只能靠运行时 watch）与 Spec（刷新不丢）两侧有体现，已分别列出。

## 改进建议（按优先级）
1. [P1·F2] ImageNode runState→imageUrl 抬升加 `immediate:true` 或挂载即处理 done；S6 e2e 补"已完成节点刷新仍出图"。
2. [P2·F3] flushNow 仅在成功后清空 pending / 失败回填，纠正"失败即丢"。
3. [P2·F4] remove 分支同步清除 nodeAdd/nodePos，避免 add+delete 并发幽灵。
4. [P2·F5] runGeneration 起始清 runState，保证本地/外部运行互斥在触发层成立。
5. [P2·S1] 把 ExternalRunState 收进 `CanvasNodeData.ts` 供 ImageNode 与插件共享；sse.ts 透传 logger。
