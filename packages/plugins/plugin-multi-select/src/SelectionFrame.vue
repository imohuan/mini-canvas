<script setup lang="ts">
/**
 * SelectionFrame —— 多选群组框（对齐老版 multi-select/SelectionFrame.vue 的"小框 + 大框"）。
 *
 * 两个框各是什么：
 * - **大框（外框）**：选中节点矩形的并集再按配置 padding 向外扩一圈，专门给节点上方的标题条留位置；
 *   它同时是**整组拖动的把手**（按在它上面拖 = 把这组节点一起移动）。
 * - **小框（内框）**：节点并集本身（默认紧贴、不含标题）；可在配置里给它加"小框外扩"，
 *   于是它也能比节点稍微胖一圈。大框始终在小框外侧再留一段"两框间距"。
 *
 * 关键：两框是**逐层往外算**的（节点并集 → 内框 → 外框），不是从一个框反推另一个。
 * 以前外框用"节点并集 + 间距"、内框位置用间距、内框尺寸却写成了外框尺寸，于是内框被推到右下、
 * 比外框还大，两个框交叉错位。现在几何全在 multiSelectEngine.computeSelectionFrameGeometry 一次算清，
 * 组件只贴样式。
 *
 * 外观（颜色/线型/线宽/圆角/填充）与两框间距全来自插件 Config（分组「布局/多选」），
 * 改动经 settings.onChange 实时生效；线宽与圆角按 1/zoom 反向缩放，缩放画布时框线粗细恒定。
 *
 * 拖动：**在多选框内按住左键拖动 = 平移多选框 + 选中的节点**（逐帧 updateNodeVisual 视觉写，
 * 松手经 graph.updateNodes 批量落盘，唯一写入口负责历史）。只移动"顶层且祖先未选"的节点
 * （父被选则子随父动，避免双位移）。
 *
 * ## 层级与命中（本轮修的两个问题）
 * 1) **节点必须在框之上**：以前大框是个铺满整块区域、还能接事件的矩形，它盖住节点后
 *    点不到节点、也就没法单独取消某个选中。现在框整体 `pointer-events:none`，节点照常可点、可 Shift 加减选。
 *    代价是"框内拖动"不再由框自己收到 —— 改为在画布层按**几何**判断（见下方 pane 上的接管逻辑）。
 * 2) **框上滚轮要能缩放画布**：浮层在 VueFlow 的 wheel 监听之外，滚轮原本到不了画布。
 *    这里加 wheel 监听把事件转发给 VueFlow 的 viewport（转发而非自己调 zoom，缩放中心才正确）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  useCanvasRender,
  RenderEvents,
  Position,
  resolveFeedback,
  reasonText as reasonTextFrom,
  DEFAULT_SNAP_ZONE_CONFIG,
} from '@mini-canvas/canvas-render'
import { MovingHandle, ConnectionLine } from '@mini-canvas/plugin-theme-default'
import type { NodeLayoutService, ViewportService } from '@mini-canvas/canvas-render'
import { validateConnection, typeConnectionDef } from '@mini-canvas/canvas-data'
import type { SelectionService, NodeStoreService, GraphDocumentService } from '@mini-canvas/canvas-data'
import {
  planBatchEdges,
  planBatchApply,
  shouldFrameFollowDrag,
  isHitOwnBatchPort,
  buildBatchGuideLines,
  markGuideLines,
  toNodeRects,
  type BatchSide,
  type BatchGuideLine,
} from './batchConnect'
import {
  computeSelectionFrameGeometry,
  draggableMembers,
  type MultiSelectRect,
  type SelectionFrameGeometry,
} from './multiSelectEngine'
import {
  applyMultiSelectFrameChange,
  framePaddingsOf,
  scaleFramePaddings,
  frameStrokeCss,
  resolveMultiSelectFrameConfig,
  type MultiSelectFrameConfig,
} from './multiSelectConfig'
import { followFrame } from './dragFollow'
import { BoxSelectClickGuard } from './boxSelectGuard'

const { viewport, ctx, updateNodeVisual, pane, interaction, rootEl, handleParams, connectionState, screenToFlow, snapZone } = useCanvasRender()

// 批量连线端口的几何/外观参数：与节点端口同源（同一份 handleParams = 主题配置），
// 所以多选框上的端口和节点上的端口看起来完全一致。
const portZoneWidth = computed(() => Number(handleParams.portZoneWidth) || 0)
/**
 * 端口跟随区高度的基准：选中集里**最高的那个节点**的高度。
 *
 * 节点那边是"节点高 × portZoneHeightRatio"（见 BaseNode 的 portZoneHeight）。多选框没有"卡片高"，
 * 最贴切的等价物就是成员节点的典型高度 —— 取最大值而不是并集高度：并集会被节点间的垂直间距撑大，
 * 换来的是一只比节点端口大一截的耳朵，观感立刻不一样（用户报的"效果不对"）。
 */
const BATCH_ZONE_MIN_HEIGHT = 72
const portZoneBaseHeight = computed(() => {
  const l = layout()
  if (!l) return 0
  let max = 0
  for (const id of sel().ids) {
    const r = l.getNodeRect(id)
    if (r && r.h > max) max = r.h
  }
  return max
})
const portZoneHeight = computed(() => {
  const ratio = Math.min(Math.max(Number(handleParams.portZoneHeightRatio) || 0.8, 0), 1)
  return Math.max(portZoneBaseHeight.value * ratio, BATCH_ZONE_MIN_HEIGHT)
})
const portZoneOffset = computed(() => Number(handleParams.portZoneOffset) || 0)
const portZoneShape = computed(() => handleParams.portZoneShape ?? 'arc')
const portZoneArcRatio = computed(() => handleParams.portZoneArcRatio ?? 0.8)

/**
 * 是否正在框选（多选框手势中）：框选期间不显示群组框，免得两套框叠在一起。
 * 防御式读取：单测/极简宿主的渲染上下文桩可能没给 interaction（或没给派生位），
 * 缺了就当作"没在框选"，不抛错。
 */
const isSelecting = computed(() => interaction?.isSelecting?.value === true)

// —— 服务（懒取，宿主恒在）——
function sel(): SelectionService {
  return ctx.get<SelectionService>('selection')
}
function layout(): NodeLayoutService | undefined {
  return ctx.get<NodeLayoutService>('nodeLayout')
}
function nodeStore(): NodeStoreService {
  return ctx.get<NodeStoreService>('nodeStore')
}
function graph(): GraphDocumentService {
  return ctx.get<GraphDocumentService>('graph')
}
function viewportSvc(): ViewportService | undefined {
  return ctx.get<ViewportService>('viewport')
}
function edgeStore(): { getEdges(): Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }> } | undefined {
  return ctx.get('edgeStore') as never
}
// ====== 批量连线（复刻 v1 的 onSelectionBatchConnectStart/End）======
/**
 * 多选后，框的**左右两侧各有一个圆形端口**：按住往某个节点上拖，松手就把**选中集里的每个节点**
 * 各连一条边到那个目标（右侧 = 选中节点当源；左侧 = 选中节点当目标，方向相反、效果对称）。
 *
 * 与 v1 的差别（v2 没有临时节点体系）：v1 会建一个临时节点拖着走；这里改为**直接在浮层上画一条
 * 跟随鼠标的引导线**（纯视觉），松手时再真正落边 —— 少建/少删两个中间态元素，也不碰历史。
 */
