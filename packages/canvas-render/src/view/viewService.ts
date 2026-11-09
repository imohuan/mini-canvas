/**
 * ViewService —— 几何事实（节点在哪、多大）与视口事实（视野在哪）的同一个名字。
 *
 * 为什么合体：聚焦实现过去各拿一半，节点矩形从一个服务取、视口变换从另一个服务取，
 * 两边的“可视区”语义容易漂。合体后 fitTo 能拿到同一份实例的矩形与视口。
 *
 * 量测写口（setMeasuredSize / clearMeasuredSize / reset）是渲染层内部面，
 * 不进插件契约；插件只看 ViewContract。
 */
import type {
  NodeStore,
  LayoutRect,
  ViewportState,
  FlowPoint,
  FocusInsets,
} from '@mini-canvas/canvas-data'
import { NodeLayoutService } from '../layout/nodeLayout'
import { ViewportService, type ViewportBackend } from '../viewport/viewportService'
import { computeFitTo, resolvePadding, type FitToOptions } from './fitTo'

export type FocusTarget = string[] | 'selection' | 'all'

export interface ViewServiceDeps {
  nodeStore: NodeStore
  layout?: NodeLayoutService
  viewport?: ViewportService
}

/**
 * 取景时"宿主界面条"的度数口：外壳量好高度后调它。
 * 单独抽出来，是为了让外壳不必知道 ViewService 这个类的其它部分。
 */
export interface ChromeBarsReporter {
  setChromeBars(bars: { top?: number; bottom?: number; left?: number; right?: number }): void
}

export class ViewService {
  private layout: NodeLayoutService
  private viewport: ViewportService
  /**
   * 宿主界面条实时尺寸（屏幕像素）。由外壳测量后上报（见 setChromeBars）。
   * 不写死像素：顶部工具栏 / 底部底栏 / 左右抽屉的尺寸随主题、字号、是否停靠而变化。
   */
  private chromeBars: { top: number; bottom: number; left: number; right: number } = {
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  }

  constructor(deps: ViewServiceDeps) {
    this.layout = deps.layout ?? new NodeLayoutService(deps.nodeStore)
    this.viewport = deps.viewport ?? new ViewportService()
  }

  // 量测写口（渲染层内部用；不进插件契约）
  setMeasuredSize(id: string, w: number, h: number): void {
    this.layout.setMeasuredSize(id, w, h)
  }

  clearMeasuredSize(id: string): void {
    this.layout.clearMeasuredSize(id)
  }

  reset(): void {
    this.layout.reset()
  }

  pruneMissing(): void {
    this.layout.pruneMissing()
  }

  nodeSize(id: string): { w: number; h: number } {
    return this.layout.nodeSize(id)
  }

  absolutePosition(id: string): { x: number; y: number } {
    return this.layout.absolutePosition(id)
  }

  getNodeRect(id: string): LayoutRect | null {
    return this.layout.getNodeRect(id)
  }

  getAllRects(): LayoutRect[] {
    return this.layout.getAllRects()
  }

  childrenOf(parentId: string): LayoutRect[] {
    return this.layout.childrenOf(parentId)
  }

  attachBackend(backend: ViewportBackend): void {
    this.viewport.attachBackend(backend)
  }

  /**
   * 上报宿主界面条高度（顶部工具栏 / 底部底栏），供 includeBars 使用。
   *
   * 为什么由外壳上报而不是渲染层自己量：这些条住在外壳（CanvasShell）里，
   * 是画布宿主 DOM 的**祖先**，渲染层顺着自己的 root 找不到它们。
   */
  setChromeBars(bars: { top?: number; bottom?: number; left?: number; right?: number }): void {
    const num = (v: unknown): number =>
      typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
    this.chromeBars = {
      top: num(bars.top),
      bottom: num(bars.bottom),
      left: num(bars.left),
      right: num(bars.right),
    }
  }

  getChromeBars(): { top: number; bottom: number; left: number; right: number } {
    return { ...this.chromeBars }
  }

  /** 取景实际用到的四边留白（含 includeBars 与 padding 解析结果；面板/调试可读） */
  focusInsets(opts: FitToOptions = {}): FocusInsets {
    const bars = opts.includeBars ?? 'none'
    const wantTop = bars === 'top' || bars === 'both'
    const wantBottom = bars === 'bottom' || bars === 'both'
    const top = wantTop ? this.chromeBars.top : 0
    const bottom = wantBottom ? this.chromeBars.bottom : 0
    const host = this.viewport.getRootEl() ?? this.viewport.getPaneEl()
    const size = { w: host?.clientWidth ?? 1, h: host?.clientHeight ?? 1 }
    const inset = resolvePadding(opts.padding, size)
    return {
      top: top + inset.top,
      right: inset.right,
      bottom: bottom + inset.bottom,
      left: inset.left,
    }
  }

  getViewport(): ViewportState {
    return this.viewport.getViewport()
  }

  setViewport(v: ViewportState): void {
    this.viewport.setViewport(v)
  }

  animateViewport(v: ViewportState, durationMs?: number): void {
    this.viewport.animateViewport(v, durationMs)
  }

