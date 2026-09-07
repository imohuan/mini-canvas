<script setup lang="ts">
/**
 * CanvasHost —— 官方渲染宿主组件：把 VueFlow 装配/数据同步/通用交互全部收进内部，调用方一行渲染。
 *
 * 解决的问题（见 docs/plan/canvas-host-component-plan.md）：CanvasDemo.vue 那套手写装配(~340行)散落在各 demo，
 * 每个宿主都要重复 provide 令牌 + 自己 mount VueFlow + store↔flow 双向同步。本组件把这些收编并藏起来。
 *
 * 职责边界：
 * - 建内核宿主(createMiniCanvasHost) + 冷启动插件 → 订阅 nodeStore 变化自动重灌渲染态。
 * - provide 全套渲染契约令牌(HOST/NODE_REGISTRY/NODE_WRITE/CANVAS_PARAMS/EDGE_VISUAL/EDGE_SELECTION)，
 *   供 BaseNode(壳)/content/边 这些渲染插件组件消费。
 * - 内部装配一个 <VueFlow>：读 themeRegistry 的 nodeShell/edge/edgeDefaultType/background 填给 VueFlow。
 * - 通用画布交互：拖拽落盘、点选同步内核 selection、连边校验+加边、键盘删除/撤销(经 command)。
 * - 生命周期：浏览器隐藏落盘、卸载回收插件副作用。
 *
 * 边界（不越权）：不内置业务工具栏/右键菜单(建哪些节点是 app 层的事)；父级经 defineExpose 的 host/api
 * 驱动业务操作，经 emit('context-menu') 弹自己的菜单。数据(节点增删/编辑)经 nodeStore 变化自动刷渲染态，
 * 父级/插件 service 改 store 后无需手动同步。
 *
 * 模板结构：本组件占满父容器高度(定位 100%)，内部是 booting/error + canvas-wrap(VueFlow+主题背景)。
 * 父级想加自己的 toolbar/面板，在本组件外层套一层 flex 布局即可。
 */