const batchSide = ref<BatchSide | null>(null)
/** 拖动中的鼠标位置（屏幕坐标，用于画引导线） */
const batchCursor = ref<{ x: number; y: number } | null>(null)
const isBatchConnecting = computed(() => batchSide.value !== null)

/** 拖动中当前吸附到的目标端口锚点（flow）；没吸附 = null（所有线指向鼠标） */
const batchSnapAnchor = ref<{ x: number; y: number } | null>(null)

/** 拖动中的落点目标节点 id（没瞄准任何节点 = null） */
const batchDropId = ref<string | null>(null)

/**
 * 当前这一批到底会连上哪几条（预览与落边**共用**这一个判定）。
 *
 * 用户问的是"目标节点应该如何判断是否可以连接？只要部分连接线支持就可以连接，
 * 连接的时候也只允许支持的连接线进行连接，不能一股脑的直接建立连接线"。
 *
 * 这里的做法：拿**同一份**计划既喂预览（哪条线会亮/会淡）又喂落边（真正建哪几条），
 * 于是"看到的"和"建出来的"不可能不一致 —— 两套独立判断迟早会漂移（这正是我修前的问题）。
 *
 * 判定的关键是容量要**在批内累计**：把"这一批里已经决定要建的边"一起喂进内核校验，
 * 否则目标输入口 capacity=1 时，同一批的 3 个合法源会各自都判合法、3 条一起落进去。
 */
const batchPlan = computed(() => {
  const side = batchSide.value
  const dropId = batchDropId.value
  if (!side || !dropId) return null
  const specs = planBatchEdges(side, sel().ids, dropId)
  if (specs.length === 0) return null
  const graphEdges = edgeStore()?.getEdges() ?? []
  // canonical 双向都算"已存在"，否则反向重复边会漏判
  const isDuplicate = (s: { source: string; target: string }): boolean =>
    graphEdges.some(
      (x) =>
        (x.source === s.source && x.target === s.target) ||
        (x.source === s.target && x.target === s.source),
    )
  return planBatchApply(specs, {
    isDuplicate,
    // 把批内已计划的边一起算进去：内核只看"现有入边条数"，看得见它们才能正确拦住容量溢出。
    canConnect: (s, alreadyPlanned) =>
      validateBatchEdge(s.source, s.target, alreadyPlanned.length === 0 ? [] : alreadyPlanned),
  })
})

/**
 * 在端口上按下左键 → 开始批量连线。
 *
 * 两条入口都接（**故意冗余**）：圆球的 `connect-start`，以及定位盒的 mousedown。
 * 为什么不能只留前者：圆球永远画在跟随区**里面**（静止位 = 锚点外 restOffset），
 * 跟随区的 z-index 更高，所以绝大多数按下命中的是跟随区、圆球根本收不到 mousedown ——
 * 只接它的话端口就"拖不动"（用户报的正是这个）。反过来说，跟随区高度可配，
 * 万一配到比圆球还小时，按下就会落在露在外面的球上、定位盒收不到 —— 所以后者也要留。
 * 幂等判据在下面挡住重复起手，两条路同时通着也不会装两套监听。
 *
 * 节点那边为什么没这问题：跟随区在节点上是包在真实 VueFlow Handle 里的子元素，
 * 按下会冒泡到 Handle 由 VueFlow 起手拖线。多选框这里是纯浮层、没有那层 Handle，
 * 所以得由本层自己起手。
 */
function onBatchConnectStart(event: MouseEvent, side: BatchSide): void {
  // 幂等：两条入口可能先后都送到，只认第一次，避免装两套 move/up 监听。
  if (isBatchConnecting.value) return
  if (event.button !== 0) return
  // 起手就断掉冒泡：不让画布层把这次按下当成"整组平移"，也不让 VueFlow 拿去当"点空白"。
  event.stopPropagation()
  event.preventDefault()
  batchSide.value = side
  batchCursor.value = { x: event.clientX, y: event.clientY }
  batchSnapAnchor.value = null
  // 让整个渲染层进入"正在拖线"态：BaseNode 会据此亮起 3D 倾斜 / 非法模糊 / 气泡，
  // 端口也会按 suppressHandles 压住 —— 与用户从节点端口拖线时的反馈**完全一致**
  // （不写这几个状态，目标节点上什么反应都没有，用户报的就是这个）。
  const cs = connectionState
  if (cs) {
    // 注意：isConnecting 是 computed（由 activeConnection 派生），**只能写 activeConnection**
    // 多源：批量连线是"一次拖出、给每个选中节点各连一条"，所以把整个选中集报上去
    // （sourceNodeIds）。只报第一个的话，其余源节点不会被当成"正在拖线的源" —— 它们的端口不压、
    // 还会被当成可连目标。渲染层经 isConnectionSource 统一判"我是不是源"。
    const ids = [...sel().ids]
    cs.activeConnection.value = {
      sourceNodeId: ids[0] ?? '',
      sourceNodeIds: ids,
      sourceHandle: side,
    }
    cs.hoverNode.value = null
    cs.suppressHandles.value = true
  }
  window.addEventListener('pointermove', onBatchMove)
  window.addEventListener('pointerup', onBatchUp)
}

function onBatchMove(e: PointerEvent): void {
  if (!isBatchConnecting.value) return
  batchCursor.value = { x: e.clientX, y: e.clientY }
  refreshBatchFeedback()
}

/**
 * 每帧算一次"当前有没有瞄准某个节点、合不合法"，并把它写进渲染层的连接反馈状态。
 *
 * 复用渲染层现成的 `resolveFeedback`（纯函数：吸附带/body 几何命中 + 校验 + 端口锚点），
 * 校验用内核 `validateConnection`（与宿主建边同源）。这样目标节点上的 3D/模糊/气泡与
 * "从节点端口拖线"时**同一套逻辑、同一套观感**，不是插件自己另做一份。
 *
 * 多选时取"第一个能命中的源"作为反馈代表：批量连线里每个选中节点都可能各自合法或非法，
 * 但 UI 上只能显示一份反馈；取命中的那个（优先合法、其次非法）最贴近用户预期。
 */