  setCenter(x: number, y: number, zoom?: number): void {
    this.viewport.setCenter(x, y, zoom)
  }

  fitView(padding?: number): void {
    this.viewport.fitView(padding)
  }

  zoomIn(): void {
    this.viewport.zoomIn()
  }

  zoomOut(): void {
    this.viewport.zoomOut()
  }

  zoomTo(level: number): void {
    this.viewport.zoomTo(level)
  }

  screenToFlow(x: number, y: number): FlowPoint {
    return this.viewport.screenToFlow(x, y)
  }

  flowToScreen(x: number, y: number): FlowPoint {
    return this.viewport.flowToScreen(x, y)
  }

  getRootEl(): HTMLElement | null {
    return this.viewport.getRootEl()
  }

  getPaneEl(): HTMLElement | null {
    return this.viewport.getPaneEl()
  }

  getRendererEl(): HTMLElement | null {
    return this.viewport.getRendererEl()
  }

  queryNodeEl(id: string): HTMLElement | null {
    return this.viewport.queryNodeEl(id)
  }

  /**
   * 唯一取景入口。返回是否真的移动了视图（只在该节点已可见时返回 false）。
   * 'selection' 的选中解析交给 canvas 门面；这里没有选中数据，故保持空集（不改选中）。
   */
  fitTo(target: FocusTarget, opts: FitToOptions = {}): boolean {
    const rects = this.resolveTargets(target)
    const root = this.viewport.getRootEl()
    const pane = this.viewport.getPaneEl() ?? this.viewport.getRendererEl()
    const host = root ?? pane
    const viewport = { w: host?.clientWidth ?? 1, h: host?.clientHeight ?? 1 }
    const zoom = this.viewport.getViewport().zoom || 1
    // 节点自身上/下控制栏是绝对定位在卡片外侧的，getNodeRect 量不到；
    // includeNodeTopBar 时只把**顶部标题条**量进来（底部控制栏不参与，见契约说明）。
    //
    // 关键：标题条在屏幕上大小**恒定**（自身 scale(1/zoom) 抵消了画布缩放），
    // 所以它在这里是屏幕像素高度，不能拿当前 zoom 除成「画布高度」——
    // 那会让包围盒反过来依赖本次要算的缩放：反复按下 F 时结果一路漂移（越缩越小）。
    // 正确做法是把它交给 computeFitTo，作为「额外要留出的屏幕像素」处理。
    const nodeTopBar = opts.includeNodeTopBar ? this.nodeTopBarScreen(rects, root) : undefined
    const bars = opts.includeBars ?? 'none'
    const wantTop = bars === 'top' || bars === 'both'
    const wantBottom = bars === 'bottom' || bars === 'both'
    const barHeight = {
      top: wantTop ? this.chromeBars.top : 0,
      bottom: wantBottom ? this.chromeBars.bottom : 0,
    }
    const result = computeFitTo({
      rects,
      viewport,
      viewportState: this.viewport.getViewport(),
      opts,
      barHeight,
      nodeTopBarHeight: nodeTopBar,
    })
    if (!result.moved) return false
    if (opts.animate === false) this.viewport.setViewport(result.viewport)
    else this.viewport.animateViewport(result.viewport, opts.durationMs ?? 320)
    return true
  }

  /**
   * 量出节点自带**顶部标题条**在屏幕上多高（像素）；多选时取最高的那个。
   *
   * 查法跟着渲染层已有的 DOM 约定走（与 CSS 里用的类名同一个来源）：
   * `.csurface-node-toolbars .v2-toolbar-anchor[data-node-id]` 下的 `--top`。
   * 量不到返回 undefined（旧主题 / 无 DOM 场景不崩）。
   *
   * 注意这里**故意不除以 zoom**：标题条自身带 scale(1/zoom)，屏幕上始终这么大，
   * 它是一段固定的屏幕像素，只有在算缩放之前才该换算成画布坐标（见 computeFitTo）。
   * 底部控制栏**不量**：它高度大且随内容变，算进聚焦范围会把卡片压得过小。
   */
  private nodeTopBarScreen(rects: LayoutRect[], root: HTMLElement | null): number | undefined {
    if (!root || rects.length === 0) return undefined
    const churn = root.querySelectorAll<HTMLElement>('.csurface-node-toolbars .v2-toolbar-anchor[data-node-id]')
    if (churn.length === 0) return undefined
    const byId = new Map<string, number>()
    for (const anchor of churn) {
      const id = anchor.dataset.nodeId
      if (!id) continue
      byId.set(id, anchor.querySelector<HTMLElement>('.v2-slot--top')?.offsetHeight ?? 0)
    }
    if (byId.size === 0) return undefined
    // 多个节点时取最高的那个：保证每个节点的标题条都不会出界
    let top = 0
    for (const r of rects) top = Math.max(top, byId.get(r.id) ?? 0)
    return top > 0 ? top : undefined
  }

  private resolveTargets(target: FocusTarget): LayoutRect[] {
    if (target === 'all') return this.layout.getAllRects()
    if (target === 'selection') return []
    return target
      .map((id) => this.layout.getNodeRect(id))
      .filter((r): r is LayoutRect => r !== null)
  }
}
