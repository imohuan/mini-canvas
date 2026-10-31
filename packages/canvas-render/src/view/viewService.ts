/**
 * ViewService —— 几何事实（节点在哪、多大）与视口事实（视野在哪）的同一个名字。
 *
 * 为什么合体：聚焦实现过去各拿一半，节点矩形从一个服务取、视口变换从另一个服务取，
 * 两边的“可视区”语义容易漂。合体后 fitTo 能拿到同一份实例的矩形与视口。
 *
 * 量测写口（setMeasuredSize / clearMeasuredSize / resetMeasured）是渲染层内部面，
 * 不进插件契约；插件只看 ViewContract。
 */
import type { NodeStore, LayoutRect, ViewportState, FlowPoint } from '@mini-canvas/canvas-data'
import { NodeLayoutService } from '../layout/nodeLayout'
import { ViewportService, type ViewportBackend } from '../viewport/viewportService'
import { computeFitTo, type FitToOptions } from './fitTo'

export type FocusTarget = string[] | 'selection' | 'all'

export interface ViewServiceDeps {
  nodeStore: NodeStore
  layout?: NodeLayoutService
  viewport?: ViewportService
}

export class ViewService {
  private layout: NodeLayoutService
  private viewport: ViewportService

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

  resetMeasured(): void {
    this.layout.reset()
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
    const result = computeFitTo({
      rects,
      viewport,
      viewportState: this.viewport.getViewport(),
      opts,
    })
    if (!result.moved) return false
    if (opts.animate === false) this.viewport.setViewport(result.viewport)
    else this.viewport.animateViewport(result.viewport, opts.durationMs ?? 320)
    return true
  }

  private resolveTargets(target: FocusTarget): LayoutRect[] {
    if (target === 'all') return this.layout.getAllRects()
    if (target === 'selection') return []
    return target
      .map((id) => this.layout.getNodeRect(id))
      .filter((r): r is LayoutRect => r !== null)
  }
}