function refreshBatchFeedback(): void {
  const cs = connectionState
  const side = batchSide.value
  const cursor = batchCursor.value
  if (!cs || !side || !cursor) return
  const l = layout()
  const ids = [...sel().ids]
  if (!l || ids.length === 0) return

  const flowPoint = screenToFlowPoint(cursor.x, cursor.y)

  // 落点目标：几何命中的那个节点（与松手落边用的是同一个判定函数）。
  // 先把它记下来 —— batchPlan 依赖它，而下面的循环要用 batchPlan 决定"整体算不算可连"。
  batchDropId.value = nodeIdAtClient(cursor.x, cursor.y)
  const plan = batchPlan.value
  // 部分支持 = 至少有一条能连上。用户要的就是这个语义：有源能连就该亮"可连"，
  // 不能因为个别源连不上（类型不符/目标口被前面的兄弟占满）就整体判死。
  // 一条都连不上（plan 为空、或全部被拒）→ 整体按"非法"处理，让目标显示灰框/气泡。
  const anyConnectable = !!plan && plan.build.length > 0

  const selected = new Set(ids)
  // 候选目标：存活节点里排除选中集本身（批量连不会连自己人）
  // 注意必须经 toNodeRects 转成 resolveFeedback 要的 width/height —— 少这一步整个反馈都是死的
  // （width/height 是 undefined → 命中算成 NaN → hover 恒为 null → 目标节点上什么反应都没有）。
  const nodeRects = toNodeRects(l.getAllRects().filter((r) => !selected.has(r.id)))
  const handleRadius = Number(handleParams.portZoneWidth) || 0

  /** 单条边的拒绝文案（给气泡用）。合法 = 空串 */
  const reasonFor = (source: string, target: string): string => {
    const store = nodeStore()
    const nodes = new Map(store.getNodes().map((n) => [n.id, { id: n.id, type: n.type }]))
    const res = validateConnection(
      { source, sourceHandle: 'source', target, targetHandle: 'target' },
      { nodes, edges: edgeStore()?.getEdges() ?? [], getTypeConn: (t) => typeConnectionDef(store.types.get(t)) },
    )
    return res.ok ? '' : reasonTextFrom(res.reason)
  }

  // 吸附带配置与"从节点端口拖线"同一份（渲染上下文里的 snapZone，如宽 42 / 高占比 0.8）：
  // 以前这里写死 DEFAULT_SNAP_ZONE_CONFIG（宽 undefined → 吸附带塌成 0 宽），于是批量连线永远
  // 吸不到目标端口、只能靠卡片主体命中 —— 与节点端口拖线的行为不一致。用同一份配置，两条路径才是同一套几何。
  const snapCfg = { ...DEFAULT_SNAP_ZONE_CONFIG, ...(snapZone ?? {}) }

  /**
   * 几何命中：用 resolveFeedback 找出鼠标压着哪个节点（吸附带优先，其次卡片主体）。
   *
   * 这里 validate 一律返回空串 = 只问"打到哪个节点"，**合法性不走它** —— 因为合法性对整批
   * 只有一个结论（见 anyConnectable），而 resolveFeedback 是按**单个源**判的：拿它当结论的话，
   * 某一个源不合法就会把整个目标画成"不可连"，即使别的源明明连得上（正是要修的语义）。
   * 吸附终点也只取几何（snappedToId 的那次），与合法性解耦。
   */
  let hoverZone: { nodeId: string; zone: 'snap' | 'body'; portSide?: 'input' | 'output' | null } | null = null
  let snapAnchor: { x: number; y: number } | null = null
  for (const id of ids) {
    const r = resolveFeedback({
      sourceId: id,
      sourceHandle: side === 'source' ? 'source' : 'target',
      nodeRects,
      flowPoint,
      handleRadius,
      config: snapCfg,
      validate: () => '',
    })
    if (!r.hover) continue
    // 首个命中的记下即可：命中哪个节点是纯几何问题，各源算出来必然同一个节点
    hoverZone = { nodeId: r.hover.nodeId, zone: r.hover.zone, portSide: r.hover.portSide }
    snapAnchor = r.snappedToId ? r.end : null
    break
  }

  if (!hoverZone) {
    cs.hoverNode.value = null
    batchSnapAnchor.value = null
    return
  }

  // 只要有一条能连上就算"可连"（部分支持）；一条都连不上才判非法，并把真实原因透出去。
  // 注意"已存在"不算非法：那条边本来就在，按可连显示，用户看到的是"这条已经有了"。
  const rejectedReason =
    plan && plan.build.length === 0 && plan.rejected.length > 0
      ? reasonFor(plan.rejected[0].source, plan.rejected[0].target) || '无法连接'
      : undefined
  cs.hoverNode.value = {
    nodeId: hoverZone.nodeId,
    status: anyConnectable ? 'valid' : 'invalid',
    zone: hoverZone.zone,
    flowPosition: flowPoint,
    reason: rejectedReason,
    portSide: hoverZone.portSide ?? undefined,
  }
  batchSnapAnchor.value = snapAnchor
}

/** 松手：把落点处的节点作为目标，给选中集逐个落边 */
function onBatchUp(e: PointerEvent): void {
  if (!isBatchConnecting.value) return
  const side = batchSide.value as BatchSide
  window.removeEventListener('pointermove', onBatchMove)
  window.removeEventListener('pointerup', onBatchUp)

  /**
   * 落边用**拖动时算好的同一份计划**（batchPlan）——预览与落边共用一套判定，
   * 所见即所得，不会出现"看着能连、松手却没连"或反过来的情况。
   *
   * 必须先算再清状态：batchPlan 是 computed，依赖 batchSide / batchDropId。
   * 顺手把 batchSide 置空之后再读它，计划必然是 null —— 于是**一条边都建不出来**
   * （实测：预览两条线都对，松手却什么都没有，就是这个顺序错的）。order 很关键，别调换。
   */
  batchDropId.value = nodeIdAtClient(e.clientX, e.clientY)
  const plan = batchPlan.value

  batchSide.value = null
  batchCursor.value = null
  batchDropId.value = null
  // 退出"正在拖线"态：清掉反馈（3D/模糊/气泡随之熄灭）与压端口，与宿主 endConnection 同语义
  const cs = connectionState
  if (cs) {
    cs.activeConnection.value = null
    cs.hoverNode.value = null
    cs.suppressHandles.value = false
  }
  batchSnapAnchor.value = null

  if (!plan || plan.build.length === 0) return

  const g = graph()
  // 一次性提交：整批边落在同一条历史记录里（撤销一次全退）
  g.transaction('batch-connect', (tx) => {
    for (const s of plan.build) {
      // 统一入口：预览的判定已经做过，这里再过一次守门人只作兜底（两次判定同源不会漂移），
      // 且满额挤出/幂等去重由它保证 —— 与拖线、加素材完全同一套规则。
      tx.connectEdge({ source: s.source, target: s.target, sourceHandle: s.sourceHandle, targetHandle: s.targetHandle })
    }
  })
}

/** 落点是否在某节点上（用 nodeLayout 的绝对矩形做几何命中，不依赖 DOM 层级） */
function nodeIdAtClient(clientX: number, clientY: number): string | null {
  const l = layout()
  if (!l) return null
  const p = screenToFlowPoint(clientX, clientY)
  const hit = l.getAllRects().find((r) => pointInRect(p, r))
  return hit ? hit.id : null
}

/**
 * 这条边能不能落。走内核的 `validateConnection`（纯函数，与宿主建边同源）：自连/成环/重复/类型/容量
 * 全部一次判掉，避免批量连线绕过规则（比如在选中集里成环、或往满额输入口硬塞）。
 *
 * @param alreadyPlanned 这一批里**已经决定要建**的边。它们还没真的进图，所以内核看不见 ——
 *   必须在这里手工并进"现有边"一起校验。不并的话，目标输入口 capacity=1 时同一批的多个合法源
 *   会各自都判合法，3 条一起挤进只装得下 1 条的口（用户说的"不能一股脑的直接建立连接线"）。
 *   顺序即优先级：入选的边按 selectedIds 顺序排，先到先得，与单条拖线"先连上的占住口"一致。
 */
