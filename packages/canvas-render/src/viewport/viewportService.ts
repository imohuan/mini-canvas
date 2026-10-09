/**
 * viewportService —— 画布视口服务（渲染层提供、插件/工具消费）。
 *
 * 背景：老插件(align-guide/mini-map/node-find/auto-layout/canvas-export)都需要读视口、移动视图、
 * 屏幕坐标与画布坐标互转。v2 里这些能力散在 CanvasSurface(useVueFlow) 内部，插件模块拿不到。
 *
 * 本服务定义视口后端最小接口(ViewportBackend)，CanvasHost 把 VueFlow 能力适配进去并注入
 * ctx.get(viewport)（服务名 viewport）；纯逻辑可单测（fake backend 验证语义）。
 *
 * 对外类型面见 canvas-data 的 ViewportContract（服务名 → 类型的唯一事实源在作者 SDK 上游）：
 * 公开给插件的只有读视口 / 控视图 / 坐标换算 / 实例级 DOM 锚点；后端装配口（attachBackend）
 * 与拖拽期视觉写口（updateNodeVisual / getNodeRenderPosition）是这个类的渲染层内部面，
 * 不进契约（拖拽视觉读写由 flow facade 承担）。
 */

import type { ViewportContract, ViewportState, FlowPoint } from '@mini-canvas/canvas-data'

export type { ViewportState, FlowPoint }

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
  /**
   * 带过渡的视口定位（**只给"聚焦/取景"这类一次性动作**用）。
   *
   * 为什么单独开一条而不是给 setViewport 加 duration：setViewport 还服务"跟手"场景
   * （小地图拖拽、自动布局逐帧写视口）—— 那里每帧都重启一次补间会严重卡顿（老版实测），
   * 所以那条必须即时。这里把"要不要动画"变成调用方的选择，两条路互不影响。
   */
  animateViewport?(v: ViewportState, durationMs?: number): void
  /** 拖拽中把单节点视觉位置写进 VueFlow（不触发 store）；可选（假后端可省） */
  updateNodeVisual?(id: string, position: { x: number; y: number }): void
  /** 读节点当前渲染位置（含拖动中未落盘位移）；可选（假后端可省） */
  getNodeRenderPosition?(id: string): { x: number; y: number } | undefined
  /** 本画布实例根 DOM（多宿主不串线；未挂载 null） */
  getRootEl?(): HTMLElement | null
  /** VueFlow renderer DOM（节点层容器；导出/量测锚点） */
  getRendererEl?(): HTMLElement | null
  /** 视口 pane DOM（浮层挂载/坐标基准） */
  getPaneEl?(): HTMLElement | null
  /** 在实例内按 data-id 查节点 DOM */
  queryNodeEl?(nodeId: string): HTMLElement | null
}

export class ViewportService implements ViewportContract {
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

  /**
   * 带过渡的视口定位（聚焦取景用）。后端没实现这条（假后端/老装配）时**退回即时**，
   * 行为不退化 —— 只是没有补间动画。
   */
  animateViewport(v: ViewportState, durationMs = 320): void {
    const backend = this.requireBackend()
    if (!backend) return
    if (backend.animateViewport) backend.animateViewport(v, durationMs)
    else backend.setViewport(v)
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


