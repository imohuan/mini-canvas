# CanvasRenderContext 现状盘点 + 补齐方案（对照 index.ts interactionContext）

> 目的：先跟用户对齐"render 数据面现状 vs 插件(尤其 multi-select 自绘框选/SelectionFrame)需要"，
> 确认补齐项后再动 render 层。分层铁律：render 只做数据/能力，交互决策/UI 归插件，零耦合。

## 一、用户指的"状态"= index.ts 的 interactionContext

index.ts 导出了 interactionContext 全套：createInteractionState / updateActivity / clearActivity /
beginNodeDrag / endNodeDrag / beginViewportMove / endViewportMove + 类型 CanvasInteractionState。

它建模"画布此刻在干什么"：activity 多面旗子(nodeDragging/paneDragging/zooming/edgeDragging/selecting)
可叠加，各附对象 id；派生位 isBusyDragging/isSelecting/isPanning... 供 UI/theme 读。
CanvasHost 建它、经 CanvasSurface 塞进 CanvasRenderContext.interaction，theme 消费。

结论：interactionContext = "手势/活动状态"。它是数据面的一部分，但不含"画布数据长什么样"
(节点几何/选中集/视口变换/渲染态)。multi-select 两类都要。

## 二、CanvasRenderContext 现状（能拿到的）

| 通道 | 内容 | 响应式? |
|---|---|---|
| ctx(内核) | nodeStore/edgeStore/selection/save/history/command/nodeLayout | store 订阅有、非 ref |
| host | 同 ctx + stop | — |
| registry/nodeWrite | 展示注册表/标题写回 | — |
| edgeSelection | selectedNodeIds/EdgeIds（ref） | 是 |
| connectionState | 拖线反馈 | 是 |
| interaction | 手势活动(interactionContext) | 是 |
| handleParams/edgeVisual/debug/snapZone | 外观 | 是 |
| 视口 | host.viewport 服务(方法读) | 否 |
| 渲染态 nodes/edges | 仅 CanvasHost/Surface 内部 | 否 |
| 屏幕↔flow | host.viewport.screenToFlow 等方法 | 是(方法) |

## 三、multi-select(老版对齐)需要、当前缺的

1. 响应式 viewport（SelectionFrame transform/反缩放、框选换算）→ 缺（viewport 服务非响应式）
2. 渲染态节点只读快照(含尺寸/选中/实时位置) → 缺（nodes ref 在内部；nodeLayout 有几何但非"渲染现况"）
3. 屏幕↔flow 便捷（组件内直接调） → 部分（服务有方法）
4. 交互状态 selecting 驱动（插件自绘框选时置位） → 有 isSelecting 位但 CanvasHost 未接 selectionStart/End

## 四、补齐方向（待用户确认）

A. CanvasRenderContext 增加只读数据源：viewport(ref)/renderNodes(ref)/renderEdges(ref)/paneRect(ref)
B. 补 screenToFlow/flowToScreen 纯能力到 context
C. 把 VueFlow selectionStart/End 接进 interaction.selecting（这样插件自绘框选期间 theme/UI 能读 isSelecting）
D. 交互手势(自绘框选/拖动组)全部在 multi-select 插件实现，render 只提供 A/B/C 数据与状态位