function validateBatchEdge(
  source: string,
  target: string,
  alreadyPlanned: ReadonlyArray<{ source: string; target: string; sourceHandle?: string; targetHandle?: string }> = [],
): boolean {
  const store = nodeStore()
  const nodes = new Map(store.getNodes().map((n) => [n.id, { id: n.id, type: n.type }]))
  const planned = alreadyPlanned.map((s) => ({
    id: `__planned__${s.source}->${s.target}`,
    source: s.source,
    target: s.target,
    sourceHandle: s.sourceHandle,
    targetHandle: s.targetHandle,
  }))
  const res = validateConnection(
    { source, sourceHandle: 'source', target, targetHandle: 'target' },
    {
      nodes,
      // 图上已有的边 + 这一批已计划的边：容量判定才看得见"兄弟边"
      edges: [...(edgeStore()?.getEdges() ?? []), ...planned],
      getTypeConn: (t) => typeConnectionDef(store.types.get(t)),
    },
  )
  return res.ok
}


// ====== 外观配置（实时跟随设置面板）======
const frameConfig = ref<MultiSelectFrameConfig>(resolveMultiSelectFrameConfig((key) => ctx.get<{ get(k: string): unknown } | undefined>('settings')?.get(key)))
const settingsOff = ctx
  .get<{ onChange(cb: (key: string, value: unknown) => void): { dispose(): void } } | undefined>('settings')
  ?.onChange((key, value) => {
    frameConfig.value = applyMultiSelectFrameChange(frameConfig.value, key, value)
  })
onBeforeUnmount(() => settingsOff?.dispose())

// ====== 当前选中节点的内外两框（随选中 / 布局变化重算）======
const frame = ref<SelectionFrameGeometry | null>(null)

function refreshFrame(): void {
  const l = layout()
  if (!l) return
  // 总开关关掉：不画框（多选本身照常可用）
  if (!frameConfig.value.enabled) {
    frame.value = null
    return
  }
  const ids = [...sel().ids]
  if (ids.length <= 1) {
    frame.value = null
    return
  }
  const rects = ids.map((id) => l.getNodeRect(id)).filter((r): r is MultiSelectRect => r !== null)
  const pads = framePaddingsOf(frameConfig.value)
  // 间距必须与线宽同空间（都按 1/zoom 反缩放）：否则缩得越小线越粗、间距越窄，两条线糊成一条。
  // 详见 scaleFramePaddings 的说明与那张实测表。
  const scaled = scaleFramePaddings(pads, viewport.value.zoom || 1)
  frame.value = computeSelectionFrameGeometry(rects, scaled.gap, scaled.inner)
}

// 选中变化触发重算（内核 onChange 是选中单源，最可靠）
let unsubSel: (() => void) | undefined
unsubSel = sel().onChange(() => refreshFrame())

// 节点尺寸/位置变化（拖拽落盘、插件增删节点、resize）后包围框要跟上。
// 注意：**单节点拖动**（VueFlow 原生拖动，不是拖多选框）期间 store 不会更新，
// 所以框不能只靠这个订阅；每帧的跟随由 onDragFrame 处理（见下）。
let unsubStore: (() => void) | undefined
unsubStore = nodeStore().subscribe(() => refreshFrame())

/**
 * 节点拖动逐帧：被拖动的节点里有选中成员时，框要跟着一起动。
 *
 * 为什么不能只等 nodeStore 订阅：VueFlow 原生拖动**逐帧只改渲染层**（updateNode 内部状态），
 * 位置要到松手才落盘 —— 只订阅 store 的话，整个拖动过程中框都定在原地，松手那一瞬才"跳"过去
 * （用户截图里看到的正是这个）。节点逐帧视觉写由渲染层负责，这里同步把框按当前帧的并集重算。
 *
 * 多选框平移（本组件自己发起的拖动）不走这里：那条路径由 dragStartFrame 快照 + 位移算，不查 store。
 */
/**
 * 拖动开始那一刻的框快照 + 被拖成员在那一刻的位置。
 * 拖动中用"快照 + 与起始位置的位移"来移动框 —— 而不是每帧重算节点并集。
 *
 * 为什么不重算并集（这是实测踩出来的坑）：拖动过程中被拖节点的 store 位置**还是旧的**
 * （VueFlow 只在松手时落盘），于是"新位置 + 旧并集"混在一起算，框会随帧越跑越偏
 * （实测拖 4 帧，框相对节点的外扩量从 -7/-9 漂到 -7/-21），松手落盘后才跳回正确值。
 * 用位移量移动框则天然同步：框与节点走同一个 delta，偏移恒定不变。
 */
let nodeDragFrameAnchor: {
  frame: SelectionFrameGeometry
  anchorNodeId: string
  anchorStart: { x: number; y: number }
} | null = null

/**
 * 拖动中按"位移量"移动框（不重算并集，见 nodeDragFrameAnchor 的说明）。
 * @param delta 相对拖动起始的位移（flow 坐标）
 */
function followFrameByDelta(delta: { x: number; y: number }): void {
  const a = nodeDragFrameAnchor
  if (!a) return
  frame.value = followFrame(a.frame, delta.x, delta.y)
}

// 订阅渲染层的节点拖拽事件（宿主逐帧广播）：拖动中实时跟随，松手回到 store 权威值。
// 防御式：单测/极简宿主的上下文桩可能没有 `on`（只给 get），缺了就跳过订阅、不抛错。
const dragDisposers: Array<{ dispose(): void }> = []
type EventCtx = { on?: (name: string, cb: (payload: never) => void) => { dispose(): void } }
const ctxOn = (ctx as unknown as EventCtx).on?.bind(ctx)
if (ctxOn) {
  dragDisposers.push(
    ctxOn(RenderEvents.NodeDragStart, (p: { nodeId: string; position: { x: number; y: number } }) => {
      // 只有"拖的节点属于当前选中集"时才让框跟随。
      // 否则拖一个未选中的节点，框也会跟着一起动（用户报的 bug：拖未选中节点时选框也在移动）——
      // 框代表的是选中集，没被选中就不该理它。
      if (!frame.value || !shouldFrameFollowDrag(p.nodeId, sel().ids)) {
        nodeDragFrameAnchor = null
        return
      }
      // 记下"框此刻的样子"与"抓着的那个节点的起始位置"；之后每帧只用位移量移框。
      nodeDragFrameAnchor = {
        frame: { outer: { ...frame.value.outer }, inner: { ...frame.value.inner } },
        anchorNodeId: p.nodeId,
        anchorStart: { x: p.position.x, y: p.position.y },
      }
    }),
    ctxOn(RenderEvents.NodeDrag, (p: { nodeId: string; position: { x: number; y: number } }) => {
      const a = nodeDragFrameAnchor
      // 只认"抓着的主节点"的帧：多选拖动时 VueFlow 会给每个成员各发一帧，
      // 用同一节点算位移才能保证框与节点严格同步。
      if (!a || p.nodeId !== a.anchorNodeId) return
      followFrameByDelta({ x: p.position.x - a.anchorStart.x, y: p.position.y - a.anchorStart.y })
    }),
    ctxOn(RenderEvents.NodeDragEnd, () => {
      nodeDragFrameAnchor = null
      refreshFrame()
    }),
  )
}

