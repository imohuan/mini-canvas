<script setup lang="ts">
// CanvasSurface —— CanvasHost 的「渲染子树宿主」：boot 完成后才挂载，向子树 provide 裸渲染上下文。
//
// 为什么单独一个组件：CanvasHost 自身在 setup 期就要 provide（那时 ctx 还没建好，只能给 Ref 盒子），
// 导致渲染组件拿 ctx 要 .value + 判空。本组件在 boot 完成(booting=false)后才由 CanvasHost 以 v-else 挂载，
// 其 setup 执行时 props.host 已就绪 —— 所以它能 provide **裸 ctx / 裸 host**，消费组件直接
// `useCanvasRender().ctx.get('doc')`，零 value 零判空。
//
// 职责边界（只管「渲染 + provide 裸上下文」）：
// - 接收 CanvasHost 传入的已就绪数据(host/registry/外观/渲染态)与交互回调，原样转发给 VueFlow。
// - provide RENDER_CONTEXT_KEY(裸)：单一令牌，消费方一律走 useCanvasRender()。
// - 不持有业务逻辑：所有 handler/订阅/生命周期仍在 CanvasHost，经 props 传入，避免状态双份。
import { provide, shallowRef, ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { VueFlow, useVueFlow, ConnectionMode } from '@vue-flow/core'
import type { Connection, NodeMouseEvent, NodeDragEvent, EdgeMouseEvent } from '@vue-flow/core'
import type { CanvasHostHandle } from './createMiniCanvasHost'
import type { NodeRegistry } from '@mini-canvas/canvas-data'
import type { NodeWrite } from '../contracts/nodeRegistryKey'
import type { CanvasParams } from '../contracts/canvasParamKey'
import type { EdgeVisual, EdgeSelection } from '../contracts/edgeContext'
import type { ConnectionFeedbackState } from '../contracts/connectionContext'
import type { CanvasInteractionState } from '../contracts/interactionContext'
import type { CanvasRenderContext } from '../contracts/renderContext'
import { RENDER_CONTEXT_KEY } from '../contracts/renderContext'
import type { FlowNode } from './canvasHostCore'
import type { ViewportState } from '../viewport/viewportService'
import type { CanvasDebug } from '../contracts/debugContext'
import type { SnapZoneConfig } from '../connection/geometry'
import type { CanvasInteractionSettings } from '../contracts/canvasInteractionSettings'
import SlotHost from '../components/SlotHost.vue'
import ConnectionLineHost from './ConnectionLineHost.vue'
import { useNodeMeasure, resolveMeasureContainer } from './useNodeMeasure'
import { applyRapidModeStyle, clearRapidModeStyle } from './rapidModeStyle'
import { usePaneSizeObserver } from './paneSize'
import { applyNodeVisualSize, type NodeVisualSyncApi } from './nodeVisualSync'
import { createCanvasFlowController } from '../contracts/canvasFlowApi'
import type { ViewportBackend } from '../viewport/viewportService'
import { viewportRectInFlow, expandRect, rectsOverlap, type FlowRect } from '../geometry/visibleArea'
import type { LayoutRect, NodeLayoutService } from '../layout/nodeLayout'
import { LAYERS } from '../contracts/layers'
import { NODE_TOOLBAR_HOST_KEY } from '../contracts/nodeToolbarHost'

const props = defineProps<{
  /** boot 后已就绪的宿主句柄。模板类型上可为空(父级 v-else 保证 boot 完成才挂载本组件)，
   *  setup 里空则抛错，实际不会触发。 */
  host?: CanvasHostHandle | undefined
  registry: NodeRegistry
  nodeWrite: NodeWrite
  handleParams: CanvasParams
  edgeVisual: Partial<EdgeVisual>
  edgeSelection: EdgeSelection
  connectionState: ConnectionFeedbackState
  /** 画布交互状态（CanvasHost 维护；塞进 renderCtx 供 theme/UI 消费显隐/行为） */
  interaction: CanvasInteractionState
  /** Host 端 mousemove 实时写的 flow 坐标（VueFlow lineProps 不可靠时由这里驱动连接线端点）。可空（拖线外时段）。 */
  dragFlowPoint?: { x: number; y: number } | null
  debugVisual: CanvasDebug
  /** 吸附带配置（响应式对象，属性改实时影响吸附判定 + BaseNode 调试叠加） */
  snapZone: SnapZoneConfig
  // —— VueFlow 渲染态数据（CanvasHost 订阅 store 持续更新，经 ref 解包成裸数组传入）——
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodes: any[]
  edges: Array<{ id: string; type: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodeTypes: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  edgeTypes: Record<string, any>
  backgroundComp: unknown
  /** 拖线临时连接线组件（connectionLine 槽赢家；undefined → ConnectionLineHost 回退默认线） */
  connectionLineComp: unknown
  /** 插件变更后 bump → 给 VueFlow 加 key 强制重挂 */
  nodeEpoch: number
  /** 画布交互配置（「常规/画布」；CanvasHost 从 settings 读成响应式对象，改值实时生效） */
  interactionSettings: CanvasInteractionSettings
  /** 可视矩形变化回调（剔除刷新入口）：viewport/pane 每次变化都会带最新 FlowRect 调用（可为 null=不可用） */
  onVisibleRectChange?: (rect: FlowRect | null) => void
  // —— VueFlow 交互回调（均在 CanvasHost 持有，引用其 refs）——
  isValidConnection: (conn: Connection) => boolean
  onConnect: (conn: Connection) => void
  onConnectStart: (p: { nodeId?: string; handleId: string | null; handleType?: 'source' | 'target' }) => void
  onConnectEnd: () => void
  onNodeClick: (e: NodeMouseEvent) => void
  onEdgeClick: (e: EdgeMouseEvent) => void
  onNodeDrag: (e: NodeDragEvent) => void
  onNodeDragStart: (e: NodeDragEvent) => void
  onNodeDragStop: (e: NodeDragEvent) => void
  onMoveStart: () => void
  onMoveEnd: () => void
  onPaneClick: () => void
  onNodeContextMenu: (e: NodeMouseEvent) => void
  onEdgeContextMenu: (e: EdgeMouseEvent) => void
  onPaneContextMenu: (e: MouseEvent) => void
}>()

// ==================== provide 裸渲染上下文（本组件 boot 后才挂载 → ctx/host 已就绪，全是裸值） ====================
const host = props.host
if (!host) {
  // 父级 v-else 保证 boot 完成才挂载本组件，正常不会走到；防御性报错以免渲染子树拿到空宿主。
  throw new Error('[CanvasSurface] 宿主未就绪：CanvasSurface 仅应在 boot 完成后挂载')
}
// 闭包安全的非空 ctx（setup 内 throw 收窄不作用于嵌套函数，故先取出给 collectVisibleNodes 等用）
const hostCtx = host.ctx
// VueFlow 实例（viewport/screen-flow/flow-screen 等视图能力的来源；在 provide renderCtx 前拿到）
const vfApi = useVueFlow()

/**
 * 有就绪状态的 Flow 能力面（T04）：CanvasSurface 一 setup 就建它（detached），
 * VueFlow 能力在 onMounted 里 attachFlow，DOM 锚点同处 attachDom。
 * 未挂载期间对它的调用会抛明确错误（不返回默认坐标/不做 no-op）。
 */
const flow = createCanvasFlowController()

// —— 只读数据源 refs（供 renderCtx 暴露给插件；宿主/本组件维护，插件只读）——
// 渲染态节点/边：随 props.nodes/edges(宿主订阅 store 自动重灌)同步，包成稳定 ref 供上下文消费方响应式读
const renderNodesRef = shallowRef<ReadonlyArray<FlowNode>>(props.nodes ?? [])
const renderEdgesRef = shallowRef<ReadonlyArray<{ id: string; type: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }>>(props.edges ?? [])
watch(
  () => props.nodes,
  (v) => { renderNodesRef.value = v ?? [] },
)
watch(
  () => props.edges,
  (v) => { renderEdgesRef.value = v ?? [] },
)
// 视口变换：跟随 VueFlow viewport（响应式 computed）
const viewportRef = shallowRef<ViewportState>({ x: 0, y: 0, zoom: 1 })
flow.attachViewportSource(viewportRef)
watch(
  () => (vfApi.viewport as unknown as { value?: ViewportState })?.value,
  (v) => { if (v) viewportRef.value = { x: v.x, y: v.y, zoom: v.zoom } },
  { immediate: true },
)
// pane DOM 矩形：onMounted 后填（见下方 paneEl 捕获）；move 事件经 CanvasHost 已桥，这里 watch viewport 变化时刷新
const paneRectRef = shallowRef<DOMRect | null>(null)
const paneEl = ref<HTMLElement | null>(null)
/**
 * pane 尺寸持续观测（2026-10-17 修复）：可视区 = viewport 变换 + pane 像素尺寸。
 * 以前只在挂载 / 插件重挂时量一次，窗口被拖动或响应式布局改变后 pane 已变、矩形还是旧的，
 * 于是可见剔除按旧视口算 —— 该显示的节点被隐藏。现在交给 ResizeObserver 盯着。
 */
const paneSize = usePaneSizeObserver((rect) => {
  paneRectRef.value = rect
  // VueFlow 能力面同样读 paneRect（小地图 / 裁剪浮层等消费方），同步过去
  flow.setPaneRect(rect)
})
// pane 尺寸按像素量；视口缩放变了也要重算 flow 坐标下的可视矩形
watch(paneRectRef, refreshVisibleRect)
/**
 * 重新捕获本画布实例的 DOM 锚点（pane / renderer / paneRect）。
 *
 * 为什么必须"重新"捕获：VueFlow 挂在 nodeEpoch 这个 key 上，而插件装/卸会 bump nodeEpoch
 * → 整棵 VueFlow 子树销毁重建 → pane 变成一个全新的 DOM 元素。
 * 若只在 onMounted 里捕获一次，paneEl 永远停在那个**已脱离文档**的旧元素上：
 *   · 事件绑不上去（绑在死元素上收不到 pointer 事件）——多选的 Shift 框选因此整体失效；
 *   · 屏幕坐标量出来的矩形也是旧的。
 * 冷启动时插件在 VueFlow 挂载**之前**就注册好（此后只重挂一次），所以那个场景看着正常；
 * 一旦改成运行期逐个安装插件（每个都触发一次重挂），问题才暴露。
 */
function refreshFlowDom(): void {
  const flowRoot = rootEl.value
  paneEl.value = (flowRoot?.querySelector('.vue-flow__pane') as HTMLElement | null) ?? null
  rendererEl.value = resolveMeasureContainer(flowRoot)
  // 交给持续观测：换元素时自动断开旧观测、立即量一次
  paneSize.observe(paneEl.value)
}
/**
 * 节点上/下控制栏的画布级宿主（flow 坐标系）。
 *
 * 为什么要有这一层（2026-09-29）：节点的控制栏原先住在节点壳内部，而 `.vue-flow__node` 带
 * transform（VueFlow 定位用）必然创建层叠上下文 —— 里面的 z-index 再大也越不过作为其**兄弟**的
 * 边层。用户开「连线显示在最上层」后控制栏就被边盖住（实测 216/3888 采样命中边）。
 * 让壳把控制栏 DOM Teleport 到这里（层值 LAYERS.nodeToolbar，压在置顶连线之上）即可解决，
 * 而逻辑/能力实例仍留在壳内（provider 沿组件树传递，共享关系不变）。
 *
 * 变换：外层跟随视口 translate+scale，于是子内容可直接用 flow 坐标定位
 * （与 multi-select 的 SelectionFrame / 分组控制栏同一套数学）。
 */
const nodeToolbarHostEl = ref<HTMLElement | null>(null)
provide(NODE_TOOLBAR_HOST_KEY, nodeToolbarHostEl)
/** 宿主外层的视口变换（flow 坐标 → 屏幕） */
const nodeToolbarHostTransform = computed(() => {
  const vp = viewportRef.value
  return { transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`, transformOrigin: '0 0' }
})
/** 本画布实例根 DOM（模板 ref）——实例级锚点，替代 document.querySelector('.vue-flow') */
const rootEl = ref<HTMLElement | null>(null)
/** 节点层 DOM（含 .vue-flow__node 的最内层容器；模板 ref 不可达内部渲染层，onMounted 内解析） */
const rendererEl = ref<HTMLElement | null>(null)

// 可视区(flow 坐标矩形)：由 viewport 变换 + pane 像素尺寸现算；响应式，pan/zoom/量测后自动更新。
const visibleRectRef = shallowRef<FlowRect | null>(null)
function refreshVisibleRect(): void {
  const pr = paneRectRef.value
  if (!pr || pr.width <= 0 || pr.height <= 0 || !viewportRef.value) {
    visibleRectRef.value = null
    return
  }
  visibleRectRef.value = viewportRectInFlow(viewportRef.value, pr.width, pr.height)
}
// viewport 变化时刷新可视矩形；onMounted 量到 pane 后由 paneRectRef 的 watch 刷一次
watch(viewportRef, refreshVisibleRect)
// —— 拖拽快速模式（dragRapidMode，2026-10-15 性能优化 P1）——
// Chrome：脚本改 transform scale 时每帧重光栅化，把节点层提升为合成层能固定位图、提升速度
// （developer.chrome.com/blog/re-rastering-composite；实测节点层 96ms→24.8ms/帧）。
// 代价：手势期间放大看略糊。挂在节点层（比 transformationpane 更省，见诊断报告 §三原因2）。
//
// ⚠️ 绝不能用 will-change: transform（2026-10-27 用户实测：平移画布时连线在节点上下反复跳）。
// 原因：.vue-flow__nodes 是每边 SVG 的兄弟。给它写 will-change:transform（或 transform/filter/
// opacity/isolation 这类会建层叠上下文的属性）会把节点层变成层叠上下文 —— 此时该容器 z-index 为
// auto、不参与兄弟间 z 比较，容器内所有节点（普通 200 / 选中 300）整体落到兄弟边的层叠顺序里，
// 于是由「节点压边」变成「边压节点」。平移时加、300ms 后摘，画面就来回切。
// 改用 backface-visibility: hidden：同样触发合成层提升，但不创建层叠上下文，层级语义不变
// （见 contracts/layers.ts 门牌：层序只有一处可读、可测、可改）。
// 开关时机：viewport 开始变化时加，停止 300ms 后摘（避免频繁开关本身的一次性成本）。
let rapidOffTimer: ReturnType<typeof setTimeout> | null = null
watch(viewportRef, () => {
  if (!props.interactionSettings.dragRapidMode) return
  applyRapidModeStyle(rootEl.value?.querySelector<HTMLElement>('.vue-flow__nodes'))
  if (rapidOffTimer) clearTimeout(rapidOffTimer)
  rapidOffTimer = setTimeout(() => {
    rapidOffTimer = null
    clearRapidModeStyle(rootEl.value?.querySelector<HTMLElement>('.vue-flow__nodes'))
  }, 300)
})
// 可视矩形 → 宿主（剔除刷新入口；宿主侧 rAF 节流，这里直呼不节流）
watch(visibleRectRef, (rect) => {
  props.onVisibleRectChange?.(rect)
})

/** 屏幕 client → flow（官方换算，可靠） */
function screenToFlow(clientX: number, clientY: number): { x: number; y: number } {
  const p = vfApi.screenToFlowCoordinate({ x: clientX, y: clientY }) as { x: number; y: number }
  return { x: p.x, y: p.y }
}
/** flow → 屏幕 client（官方换算） */
function flowToScreen(flowX: number, flowY: number): { x: number; y: number } {
  const p = vfApi.flowToScreenCoordinate({ x: flowX, y: flowY }) as { x: number; y: number }
  return { x: p.x, y: p.y }
}

/** 拖拽中把单节点视觉位置写到 VueFlow 内部（不触发 store/整组替换）——对齐吸附等插件用 */
function updateNodeVisual(id: string, position: { x: number; y: number }): void {
  vfApi.updateNode(id, { position })
}

/**
 * 拖拽中把单节点**视觉尺寸**同步进 VueFlow 并强制重算内部（端口位置 / 相连边端点）。
 * resize 拖拽绕过 store 直接改卡片尺寸，VueFlow 内部尺寸不跟就会导致"端口/边停在旧位置"。
 * 两步：先写尺寸（外层盒子来源）、再 updateNodeInternals 让 VueFlow 重算 handle / 边。
 */
function updateNodeVisualSize(id: string, w: number, h: number): void {
  applyNodeVisualSize(vfApi as unknown as NodeVisualSyncApi, id, w, h)
}

/** 当前可视区内(或外扩 margin)的存活节点矩形列表 —— 供 align-guide 等按可视区裁剪候选，免全量 O(n) 逐帧 */
function collectVisibleNodes(margin = 0): LayoutRect[] {
  const vr = visibleRectRef.value
  if (!vr) return []
  const area = margin > 0 ? expandRect(vr, margin) : vr
  const layout = hostCtx.get<NodeLayoutService>('nodeLayout')
  return layout.getAllRects().filter((r) => rectsOverlap(r, area))
}

const renderCtx: CanvasRenderContext = {
  ctx: host.ctx,
  host,
  registry: props.registry,
  nodeWrite: props.nodeWrite,
  handleParams: props.handleParams,
  edgeVisual: props.edgeVisual,
  edgeSelection: props.edgeSelection,
  connectionState: props.connectionState,
  interaction: props.interaction,
  debug: props.debugVisual,
  snapZone: props.snapZone,
  flow,
  renderNodes: renderNodesRef,
  renderEdges: renderEdgesRef,
  visibleRect: visibleRectRef,
  visibleNodes: collectVisibleNodes,
}
provide(RENDER_CONTEXT_KEY, renderCtx)

// 节点实测尺寸注入 nodeLayout（ResizeObserver + MutationObserver）；start 在 onMounted 内（renderer DOM 就绪后）
const measure = useNodeMeasure({
  nodeLayout: host.nodeLayout,
  container: () => rendererEl.value,
})
onBeforeUnmount(() => {
  measure.stop()
  paneSize.stop()
  // 销毁 Flow 能力面：此后任何调用都抛 NotReady（不再指向已卸载的 VueFlow 实例）
  flow.dispose()
})
onMounted(() => {
  // VueFlow 渲染后 .vue-flow__pane 已在 DOM（实例根内查询，多宿主页面不串线），捕获以量屏幕坐标
  const flowRoot = rootEl.value
  // 节点层容器：按"含 .vue-flow__node 的最内层节点容器"解析（Vue Flow 1.48 无 .vue-flow__renderer，
  // 旧写法恒为 null 会让节点实测尺寸永不注入 → 自动布局按默认尺寸错算）
  // 捕获 pane/renderer 的**统一入口**（见下方 refreshFlowDom 注释）：nodeEpoch 会让 VueFlow 整树重挂，
  // pane DOM 会被换成一个新元素 —— 必须跟着刷新，否则插件（如多选的 Shift 框选）会一直绑在旧元素上。
  refreshFlowDom()
  // VueFlow 后端：一个适配对象，同时喂给旧 ViewportService（ctx.get('viewport')）与新的
  // Flow 能力面（useCanvasRender().flow）——同一份实现，两处语义不再各写一遍。
  const backend: ViewportBackend = {
    getViewport: () => {
      const vp = (vfApi.viewport as unknown as { value?: { x: number; y: number; zoom: number } }).value
      return vp ? { x: vp.x, y: vp.y, zoom: vp.zoom } : { x: 0, y: 0, zoom: 1 }
    },
    screenToFlow: (x: number, y: number) => {
      const p = vfApi.screenToFlowCoordinate({ x, y }) as { x: number; y: number }
      return { x: p.x, y: p.y }
    },
    flowToScreen: (x: number, y: number) => {
      // 用 VueFlow 官方 flowToScreenCoordinate（处理 dom 偏移 + viewport transform），避免手算公式出错
      const p = vfApi.flowToScreenCoordinate({ x, y }) as { x: number; y: number }
      return { x: p.x, y: p.y }
    },
    zoomIn: () => vfApi.zoomIn({ duration: 200 }),
    zoomOut: () => vfApi.zoomOut({ duration: 200 }),
    zoomTo: (level: number) => vfApi.zoomTo(level, { duration: 200 }),
    fitView: (padding?: number) => vfApi.fitView({ padding: padding ?? 0.1, duration: 200 }),
    setCenter: (x: number, y: number, zoom?: number) =>
      vfApi.setCenter(x, y, zoom !== undefined ? { zoom, duration: 200 } : { duration: 200 }),
    // setViewport = 程序化定位（小地图拖拽/自动布局聚焦/框选平移等"跟手"场景）→ 必须即时生效。
    // 带 duration 会让每帧拖拽都重启一次 200ms 补间动画，严重卡顿（老版 PluginContext.setViewport 即无动画）。
    setViewport: (v: { x: number; y: number; zoom: number }) => vfApi.setViewport(v),
    // 带过渡的取景（聚焦/适配这类一次性动作）：VueFlow 的 setViewport 接受 duration，
    // 走的是它自己的补间；「跟手」场景仍用上面那条即时版。
    animateViewport: (v: { x: number; y: number; zoom: number }, durationMs = 320) =>
      vfApi.setViewport(v, { duration: durationMs }),
    // 拖拽中视觉写位置（对齐吸附/多选整组移动用；不落盘）
    updateNodeVisual: (id: string, position: { x: number; y: number }) => {
      vfApi.updateNode(id, { position })
    },
    getNodeRenderPosition: (id: string) => {
      const node = (vfApi.getNodes.value ?? []).find((n) => n.id === id)
      return node ? ((node.computedPosition || node.position) as { x: number; y: number }) : undefined
    },
    // —— 实例级 DOM（多宿主页面不串线：一律在本实例根内查询）——
    getRootEl: () => rootEl.value,
    getRendererEl: () => rendererEl.value,
    getPaneEl: () => paneEl.value,
    queryNodeEl: (nodeId: string) =>
      rootEl.value?.querySelector(`.vue-flow__node[data-id="${nodeId}"]`) ?? null,
  }
  // 视口服务接线（旧入口保留）：把 VueFlow 能力 attach 到 host.viewport
  props.host?.viewport.attachBackend(backend)
  // Flow 能力面（T04）：实例就绪（flow-ready）→ DOM 锚点捕获（dom-ready）
  flow.attachFlow(backend)
  flow.attachNodeVisual(vfApi as unknown as NodeVisualSyncApi)
  flow.attachPositionReader((id: string) => {
    const node = (vfApi.getNodes.value ?? []).find((n) => n.id === id)
    return node ? ((node.computedPosition || node.position) as { x: number; y: number }) : undefined
  })
  flow.attachDom({
    rootEl: () => rootEl.value,
    rendererEl: () => rendererEl.value,
    paneEl: () => paneEl.value,
    queryNodeEl: (nodeId: string) =>
      rootEl.value?.querySelector(`.vue-flow__node[data-id="${nodeId}"]`) ?? null,
  }, paneRectRef.value)
  // renderer DOM 就绪后启动节点尺寸观测（在 onMounted 内，容器已挂载）
  measure.start()
})

// nodeEpoch 变化 = VueFlow 整树重挂 → pane/renderer 是新 DOM 元素。
// 必须重新捕获 + 重新 attachDom，把新的 pane 元素灌进 flow.pane，
// 否则消费方（BoxSelectLayer 的 Shift 框选、依赖 pane 的插件）会一直绑在旧元素上。
// 在 flush: 'post' 里做（等 Vue 把新子树真正挂到 DOM 之后）。
watch(
  () => props.nodeEpoch,
  () => {
    if (!rootEl.value) return
    refreshFlowDom()
    flow.attachDom({
      rootEl: () => rootEl.value,
      rendererEl: () => rendererEl.value,
      paneEl: () => paneEl.value,
      queryNodeEl: (nodeId: string) =>
        rootEl.value?.querySelector(`.vue-flow__node[data-id="${nodeId}"]`) ?? null,
    }, paneRectRef.value)
    measure.start()
  },
  { flush: 'post' },
)

// expose 给父：父级拖线时用 VueFlow 自带的 screenToFlowCoordinate（已处理 zoom/pan + pane 偏移，
// 比手算 rect.left / zoom 准）。paneRect 也一并暴露，兜底用。
defineExpose({
  /** 在**本画布实例**内按 data-id 查节点 DOM（实例级，多宿主不串线；替代全局 document.querySelector） */
  queryNodeEl: (nodeId: string): HTMLElement | null =>
    rootEl.value?.querySelector(`.vue-flow__node[data-id="${nodeId}"]`) ?? null,
  getViewport: () => {
    const vp = (vfApi.viewport as unknown as { value?: { x: number; y: number; zoom: number } }).value
    return vp
      ? { x: vp.x, y: vp.y, zoom: vp.zoom }
      : (vfApi.viewport as unknown as { x: number; y: number; zoom: number })
  },
  getPaneRect: (): DOMRect | null => (paneEl.value ? paneEl.value.getBoundingClientRect() : null),
  /** 当前可视区（flow 坐标矩形）：宿主做可见剔除判定用（visibleCull）；未挂载/量不到时 null */
  getVisibleRect: (): FlowRect | null => visibleRectRef.value,
  /** 当前被 VueFlow 选中的节点 id（框选/多选后读；供宿主回写内核） */
  /** 当前选中节点的最新位置（多选拖动落盘用：VueFlow 已把位移应用到全部选中节点） */
  getSelectedNodePositions: () =>
    (vfApi.getSelectedNodes.value ?? []).map((n) => ({ id: n.id, x: n.position.x, y: n.position.y })),
  /**
   * 当前正在被 VueFlow 拖动的节点及其实时位置（拖动期间 store 尚未落盘）。
   * 宿主重灌渲染态时用它保留拖动位置，避免滚轮缩放引发的可见集合变化把节点拉回旧位置。
   */
  getDraggingNodePositions: () => {
    const out = new Map<string, { x: number; y: number }>()
    for (const node of vfApi.getNodes.value ?? []) {
      if (!node.dragging) continue
      const p = node.computedPosition || node.position
      out.set(node.id, { x: p.x, y: p.y })
    }
    return out
  },
  /** 当前被 VueFlow 选中的边 id */
  /** 把屏幕坐标(clientX/Y)→flow 坐标，由 VueFlow 自身处理（缩放/平移完全可靠） */
  screenToFlow: (x: number, y: number): { x: number; y: number } => {
    const p = vfApi.screenToFlowCoordinate({ x, y }) as { x: number; y: number }
    return { x: p.x, y: p.y }
  },
  /** 把 flow 坐标→屏幕 client 坐标（供浮层定位/对齐线画在屏幕层） */
  flowToScreen: (x: number, y: number): { x: number; y: number } => {
    const p = vfApi.flowToScreenCoordinate({ x, y }) as { x: number; y: number }
    return { x: p.x, y: p.y }
  },
  // —— 视图控制（viewport 服务 backend 用）——
  zoomIn: () => vfApi.zoomIn({ duration: 200 }),
  zoomOut: () => vfApi.zoomOut({ duration: 200 }),
  zoomTo: (level: number) => vfApi.zoomTo(level, { duration: 200 }),
  fitView: (padding?: number) => vfApi.fitView({ padding: padding ?? 0.1, duration: 200 }),
  setCenter: (x: number, y: number, zoom?: number) =>
    vfApi.setCenter(x, y, zoom !== undefined ? { zoom, duration: 200 } : { duration: 200 }),
  setViewport: (v: { x: number; y: number; zoom: number }) => vfApi.setViewport(v),
  // 带过渡的取景（聚焦/适配这类一次性动作）；「跟手」场景仍用上面那条即时版
  animateViewport: (v: { x: number; y: number; zoom: number }, durationMs = 320) =>
    vfApi.setViewport(v, { duration: durationMs }),
})
</script>

<template>
  <div ref="rootEl" class="csurface">
    <VueFlow
      :key="nodeEpoch"
      :nodes="nodes"
      :edges="edges"
      :node-types="nodeTypes"
      :edge-types="edgeTypes"
      :is-valid-connection="isValidConnection"
      :connection-mode="ConnectionMode.Strict"
      :elevate-nodes-on-select="false"
      :nodes-draggable="interactionSettings.nodesDraggable"
      :nodes-connectable="interactionSettings.nodesConnectable"
      :elements-selectable="interactionSettings.elementsSelectable"
      :select-nodes-on-drag="interactionSettings.selectNodesOnDrag"
      :snap-to-grid="interactionSettings.snapToGrid"
      :snap-grid="interactionSettings.snapGrid"
      :zoom-on-scroll="interactionSettings.zoomOnScroll"
      :zoom-on-pinch="interactionSettings.zoomOnPinch"
      :pan-on-scroll="interactionSettings.panOnScroll"
      :pan-on-drag="interactionSettings.panOnDrag"
      :zoom-on-double-click="interactionSettings.zoomOnDoubleClick"
      :only-render-visible-elements="interactionSettings.onlyRenderVisibleElements"
      :prevent-scrolling="interactionSettings.preventScrolling"
      :min-zoom="interactionSettings.minZoom"
      :max-zoom="interactionSettings.maxZoom"
      :selection-key-code="null"
      :multi-selection-key-code="null"
      @connect="onConnect"
      @connect-start="onConnectStart"
      @connect-end="onConnectEnd"
      @node-click="onNodeClick"
      @edge-click="onEdgeClick"
      @node-drag="onNodeDrag"
      @node-drag-start="onNodeDragStart"
      @node-drag-stop="onNodeDragStop"
      @move-start="onMoveStart"
      @move-end="onMoveEnd"
      @pane-click="onPaneClick"
      @node-context-menu="onNodeContextMenu"
      @edge-context-menu="onEdgeContextMenu"
      @pane-context-menu="onPaneContextMenu"
    >
      <!-- 主题插件提供的画布背景（垫在节点之下）；未提供则空 -->
      <component :is="backgroundComp" v-if="backgroundComp" />
      <!-- 拖线临时连接线：能力层每帧算吸附/反馈并写 connectionState，渲染主题 connectionLine 赢家或回退默认线 -->
      <template #connection-line="lineProps">
        <ConnectionLineHost
          :line-props="lineProps"
          :connection-line="connectionLineComp"
          :state="connectionState"
          :drag-flow-point="dragFlowPoint ?? null"
        />
      </template>
      <!-- 父级可经默认插槽往 VueFlow 内塞自定义背景/控件 -->
      <slot />
    </VueFlow>

    <!-- 通用 UI 槽(overlay)：渲染层封装成 SlotHost，自动读 ctx.slots.occupants('overlay') 并按序渲染。
         z-index 用 LAYERS.overlay（唯一事实源）：它必须压过整棵 VueFlow（包括置顶连线）。 -->
    <div class="csurface-overlay" :style="{ zIndex: LAYERS.overlay }">
      <SlotHost slot="overlay" item-class="csurface-overlay-item" />
    </div>

    <!-- 节点上/下控制栏的画布级宿主：压过整棵 VueFlow（含置顶连线），但低于上面的 overlay 槽。
         节点壳（BaseNode）把控制栏 DOM Teleport 进 .csurface-node-toolbars（见 NODE_TOOLBAR_HOST_KEY）。
         外层跟随视口变换，所以内部按 flow 坐标定位；零尺寸 + 不接事件（真实可点区域在控制栏自身）。 -->
    <div class="csurface-node-toolbar-layer" :style="{ zIndex: LAYERS.nodeToolbar }">
      <div ref="nodeToolbarHostEl" class="csurface-node-toolbars" :style="nodeToolbarHostTransform" />
    </div>

    <!-- 宿主业务 UI 区(#ui)：宿主把 toolbar/设置 dock/右键菜单等画布之上的 UI 放这里，即可经 useCanvasRender 读 ctx。
         SlotHost / SettingsHost 在本作用域内任意嵌套可用。CanvasHost 不内置任何业务 UI，只把具名插槽转发到这里。 -->
    <slot name="ui" />
  </div>
</template>

<style scoped>
.csurface {
  position: relative;
  width: 100%;
  height: 100%;
}
.csurface :deep(.vue-flow__node) {
  /* 节点卡片外观由主题 nodeShell(如 BaseNode 的 .v2-card)统一负责；这里只留布局与光标 */
  font-size: 14px;
  background: transparent;
  border: none;
  box-shadow: none;
}
.csurface-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none; /* 不挡画布交互；浮层控件自己开 pointer-events 才能点 */
  /* z-index 由模板 :style 绑 LAYERS.overlay 注入（唯一事实源）；此处不再写死 */
  overflow: hidden;
}
/* 控制栏层：铺满画布、不接事件（真实可点区域是控制栏自己）；零尺寸子容器承载 flow 坐标内容。
   overflow 必须 visible：节点上/下状态栏都挂在这一层里（BaseNode 的 out:top / out:bottom 锚点），
   卡片贴近视口边缘时状态栏会超出画布矩形 —— 裁掉就等于「下栏突然消失」（用户实测报过）。
   本层 pointer-events:none，溢出内容不会挡住画布交互。 */
.csurface-node-toolbar-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}
.csurface-node-toolbars {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  overflow: visible;
}
</style>

<style>
/* 浮层里的 occupant(由 SlotHost 渲染)要能点：容器 pointer-events:none，item 恢复 auto。
   放全局(非 scoped)是因为 item 元素由 SlotHost(子组件)渲染，scoped 选择器够不到。 */
.csurface-overlay .csurface-overlay-item {
  pointer-events: auto;
}
/*
 * 例外：全画布矩形类浮层（多选框、对齐线、临时选择层…）自身内部不承载可点内容，
 * 必须把 SlotHost 恢复的 auto 再压回 none，否则会盖住外壳（左抽屉/状态条/底栏）的点击
 * （2026-10-28 用户实测：装外壳插槽演示插件后整页点不动，DevTools 显示
 * .multi-select-box-layer.csurface-overlay-item 拦截了所有 pointer events）。
 * 判定按类名：这些层的共同特征是"铺满 inset:0 的命中收集层"。新浮层若需要可点内容，
 * 要么给内部元素显式 pointer-events:auto，要么不要用 *-box-layer / *-layer 类名结尾。
 */
.csurface-overlay .csurface-overlay-item.multi-select-box-layer,
.csurface-overlay .csurface-overlay-item.align-guide-layer {
  pointer-events: none;
}
</style>
