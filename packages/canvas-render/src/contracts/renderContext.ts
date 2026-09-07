/**
 * renderContext —— 渲染宿主统一上下文（Vue provide/inject 单令牌收口）。
 *
 * 目标：把 CanvasHost 之前逐个 provide 的 6 个独立令牌(NODE_REGISTRY/NODE_WRITE/CANVAS_PARAMS/
 * HOST/EDGE_VISUAL/EDGE_SELECTION)收拢成**一个上下文对象** + 一个消费函数 `useCanvasRender()`，
 * 消费方(插件壳/边/content 组件)不必逐个 `inject(某 KEY)!` 再自己处理缺省/报错。
 *
 * 提供方：CanvasSurface（CanvasHost 的内层渲染子树宿主，boot 完成后才挂载）。因此本上下文里
 * ctx/host 都是**裸值**（非 Ref、非空）——渲染组件 setup 时宿主已就绪，可直接
 * `ctx.get('nodeStore')` / `ctx.text.editText(...)`，无需 .value、无需判空。
 *
 * 用法：
 *   渲染子树内任意子组件：const { ctx, registry, handleParams, edgeVisual } = useCanvasRender()
 *   - ctx：内核 Context（调服务/插件直访）—— content 组件最常用。
 *   - host：宿主句柄（ctx 的超集，多摊平服务字段 + stop() 落盘语义）—— 需宿主级能力时用。
 *   - registry / nodeWrite / handleParams / edgeVisual / edgeSelection：展示/外观/选中，给壳/边。
 *
 * 说明：
 * - 字段里凡"宿主注入的响应式对象"(edgeVisual/handleParams) 保持**原引用**，属性改即实时生效。
 *   edgeSelection.selectedNodeIds/selectedEdgeIds 是 Ref（供"相连被选即高亮"追踪）。
 * - 旧 6 个 *_KEY 常量仍保留导出(CanvasSurface 仍逐个 provide 同引用)以兼容未迁移的外部消费方；
 *   新代码一律走 useCanvasRender()。
 * - 仅限 CanvasSurface(渲染子树) 内调用；不在宿主内会抛清晰错误。
 */
import { inject, type InjectionKey, type Ref } from 'vue'
import type { Context, NodeRegistry } from '@mini-canvas/canvas-core-v2'
import type { CanvasHostHandle } from '../host/createMiniCanvasHost'
import type { NodeWrite } from './nodeRegistryKey'
import type { CanvasParams } from './canvasParamKey'
import type { EdgeVisual, EdgeSelection } from './edgeContext'
import type { ConnectionFeedbackState } from './connectionContext'
import type { CanvasInteractionState } from './interactionContext'
import type { CanvasDebug } from './debugContext'
import type { SnapZoneConfig } from '../connection/geometry'
import type { FlowNode } from '../host/canvasHostCore'
import type { ViewportState } from '../viewport/viewportService'

/** 渲染宿主提供给其子树(VueFlow 内插件组件)的整包上下文（boot 后提供，值均就绪） */
export interface CanvasRenderContext {
  /** 内核上下文：调服务/插件直访（content 组件常用：ctx.get('nodeStore') / ctx.text 等） */
  ctx: Context
  /** 宿主句柄（ctx 的超集：save/nodeStore/selection/command/history/nodeRegistry/themeRegistry/stop） */
  host: CanvasHostHandle
  /** 节点展示注册表（content/toolbar 段组件） */
  registry: NodeRegistry
  /** 标题就地重命名写回（宿主总给，按需用） */
  nodeWrite: NodeWrite
  /** 浮动端口外观（响应式对象，属性改实时生效） */
  handleParams: CanvasParams
  /** 边外观（响应式对象） */
  edgeVisual: Partial<EdgeVisual>
  /** 选中集合（含 ref，供"相连被选即高亮"） */
  edgeSelection: EdgeSelection
  /** 拖线连接过程反馈（能力层 CanvasHost 维护；BaseNode/ConnectionLine 消费做 3D/气泡/吸附/压端口） */
  connectionState: ConnectionFeedbackState
  /** 画布交互状态（多属性组合：拖节点/pan/缩放/框选等活动位 + 派生 isBusy 等；theme/UI 消费做显隐/行为） */
  interaction: CanvasInteractionState
  /** 调试可视化开关（端口/吸附调试；响应式对象，属性改实时生效） */
  debug: CanvasDebug
  /** 吸附带配置（高占节点比例/宽/偏移/形状；属性改实时影响吸附判定与 BaseNode 调试叠加） */
  snapZone: SnapZoneConfig
  // ===== v2 完善（2026-09）：只读数据源 + 坐标能力，供插件(多选/浮层/装饰)消费，render 不掺决策 =====
  /** 当前画布视口变换（响应式，pan/zoom 实时跟；浮层定位/坐标换算用） */
  viewport: Readonly<Ref<ViewportState>>
  /** 视口 pane 的 DOM 矩形（client 坐标基准；未挂载/无 DOM 时 null） */
  paneRect: Readonly<Ref<DOMRect | null>>
  /** 画布 pane DOM 元素（插件自绘框选/手势监听挂载点；未挂载时 null） */
  pane: Readonly<Ref<HTMLElement | null>>
  /** 当前渲染节点只读快照（含选中标记与位置；宿主订阅 store 自动重灌；拖动中为最近一次同步态） */
  renderNodes: Readonly<Ref<ReadonlyArray<FlowNode>>>
  /** 当前渲染边只读快照 */
  renderEdges: Readonly<Ref<ReadonlyArray<{ id: string; type: string; source: string; target: string }>>>
  /** 屏幕 client 坐标 → flow(画布)坐标（pane 偏移 + 视口逆变换；由 VueFlow 官方换算保证可靠） */
  screenToFlow(clientX: number, clientY: number): { x: number; y: number }
  /** flow(画布)坐标 → 屏幕 client 坐标（浮层画线/手柄定位/对齐线用） */
  flowToScreen(flowX: number, flowY: number): { x: number; y: number }
  /**
   * 拖拽中把某节点的视觉位置写到渲染层（VueFlow 内部节点）——不触发 store/整组替换。
   * 用途：对齐吸附/参考线等"拖动过程中实时微调被拖节点位置"的插件能力；
   * 拖拽结束的位置落盘仍由宿主照常处理（nodeDragStop → store）。
   */
  updateNodeVisual(id: string, position: { x: number; y: number }): void
}

/** 单令牌：CanvasSurface provide、消费方经 useCanvasRender() 取 */
export const RENDER_CONTEXT_KEY: InjectionKey<CanvasRenderContext> = Symbol('canvas-v2-render-context')

/**
 * 取渲染宿主上下文。必须在 <CanvasHost> 的渲染子树内(CanvasSurface provide 作用域下)调用；
 * 不在宿主内会抛清晰错误（这些渲染组件本就依赖宿主能力）。
 */
export function useCanvasRender(): CanvasRenderContext {
  const ctx = inject(RENDER_CONTEXT_KEY, null)
  if (!ctx) {
    throw new Error('[useCanvasRender] 缺少渲染上下文：请确保该组件渲染在 <CanvasHost> 之内（宿主未 provide RENDER_CONTEXT_KEY）')
  }
  return ctx
}