// 配置、选中集、**缩放**变化都要重算：
// - 配置改变两框间距/大小/样式；
// - 选中集变了并集就变了；
// - 缩放变了间距要跟着换算（间距与线宽同空间，见 scaleFramePaddings）—— 少了这一项，
//   缩放画布后框的间距会停在旧缩放算出来的值上，与线宽对不上（就是"缩放后 padding 有 BUG"的另一半）。
watch([() => sel().ids, frameConfig, () => viewport.value.zoom], () => refreshFrame(), {
  immediate: true,
})

// ====== 整组拖动 ======
const isDragging = ref(false)
const dragStartClient = ref({ x: 0, y: 0 })
/** 拖动起始时各可动节点的绝对位置（flow） */
const dragStartPositions = ref<Map<string, { x: number; y: number }>>(new Map())
/** 拖动中最新视觉位置（松手落盘用） */
const livePositions = ref<Map<string, { x: number; y: number }>>(new Map())
/**
 * 拖动起始时的两框快照（拖动中框位置 = 快照 + 累计位移）。
 * 必须是**快照**、不能拿"当前框"当基准：mousemove 每帧都在写 frame，
 * 若每帧在当前值上再加一次"从按下算起的累计位移"，位移就会被重复累加 ——
 * 框会以 1、3、6、10… 的加速度甩出去（实测拖 100px 框跑了 300px）。
 */
const dragStartFrame = ref<SelectionFrameGeometry | null>(null)
// ====== 在画布层接管"框内拖动"======
/**
 * 为什么要在 pane 上判断、而不是让框自己接事件：
 * 框必须 `pointer-events:none`（否则会盖住节点，节点点不到 = 没法单独取消选中）。
 * 一旦让出事件，左键落在"框内空白"就会被 VueFlow 当成"拖空白 = 平移画布"。
 * 所以这里在 pane 的捕获阶段按**几何**判断：落点在多选框内、且不在任何节点上 → 这次手势归本插件，
 * 拦下事件自己处理成"整组平移"；落在节点上则原样放过（VueFlow 的节点选中/拖动照旧）。
 */
function screenToFlowPoint(clientX: number, clientY: number): { x: number; y: number } {
  // 官方换算（VueFlow 内部处理 pane 偏移与变换），比手写公式可靠（手写版实测算错 flow 坐标导致反馈失效）
  try {
    return screenToFlow(clientX, clientY)
  } catch {
    // 单测桩可能没提供
  }
  const vp = viewport.value
  const zoom = vp.zoom || 1
  const paneEl = pane?.value
  const rect = paneEl?.getBoundingClientRect()
  const originX = rect ? rect.left : 0
  const originY = rect ? rect.top : 0
  return { x: (clientX - originX - vp.x) / zoom, y: (clientY - originY - vp.y) / zoom }
}

function pointInRect(
  p: { x: number; y: number },
  r: { x: number; y: number; w: number; h: number },
): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

/** 该点是否落在某个节点的矩形里（落节点上就让 VueFlow 自己处理，不做整组平移） */
function hitsAnyNode(p: { x: number; y: number }): boolean {
  const l = layout()
  if (!l) return false
  return l.getAllRects().some((r) => pointInRect(p, r))
}

/**
 * 整组拖动结束后的"误点击守卫"（与框选同一套语义，见 boxSelectGuard.ts）。
 * 拖动松手后浏览器会补一个 `click`，VueFlow 当成点空白 → 清空选中；
 * 这里让那次 click 失效，保住刚拖完的选中。
 */
const groupDragClickGuard = new BoxSelectClickGuard()

/** 框内/框外空白上的 click：若刚拖完整组，吞掉这一次（避免清空选中） */
function onOwnerCaptureClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  const isPaneBlank = !!target && !target.closest('.vue-flow__node') && !target.closest('.vue-flow__edge')
  const swallowed = groupDragClickGuard.shouldSwallow(isPaneBlank)
  if (!swallowed) return
  e.stopImmediatePropagation()
  e.preventDefault()
}


/** pane 捕获阶段：判断这次左键按下要不要由本插件接管为"整组平移" */
function onPaneCaptureDown(e: PointerEvent | MouseEvent): void {
  // 已经由 pointerdown 接管了这次手势：紧随其后的 `mousedown` 是**同一个物理动作的另一个事件**，
  // 必须一并拦下 —— 否则 d3-zoom 会从它那里开始平移画布（实测：框和节点在拖、画布也在平移）。
  // 只在"拖动正在进行"时抵消：箭头不能靠 groupDragArmed 判断，否则下一次 pointerdown
  // 也会被它吃掉（那次本该开始新的拖动）。
  if (isDragging.value && e.type === 'mousedown') {
    e.stopImmediatePropagation()
    e.preventDefault()
    return
  }
  // 新的手势开始（pointerdown）：作废上一次遗留的吞 click 标记。
  // 正常路径下上一次的 click 已在松手后立刻被消费；能留到这里的只有"松手点落在节点上、
  // 浏览器没补发 click"那一类，必须作废，否则会误吞用户这次的真实点击。
  if (e.type === 'pointerdown') groupDragClickGuard.reset()
  if (e.button !== 0 || isDragging.value) return
  const g = frame.value
  if (!g) return
  const target = e.target as HTMLElement | null
  if (!(target instanceof HTMLElement)) return
  // 落在节点/边/端口/控件上 → 交给它们（节点选中、单独取消选中、拖单个节点都靠这个）
  if (
    target.closest('.vue-flow__node') ||
    target.closest('.vue-flow__edge') ||
    target.closest('.vue-flow__handle') ||
    target.closest('.vue-flow__controls') ||
    target.closest('.vue-flow__minimap') ||
    target.closest('.vue-flow__panel')
  ) {
    return
  }
  // 落在**本插件自己的批量连线端口**上 → 交给它（preview 的 MovingHandle 自己发 connectStart）。
  // 不排除的话：端口球就画在多选框边缘内侧，几何判定会把它当成"框内空白"，
  // 于是这次按下被接管成"整组平移"、端口的拖动压根收不到事件（用户报的 bug）。
  if (
    isHitOwnBatchPort({
      batchSlot: !!target.closest('.selection-frame-batch-slot'),
      movingHandle: !!target.closest('.moving-handle-anchor'),
    })
  ) {
    return
  }
  const p = screenToFlowPoint(e.clientX, e.clientY)
  // 只在"多选框内部"接管；框外空白仍是 VueFlow 的平移/框选
  if (!pointInRect(p, g.outer)) return
  if (hitsAnyNode(p)) return

  // 拦下：不让 VueFlow 把这次拖动当成画布平移
  e.stopImmediatePropagation()
  // 注意：这里**要** preventDefault（抑制原生拖拽/选中文字），但它会连带抑制该 pointer 的
  // 兼容鼠标事件（mousemove/mouseup）—— 所以下面的拖动监听用的是 **pointermove/pointerup**，
  // 而不是 mousemove/mouseup（踩过：监听 mousemove 导致拖动全程收不到事件）。
  e.preventDefault()
  startGroupDrag(e.clientX, e.clientY)
}

