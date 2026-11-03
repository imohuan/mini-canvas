# Spec 轴 code review — commit 2e0ce0e（视口持久化与启动恢复）

审查范围：只评"改动是否实现最终意图、有无边界漏洞、逻辑是否自洽"，不评风格。
核实的代码：`CanvasHost.vue`、`CanvasSurface.vue`、`viewportService.ts`、`createMiniCanvasHost.ts`、`SaveService.ts`、`localStorageAdapter.ts`、`keys.ts`，以及 commit 前后差异、Vue 3.5.38 调度器源码（判定挂载时序）。

## 总评

改动**达成了用户最终意图**：把视口(zoom+平移)像 nodes/edges 一样持久化、启动时恢复上次停位、仅首次(无存档)才 fitView 居中——实现路径正确，且在 Vue 3.5 的挂载时序下 restore/fitView 能可靠地在视口 backend attach 之后执行，未发现会让"恢复被丢弃"的竞态。整体干净，少数是低危边界。

---

## 逐条问题

### 1. [M] `fitViewFirstRun` 重试期间用户先动过视口，`initial` 快照已过期 → 结果不可预期
文件：`packages/canvas-render/src/host/CanvasHost.vue:306-325`

- 场景：首启无存档 → 走 fitView 基线。`initial` 在函数入口一次性快照（通常 `(0,0,1)`）。前几次 attempt 因节点首帧未量测（dimensions=0）fitView no-op 而重试，重试序列 80/150/300/600/1000ms 跨度约 2 秒。若用户在量测就绪前就开始平移/缩放：
  - 一旦某次 attempt 的 fitView 真正位移（节点已量测），它拿当前 `v` 与**过期的 `initial`** 比较判 `moved=true`，于是把这次 fitView（把用户刚挪走的位置再拽回并居中）当成"基线"落盘——用户挪的位置被强制改回居中；
  - 或者：若该 attempt 的 fitView 仍 no-op（节点仍没量测），fitView 不改视口，`v` 已是用户新位置，与 `initial` 差>0.5 → 误判"已移动"，把**用户当前视口**当基线保存并提前停止重试（此时若节点根本没量测，将永远不 fitView，且把用户随手位置当基线）。
- 复现推理：首次冷启动在节点自适应量测前（<1 秒）内用户快速拖动画布，行为不确定。
- 建议：重试成功判据不应与入口处固定 `initial` 比较，而应与"上一次 attempt 前"的视口比较（每次 attempt 记录前后差异），或给首次 fitView 加"量测就绪前不响应用户位移竞争"的窗口判定。属低概率 UX 竞态，非主路径缺陷。

### 2. [L] `stopViewportRestore?.()` 在 watch 内一处省略与潜在重复调用
文件：`CanvasHost.vue:337-345`、`997-1006`

- watch 回调首行 `stopViewportRestore?.()` 停止自己，实现 one-shot。逻辑自洽，`onBeforeUnmount` 再调一次是幂等兜底。无实质问题，仅确认：回调未用 `{ once: true }` 而是手动 stop + 每次触发都会把自己停掉并清 `viewportTimers`——若某次触发因 `!hostRef`/`!persistViewport` 提前 return（未 stop），后续 surfaceRef 再次变化会重复进入恢复分支。但 surfaceRef 只在 CanvasSurface 首次挂载时 undefined→instance 变化一次，不会再次触发；**此分支在正常流程中不可达**，仅当 host 未就绪的异常态才可能。低危，可不改。

### 3. [L] 单全局 key（`canvas:graph-viewport`）无实例作用域：同页多宿主共用同一 adapter 会互相覆盖
文件：`keys.ts:19`、`CanvasHost.vue:317,334,945`

- 存储物理 key 恒为 `canvas:graph-viewport`，不带 host/实例作用域。这与 `graph`/`graph-edges` 的既有做法一致（`createMiniCanvasHost.ts:207-209` 也写死 `canvas:graph`）。当前仓库真实宿主（`packages/ui/src/App.vue`、`plugin-theme-default/demo-web`）均为**单 CanvasHost**，故不触发。
- 但 `persistViewport` **默认 true** 意味着此后**所有**用 `LocalStorageAdapter` 的宿主都会读写同一 viewport key：一旦未来出现"同页两个 CanvasHost 共享一个 adapter"的布局（多画布对比页），B 的 move-end 会覆盖 A 的视口、A 下次刷新会恢复到 B 的位置。nodes/edges 早已有此撞车，因此这是沿用旧习、非本 commit 新引入的回归，但默认开会在不经意间放大影响面。建议至少在文档/注释标注"同一存储命名空间内单实例"，或后续做 pid/实例级 key 时一并处理 viewport。