import { markRaw, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import type { Connection, NodeMouseEvent, NodeDragEvent, EdgeMouseEvent } from '@vue-flow/core'
import {
  NodeRegistry,
  type PluginClassLike,
  type PluginModule,
  type Disposable,
  type StorageAdapter,
  MemoryStorageAdapter,
  type CanvasNode,
  type CanvasEdge,
  type EdgeStoreService,
  GRAPH_EDGES_KEY,
  validateConnection,
  typeConnectionDef,
  type ValidationResult,
} from '@mini-canvas/canvas-core-v2'
import {
  createMiniCanvasHost,
  type CanvasHostHandle,
  type MiniCanvasApi,
} from './createMiniCanvasHost'
import type { PluginManager } from './pluginManager'
import type { PluginManifest } from './pluginManager'
import type { NodeWrite } from '../contracts/nodeRegistryKey'
import type { CanvasParams } from '../contracts/canvasParamKey'
import type { EdgeVisual } from '../contracts/edgeContext'
import type { ConnectionFeedbackState, FlowPoint, HoverFeedback, AimedTarget } from '../contracts/connectionContext'
import type { CanvasDebug } from '../contracts/debugContext'
import { createConnectionState, beginConnection, endConnection } from './connectionState'
import {
  createInteractionState,
  beginNodeDrag,
  endNodeDrag,
  beginViewportMove,
  endViewportMove,
} from '../contracts/interactionContext'
import { clickNode, clickEdge, clickPane } from './selectionInteractions'
import { RenderEvents, toDragPayload } from './renderEvents'
import { reasonText as reasonTextFrom } from '../connection/reasonText'
import type { HoverDecision } from '../connection/resolveFeedback'
import { oldestIncomingToEvict } from '../connection/edgeCapacity'
import { DEFAULT_SNAP_ZONE_CONFIG, type NodeRect, type SnapZoneConfig } from '../connection/geometry'
import { createV2Logger } from '../utils/log'
import CanvasSurface from './CanvasSurface.vue'
import {
  assembleTheme,
  nodesFromStore,
  DEFAULT_EDGE_VISUAL,
  DEFAULT_HANDLE_VISUAL,
  DEFAULT_DEBUG_VISUAL,
} from './canvasHostCore'

const log = createV2Logger('canvas-host')

// ==================== props / emits ====================

const props = withDefaults(
  defineProps<{
    /** 冷启动插件（顺序即装载序）。宿主负责给全：主题 + 业务节点插件。支持 PluginModule 对象与 Service 类。 */
    plugins: (PluginModule | PluginClassLike)[]
    /**
     * 装配清单冷启动（与 plugins 二选一，给则优先走 manifest：disabled/config 覆盖/同 id 换版本生效）。
     * 见 createMiniCanvasHost 的 MiniCanvasOptions.manifest。
     */
    manifest?: PluginManifest
    /** 存储后端。缺省内存 adapter（刷新即丢）。想要持久化传 LocalStorageAdapter。 */
    adapter?: StorageAdapter
    /** 首次(存储为空)生成默认画布；返回的节点会 replaceAll。 */
    seed?: () => CanvasNode[]
    /** 覆盖默认的标题写回实现（BaseNode 就地重命名用）。缺省：改 store data + 落盘。 */
    nodeWrite?: NodeWrite
    /** 自定义边外观覆盖（缺省对齐 contract §0）。传响应式对象可实时生效。 */
    edgeVisual?: Partial<EdgeVisual>
    /** 浮动端口尺寸覆盖（缺省对齐 contract §0）。BaseNode 读 handle 字段无回落，故需传含全部字段的响应式对象。 */
    handleVisual?: CanvasParams
    /** 调试可视化开关覆盖（缺省对齐 DEFAULT_DEBUG_VISUAL，均关）。传响应式对象可实时开关。 */
    debugVisual?: CanvasDebug
    /** 吸附带配置覆盖（缺省对齐 DEFAULT_SNAP_ZONE_CONFIG）。传响应式对象可实时调整吸附带。 */
    snapZoneVisual?: SnapZoneConfig
    /** VueFlow 缩放范围 */
    minZoom?: number
    maxZoom?: number
    /** 挂到 window 的调试 key；传空则不挂 */
    windowKey?: string
  }>(),
  {
    minZoom: 0.2,
    maxZoom: 2,
  },
)

const emit = defineEmits<{
  /** 右键菜单请求（已在内部 preventDefault）。父级据此弹业务菜单。 */
  (e: 'context-menu', payload: { kind: 'node' | 'pane'; clientX: number; clientY: number; nodeId?: string }): void
  /** 宿主就绪 */
  (e: 'ready', host: CanvasHostHandle): void
  (e: 'boot-error', error: Error): void
  /** 运行期某插件装载失败(经 ctx:lifecycle-change ERROR 事件上报，非轮询) */
  (e: 'plugin-issue', payload: { name: string; lifecycle: string }): void
}>()

// ==================== boot 状态 ====================

const booting = ref(true)
const bootError = ref('')
const hostRef = shallowRef<CanvasHostHandle | undefined>()
const apiRef = shallowRef<MiniCanvasApi | undefined>()
const managerRef = shallowRef<PluginManager | undefined>()
/** 内层 CanvasSurface ref（拖线 mousemove/mouseup 要从它拿 screenToFlow / viewport / pane） */
const surfaceRef = shallowRef<{
  getViewport?: () => { x: number; y: number; zoom: number }
  getPaneRect?: () => DOMRect | null
  screenToFlow?: (x: number, y: number) => { x: number; y: number }
  getSelectedNodeIds?: () => string[]
  getSelectedEdgeIds?: () => string[]
  getSelectedNodePositions?: () => Array<{ id: string; x: number; y: number }>
} | undefined>()

// ==================== 渲染子树的装配数据（经 props 交给内层 CanvasSurface 统一 provide） ====================
// provide 点已移到 CanvasSurface（boot 完成后才挂载，故能 provide 裸 ctx/host）：
// 这里只负责**准备**渲染子树要用的数据与回调，不 provide。

// 节点展示注册表：宿主自建，同时传入 boot(createMiniCanvasHost)。
// 插件 setup 经 ctx.get('nodeRegistry') 把 content 组件注册进来；BaseNode(壳)经此解析 content 段。
const registry = new NodeRegistry()

// 标题就地重命名写回：缺省 = 改内核 nodeStore data 并落盘。nodeStore.subscribe 会自动刷新渲染态，
// 无需像旧 demo 那样手动 map 改 nodes 数组。
function defaultWrite(id: string, patch: Record<string, unknown>): void {
  const h = hostRef.value
  if (!h) return
  const node = h.nodeStore.getNode(id)
  if (!node) return
  h.nodeStore.updateNodeData(id, patch) // 触发 subscribe → 渲染态自动更新
  void h.save.set('graph', h.nodeStore.getNodes(), 'canvas')
}
const nodeWrite: NodeWrite = props.nodeWrite ?? defaultWrite

// 外观参数注入：EDGE_VISUAL(边) / CANVAS_PARAMS(浮动端口)。
// 父级若传 props.edgeVisual / props.handleVisual（应为响应式对象，改属性实时生效），
// 我们直接传那个引用；未传则用内部 DEFAULT reactive 回落。
// 注意：BaseNode 读 handle 字段不做默认回落，故 handleVisual 需含全部 5 个字段（通常传一个全字段 reactive）。
const edgeDefaultR = reactive({ ...DEFAULT_EDGE_VISUAL })
const handleDefaultR = reactive({ ...DEFAULT_HANDLE_VISUAL })
const debugDefaultR = reactive({ ...DEFAULT_DEBUG_VISUAL })
const snapZoneDefaultR = reactive({ ...DEFAULT_SNAP_ZONE_CONFIG })
const edgeVisualToProvide = props.edgeVisual ?? edgeDefaultR
const handleToProvide = props.handleVisual ?? handleDefaultR
const debugToProvide = props.debugVisual ?? debugDefaultR
const snapZoneToProvide = props.snapZoneVisual ?? snapZoneDefaultR

// 选中集合注入给 CustomEdge：相连节点被选 → 边高亮流光。
// 以 ReadonlySet 形状暴露（消费方只读）。内核 Selection 是单源：本 ref 只是它的派生投影——
// 点击/清空/删除/撤销只写内核 selection，此处经订阅 onChange 整体替换新集合以触发响应式。
const selectedIds = ref<ReadonlySet<string>>(new Set())
const selectedEdgeSelRef = ref<ReadonlySet<string>>(new Set())
const edgeSelection = { selectedNodeIds: selectedIds, selectedEdgeIds: selectedEdgeSelRef }

// 拖线连接过程反馈状态（能力层）。onConnectStart/onConnectEnd 写入；每帧 hover 由 ConnectionLineHost 写。
// 同一引用经 renderContext provide，BaseNode/ConnectionLine 消费。
const connectionState: ConnectionFeedbackState = createConnectionState()
/** 画布交互状态（拖节点/pan/缩放等活动位 + 派生 isBusyDragging；CanvasSurface 塞进 renderCtx，theme/UI 消费）。
 *  A 决策：pan 与 wheel/pinch 缩放走 VueFlow 同一套 move 事件，不拆位——视图在动一律置 paneDragging
 *  (计入 isBusyDragging，端口被压)。zooming 位保留给未来需要细分"缩放手势"的场景。 */
const interaction = createInteractionState()
/** 拖线期间 Host 端实时 mouse 跟踪的 flow 坐标（VueFlow 自身 lineProps 不可靠时由这里兜底）。
 *  拖线开始时清零、mousemove 更新、connect-end 清零。供 ConnectionLineHost 渲染端点。 */
const dragFlowPoint = shallowRef<FlowPoint | null>(null)

/** 把内核 Selection 的 ids 投影成新的 ReadonlySet 引用（整体替换以触发 Vue 响应式） */
function syncSelected(): void {
  const h = hostRef.value
  if (!h) return
  selectedIds.value = new Set(h.selection.ids)
  selectedEdgeSelRef.value = new Set(h.selection.edgeIds)
  // 重建渲染态节点并带 selected 标记：内核选中(单击/框选/Ctrl+A)驱动 VueFlow 节点高亮一致
  nodes.value = nodesFromStore(h.nodeStore, h.selection.ids)
  h.ctx.emit(RenderEvents.SelectionChange, {
    nodeIds: [...h.selection.ids],
    edgeIds: [...h.selection.edgeIds],
  })
}

// ==================== 渲染态（VueFlow 消费）====================

const nodes = ref<ReturnType<typeof nodesFromStore>>([])
const edges = ref<Array<{ id: string; type: string; source: string; target: string }>>([])
// 组件句柄(opaque，来自 themeRegistry/registry)塞给 VueFlow 的 node-types/edge-types。
// 必须用 shallowRef：里面存的是 .vue 组件对象，ref 会深代理组件触发 Vue "组件被 reactive 化" 警告，
// 且我们总是整体替换 .value，浅层响应式就够。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeTypes = shallowRef<Record<string, any>>({})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edgeTypes = shallowRef<Record<string, any>>({})
// 背景也是组件句柄，同样浅层即可。
const backgroundComp = shallowRef<unknown>(undefined)
// 拖线临时连接线组件（connectionLine 槽赢家；未注册 undefined → ConnectionLineHost 回退默认线）。
const connectionLineComp = shallowRef<unknown>(undefined)
const edgeDefaultType = ref('custom')
const nodeEpoch = ref(0) // 插件变更后 bump → 触发 VueFlow 子树重挂

// 选中态：与内核 selection 双向——CustomEdge 高亮读 selectedIds；命令(command:delete)读内核 selection。
const canUndo = ref(false)
const canRedo = ref(false)

// ==================== 装配：主题 + nodeTypes ====================

function applyTheme(): void {
  const h = hostRef.value
  if (!h) return
  const asm = assembleTheme(h.themeRegistry, h.nodeStore.types.keys())
  // markRaw 组件句柄：防止它们被 VueFlow/响应式系统 proxy，避免 Vue "组件被 reactive 化" 警告与性能损耗。
  if (asm.nodeShell) {
    const shell = markRaw(asm.nodeShell)
    nodeTypes.value = {}
    for (const t of asm.nodeTypes) nodeTypes.value[t] = shell
  }
  if (asm.edge) edgeTypes.value = { custom: markRaw(asm.edge) }
  edgeDefaultType.value = asm.edgeDefaultType
  backgroundComp.value = asm.background ? markRaw(asm.background) : undefined
  connectionLineComp.value = asm.connectionLine ? markRaw(asm.connectionLine) : undefined
}

// ==================== 通用 UI 槽(overlay) ====================
// 渲染交给内层 CanvasSurface 里的 <SlotHost slot="overlay" />（SlotHost 自动读 ctx.slots.occupants 并按序渲染）。
// 这里不再维护 uiOverlay/syncUiOverlay——那段"读槽+markRaw+渲染"已抽成可复用组件 SlotHost。

// 订阅 nodeStore / edgeStore：任何增删改(命令/插件 service/拖拽/历史 undo redo)都自动重灌渲染态。
let unsubStore: (() => void) | undefined
let unsubEdge: (() => void) | undefined
let unsubSel: (() => void) | undefined

function syncFromStore(): void {
  const h = hostRef.value
  if (!h) return
  const alive = new Set(h.nodeStore.getNodes().map((n) => n.id))
  // 边数据源 = 内核 edgeStore（边下沉后唯一数据源）；渲染态取 source/target 仍存活的边(删除路径已在 edgeStore 清边,此处兜底过滤)。
  edges.value = h.edgeStore
    .getEdges()
    .filter((e) => alive.has(e.source) && alive.has(e.target))
    .map((e) => ({ id: e.id, type: e.type ?? 'custom', source: e.source, target: e.target }))
  nodes.value = nodesFromStore(h.nodeStore, h.selection.ids)
  canUndo.value = h.history.canUndo()
  canRedo.value = h.history.canRedo()
  log.log(`syncFromStore nodes=${nodes.value.length} edges=${edges.value.length} undo=${canUndo.value}`)
}

// ==================== 通用交互事件 ====================

function onNodeDragStart(e: NodeDragEvent): void {
  beginNodeDrag(interaction, e.node.id)
  const payload = toDragPayload(e)
  if (payload) hostRef.value?.ctx.emit(RenderEvents.NodeDragStart, payload)
}

function onNodeDragStop(e: NodeDragEvent): void {
  endNodeDrag(interaction)
  const h = hostRef.value
  if (!h) return
  // VueFlow 拖动多选时已把位移应用到全部选中节点：这里把它们的最终位置一起写回内核 store，
  // 避免只写主节点导致其它被拖节点弹回原位。
  const surface = surfaceRef.value
  const moved = surface?.getSelectedNodePositions?.() ?? []
  if (moved.length > 0) {
    h.nodeStore.updateNodes(
      moved.map((p) => ({
        id: p.id,
        patch: { position: { x: p.x, y: p.y } },
      })),
    )
  } else {
    // 兜底：读不到选中节点位置时退回旧行为（只写事件主节点）
    const pos = e.node.position
    const graph: CanvasNode[] = h.nodeStore.getNodes().map((n) => {
      const movedOne = e.node.id === n.id && pos ? { x: pos.x, y: pos.y } : { ...n.position }
      return { ...n, position: movedOne }
    })
    h.nodeStore.replaceAll(graph)
  }
  void h.save.set('graph', h.nodeStore.getNodes(), 'canvas')
  const payload = toDragPayload(e)
  if (payload) h.ctx.emit(RenderEvents.NodeDragEnd, payload)
}

/** 视图平移/缩放开始（pan 与 wheel/pinch 缩放同源于 VueFlow 同一套 move 事件，A 决策：统一置 paneDragging） */
function onMoveStart(): void {
  beginViewportMove(interaction)
  emitMove(RenderEvents.MoveStart)
}

/** 视图平移/缩放结束：清 paneDragging（与 start 对称，无 wheel/pan 配对残留问题） */
function onMoveEnd(): void {
  endViewportMove(interaction)
  emitMove(RenderEvents.MoveEnd)
}

/** emit 带当前视口的视图事件（host 未就绪则跳过） */
function emitMove(event: string): void {
  const h = hostRef.value
  const surface = surfaceRef.value
  if (!h) return
  const vp = surface?.getViewport?.() ?? { x: 0, y: 0, zoom: 1 }
  h.ctx.emit(event, { viewport: vp })
}

/** 节点拖动逐帧（rAF 节流后 emit，避免 60Hz 刷屏） */
let dragEmitRaf = 0
function onNodeDrag(e: NodeDragEvent): void {
  if (dragEmitRaf) return
  dragEmitRaf = requestAnimationFrame(() => {
    dragEmitRaf = 0
    const h = hostRef.value
    const payload = toDragPayload(e)
    if (h && payload) h.ctx.emit(RenderEvents.NodeDrag, payload)
  })
}
function onNodeClick(e: NodeMouseEvent): void {
  const h = hostRef.value
  if (!h) return
  clickNode(h.selection, e.node.id, { shiftKey: e.event.shiftKey })
  h.ctx.emit(RenderEvents.NodeClick, { nodeId: e.node.id, shiftKey: e.event.shiftKey })
}

function onEdgeClick(e: EdgeMouseEvent): void {
  const h = hostRef.value
  if (!h) return
  clickEdge(h.selection, e.edge.id, { shiftKey: e.event.shiftKey })
  h.ctx.emit(RenderEvents.EdgeClick, { edgeId: e.edge.id, shiftKey: e.event.shiftKey })
}

function onPaneClick(): void {
  const h = hostRef.value
  if (!h) return
  clickPane(h.selection)
  h.ctx.emit(RenderEvents.PaneClick, {})
}

/** 框选/多选手势结束：把 VueFlow 当前选中节点/边写回内核 Selection（单源），触发 onChange → 渲染态高亮一致 */
function onSelectionEnd(): void {
  const h = hostRef.value
  const surface = surfaceRef.value
  if (!h || !surface) return
  const nodeIds = surface.getSelectedNodeIds?.() ?? []
  const edgeIds = surface.getSelectedEdgeIds?.() ?? []
  h.selection.set(nodeIds)
  h.selection.setEdges(edgeIds)
}

// 连边校验走内核 connection 服务(自连/环/重复/朝向/类型声明)。
// 返回 ValidationResult 的纯校验（供 isValidConnection / 拖线反馈 validateEdge 复用，reason 不丢弃）。
function checkConnection(
  source: string,
  target: string,
  sourceHandle?: string,
  targetHandle?: string,
): ValidationResult {
  const h = hostRef.value
  if (!h) return { ok: false, reason: 'missing-node' }
  const map = new Map(h.nodeStore.getNodes().map((n) => [n.id, { id: n.id, type: n.type }]))
  // 幂等重校验：这条连接已真实存在于内核 edgeStore(=已提交的历史边)，不是新拖出的候选——
  // VueFlow 每次 setEdges 全量重喂都会把已存在边再校验一遍，若按"重复"驳回会把已落盘边丢掉(拖线后连线"看不见")。
  // 已存在的边放行(重复/环判定交给真正的新候选)。内核 edgeStore 天然按端点去重，故不影响数据唯一性。
  const alreadyCommitted = h.edgeStore
    .getEdges()
    .some(
      (e) =>
        e.source === source &&
        e.target === target &&
        (sourceHandle === undefined || e.sourceHandle === sourceHandle) &&
        (targetHandle === undefined || e.targetHandle === targetHandle),
    )
  if (alreadyCommitted) {
    log.log(`checkConnection ${source}→${target} = 已提交边，幂等放行`)
    return { ok: true, reason: 'ok' as const }
  }
  const res = validateConnection(
    { source, sourceHandle: sourceHandle ?? undefined, target, targetHandle: targetHandle ?? undefined },
    { nodes: map, edges: edges.value, getTypeConn: (t) => typeConnectionDef(h.nodeStore.types.get(t)) },
  )
  if (!res.ok) log.warn(`checkConnection ${source}→${target} 非法:${res.reason}`)
  return res
}

function isValidConnection(conn: Connection): boolean {
  if (!conn.source || !conn.target) return false
  return checkConnection(
    conn.source,
    conn.target,
    conn.sourceHandle ?? undefined,
    conn.targetHandle ?? undefined,
  ).ok
}

/**
 * 拖线反馈用的候选校验：给(规范 source,target)返回非法文案(空串=合法)。
 * 供 ConnectionLineHost 每帧 resolveFeedback 判定 hover valid/invalid 用。
 */
function validateEdgeText(sourceId: string, targetId: string): string {
  const res = checkConnection(sourceId, targetId)
  return res.ok ? '' : reasonTextFrom(res.reason)
}

// —— 拖线生命周期：connect-start 记源+挂全局 mousemove 日志；connect-end 用 mouseup 自带的 clientX/Y 解析吸附建边 ——
/** 本次拖线手势是否已走 @connect(精确 handle) 建边。connect-end 判 drop 建边时据此避免双建。 */
let connectedThisGesture = false
/** 上一次 mousemove 日志写入时间（throttle 50ms，避免每帧刷屏） */
let lastDragHoverLogAt = 0
/** 本次拖线源端快照（onConnectEnd 用） */
let dragSourceId = ''
let dragSourceHandle: 'source' | 'target' = 'source'
/** mousemove/mouseup 是否在拖线期间挂上（用于 onMounted 早期 + boot 顺序保证） */
let dragListenersBound = false
/** rAF 节流：mousemove 高频，只记最新一次 client 坐标；rAF 内做吸附判定+写 state，避免每帧都跑导致卡顿 */
let dragRafId = 0
let pendingClient: { x: number; y: number } | null = null

function onConnectStart(p: { nodeId?: string; handleId: string | null; handleType?: 'source' | 'target' }): void {
  if (!p.nodeId) return
  const handleType = p.handleType ?? (p.handleId as 'source' | 'target') ?? 'source'
  connectedThisGesture = false
  dragSourceId = p.nodeId
  dragSourceHandle = handleType === 'target' ? 'target' : 'source'
  dragFlowPoint.value = null
  log.log(`connectStart node=${p.nodeId} handle=${p.handleId} type=${handleType} (挂 drag listeners)`)
  beginConnection(connectionState, {
    sourceNodeId: p.nodeId,
    sourceHandle: dragSourceHandle,
  })
  // 拖线期间挂全局 mousemove/mouseup（捕获阶段优先于 VueFlow 的事件，确保一定能拿到鼠标坐标）
  if (!dragListenersBound) {
    document.addEventListener('mousemove', onDragMouseMove, true)
    document.addEventListener('mouseup', onDragMouseUp, true)
    dragListenersBound = true
  }
}

/** 拖线 mousemove：取最新 client 坐标，**rAF 节流**做吸附判定+写 dragFlowPoint/hoverNode（避免每帧都跑导致卡顿） */
function onDragMouseMove(ev: MouseEvent): void {
  if (!dragSourceId) return
  // 每次 mousemove 只更新最新坐标；具体 resolveFeedback 与写 state 都放到下一帧 rAF 内（合并批次）
  pendingClient = { x: ev.clientX, y: ev.clientY }
  if (dragRafId) return
  dragRafId = requestAnimationFrame(() => {
    dragRafId = 0
    if (!pendingClient || !dragSourceId) return
    const { x, y } = pendingClient
    pendingClient = null
    const flowPoint = clientToFlow(x, y)
    // 命中来源 = 前端 mouse 事件上报的 aimedTarget（不再几何重算）；线端点跟鼠标，命中合法 snap 才吸锚点
    const target = resolveFromAim(connectionState.aimedTarget.value, flowPoint)
    // 写 dragFlowPoint（给 ConnectionLineHost 渲染端点）
    dragFlowPoint.value = { x: target.point.x, y: target.point.y }
    // 写 hoverNode（给 BaseNode 3D/气泡/吸附带 + ConnectionLineHost hasSnap）。rAF 内合并避免每帧多次写 ref
    const h = target.hover
    const nextHover: HoverFeedback | null = h ? enrichHover(h, dragSourceHandle, dragSourceId, target.point) : null
    // 变化比对（与 v1 思路一致：避免无谓写触发下游重渲）
    const cur = connectionState.hoverNode.value
    const changed =
      cur?.nodeId !== nextHover?.nodeId ||
      cur?.status !== nextHover?.status ||
      cur?.zone !== nextHover?.zone ||
      cur?.reason !== nextHover?.reason ||
      cur?.flowPosition?.x !== nextHover?.flowPosition?.x ||
      cur?.flowPosition?.y !== nextHover?.flowPosition?.y
    if (changed) {
      connectionState.hoverNode.value = nextHover
      // 节流日志（50ms 一次），hover 状态变更时打
      const now = Date.now()
      if (now - lastDragHoverLogAt >= 50) {
        lastDragHoverLogAt = now
        log.log(
          `drag hover client=${Math.round(x)},${Math.round(y)} flow=${Math.round(target.point.x)},${Math.round(target.point.y)} ${nextHover ? `→ ${nextHover.nodeId}/${nextHover.status}/${nextHover.zone}${nextHover.reason ? ' ' + nextHover.reason : ''}` : '空'}`,
        )
      }
    }
  })
}

/** 拖线 mouseup：用 mouseup 事件自带的 clientX/Y 直接解析吸附（跟 v1 useCanvasConnection.onConnectEnd 同思路） */
function onDragMouseUp(ev: MouseEvent): void {
  // 仅在拖线源端快照存在时处理（避免与其它业务 mouseup 冲突）
  if (!dragSourceId) return
  // 取消未触发的 rAF（直接走 mouseup 路径）
  if (dragRafId) {
    cancelAnimationFrame(dragRafId)
    dragRafId = 0
    pendingClient = null
  }
  const flowPoint = clientToFlow(ev.clientX, ev.clientY)
  const target = resolveFromAim(connectionState.aimedTarget.value, flowPoint)
  // 同步最后一次 mouseup 坐标到 dragFlowPoint（让 release 那一帧连接线也对齐）
  dragFlowPoint.value = { x: target.point.x, y: target.point.y }
  const drop = decideDropFromHover(dragSourceId, dragSourceHandle, target)
  log.log(
    `drop resolve client=${Math.round(ev.clientX)},${Math.round(ev.clientY)} flow=${Math.round(target.point.x)},${Math.round(target.point.y)} ${drop ? `→ ${drop.source}→${drop.target}/${drop.zone}` : '→ 空白(松空)'}`,
  )
  if (drop) {
    const res = checkConnection(drop.source, drop.target)
    if (!res.ok) log.warn(`drop ${drop.source}→${drop.target} 非法:${res.reason}`)
    else commitEdge(drop.source, drop.target)
  }
  // 清源快照（避免后续普通 mouseup 误触发），监听本身留给 onConnectEnd 拆
  dragSourceId = ''
  dragSourceHandle = 'source'
}

/** client 坐标 → flow 坐标（用 VueFlow 自带 screenToFlowCoordinate：缩放/平移/zoom 完全可靠，
 *  比手算 paneRect.left / zoom 准）。boot 前/未挂载时回退 client 当 flow（兜底） */
function clientToFlow(clientX: number, clientY: number): { x: number; y: number } {
  const surface = surfaceRef.value
  if (surface?.screenToFlow) return surface.screenToFlow(clientX, clientY)
  return { x: clientX, y: clientY }
}

/** 取 host 内核中存活节点矩形（flow 坐标） */
function liveNodeRects(): NodeRect[] {
  const h = hostRef.value
  if (!h) return []
  return h.nodeStore.getNodes().map((n) => {
    const pos = (n as unknown as { position?: { x: number; y: number } }).position ?? { x: 0, y: 0 }
    const dim = (n as unknown as { dimensions?: { width: number; height: number } }).dimensions
    return {
      id: n.id,
      type: n.type,
      x: pos.x,
      y: pos.y,
      width: dim?.width || 256,
      height: dim?.height || 128,
    }
  })
}

/** 由前端上报的 aimedTarget（mouse 事件驱动）解析当前 hover + 线端点。
 *  命中来源是前端 .moving-handle-zone / 卡片的 mouseenter 上报，后端不再几何重算吸附带。
 *  point = 连接线临时端点：命中**合法 snap 吸附带**时吸到端口锚点；否则(卡片 body/空白/非法)跟鼠标。 */
function resolveFromAim(
  aim: AimedTarget | null,
  flowPoint: { x: number; y: number },
): { point: { x: number; y: number }; hover: HoverDecision | null } {
  if (!aim || !dragSourceId) return { point: flowPoint, hover: null }
  const reverse = dragSourceHandle === 'target'
  const dir = reverse ? 'reverse' : 'forward'
  // 方向匹配：forward(拖 source 口)只认对方 input(输入口) 或 body；reverse(拖 target 口)只认 output(输出口) 或 body。
  // 方向不符的端口侧直接视为空白（与原几何「只生成方向侧吸附带」一致）。
  if (aim.side !== 'body') {
    const expectSide = reverse ? 'output' : 'input'
    if (aim.side !== expectSide) return { point: flowPoint, hover: null }
  }
  // 候选边 + 业务校验（类型/容量/方向，与 checkConnection 同源）
  const candidate = reverse
    ? { source: aim.nodeId, target: dragSourceId }
    : { source: dragSourceId, target: aim.nodeId }
  const msg = validateEdgeText(candidate.source, candidate.target)
  // 端口锚点：优先用前端上报的 anchor（真实渲染高度 cardHeight 算，保证居中）；
  // 无 anchor 时回落到节点矩形左缘/右缘中点（body 命中跟鼠标，不需锚点）。
  const rect = liveNodeRects().find((r) => r.id === aim.nodeId)
  const anchorX =
    aim.anchor?.x ?? (rect ? (dir === 'forward' ? rect.x : rect.x + rect.width) : flowPoint.x)
  const anchorY = aim.anchor?.y ?? (rect ? rect.y + rect.height / 2 : flowPoint.y)
  const zone: 'snap' | 'body' = aim.side === 'body' ? 'body' : 'snap'
  const hover: HoverDecision = {
    nodeId: aim.nodeId,
    status: msg ? 'invalid' : 'valid',
    zone,
    portSide: zone === 'snap' ? (dir === 'forward' ? 'input' : 'output') : undefined,
    reason: msg || undefined,
  }
  // 仅合法 snap(端口吸附带)把线端吸到端口锚点；body/空白/非法保持跟鼠标（body 松手仍可连）
  const snapped = !msg && zone === 'snap'
  return { point: snapped ? { x: anchorX, y: anchorY } : flowPoint, hover }
}

/** 给定 hover 决策 + 源信息，补全成富 HoverFeedback（nodeType/nodeData/nodeEl/willEvict） */
function enrichHover(
  h: HoverDecision,
  sourceHandle: 'source' | 'target',
  sourceId: string,
  flowPoint: FlowPoint,
): HoverFeedback {
  const host = hostRef.value
  const node = host?.nodeStore.getNode(h.nodeId)
  // 新边真正的"输入端接收节点"：forward=悬停节点；reverse(从 input 反拖)=发起反向拖的源节点
  const receiverId = sourceHandle === 'target' ? sourceId : h.nodeId
  const tgtNode = host?.nodeStore.getNode(receiverId)
  const tgtType = tgtNode ? host?.nodeStore.types.get(tgtNode.type) : undefined
  const inputDef = tgtType?.inputs?.find((i) => !i.port || i.port === 'target')
  const capacity = inputDef?.capacity
  const incoming = host ? host.edgeStore.getEdges().filter((e) => e.target === receiverId).length : 0
  // 输入口已满额(>=capacity>1) → 本次连接将挤最老一条（evict 为 render 默认行为）
  const willEvict = !!capacity && capacity > 1 && incoming >= capacity
  let nodeEl: HTMLElement | null = null
  try {
    nodeEl = document.querySelector(`.vue-flow__node[data-id="${h.nodeId}"]`)
  } catch {
    /* SSR/测试环境无 DOM：忽略 */
  }
  return {
    nodeId: h.nodeId,
    status: h.status,
    zone: h.zone,
    flowPosition: flowPoint,
    reason: h.reason,
    portSide: h.portSide,
    nodeType: node?.type,
    willEvict,
    nodeData: node ? { id: node.id, type: node.type, data: node.data } : null,
    nodeEl,
  }
}

/** 把 hover 决策转成规范 (source,target) 候选；空白则 null */
function decideDropFromHover(
  sourceId: string,
  sourceHandle: 'source' | 'target',
  target: { hover: HoverDecision | null },
): { source: string; target: string; zone: 'snap' | 'body' } | null {
  const h = target.hover
  if (!h || h.status !== 'valid') return null
  // reverse 方向（从 target口反向连）需把 source/target 对调
  return sourceHandle === 'target'
    ? { source: h.nodeId, target: sourceId, zone: h.zone }
    : { source: sourceId, target: h.nodeId, zone: h.zone }
}

function onConnectEnd(): void {
  // @connect 与 drag mouseup 都会尝试建边 — 二者任一成功则跳过另一。
  // 注：VueFlow 顺序：精确命中 handle → @connect(先) → mouseup → @connect-end。@connect 已建则 commitEdge 也会被幂等挡掉。
  // 这里仅负责清空状态 + 拆监听（拖线 mouseup 在 mousemove 同源时已 commit）。
  endConnection(connectionState)
  connectedThisGesture = false
  if (dragListenersBound) {
    document.removeEventListener('mousemove', onDragMouseMove, true)
    document.removeEventListener('mouseup', onDragMouseUp, true)
    dragListenersBound = false
  }
  dragSourceId = ''
  dragSourceHandle = 'source'
  dragFlowPoint.value = null
  // 收尾清 rAF（避免异步 rAF 在手势结束后还写 state）
  if (dragRafId) {
    cancelAnimationFrame(dragRafId)
    dragRafId = 0
  }
  pendingClient = null
  log.log('connectEnd 清空反馈')
}

function onConnect(conn: Connection): void {
  log.log(`connect 事件 ${conn.source}→${conn.target}`, conn)
  connectedThisGesture = true
  if (!isValidConnection(conn) || !conn.source || !conn.target) {
    connectedThisGesture = false
    log.warn(`connect 被拒(非法或缺端点) ${conn.source}→${conn.target}`)
    return
  }
  commitEdge(conn.source, conn.target, conn.sourceHandle ?? undefined, conn.targetHandle ?? undefined)
}

/**
 * 真正落一条边：幂等去重(已存在同源同目标同 handle 的边则不重复建) + 记历史 + 落盘。
 * @connect(精确命中 handle) 与 connect-end 的 lastDrop(body/snap 松开) 两条路径都走这里，保证不会双建。
 */
function commitEdge(
  source: string,
  target: string,
  sourceHandle?: string,
  targetHandle?: string,
): void {
  const h = hostRef.value
  if (!h) return
  const already = h.edgeStore
    .getEdges()
    .some(
      (e) =>
        e.source === source &&
        e.target === target &&
        (sourceHandle === undefined || e.sourceHandle === sourceHandle) &&
        (targetHandle === undefined || e.targetHandle === targetHandle),
    )
  if (already) {
    log.log(`commitEdge ${source}→${target} 已存在，跳过(幂等)`)
    return
  }
  // 拉边记进历史(undo/redo 对边生效，见 settings-panel-slot-host-plan §三.D)：addEdge 写内核 edgeStore(唯一数据源)，
  // history.withRecord 在前后各拍全图快照(含边)；边 id 稳定、重复连会被快照差异正确识别。
  h.history.withRecord(() => {
    // 输入口容量挤出：目标节点输入口声明 capacity 且已满额 → 先挤掉最老一条入边再加新边（同一 undo 记录，原子）。
    const evicted = tryEvictOldestIncoming(h, source, target)
    if (evicted) log.log(`commitEdge ${source}→${target} 输入口满额，挤掉最老边 ${evicted}`)
    h.edgeStore.addEdge({
      source,
      target,
      type: edgeDefaultType.value,
      sourceHandle: sourceHandle ?? undefined,
      targetHandle: targetHandle ?? undefined,
    })
  })
  // 边下沉后持久化：边独立存 graph-edges(与节点 graph 分存)；edgeStore.subscribe 自动刷新渲染态
  void h.save.set(GRAPH_EDGES_KEY, h.edgeStore.getEdges(), 'canvas')
  log.log(`commitEdge 建边成功 ${source}→${target}，edgeStore 边数=${h.edgeStore.getEdges().length}`)
}

/**
 * 输入口容量挤出：若目标节点(target)的输入口声明了 capacity 且当前入边已达满额，
 * 移除最老一条入边，为新边腾位。返回被挤边 id；无需挤返回 null。
 */
function tryEvictOldestIncoming(
  h: CanvasHostHandle,
  source: string,
  target: string,
): string | null {
  const tgtNode = h.nodeStore.getNode(target)
  const tgtType = tgtNode ? h.nodeStore.types.get(tgtNode.type) : undefined
  // 目标输入口容量：取 inputs(port='target') 的 capacity（缺省视为单边/无挤出 → 不走 evict）
  const inputDef = tgtType?.inputs?.find((i) => !i.port || i.port === 'target')
  const capacity = inputDef?.capacity
  if (!capacity || capacity < 2) return null
  const evictId = oldestIncomingToEvict({
    edges: h.edgeStore.getEdges(),
    target,
    capacity,
  })
  if (evictId) h.edgeStore.removeEdge(evictId)
  return evictId
}

// —— 键盘：Delete 删选中、Ctrl/Cmd+Z 撤销/重做（编辑输入框内不劫持）——
function onKeydown(e: KeyboardEvent): void {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return
  const h = hostRef.value
  if (!h) return
  if (e.key === 'Delete') {
    e.preventDefault()
    const ids = h.selection.ids // 内核 Selection 单源(点击/清空已写它)
    if (ids.size > 0) {
      h.command.execute('command:delete') // 内部清内核 selection → 订阅自动清 selectedIds 高亮
      syncFromStore()
    }
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    h.command.execute(e.shiftKey ? 'command:redo' : 'command:undo')
    h.selection.clear() // 撤销后取消选中(订阅自动清 selectedIds)
    syncFromStore()
  }
}

// 右键菜单：内部统一 preventDefault，把坐标透给父级弹业务菜单。
function onNodeContextMenu(e: NodeMouseEvent): void {
  const ev = e.event as MouseEvent
  ev.preventDefault()
  emit('context-menu', { kind: 'node', clientX: ev.clientX, clientY: ev.clientY, nodeId: e.node.id })
}
function onPaneContextMenu(e: MouseEvent): void {
  e.preventDefault()
  emit('context-menu', { kind: 'pane', clientX: e.clientX, clientY: e.clientY })
}

// ==================== 生命周期 ====================

let subs: Disposable[] = []
let keydownBound = false

onMounted(async () => {
  try {
    const { host, api, manager, exposeToWindow } = await createMiniCanvasHost({
      adapter: props.adapter ?? new MemoryStorageAdapter(),
      // manifest 与 plugins 二选一(createMiniCanvasHost 内 manifest 优先)
      manifest: props.manifest,
      coldPlugins: props.plugins,
      nodeRegistry: registry,
      seedDefault: props.seed,
    })
    hostRef.value = host
    apiRef.value = api
    managerRef.value = manager
    if (props.windowKey) exposeToWindow(props.windowKey)

    // 订阅 store 变化自动刷渲染态（nodeStore 与 edgeStore 任一变化都触发整图重刷）
    unsubStore = host.nodeStore.subscribe(syncFromStore)
    unsubEdge = host.edgeStore.subscribe(syncFromStore)

    // 订阅内核 Selection(选中单源)：点击/删除/撤销等只写内核，这里投影给 CustomEdge 高亮
    unsubSel = host.selection.onChange(syncSelected)
    syncSelected() // 初始同步一次(seed 恢复不触发 onChange)

    // 主题 + nodeTypes 装配
    applyTheme()

    // 初始灌入：seed/restore 发生在 subscribe 建立之前(createMiniCanvasHost 内部)，
    // 不会触发回调，这里主动同步一次把当前 store 节点渲染出来。
    syncFromStore()

    // 订阅插件热装/热卸：重装配主题与 nodeTypes + bump epoch 触发 VueFlow 重挂
    // (overlay 槽内容由 CanvasSurface 内 SlotHost 自行订阅刷新，无需在此处理)
    subs.push(
      host.ctx.on('ctx:plugin-installed', () => {
        applyTheme()
        nodeEpoch.value += 1
      }),
      host.ctx.on('ctx:plugin-uninstalled', () => {
        applyTheme()
        nodeEpoch.value += 1
      }),
      // 运行期插件装载失败上报(事件驱动)：内核在插件 setup/config 抛错时经 ctx:lifecycle-change ERROR 广播。
      // 此处只转发 ERROR(装载失败)这一非正常终态，不误报 ACTIVE/卸载等正常跳变。
      host.ctx.on('ctx:lifecycle-change', ({ name, lifecycle }) => {
        if (lifecycle === 'error') emit('plugin-issue', { name, lifecycle: String(lifecycle) })
      }),
    )

    // 键盘
    window.addEventListener('keydown', onKeydown)
    keydownBound = true

    // 页面隐藏/离开落盘
    window.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', flushSave)

    booting.value = false
    emit('ready', host)
  } catch (err) {
    bootError.value = err instanceof Error ? err.message : String(err)
    booting.value = false
    emit('boot-error', err instanceof Error ? err : new Error(String(err)))
  }
})

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') flushSave()
}
function flushSave(): void {
  const h = hostRef.value
  if (h?.save.isDirty()) void h.save.flush()
}

