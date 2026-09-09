/**
 * viewportService —— 画布视口服务（渲染层提供、插件/工具消费）。
 *
 * 背景：老插件(align-guide/mini-map/node-find/auto-layout/canvas-export)都需要读视口、移动视图、
 * 屏幕坐标与画布坐标互转。v2 里这些能力散在 CanvasSurface(useVueFlow) 内部，插件模块拿不到。
 *
 * 本服务定义视口后端最小接口(ViewportBackend)，CanvasHost 把 VueFlow 能力适配进去并注入
 * ctx.get(viewport)（服务名 viewport）；纯逻辑可单测（fake backend 验证语义）。
 */

export interface ViewportState {
  x: number
  y: number
  zoom: number
}

export interface FlowPoint {
  x: number
  y: number
}

/** CanvasHost 把 VueFlow 实例适配成的最小后端（screen-flow 换算 + 视图控制） */
export interface ViewportBackend {
  getViewport(): ViewportState
  screenToFlow(clientX: number, clientY: number): FlowPoint
  flowToScreen(flowX: number, flowY: number): FlowPoint
  zoomIn(): void
  zoomOut(): void
  zoomTo(level: number): void
  fitView(padding?: number): void
  setCenter(x: number, y: number, zoom?: number): void
  setViewport(v: ViewportState): void
  /** 本画布实例根 DOM（多宿主不串线；未挂载 null） */
  getRootEl?(): HTMLElement | null
  /** VueFlow renderer DOM（节点层容器；导出/量测锚点） */
  getRendererEl?(): HTMLElement | null
  /** 视口 pane DOM（浮层挂载/坐标基准） */
  getPaneEl?(): HTMLElement | null
  /** 在实例内按 data-id 查节点 DOM */
  queryNodeEl?(nodeId: string): HTMLElement | null
}

export class ViewportService {
  private backend?: ViewportBackend

  constructor(backend?: ViewportBackend) {
    this.backend = backend
  }

  /** 后端就绪后挂载（CanvasHost 拿到 VueFlow 实例后调用）；未挂载时方法调用为 no-op。 */
  attachBackend(backend: ViewportBackend): void {
    this.backend = backend
  }

  private requireBackend(): ViewportBackend | undefined {
    return this.backend
  }

  getViewport(): ViewportState {
    return this.requireBackend()?.getViewport() ?? { x: 0, y: 0, zoom: 1 }
  }

  screenToFlow(clientX: number, clientY: number): FlowPoint {
    return this.requireBackend()?.screenToFlow(clientX, clientY) ?? { x: clientX, y: clientY }
  }

  flowToScreen(flowX: number, flowY: number): FlowPoint {
    return this.requireBackend()?.flowToScreen(flowX, flowY) ?? { x: flowX, y: flowY }
  }

  zoomIn(): void {
    this.requireBackend()?.zoomIn()
  }

  zoomOut(): void {
    this.requireBackend()?.zoomOut()
  }

  zoomTo(level: number): void {
    this.requireBackend()?.zoomTo(level)
  }

  fitView(padding = 0.1): void {
    this.requireBackend()?.fitView(padding)
  }

  setCenter(x: number, y: number, zoom?: number): void {
    this.requireBackend()?.setCenter(x, y, zoom)
  }

  setViewport(v: ViewportState): void {
    this.requireBackend()?.setViewport(v)
  }

  getRootEl(): HTMLElement | null {
    return this.requireBackend()?.getRootEl?.() ?? null
  }

  getRendererEl(): HTMLElement | null {
    return this.requireBackend()?.getRendererEl?.() ?? null
  }

  getPaneEl(): HTMLElement | null {
    return this.requireBackend()?.getPaneEl?.() ?? null
  }

  queryNodeEl(nodeId: string): HTMLElement | null {
    return this.requireBackend()?.queryNodeEl?.(nodeId) ?? null
  }
}