/** 起一次"整组平移"手势（框内左键拖动 = 框与选中节点一起走） */
function startGroupDrag(clientX: number, clientY: number): void {
  if (!frame.value) return
  isDragging.value = true
  dragStartClient.value = { x: clientX, y: clientY }
  dragStartFrame.value = {
    outer: { ...frame.value.outer },
    inner: { ...frame.value.inner },
  }

  const nodes = nodeStore().getNodes()
  const movable = draggableMembers(sel().ids, nodes)
  const l = layout()
  const ns = nodeStore()
  // 每节点拖动基准：
  //   abs  = 拖动起始的**绝对**坐标（flow，供 membership 判定与事件 payload）
  //   base = 该节点**写回坐标系**的起始基准（无父 = 绝对；带父 = 相对父），父不随动故拖动期间恒定
  const startMap = new Map<string, { abs: { x: number; y: number }; base: { x: number; y: number } }>()
  const liveMap = new Map<string, { x: number; y: number }>()
  for (const id of movable) {
    const rect = l?.getNodeRect(id)
    if (rect) {
      const n = ns.getNode(id)
      const parentAbs = n?.parentId ? (l.absolutePosition(n.parentId) ?? { x: 0, y: 0 }) : { x: 0, y: 0 }
      startMap.set(id, { abs: { x: rect.x, y: rect.y }, base: { x: rect.x - parentAbs.x, y: rect.y - parentAbs.y } })
      liveMap.set(id, { x: rect.x - parentAbs.x, y: rect.y - parentAbs.y })
    }
  }
  dragStartPositions.value = startMap
  livePositions.value = liveMap

  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragUp)
}

function onDragMove(e: MouseEvent): void {
  if (!isDragging.value) return
  const zoom = viewport.value.zoom || 1
  const canvasDx = (e.clientX - dragStartClient.value.x) / zoom
  const canvasDy = (e.clientY - dragStartClient.value.y) / zoom

  // 整组节点视觉移动（渲染层单节点视觉写，不触发 store 重灌）
  const nextLive = new Map<string, { x: number; y: number }>()
  for (const [id, start] of dragStartPositions.value) {
    const p = { x: start.base.x + canvasDx, y: start.base.y + canvasDy }
    nextLive.set(id, p)
    updateNodeVisual(id, p)
  }
  livePositions.value = nextLive

  // 两框一起跟着位移 = 起始快照 + 累计位移（绝对定位，不累加；见 dragFollow 的说明）。
  // 松手落盘后由 refreshFrame 从 store 重算接管。
  const start = dragStartFrame.value
  if (start) {
    frame.value = followFrame(start, canvasDx, canvasDy)
  }
}

function onDragUp(): void {
  if (!isDragging.value) return
  isDragging.value = false
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragUp)

  // 松手后浏览器还会补发一个 `click`，VueFlow 会把它当成"点空白"清空选中 ——
  // 于是整组拖动完选中全没了（实测：拖完 selection 变空）。
  // 复用框选那套守卫：这次手势确实拖过了 → 让紧随其后的那次空白 click 失效。
  groupDragClickGuard.markGestureDone(true)

  // 有实际位移 → 批量落盘（原子 + 一条历史记录）
  const entries = [...dragStartPositions.value].map(([id, start]) => {
    const write = livePositions.value.get(id) ?? { x: start.base.x, y: start.base.y }
    return { id, patch: { position: write } }
  })
  if (entries.length > 0) graph().updateNodes(entries)
  // 批量落盘后逐节点广播 drag-end：plugin-group 等成员归属插件按"新位置"重算 join/leave。
  // （此前只广播被拖的主节点 —— 多选拖出组时其它成员的脱离/归组没人处理，用户实测：组跟着跑但没脱离。）
  for (const [id, start] of dragStartPositions.value) {
    ;(ctx as unknown as { emit(name: string, payload: unknown): void }).emit(
      RenderEvents.NodeDragEnd,
      // payload.position = 绝对坐标（与 CanvasHost 单节点拖拽的 payload 语义一致）
      { nodeId: id, position: start.abs },
    )
  }

  dragStartPositions.value.clear()
  livePositions.value.clear()
  dragStartFrame.value = null
  refreshFrame()
}

// ====== 模板样式 ======
/** 外框容器跟随视口（translate + scale），框内坐标即 flow 坐标 */
const wrapperStyle = computed(() => ({
  transform: `translate(${viewport.value.x}px, ${viewport.value.y}px) scale(${viewport.value.zoom})`,
  transformOrigin: '0 0',
}))

/** 外框（大框）：几何 + 描边样式；线宽/圆角反向缩放，视觉粗细恒定 */
const outerStyle = computed(() => {
  const g = frame.value
  if (!g) return null
  const zoom = viewport.value.zoom || 1
  const stroke = frameStrokeCss(frameConfig.value.outer, 1 / zoom)
  return {
    left: `${g.outer.x}px`,
    top: `${g.outer.y}px`,
    width: `${g.outer.w}px`,
    height: `${g.outer.h}px`,
    ...stroke,
  }
})

/**
 * 内框（小框）：紧贴节点并集，位置 = 外框左上角 + padding。
 *
 * 注意与旧实现的差别：内框是外框的**兄弟**而不是子元素。
 * 嵌在外框里时，一旦外框线宽配成 0（或将来被条件隐藏），内框会跟着一起消失 ——
 * 两个框各有各的样式，就不该有这种连坐关系。
 */
const innerStyle = computed(() => {
  const g = frame.value
  if (!g) return null
  const zoom = viewport.value.zoom || 1
  return {
    left: `${g.inner.x}px`,
    top: `${g.inner.y}px`,
    width: `${g.inner.w}px`,
    height: `${g.inner.h}px`,
    // 与上面那条一样按 1/zoom 反缩放（见 frameStrokeCss 的 lineScale 说明）：
    // 两框都对 zoom 免疫，所以"线宽"这个配置项的含义恒为"你屏幕上看到的粗细"。
    ...frameStrokeCss(frameConfig.value.inner, 1 / zoom),
  }
})

/** 是否画内框：线宽 0、或并集退化成一个点，都没意义 */
const showInner = computed(() => {
  const g = frame.value
  if (!g) return false
  return frameConfig.value.inner.lineWidth > 0 && g.inner.w > 0 && g.inner.h > 0
})

/** 有选中（>1）就显示整个浮层 */
const isVisible = computed(() => frame.value !== null && !isSelecting.value)

// ====== 批量连线端口的定位与引导线 ======
/**
 * 端口只在"有多选"且"没在拖动/框选"时出现。
 * **拖动中必须继续渲染**：引导线的起点要读它的 DOM 位置；用 `visibility:hidden` 藏起来
 * 而不是 `v-if` 摘掉（摘了就读不到位置，线画不出来）。
 */
const showBatchHandles = computed(() => isVisible.value && !isDragging.value)

/**
 * 端口位置：贴在大框左右两侧的垂直中点。
 * wrapper 本身带 viewport 变换，所以这里给"框内坐标"，再用 1/zoom 反缩放让屏幕上大小恒定。
 */