### 4. [L] epoch bump 重挂 VueFlow 后视口被重置为原点且不再恢复
文件：`CanvasHost.vue:339-340`、`CanvasSurface.vue:263`

- 插件热装/热卸/主题 occupant 变更 → `nodeEpoch++` → VueFlow `:key` 变化 → 内层 VueFlow **整个重挂**，其内部 viewport 复位到默认(0,0,1)。本 commit 注释"重挂不应再动视口"成立（watcher 不触发、不主动改视口），但 VueFlow 自身的重挂**本身就会把视口打回原点**，而 one-shot 设计使这里**不会**再用已落盘的 viewport 恢复一次。
- 影响：运行期热装/热卸插件（开发期常见）后画布跳到左上角，需用户再手动挪回；不涉及刷新主路径。
- 建议：不必本 commit 处理，但"one-shot 只在首帧恢复"与"VueFlow 重挂会复位视口"存在张力，值得在 epoch bump 处对"有存档"宿主补一次 `setViewport(最近落盘值)`（或确认这是可接受的既有限制）。

---

## 验证过的点（有依据）

- **启动恢复时序安全（关键，无竞态）**：CanvasSurface 的 `viewport.attachBackend` 在子组件 `onMounted` 执行；而父级对子组件的 template ref（`surfaceRef`）赋值在 Vue 3.5 是**延迟到 post-flush**（`runtime-core.cjs.js` setRef `queuePostRenderEffect(job, id=-1)`），父级 `watch(surfaceRef)` 因而排在**下一次** flush 才跑。核对了 `@vue/runtime-core@3.5.38` 的 `flushJobs`/`flushPostFlushCbs`/setRef 实现：顺序 = child onMounted(attachBackend) → 下一 flush 的 watch(restore/fitView)。即 restore 时 backend 必已 attach，`setViewport`/`fitView` 不会因 backend 未挂而 no-op。
- **savedViewport 读盘先于 CanvasSurface 挂载**：boot 里 `await save.get(GRAPH_VIEWPORT_KEY)` → 设 `savedViewport` → 才 `booting=false`（`CanvasHost.vue:942-950`）。CanvasSurface 的 v-else 挂载发生在 booting=false 之后，故恢复逻辑取 `savedViewport` 时必已就绪，无读-挂竞态。
- **save.set/get 的 key round-trip 一致**：onMoveEnd 用 `surface.getViewport()` 写（值与 VueFlow viewport 同空间），恢复用同一值喂 `setViewport`，往返一致，无坐标空间错配。
- **setViewport 恢复不依赖节点量测**：恢复是绝对定位，量测晚到不覆盖恢复值；只有 fitView 依赖量测，故重试设计针对 fitView 是合理命中。
- **刷新丢失最后一步**：move-end 写 viewport 与 node/edge 提交走同一 `save.set` 防抖+`pagehide`/`visibilitychange` flush（`CanvasHost.vue:939-940,958-975`），与图数据持久化机制完全一致，视口不比图数据更容易丢。
- **迁移场景合理**：老版本只存 `canvas:graph`/`canvas:graph-edges` 无 viewport → `get` 返回 undefined → 走 fitView 基线对恢复的图居中，符合预期。
- **空图/删光节点**：无存档+空图 → fitView no-op → 重试 5 次有界、不卡死、不写坏状态；有存档+空图 → setViewport 恢复上次空白平移，均安全。
- **fitView 基线只写一次、不反复**：成功即 return，重试有界；unmount 清定时器 + attempt 内 hostRef 判空双保险。
- 恢复路径不触发 move-end → 不重复落盘基线。

## 未验证的假设

- 未在真实 DOM 里跑通一遍（仓库测试环境为 `environment: 'node'`、无 happy-dom/jsdom），挂载时序结论基于对 Vue 3.5.38 运行时调度器源码的静态核对，非实测。
- VueFlow 内层对 `setViewport`/`fitView` 在"key 重挂复位视口"与"restore 时视口已就绪"上的具体边界未跑端到端验证。
- 多宿主同 adapter 撞车为推断，仓库当前无此类消费方可实测。
