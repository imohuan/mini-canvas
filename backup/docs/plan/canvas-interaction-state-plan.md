# canvas 交互状态（Interaction State）落地 PLAN

> 目标：让"画布此刻在干什么"成为**可读、可订阅、可扩展**的共享状态 + 事件，
> 供 render 库内部与 theme 插件（BaseNode/MovingHandle 等）响应式消费。
> 需求方共识：**不是单一 enum 开关切换**，而是**多个响应式属性的组合**（手势可叠加：
> 拖线同时 hover 目标、拖节点同时掠过另一节点……），并附各自对象/上下文。
> 坐标统一用 flow（画布）坐标（沿用 connectionContext 的约定）。

## 一、现状（为什么缺）

- ctx 事件总线现成（cordis 式 `ctx.on/emit` + `Events`/`CanvasEventMap` 声明合并），
  内置只有 4 个内核生命周期事件，**画布交互事件 0 个**。
- render 层只有"拖线连接"被建模成 `connectionState`（CanvasHost 维护、CanvasSurface provide、
  BaseNode/ConnectionLine 消费）。它很专门：只服务连线 hover/压制/反馈。
- 节点拖拽只有 `nodeDragStop`；**画布 pan、缩放、edge 拖拽、框选/多选都没暴露**；
  全部事件在 CanvasHost 内部消化成"落盘/建边/选中"，从未 `ctx.emit` 广播，也无共享状态。
- VueFlow 1.48 已提供全部所需原始事件：`nodeDragStart/nodeDrag/nodeDragStop`、
  `moveStart/move/moveEnd`（pan+zoom）、`selectionStart/selectionEnd`、
  `connect-start/connect-end`。

## 二、新增一层：`CanvasInteraction`（render 库，契约 + 状态工厂）

放 `packages/canvas-render/src/contracts/interactionContext.ts`（类型/契约 + 工厂纯函数，
仿 connectionState.ts 可单测）。不替 connectionState 背连线 hover——新状态只管
connectionState 之外的"手势/活动"，并同时暴露派生位供 UI 一把读。

### 状态形状（多属性组合）

```ts
interface CanvasInteractionState {
  // —— 每类"正在进行的活动"，布尔可叠加，附指向对象 ——
  activity: {
    /** 正在拖动节点 */
    nodeDragging: boolean
    nodeDragId: string | null
    /** 画布视图在动(pan 或 wheel/pinch 缩放——VueFlow 同一套 move 事件，A 决策不拆位) */
    paneDragging: boolean
    /** 正在缩放(wheel/pinch；A 决策下暂不驱动，保留给未来需细分缩放手势的场景) */
    zooming: boolean
    /** 正在重连一条边(edge 拖拽；当前无此交互，先占位未来) */
    edgeDragging: boolean
    edgeDragId: string | null
    /** 正在框选/多选(selectionStart..End；占位未来) */
    selecting: boolean
  }
  // —— 派生便捷读(computed，供 UI/主题一把读) ——
  // isAnyNodeDragging / isPanning / isZooming / isConnecting(转发 connectionState)
  // isAnyDragging / isBusy
}

function createInteractionState(): CanvasInteractionState
function updateInteraction(state, patch): void   // 局部分片写入，保留其它位
```

### 事件（ctx.emit 广播，命令流 —— 本 PLAN 的下一步 B，可拆分另开）

- `canvas/interaction:change`：状态任何活动位变化广播一次（含进/出），payload=活动位快照。
- 手势全程事件(带上下文)：`canvas/node:drag-start|drag|drag-end`、
  `canvas/viewport:move-start|move|move-end`（pan 与 wheel/pinch 缩放同源，均经 VueFlow 同一套 move
  事件；**A 决策：不拆位**——视图在动统一置 paneDragging(计入 isBusyDragging 压端口)，zooming 位保留
  给未来需细分"缩放手势"的场景）、`canvas/viewport:zoom`、`canvas/selection:change`。
- 规矩：状态供渲染读(响应式)，事件供插件做副作用；move 类一律 rAF 节流 + 变化比对，
  事件绝不写响应式状态（防 Maximum recursive updates）。【B 拆分，先不做】

## 三、接入点（canvas-render）

1. `CanvasHost.vue`：`createInteractionState()` 一份；新增 handler
   `onNodeDragStart/onNodeDrag/onNodeDragStop`、`onMoveStart/onMoveEnd`（onMove 无需逐帧驱动——
   move 事件高频，只在 start 置位 / end 清位即可，配合 rAF 已由 VueFlow 内部节流），
   局部 `updateInteraction` 填活动位；连线仍走现有 connectionState（不重复）。
2. `CanvasSurface.vue`：props 增这批回调，`<VueFlow>` 绑 `@node-drag-*`/`@move-*`；
   把 `interaction` 塞进 `RENDER_CONTEXT`（renderContext.ts 加字段）。
3. `theme-default` BaseNode/MovingHandle：端口显隐规则加"交互进行中不显示加号"。

## 四、theme 消费（本次要解决的可见需求）

BaseNode `shouldShowHandles` 当前 `= !lowDetail && !suppressHandles && !isCurrentConnectingNode
&& (isHovered || selected)`。**拖动节点时 isHovered 仍 true → 加号端口照常显示**。
改动：新增条件 `&& !interaction.isBusyDragging`（拖节点/pan/连线期间都不冒端口），
配合 MovingHandle 自身状态机，实现"拖拽时不允许显示这个加号按钮"。

## 五、验证

- `pnpm --filter canvas-render typecheck` 与 `vue-tsc --noEmit`（后者覆盖 .vue 模板内 TS，CanvasHost/
  CanvasSurface/BaseNode 均须过）通过；交互状态工厂配 `__tests__/interactionContext.test.ts`
  （覆盖：叠加、局部分片写、clearActivity 全清、空态默认值）。
- demo 手动验证：hover 显示端口 → 按住拖动节点端口消失 → 松开恢复；拖线期间端口被压不干扰。
- 不破坏现有连线 hover/压制逻辑（connectionState 不动）。