function batchStyle(side: 'left' | 'right'): Record<string, string> {
  const g = frame.value
  if (!g) return {}
  const zoom = viewport.value.zoom || 1
  // 定位盒：高 = 跟随区高、宽 = 0，摆在大框左/右缘的垂直中点。
  //
  // 为什么给高度而不给 0：MovingHandle 的锚点自带 top:50% + translateY(-50%)，它把跟随区
  // 以锚点为中心上下摆开。盒子高 = 跟随区高时，锚点就落在"盒子垂直中点"这个真正的几何中心上，
  // 跟随区上下各露一半 —— 与节点端口同款；以后改跟随区高度也不用再动这里。
  // 用 1/zoom 反缩放，保证屏幕上端口大小恒定（与节点端口同观感）。
  return {
    top: `${g.outer.y + g.outer.h / 2 - portZoneHeight.value / 2}px`,
    height: `${portZoneHeight.value}px`,
    left: side === 'left' ? `${g.outer.x}px` : `${g.outer.x + g.outer.w}px`,
    transform: `scale(${1 / zoom})`,
    transformOrigin: side === 'left' ? 'left center' : 'right center',
  }
}

/**
 * 引导线（屏幕坐标）：从端口当前位置连到鼠标。
 * 读端口 DOM 的真实屏幕位置最省事，也天然包含缩放/反缩放的效果。
 */
/**
 * 拖动中的临时线：**每个选中节点各一条**，从他自己的端口锚点连到鼠标/吸附点。
 *
 * 端点转换：`buildBatchGuideLines` 给的是 flow 坐标；渲染层（wrapper 外）要屏幕坐标，
 * 所以这里用 viewport + pane 统一换算。起点的"朝向外侧"由 fromPosition 决定（右拖=从右缘出、
 * 左拖=从左缘出），与 ConnectionLine 注释里"方向别硬编码"的要求一致。
 */
const guideLines = computed<BatchGuideLine[]>(() => {
  if (!isBatchConnecting.value || !batchCursor.value) return []
  const side = batchSide.value
  const l = layout()
  if (!l || !side) return []
  const ids = [...sel().ids]
  const rects = ids.map((id) => l.getNodeRect(id)).filter((r): r is MultiSelectRect => r !== null)
  const vp = viewport.value
  const paneEl = pane?.value
  const rect = paneEl?.getBoundingClientRect()
  if (!rect) return []
  const toScreen = (p: { x: number; y: number }) => ({
    x: p.x * (vp.zoom || 1) + vp.x + rect.left,
    y: p.y * (vp.zoom || 1) + vp.y + rect.top,
  })
  const cursorFlow = screenToFlowPoint(batchCursor.value.x, batchCursor.value.y)
  const raw = buildBatchGuideLines(side, ids, rects, cursorFlow, batchSnapAnchor.value)
  // 贴上"这条会不会连上"（与落边共用同一份计划）——有源连不上时，那条线画淡，
  // 用户在松手前就能看出"这一拖只有几条会成"。计划还没有（没瞄准节点）时不标，保持原样。
  const marked = batchPlan.value ? markGuideLines(raw, batchPlan.value, side) : raw
  return marked.map((line) => ({
    ...line,
    from: toScreen(line.from),
    to: toScreen(line.to),
  }))
})

// ====== 滚轮穿透：在框上滚轮 = 缩放画布（#4）======
/**
 * 把框上的滚轮转发给 VueFlow 的 viewport 元素。
 *
 * 为什么是转发而不是自己算 zoom：VueFlow 的缩放中心要按"鼠标在画布内的位置"算，
 * 自己调 zoomTo 会以画布中心缩放（手感不对）；转发出一个真实 wheel 事件交给它处理，
 * 缩放中心、增量、动画都与直接在空白处滚完全一致。
 */
function forwardWheel(e: WheelEvent): void {
  const target = viewportEl.value
  if (!target) return
  e.preventDefault()
  target.dispatchEvent(
    new WheelEvent('wheel', {
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      deltaZ: e.deltaZ,
      deltaMode: e.deltaMode,
      clientX: e.clientX,
      clientY: e.clientY,
      bubbles: true,
      cancelable: true,
    }),
  )
}

/** VueFlow 的 viewport 元素（滚轮转发目标）；pane 就绪后可解析 */
const viewportEl = ref<HTMLElement | null>(null)
function resolveViewportEl(): void {
  // 防御式：单测/极简宿主的上下文桩可能没有 pane
  const paneEl = pane?.value
  const root = paneEl?.closest('.vue-flow')
  viewportEl.value = root ? root.querySelector('.vue-flow__viewport') : null
}
watch(pane, () => resolveViewportEl())
resolveViewportEl()

/** 滚轮监听在 wrapper 上（捕获阶段）：框上任何位置滚轮都拦下并转发 */
const wrapperRef = ref<HTMLElement | null>(null)
watch(wrapperRef, (el, _old, onCleanup) => {
  if (!el) return
  el.addEventListener('wheel', forwardWheel, { passive: false })
  onCleanup(() => el.removeEventListener('wheel', forwardWheel))
})

/**
 * pane 上的"框内拖动接管"（捕获阶段，必须早于 VueFlow/d3-zoom 的按下处理）。
 *
 * 必须 `immediate: true`：本组件是"选中 >=2"时才挂载的，挂载那一刻 pane 往往**已经有值**，
 * 不加 immediate 的话 watch 不触发、监听器永远装不上（踩过一次：拖动完全没被接管）。
 */
/**
 * 监听装在 **`.vue-flow` 根**上（捕获阶段），而不是 pane 上。
 *
 * 为什么必须是这一层（都是实测定出来的，不是猜）：
 * - **d3-zoom 的平移挂在 `.vue-flow__viewport` 上**（`mousedown`，非捕获）——
 *   它在 pane 的**祖先**链上，拦 pane 根本拦不住它，画布照样被拖走；
 * - 而 VueFlow 自己的框选/选中在 pane 的 `pointerdown` 上；
 * - 还有**窗口级**（非委托）的 mousemove 兜底逻辑，事件一冒泡到 window 就可能建边；
 * 结论：捕获阶段挂在 `.vue-flow` 根上，并在命中的那一帧同时 `stopImmediatePropagation`，
 * 才能既抢在 d3-zoom 之前、又阻断后续冒泡。
 */
/**
 * 实际挂监听的元素：画布实例根（`.csurface`，即 `.vue-flow` 的父节点）。
 *
 * 为何是这一层、且必须捕获阶段（实测定出来的）：
 * - **d3-zoom 的平移挂在 `.vue-flow__viewport` 的 `mousedown`**（非捕获）—— 它在 pane 的祖先链上，
 *   拦 pane 拦不住它（实测画布照样被拖走）；
 * - VueFlow 自己的框选/选中在 pane 的 `pointerdown`；
 * - 还有**窗口级** mousemove 兜底逻辑，事件冒泡到 window 就可能建边。
 * 挂在实例根的捕获阶段，既能抢在 d3-zoom 之前，又能 `stopImmediatePropagation` 阻断后续冒泡。
 */
const hostEl = computed<HTMLElement | null>(() => rootEl?.value ?? null)