// 暴露给父级：boot 后拿 host/api 驱动业务(建节点/撤销/读 nodeStore 等)，拿 ready 判断是否可用。
// 父级经 ref 拿实例：`const c = ref(); c.value.host` / `c.value.host?.command.execute(...)`。
defineExpose({
  get host(): CanvasHostHandle | undefined {
    return hostRef.value
  },
  get api(): MiniCanvasApi | undefined {
    return apiRef.value
  },
  /** 目标 D 统一安装句柄(manager.install/uninstall/reload/list/applyManifest) */
  get manager(): PluginManager | undefined {
    return managerRef.value
  },
  get ready(): boolean {
    return !booting.value && !bootError.value
  },
  get bootErrorText(): string {
    return bootError.value
  },
})

onBeforeUnmount(() => {
  if (dragEmitRaf) cancelAnimationFrame(dragEmitRaf)
  unsubStore?.()
  unsubEdge?.()
  unsubSel?.()
  for (const s of subs) s.dispose()
  if (keydownBound) window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('pagehide', flushSave)
  void hostRef.value?.save.flush()
  hostRef.value?.stop()
})
</script>

<template>
  <div class="chost">
    <div v-if="booting" class="chost-status">正在启动内核…</div>
    <div v-else-if="bootError" class="chost-status chost-err">启动失败：{{ bootError }}</div>

    <div v-else class="chost-canvas">
      <!-- 内层渲染子树宿主：boot 完成后才挂载，向渲染组件 provide 裸 ctx/host（见 CanvasSurface.vue） -->
      <CanvasSurface
        ref="surfaceRef"
        :host="hostRef"
        :registry="registry"
        :node-write="nodeWrite"
        :handle-params="handleToProvide"
        :edge-visual="edgeVisualToProvide"
        :debug-visual="debugToProvide"
        :snap-zone="snapZoneToProvide"
        :edge-selection="edgeSelection"
        :nodes="nodes"
        :edges="edges"
        :node-types="nodeTypes"
        :edge-types="edgeTypes"
        :background-comp="backgroundComp"
        :connection-line-comp="connectionLineComp"
        :node-epoch="nodeEpoch"
        :min-zoom="props.minZoom"
        :max-zoom="props.maxZoom"
        :is-valid-connection="isValidConnection"
        :connection-state="connectionState"
        :interaction="interaction"
        :drag-flow-point="dragFlowPoint"
        :on-connect="onConnect"
        :on-connect-start="onConnectStart"
        :on-connect-end="onConnectEnd"
        :validate-edge="validateEdgeText"
        :on-node-click="onNodeClick"
        :on-edge-click="onEdgeClick"
        :on-node-drag="onNodeDrag"
        :on-node-drag-start="onNodeDragStart"
        :on-node-drag-stop="onNodeDragStop"
        :on-move-start="onMoveStart"
        :on-move-end="onMoveEnd"
        :on-pane-click="onPaneClick"
        :on-selection-end="onSelectionEnd"
        :on-node-context-menu="onNodeContextMenu"
        :on-pane-context-menu="onPaneContextMenu"
      >
        <!-- 宿主业务 UI 区(#ui)：转发给 CanvasSurface，使宿主放在本组件 <template #ui> 里的 toolbar/设置 dock 等能经 useCanvasRender 读 ctx -->
        <template #ui>
          <slot name="ui" />
        </template>
        <!-- 父级默认插槽透传进 VueFlow（自定义背景/控件） -->
        <slot />
      </CanvasSurface>
    </div>
  </div>
</template>

<style scoped>
.chost {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.chost-status {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6b7280;
}
.chost-status.chost-err {
  color: #dc2626;
}
.chost-canvas {
  flex: 1;
  position: relative;
  min-height: 0;
}
</style>

