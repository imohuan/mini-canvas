/**
 * renderServiceContracts —— 渲染层服务的**纯结构契约**（作者 SDK 的类型面）。
 *
 * 为什么放在 canvas-data 而不是 canvas-render：
 * - 服务名 → 类型的唯一事实源必须能被任何只依赖 canvas-base 的插件看到。canvas-base 依赖
 *   canvas-data，而 canvas-render 是它的下游（canvas-render 依赖 canvas-data）；契约留在这里，
 *   逻辑插件就**不必 import 渲染包**也能按名推导 ctx.get<ViewContract>('view') 等类型。
 * - 这两个契约是纯数据/纯结构（矩形、视口三元组、方法签名），不含 Vue、不含 VueFlow、不含
 *   实现细节（setMeasuredSize / attachBackend 这类写口与装配口都**不在**契约里）。
 *
 * canvas-render 的 ViewService（以及它内部持有的布局/视口实例）实现这些契约，
 * 对外服务名只有 `view`；canvas-render 不再各自 declare 服务名。
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
 * 取景参数（服务名 view 的 fitTo）。九个聚焦实现的所有差异都收在这里：
 * 是否改缩放、是否只在该内容不可见时动、可视区要不要扣掉状态栏。
 */
export interface FitToOptions {
  /** 留白比例（0..0.49，与 VueFlow fitView 同义）；不写 heightRatio 时用它适配整块内容 */
  padding?: number
  /** 目标内容高度占视口高度的比例（auto-layout / 底栏用 0.5）；写了它就不看 padding */
  heightRatio?: number
  minZoom?: number
  maxZoom?: number
  /** true = 保持当前 zoom，只平移 */
  keepZoom?: boolean
  /** 指定固定 zoom */
  zoom?: number
  /** 是否顺手选中目标；由 canvas.focus 消费，view.fitTo 自己不碰选中 */
  select?: boolean
  /** 只在该内容不可见时移动 */
  onlyIfOutOfView?: boolean
  /** 不可见判定的额外边距（屏幕像素） */
  margin?: number
  /** 把上/下状态栏高度算进包围盒：缺省 'none' */
  includeBars?: 'none' | 'bottom' | 'both'
  /** 是否播放过渡；缺省 true */
  animate?: boolean
  durationMs?: number
}

/** 取景目标：一组节点 id / 当前选中集 / 全部节点 */
export type FocusTarget = string[] | 'selection' | 'all'

/**
 * 视口与几何合并后的插件契约（服务名 view）。
 *
 * 不含量测写口（setMeasuredSize 等）与后端装配口（attachBackend）：那两件是渲染层内部面。
 */
export interface ViewContract extends NodeLayoutContract, ViewportContract {
  /** 唯一取景算法；返回是否真的移动了视图（已可见时 false） */
  fitTo(target: FocusTarget, opts?: FitToOptions): boolean
}

/** 通知选项（服务名 canvas 的 notify / 旧 tip 转发共用） */
export interface NotifyOptions {
  source?: string
  priority?: number
  once?: boolean
  /** 0 = 常驻 */
  durationMs?: number
  /** 跟随鼠标渲染（tip 语义） */
  followPointer?: boolean
}

/** canvas 建节点的附加参数（透传给节点插件 creator） */
export interface CanvasCreateNodeOptions {
  data?: Record<string, unknown>
  sourceNodeId?: string
  gap?: number
}

export type CanvasSelectMode = 'replace' | 'add' | 'toggle'

/**
 * 画布动作门面契约（服务名 canvas）。
 *
 * 只转发、不存数据；可选业务服务（group / nodeToolbar / nodeTask）缺失时
 * 返回 undefined / false / null，只有 runBarAction 缺执行器时明确 reject。
 */
export interface CanvasActions {
  createNode(
    type: string,
    at: { x: number; y: number },
    opts?: CanvasCreateNodeOptions,
  ): string | undefined
  creatableTypes(): string[]
  select(ids: string[], mode?: CanvasSelectMode): void
  focus(target: FocusTarget, opts?: FitToOptions): boolean
  enterMode(nodeId: string, modeId: string): boolean
  exitMode(nodeId?: string): void
  activeMode(nodeId: string): string | undefined
  group(nodeIds: string[]): string | null
  ungroup(groupId: string): void
  notify(message: string, opts?: NotifyOptions): () => void
  runBarAction(nodeId: string, actionId: string, input?: unknown): Promise<unknown>
  cancelBarAction(nodeId: string): void
  /** 执行命令（未注册 → no-op，与 CommandRegistry.execute 同义） */
  runCommand(id: string, ...payload: unknown[]): unknown
  /** 枚举命令（菜单/快捷键面板用） */
  listCommands(): Array<{
    id: string
    title?: string
    keys?: string[]
    areas?: string[]
    group?: string
    order?: number
    icon?: string
  }>
  /** 判断命令是否已注册 */
  hasCommand(id: string): boolean
  /** 运行期改键（快捷键管理器用）；返回改后的 keys */
  remapCommandKeys(id: string, keys: string[]): string[]
  /** 恢复某命令注册时的 keys（未 remap 过 → 当前 keys） */
  resetCommandKeys(id: string): string[] | undefined
  /** 只读：某命令注册时的原始 keys */
  originalCommandKeys(id: string): string[] | undefined
  /** 某命令 keys 是否被 remap 过 */
  isCommandRemapped(id: string): boolean
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
