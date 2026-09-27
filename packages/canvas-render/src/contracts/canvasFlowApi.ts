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
import { ref, type Ref } from 'vue'

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

  /**
   * 当前视口（响应式 Ref；pan/zoom 实时跟）。
   *
   * 与 viewport() 方法的区别：模板/computed 里做响应式绑定用它；命令式读取用 viewport()。
   * 未挂载时 value 为 {0,0,1}（这是"视口状态"的默认值，不是"命令成功"的伪装）——
   * 响应式状态无法抛错，需要强一致判断时配合 ready() 使用。
   */
  readonly viewport: Readonly<Ref<ViewportState>>
  readonly pane: Readonly<Ref<HTMLElement | null>>
  readonly paneRect: Readonly<Ref<DOMRect | null>>
  readonly root: Readonly<Ref<HTMLElement | null>>
  readonly renderer: Readonly<Ref<HTMLElement | null>>

  viewportSnapshot(): ViewportState
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

  /**
   * 节点当前**渲染位置**（含拖动中未落盘的实时位移）。
   *
   * 与 store 投影的区别：拖动进行时 VueFlow 内部位置已更新、store 尚未提交，
   * 需要贴"用户眼睛看到的"位置的代码（端口锚点 / 悬停反馈）用它。
   */
  getNodeRenderPosition(id: string): { x: number; y: number } | undefined

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
  attachDom(dom: CanvasFlowDomApi, paneRect?: DOMRect | null): void
  /** 宿主停止 → disposed：后续任何调用都抛 NotReady */
  dispose(): void
  /** 节点视觉尺寸同步后端（CanvasSurface 把 VueFlow 的 updateNode* 适配进来） */
  attachNodeVisual(api: NodeVisualSyncApi): void
  /** 节点实时渲染位置读取器（拖动中未落盘的位置） */
  attachPositionReader(reader: (id: string) => { x: number; y: number } | undefined): void
  /** 响应式视口数据源（宿主 watch VueFlow viewport 写入） */
  attachViewportSource(source: Readonly<Ref<ViewportState>>): void
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
  /** 读节点实时渲染位置（宿主把 VueFlow 内部状态适配进来） */
  let positionReader: ((id: string) => { x: number; y: number } | undefined) | undefined
  /** 响应式视口（宿主把 VueFlow viewport 同步进来；未挂载 = 默认值） */
  const viewportRef = ref<ViewportState>({ x: 0, y: 0, zoom: 1 })
  const paneRef = ref<HTMLElement | null>(null)
  const paneRectRef = ref<DOMRect | null>(null)
  const rootRef = ref<HTMLElement | null>(null)
  const rendererRef = ref<HTMLElement | null>(null)
  let viewportSource: Readonly<Ref<ViewportState>> = viewportRef
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
    get viewport() {
      return viewportSource
    },
    pane: paneRef,
    paneRect: paneRectRef,
    root: rootRef,
    renderer: rendererRef,
    subscribe(fn) {
      listeners.add(fn)
      return { dispose: () => listeners.delete(fn) }
    },

    attachFlow(next) {
      if (phase === 'disposed') return
      backend = next
      advanceTo('flow-ready')
    },
    attachDom(next, rect) {
      if (phase === 'disposed') return
      dom = next
      paneRef.value = next.paneEl()
      const pane = next.paneEl()
      paneRectRef.value = rect ?? (typeof pane?.getBoundingClientRect === 'function' ? pane.getBoundingClientRect() : null)
      rootRef.value = next.rootEl()
      rendererRef.value = next.rendererEl()
      advanceTo('dom-ready')
    },
    attachNodeVisual(api) {
      nodeVisual = api
    },
    attachPositionReader(reader) {
      positionReader = reader
    },
    attachViewportSource(source) {
      viewportSource = source
    },
    dispose() {
      if (phase === 'disposed') return
      backend = undefined
      dom = undefined
      paneRef.value = null
      paneRectRef.value = null
      rootRef.value = null
      rendererRef.value = null
      nodeVisual = undefined
      phase = 'disposed'
      notify()
      listeners.clear()
    },

    viewportSnapshot() {
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

    getNodeRenderPosition(id) {
      return needFlow().getNodeRenderPosition?.(id) ?? positionReader?.(id)
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
