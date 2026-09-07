# canvas-render CanvasRenderContext 完善设计（数据面补全，供插件开发）

> 日期：2026-09-07 · 分支：feat/cordis-plugin-system · 状态：设计待实现
> 起因：multi-select 插件要对齐老版实现（自绘 Shift+拖框选 + SelectionFrame 群组预览浮层），
> 发现插件消费方从 CanvasRenderContext 拿不到"画布当前长什么样/视口在哪"的数据。
> 分层铁律（用户）：render 层只做数据与能力，不掺交互决策/UI；插件做逻辑与 UI，两者零耦合。
> 本设计只补"数据面"，交互(框选手势/浮层显隐/拖动组)全部留给插件。

## 一、原则

1. CanvasRenderContext 是 render 给渲染子树(插件 UI 组件)的**数据/能力收口**；只放"读数据/调能力"，不放任何"该做什么"的判断。
2. 插件组件用 useCanvasRender() 拿 ctx/host/数据源；交互决策(何时框选/何时显示浮层/命中哪些节点)在插件内。
3. render 与插件通过**内核 ctx + 上下文**通信，不互相 import，不共享内部 ref。
4. 旧字段保留；新字段只增不改（向后兼容）。

## 二、现状缺口（从老版 multi-select 倒推）

老版 SelectionFrame/框选消费：
- props.viewport（实时视口变换）→ 浮层 transform/反缩放
- vfInstance.getNodes（含 dimensions/selected/computedPosition 运行时态）→ 包围框/碰撞
- 屏幕坐标换算 → 框选矩形
- 写节点位置(updateNode) → 拖动选中组

v2 现状：
- 视口在 CanvasSurface 的 vfApi(computed)，**未 provide**；host.viewport 服务只能方法读、非响应式。
- 渲染态 nodes 在 CanvasHost 内部 ref，**未 provide**（拖动中实时位置拿不到）。
- 屏幕换算/几何已在 ctx(viewport/nodeLayout) 服务——OK。
- 写位置在内核 nodeStore.updateNodes——OK（宿主订阅自动重灌）。

## 三、新增上下文（只读数据源 + 能力）

```ts
// renderContext.ts 增量（全部可选只读，向后兼容）
export interface CanvasRenderContext {
  // —— 既有字段保持 ——
  ctx: Context; host: CanvasHostHandle; registry: NodeRegistry; nodeWrite: NodeWrite
  handleParams: CanvasParams; edgeVisual: Partial<EdgeVisual>; edgeSelection: EdgeSelection
  connectionState: ConnectionFeedbackState; interaction: CanvasInteractionState
  debug: CanvasDebug; snapZone: SnapZoneConfig

  // —— 新增：当前视口（响应式；VueFlow viewport 派生，pan/zoom 实时跟）——
  /** 画布视口变换（flow→屏幕的 translate+scale）；浮层定位/坐标换算用 */
  viewport: Readonly<Ref<{ x: number; y: number; zoom: number }>>
  /** 视口容器 DOM 矩形（client 坐标基准；无 DOM 时 null） */
  paneRect: Readonly<Ref<DOMRect | null>>

  // —— 新增：渲染态只读快照（含 VueFlow 运行时位置/选中；拖动中实时）——
  /** 当前渲染节点（含拖动中实时 position/selected）；只读，勿改 */
  renderNodes: Readonly<Ref<ReadonlyArray<FlowNode>>>
  /** 当前渲染边 */
  renderEdges: Readonly<Ref<ReadonlyArray<{ id: string; source: string; target: string }>>>

  // —— 新增：纯能力（不掺决策）——
  /** 屏幕 client 坐标 → flow 坐标（paneRect 修正 + 视口逆变换） */
  screenToFlow(clientX: number, clientY: number): { x: number; y: number }
  /** flow 坐标 → 屏幕 client 坐标（浮层画线/手柄定位用） */
  flowToScreen(flowX: number, flowY: number): { x: number; y: number }
}
```

## 四、接线（canvas-render 内部，不改插件）

- CanvasSurface：把 vfApi.viewport（响应式 computed）包成 ref 传 renderCtx.viewport；
  paneRect 由 onMounted 捕获 .vue-flow__pane + 缩放时刷新。
- CanvasHost：把渲染态 nodes/edges ref 以只读形式传 CanvasSurface → renderCtx.renderNodes/renderEdges
  （保持宿主订阅 store 自动重灌；插件只读消费）。
- screenToFlow/flowToScreen：复用 viewport 服务后端（已接 vfApi 官方换算），放 renderCtx 直接调。
- viewport/paneRect 变更监听：move 事件已桥，paneRect 在 move/pan 时更新。

## 五、multi-select 插件据此实现（后续任务，本设计只管 render 数据面）

- 自绘框选：pane pointerdown(Shift) → screenToFlow → 命中 renderNodes(几何经 nodeLayout) → selection.set。
- SelectionFrame：读 renderNodes + viewport，计算选中组包围框 → 画虚线框；拖动组 = 收集选中 nodes 增量 → nodeStore.updateNodes。
- 选中>1 显示浮层：插件内部判断，经 ctx.slots.register('overlay') 挂组件。

## 六、验证

- 纯逻辑部分单测（screenToFlow/flowToScreen 已测；renderNodes 派生复用 canvasHostCore 测）。
- vue-tsc 干净；既有 125+243 测试不回归。
- 浏览器目验交给插件完成后。

