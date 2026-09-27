/**
 * canvasFlowApi —— 有就绪状态的画布 Flow/DOM 能力面（执行计划 T04）。
 *
 * 解决的缺陷：旧 ViewportService 在后端未挂载时**静默降级** —— getViewport 返回
 * {0,0,1}、screenToFlow 原样回传坐标、其余命令 no-op。调用方无法区分"真的在那里"
 * 与"还没挂载"，于是把未就绪当成成功（例如把坐标算在错误的位置上）。
 *
 * 本模块是一个**纯逻辑状态机**（零 Vue、零 DOM），把生命周期讲清楚：
 *   detached ──attachFlow──▶ flow-ready ──attachDom──▶ dom-ready ──dispose──▶ disposed
 *
 * - flow-ready：VueFlow 实例已接入 → 视口读取/控制、坐标换算、节点视觉更新可用。
 * - dom-ready：pane/renderer 等 DOM 锚点已捕获 → DOM 查询可用（DOM 晚于实例就绪）。
 * - 能力不够用时**抛明确错误**，不返回默认值/原样回传；调用方先用 ready()/phase() 判断。
 *
 * 组件侧由 canvas-render 的 Vue 桥（useCanvasRender().flow）提供；插件 apply(ctx) 拿不到
 * 实时实例（此时 CanvasSurface 尚未挂载），故不作为 ctx 服务暴露。
 */
import type { ViewportBackend, ViewportState, FlowPoint } from '../viewport/viewportService'
import type { NodeVisualSyncApi } from '../host/nodeVisualSync'

/** 生命周期阶段（只增不减，dispose 为终态） */
export type CanvasFlowPhase = 'detached' | 'flow-ready' | 'dom-ready' | 'disposed'

/** 调用能力时尚未就绪（不降级、不静默；调用方按 phase/ready 判断后再调） */
export class CanvasFlowNotReadyError extends Error {
  constructor(
    /** 调用时所在阶段 */
    readonly phase: CanvasFlowPhase,
    /** 该调用要求的最低阶段 */
    readonly required: CanvasFlowPhase,
    capability: string,
  ) {
    super(
      '[canvasFlow] ' + capability + ' 尚未就绪：当前阶段 "' + phase + '"，需要至少 "' + required + '"' +
        (phase === 'disposed'
          ? '（宿主已停止，实例已销毁）'
          : '（CanvasSurface 还未挂载 VueFlow）'),
    )
    this.name = 'CanvasFlowNotReadyError'
  }
}

/** DOM 锚点（实例级；多宿主页面不串线） */
export interface CanvasFlowDomApi {
  rootEl(): HTMLElement | null
  rendererEl(): HTMLElement | null
  paneEl(): HTMLElement | null
  queryNodeEl(nodeId: string): HTMLElement | null
}

/**
 * Flow/DOM 能力面。所有命令在阶段不足时抛 CanvasFlowNotReadyError。
 * 只读 getter（phase/ready/domReady）永不抛，供调用方先判断再行动。
 */
export interface CanvasFlowApi {
  phase(): CanvasFlowPhase
  /** 视口/坐标/节点视觉能力可用（>= flow-ready） */
  ready(): boolean
  /** DOM 锚点可用（dom-ready） */
  domReady(): boolean
  subscribe(fn: () => void): { dispose(): void }

  viewport(): ViewportState
  screenToFlow(clientX: number, clientY: number): FlowPoint
  flowToScreen(flowX: number, flowY: number): FlowPoint
  zoomIn(): void
  zoomOut(): void
  zoomTo(level: number): void
  fitView(padding?: number): void
  setCenter(x: number, y: number, zoom?: number): void
  setViewport(view: ViewportState): void

  updateNodeVisual(id: string, position: { x: number; y: number }): void
  updateNodeVisualSize(id: string, w: number, h: number): void
  updateNodeInternals(id: string): void

  queryNodeEl(nodeId: string): HTMLElement | null
  rootEl(): HTMLElement | null
  paneEl(): HTMLElement | null
  rendererEl(): HTMLElement | null
}