// 挂监听：`immediate: true` 让"挂载时元素已就绪"也能装上；元素换了（重挂载）自动跟着换
watch(
  hostEl,
  (el, _old, onCleanup) => {
    if (!el) return
    el.addEventListener('pointerdown', onPaneCaptureDown, { capture: true })
    el.addEventListener('mousedown', onPaneCaptureDown, { capture: true })
    el.addEventListener('click', onOwnerCaptureClick, { capture: true })
    onCleanup(() => {
      el.removeEventListener('pointerdown', onPaneCaptureDown, { capture: true })
      el.removeEventListener('mousedown', onPaneCaptureDown, { capture: true })
      el.removeEventListener('click', onOwnerCaptureClick, { capture: true })
    })
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragUp)
  for (const d of dragDisposers) d.dispose()
  unsubSel?.()
  unsubStore?.()
})
</script>

<template>
  <div v-if="isVisible" ref="wrapperRef" class="selection-frame-wrapper" :style="wrapperStyle">
    <!-- 大框：纯视觉，整体不接事件（节点才点得到、可单独取消选中）。
         "在框内按住拖动 = 整组平移"由 pane 上的几何判断接管（见 onPaneCaptureDown）。 -->
    <div class="selection-frame-outer" :style="outerStyle" role="presentation" />
    <!-- 小框：紧贴选中节点并集（不含标题），纯装饰不接事件 -->
    <div v-if="showInner" class="selection-frame-inner" :style="innerStyle" />
    <!-- 批量连线端口：左右各一个（效果对称，右侧=选中节点当源、左侧=当目标）。
         直接复用主题的 MovingHandle（preview 模式 = 只复用外观、不注册 VueFlow 连接点），
         所以它和节点上的端口**长得完全一样**（半圆跟随区 + 浮动圆球 + 同一套主题变量）。
         按住端口区往节点上拖 → 松手给选中集逐个落边（见 onBatchConnectStart/onBatchUp）。

         按下监听挂在这个定位盒上（不是 MovingHandle 的 connect-start）：圆球始终画在跟随区**里面**、
         跟随区 z-index 更高，按下命中的是跟随区，圆球的 mousedown 收不到。挂在盒子这层，
         跟随区/圆球/耳朵从哪儿按都能起手。

         盒子给的是**真实高度**（= 跟随区高），MovingHandle 自己的 `top:50%` 就落在盒子垂直中点上，
         跟随区上下各露一半 —— 与节点端口同一套几何，不再另做一套定位。 -->
    <div
      v-if="showBatchHandles"
      class="selection-frame-batch-slot is-left"
      :style="batchStyle('left')"
      @mousedown="onBatchConnectStart($event, 'target')"
    >
      <MovingHandle
        id="multi-select-batch-left"
        type="target"
        :position="Position.Left"
        preview
        :selected="true"
        :visible="true"
        :disabled="false"
        :rest-offset="handleParams.handleRestOffset"
        :cursor-gap="handleParams.handleCursorGap"
        :button-size="handleParams.handleButtonSize"
        :zone-width="portZoneWidth"
        :zone-height="portZoneHeight"
        :zone-offset="portZoneOffset"
        :zone-shape="portZoneShape"
        :zone-arc-ratio="portZoneArcRatio"
        class="selection-frame-batch-handle"
        @connect-start="onBatchConnectStart($event.event, 'target')"
      />
    </div>
    <div
      v-if="showBatchHandles"
      class="selection-frame-batch-slot is-right"
      :style="batchStyle('right')"
      @mousedown="onBatchConnectStart($event, 'source')"
    >
      <MovingHandle
        id="multi-select-batch-right"
        type="source"
        :position="Position.Right"
        preview
        :selected="true"
        :visible="true"
        :disabled="false"
        :rest-offset="handleParams.handleRestOffset"
        :cursor-gap="handleParams.handleCursorGap"
        :button-size="handleParams.handleButtonSize"
        :zone-width="portZoneWidth"
        :zone-height="portZoneHeight"
        :zone-offset="portZoneOffset"
        :zone-shape="portZoneShape"
        :zone-arc-ratio="portZoneArcRatio"
        class="selection-frame-batch-handle"
        @connect-start="onBatchConnectStart($event.event, 'source')"
      />
    </div>
  </div>
  <!-- 拖动中的临时线：**每个选中节点各一条**（从该节点自己的端口锚点连到鼠标/吸附点），
       用主题的 ConnectionLine（内部委托给 CustomEdge）→ 与正式边**完全同款**
       （导轨 / 流光 / 箭头 / 配置全一致）。挂在 wrapper 外面并用屏幕坐标，因为 wrapper 带 viewport scale。 -->
  <svg v-if="guideLines.length > 0" class="selection-frame-batch-guide" aria-hidden="true">
    <g
      v-for="(line, i) in guideLines"
      :key="line.nodeId + '-' + i"
      class="selection-frame-batch-guide-line"
      :class="{ 'is-rejected': line.willConnect === false }"
    >
      <ConnectionLine
        :source-x="Math.round(line.from.x)"
        :source-y="Math.round(line.from.y)"
        :target-x="Math.round(line.to.x)"
        :target-y="Math.round(line.to.y)"
        :source-position="line.fromPosition"
        :target-position="batchSide === 'source' ? 'left' : 'right'"
      />
    </g>
  </svg>
</template>

<style scoped>
.selection-frame-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  pointer-events: none;
  z-index: 5;
  overflow: visible;
}

/* 大框：纯视觉层（颜色/线型/线宽/圆角/填充全由配置注入 inline style）。
   注意它**不接事件**：一旦接事件就会把整块区域从节点手里抢走（节点点不到 = 没法单独取消选中）。 */
.selection-frame-outer {
  position: absolute;
  box-sizing: border-box;
  pointer-events: none;
  overflow: visible;
  transition: background 180ms ease, border-color 180ms ease;
}

/* 小框：紧贴节点并集，纯装饰不接事件 */
.selection-frame-inner {
  position: absolute;
  box-sizing: border-box;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .selection-frame-outer {
    transition: none;
  }
}

/* 批量连线端口本体是主题的 MovingHandle（外观/跟随/显隐全由它负责），
   这里只负责"把它摆在大框左右两侧的垂直中点"。
   宽度 0（不影响左右缘对齐），高度由行内 style 给（= 跟随区高），让锚点的 top:50% 有意义；
   允许子元素溢出（端口球/跟随区会画到外面去）。 */
.selection-frame-batch-slot {
  position: absolute;
  width: 0;
  pointer-events: none;
  z-index: 2;
  overflow: visible;
}

/* —— 拖动中的临时线（屏幕层；svg 铺满视口，线由 ConnectionLine 画）—— */
.selection-frame-batch-guide {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  z-index: 9998;
  overflow: visible;
}

/* 连不上的那条临时线：压暗 + 半透明。
  为什么不用虚线：CustomEdge 的线型来自主题配置（用户可配），这里再叠一层 dash 会与配置打架，
  而且虚线看上去像"另一种线"，压暗才准确表达"这条不会成"。 */
.selection-frame-batch-guide-line.is-rejected {
  opacity: 0.28;
  filter: grayscale(0.7);
}
</style>
