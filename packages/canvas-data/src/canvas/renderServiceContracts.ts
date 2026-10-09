/**
 * renderServiceContracts —— 渲染层两个内置服务的**纯结构契约**（作者 SDK 的类型面）。
 *
 * 为什么放在 canvas-data 而不是 canvas-render：
 * - 服务名 → 类型的唯一事实源必须能被任何只依赖 canvas-base 的插件看到。canvas-base 依赖
 *   canvas-data，而 canvas-render 是它的下游（canvas-render 依赖 canvas-data）；契约留在这里，
 *   逻辑插件就**不必 import 渲染包**也能按名推导 ctx.get('nodeLayout') / ctx.get('viewport')。
 * - 这两个契约是纯数据/纯结构（矩形、视口三元组、方法签名），不含 Vue、不含 VueFlow、不含
 *   实现细节（setMeasuredSize / attachBackend 这类写口与装配口都**不在**契约里）。
 *
 * canvas-render 的 NodeLayoutService / ViewportService 实现这些契约（implements），
 * 并由本文件（经 canvas-data 的 Services 登记）提供按名类型；canvas-render 不再各自 declare。
 */

/** 视口变换状态（pan 的 x/y + 缩放），与 VueFlow viewport 同形 */
export interface ViewportState {
  x: number
  y: number
  zoom: number
}

/** flow（画布）坐标点 */
export interface FlowPoint {
  x: number
  y: number
}

/**
 * 视口服务契约（服务名 viewport；渲染层注入，未 attach 后端时读为默认值、控制为 no-op）。
 *
 * 只含"读视口 + 控视图 + 坐标换算 + 实例级 DOM 锚点"。不含 updateNodeVisual /
 * getNodeRenderPosition —— 那两件是拖拽期视觉写读，经稳定的 flow facade 暴露，不在此服务。
 */
export interface ViewportContract {
  /** 当前视口变换（未就绪时为 {0,0,1}） */
  getViewport(): ViewportState
  /** 屏幕 client 坐标 → flow 坐标 */
  screenToFlow(clientX: number, clientY: number): FlowPoint
  /** flow 坐标 → 屏幕 client 坐标 */
  flowToScreen(flowX: number, flowY: number): FlowPoint
  zoomIn(): void
  zoomOut(): void
  zoomTo(level: number): void
  fitView(padding?: number): void
  setCenter(x: number, y: number, zoom?: number): void
  /** 即时写视口（"跟手"场景：小地图拖拽 / 逐帧写）——**不加过渡**，否则每帧重启补间会卡 */
  setViewport(v: ViewportState): void
  /**
   * 带过渡的取景（聚焦 / 适配这类一次性动作）。
   * 可选：后端未实现时服务内部退回即时写，行为不退化、只是没有补间动画。
   */
  animateViewport?(v: ViewportState, durationMs?: number): void
  /** 本画布实例根 DOM（多宿主不串线；未挂载 null） */
  getRootEl(): HTMLElement | null
  /** VueFlow renderer DOM（节点层容器；导出/量测锚点） */
  getRendererEl(): HTMLElement | null
  /** 视口 pane DOM（浮层挂载/坐标基准） */
  getPaneEl(): HTMLElement | null
  /** 在实例内按 data-id 查节点 DOM */
  queryNodeEl(nodeId: string): HTMLElement | null
}

/** 节点矩形（flow **绝对**坐标 + 实测/声明尺寸） */
export interface LayoutRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/**
 * 节点布局只读契约（服务名 nodeLayout；渲染层注入）。
 *
 * 只含读口：实测尺寸 / 绝对坐标 / 矩形。渲染层内部写口（setMeasuredSize / clearMeasuredSize /
 * reset）与实测装配不经此契约暴露给插件。
 */
export interface NodeLayoutContract {
  /** 某节点实际尺寸：实测 > node.size > type.defaultSize；节点不存在为 {0,0} */
  nodeSize(id: string): { w: number; h: number }
  /** 绝对坐标（累加父链 position）；节点不存在为 {0,0} */
  absolutePosition(id: string): { x: number; y: number }
  /** 某节点矩形（绝对坐标 + 实际尺寸）；节点不存在返回 null */
  getNodeRect(id: string): LayoutRect | null
  /** 全部存活节点矩形（含子节点；顺序同 store） */
  getAllRects(): LayoutRect[]
  /** 某父节点直属子节点矩形 */
  childrenOf(parentId: string): LayoutRect[]
}