/** 宿主侧用的可变句柄（组件侧只看到只读的 CanvasFlowApi） */
export interface CanvasFlowController extends CanvasFlowApi {
  /** VueFlow 实例就绪 → flow-ready（幂等；已更靠后则不动） */
  attachFlow(backend: ViewportBackend): void
  /** DOM 锚点就绪 → dom-ready（必须在 attachFlow 之后） */
  attachDom(dom: CanvasFlowDomApi): void
  /** 宿主停止 → disposed：后续任何调用都抛 NotReady */
  dispose(): void
  /** 节点视觉尺寸同步后端（CanvasSurface 把 VueFlow 的 updateNode* 适配进来） */
  attachNodeVisual(api: NodeVisualSyncApi): void
}

const ORDER: Record<CanvasFlowPhase, number> = {
  detached: 0,
  'flow-ready': 1,
  'dom-ready': 2,
  disposed: 3,
}

/**
 * 建一个 Flow 能力控制器（纯逻辑，Node 可单测）。
 * 未 attach 任何后端时是 detached；dispose 后为终态。
 */
export function createCanvasFlowController(): CanvasFlowController {
  let phase: CanvasFlowPhase = 'detached'
  let backend: ViewportBackend | undefined
  let dom: CanvasFlowDomApi | undefined
  let nodeVisual: NodeVisualSyncApi | undefined
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const fn of listeners) {
      try {
        fn()
      } catch {
        /* 单个订阅者异常不阻断其它（与注册场同一条原则） */
      }
    }
  }
  const advanceTo = (next: CanvasFlowPhase): void => {
    if (ORDER[next] > ORDER[phase]) {
      phase = next
      notify()
    }
  }

  /** 阶段守卫：不足即抛，绝不降级返回 */
  const require = (required: CanvasFlowPhase, capability: string): void => {
    if (ORDER[phase] < ORDER[required] || phase === 'disposed') {
      throw new CanvasFlowNotReadyError(phase, required, capability)
    }
  }
  const needFlow = (): ViewportBackend => {
    require('flow-ready', 'flow')
    return backend as ViewportBackend
  }
  const needDom = (capability: string): CanvasFlowDomApi => {
    require('dom-ready', capability)
    return dom as CanvasFlowDomApi
  }

  return {
    phase: () => phase,
    ready: () => ORDER[phase] >= ORDER['flow-ready'] && phase !== 'disposed',
    domReady: () => phase === 'dom-ready',
    subscribe(fn) {
      listeners.add(fn)
      return { dispose: () => listeners.delete(fn) }
    },

    attachFlow(next) {
      if (phase === 'disposed') return
      backend = next
      advanceTo('flow-ready')
    },
    attachDom(next) {
      if (phase === 'disposed') return
      dom = next
      advanceTo('dom-ready')
    },
    attachNodeVisual(api) {
      nodeVisual = api
    },
    dispose() {
      if (phase === 'disposed') return
      backend = undefined
      dom = undefined
      nodeVisual = undefined
      phase = 'disposed'
      notify()
      listeners.clear()
    },

    viewport() {
      return needFlow().getViewport()
    },
    screenToFlow(x, y) {
      return needFlow().screenToFlow(x, y)
    },
    flowToScreen(x, y) {
      return needFlow().flowToScreen(x, y)
    },
    zoomIn() {
      needFlow().zoomIn()
    },
    zoomOut() {
      needFlow().zoomOut()
    },
    zoomTo(level) {
      needFlow().zoomTo(level)
    },
    fitView(padding) {
      needFlow().fitView(padding)
    },
    setCenter(x, y, zoom) {
      needFlow().setCenter(x, y, zoom)
    },
    setViewport(view) {
      needFlow().setViewport(view)
    },

    updateNodeVisual(id, position) {
      needFlow().updateNodeVisual?.(id, position)
    },
    updateNodeVisualSize(id, w, h) {
      require('flow-ready', 'updateNodeVisualSize')
      nodeVisual?.updateNode(id, { style: { width: w + 'px', height: h + 'px' } })
      nodeVisual?.updateNodeInternals([id])
    },
    updateNodeInternals(id) {
      require('flow-ready', 'updateNodeInternals')
      nodeVisual?.updateNodeInternals([id])
    },

    queryNodeEl(nodeId) {
      return needDom('queryNodeEl').queryNodeEl(nodeId)
    },
    rootEl() {
      return needDom('rootEl').rootEl()
    },
    paneEl() {
      return needDom('paneEl').paneEl()
    },
    rendererEl() {
      return needDom('rendererEl').rendererEl()
    },
  }
}
