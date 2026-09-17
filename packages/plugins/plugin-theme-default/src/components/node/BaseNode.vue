<script setup lang="ts">
// BaseNode —— 节点"壳"（v2 视觉完善版，消费 canvas-render 的连接反馈能力 + 类型能力 + 主题变量）。
// 职责：
//   1. 消费 NodeRenderer：按 node.type 路由 content/title/top/bottom 段组件渲染（保留 M2 契约）。
//   2. 卡片外观对齐 v1 Decoration：固定可 resize 尺寸 + 内容裁剪层 + 圆角；标题条(BaseTitle)就地重命名。
//   3. 端口按节点类型能力显隐(useNodeCapability)；浮动端口外观全来自 handleParams。
//   4. 拖线反馈(消费 useCanvasRender().connectionState)：3D 倾斜 / 非法气泡 / valid/invalid / 拖线时压源口。
//   5. LOD：zoom 低时简化渲染。
// 依赖最新 API：useCanvasRender() 统一上下文（registry/nodeWrite/handleParams/connectionState）+ useVueFlow。
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  useVueFlow,
  Position,
  useCanvasRender,
  createV2Logger,
  useToolbarOffsets,
  resolveNodeSlotStyle,
  isConnectionSource,
} from '@mini-canvas/canvas-render'
import type { NodeProps, AimedTarget } from '@mini-canvas/canvas-render'
import { resolveSegment, nodeSegmentStackEntries } from '@mini-canvas/canvas-data'
import MovingHandle from './MovingHandle.vue'
import BaseTitle from './BaseTitle.vue'
import TitleLabel from './TitleLabel.vue'
import { isRectFullyVisible } from './titleEdit'
import { useNodeCapability } from '../../composables/useNodeCapability'
import { resolveCardFrame } from './cardFrame'
import {
  resolveMultiRadio,
  applyMultiRadioChange,
  multiRadioStyle,
  MULTI_RADIO_KEY_SET,
} from './multiRadio'
import { useNodeCardSize } from '../../composables/useNodeCardSize'
import { useNodeDebugOverlay } from '../../composables/useNodeDebugOverlay'

const log = createV2Logger('base-node')
const props = defineProps<NodeProps>()
// 节点类型都是本组件(VueFlow nodeTypes 全指到 BaseNode)，透传的 selected 等内部 prop 不落到根
defineOptions({ inheritAttrs: false })

// 统一渲染上下文（CanvasHost provide）——单入口取 registry/写回回调/端口外观/连接反馈/内核上下文
// visibleRect = 当前可视区（flow 坐标）：进编辑时判断要不要挪视图；未挂载为 null，判定自动跳过
const { ctx, registry, nodeWrite, handleParams, connectionState, interaction, debug, snapZone, updateNodeVisualSize, visibleRect } = useCanvasRender()
const vf = useVueFlow()

const type = computed(() => props.type)

// 3D 连接反馈常量（对齐 v1 CONNECT_FEEDBACK）
const CONNECT_FEEDBACK = {
  rotateX: 18,
  rotateY: 18,
  perspective: 800,
  scale: 1.018,
}

// —— 缩放 / LOD / 标题反缩放（v2 固定卡尺寸，标题宽=cardWidth×max(zoom,minZoom)）——
const zoom = computed(() => Math.max(vf.viewport.value?.zoom || 1, 0.01))
// 节点外观：全部来自本插件 Config（节点/标题、节点/低细节、节点/多选标记），对齐 v1 core 的
// nodeTitleOffset / nodeTitleScaleMinZoom / nodeLodLowDetailZoom。settings 单一数据源非 Vue 响应式，
// 故这里用 ref + onChange 订阅把配置改动实时驱动到渲染（改设置面板即生效，不整图重建）。
const settingsStore = () => ctx?.get<{ get(key: string): unknown }>('settings')
const numOf = (key: string, fallback: number): number => {
  const v = settingsStore()?.get(key)
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
const TITLE_OFFSET = ref(numOf('titleOffset', 12))
const TITLE_MIN_ZOOM = ref(numOf('titleScaleMinZoom', 0.5))
const LOW_DETAIL_ZOOM = ref(numOf('nodeLodLowDetailZoom', 0.4))
/**
 * 多选标记的外观（大小 / 颜色 / 低缩放是否显示）。
 * 配置来自本插件 Config 的「节点/多选标记」一组；这里读一次做初值，之后靠 onChange 窄更新。
 */
const MULTI_RADIO = ref(resolveMultiRadio((key) => settingsStore()?.get(key)))
/** 多选时是否隐藏标题条（配置在 multi-select 插件，key 全局平面命名，这里按名字读） */
const HIDE_TITLES_ON_MULTI = ref(
  settingsStore()?.get('multiSelectHideTitles') === true,
)
const applyTitleSetting = (key: string, value: unknown): void => {
  if (key === 'multiSelectHideTitles') {
    HIDE_TITLES_ON_MULTI.value = value === true
    return
  }
  // 多选标记的三项：只认识自己的键才动，别的键照旧往下走（互不干扰）
  if (MULTI_RADIO_KEY_SET.has(key)) {
    MULTI_RADIO.value = applyMultiRadioChange(MULTI_RADIO.value, key, value)
    return
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return
  if (key === 'titleOffset') TITLE_OFFSET.value = value
  else if (key === 'titleScaleMinZoom') TITLE_MIN_ZOOM.value = value
  else if (key === 'nodeLodLowDetailZoom') LOW_DETAIL_ZOOM.value = value
}
// 全局订阅配置变化，按 key 过滤出本节点关心的几项（不按插件 scope 过滤，避免命名/装配差异导致不触发）。
const titleSettingOff = ctx?.get<{ onChange(cb: (key: string, value: unknown) => void): { dispose(): void } }>('settings')?.onChange(
  (key, value) => applyTitleSetting(key, value),
)
onBeforeUnmount(() => titleSettingOff?.dispose())

const lowDetail = computed(() => zoom.value < LOW_DETAIL_ZOOM.value)
const titleScale = computed(() => 1 / Math.max(zoom.value, TITLE_MIN_ZOOM.value))

// ============ 多选相关显隐（配置由 multi-select 插件声明）============
/** 多选（选中 >=2）时是否隐藏标题条：列表更干净，也不再和大框的"上方间距"打架 */
const hideTitleOnMulti = computed(
  () => HIDE_TITLES_ON_MULTI.value && isSelected.value && selectedCount.value > 1,
)
/** 标题条可见性：低细节不显示；开了"多选隐藏标题"且处于多选时也不显示 */
const showTitle = computed(() => !lowDetail.value && !hideTitleOnMulti.value)

/**
 * 是否隐藏上下控制栏（NodeToolbar）。两部分：
 * - 框选手势进行中：那一排操作条/状态栏会被一起框进来、也挡视线 → 无条件收起。
 * - 多选（>=2）时：多选下这些栏没有意义（面板都是"恰好选中一个"的语义）→ 收起。
 * 单选时的显隐仍由各段组件自己的 useSoleNodeSelected 决定，这里只做"不该出现"的压制。
 */
const hideToolbars = computed(
  () => interaction?.isSelecting?.value === true || (isSelected.value && selectedCount.value > 1),
)

/** 多选（选中 >=2）且本节点在其中：此时压掉自身端口，改用多选框上的批量连线端口 */
const isMultiSelected = computed(() => isSelected.value && selectedCount.value > 1)

/**
 * 多选态（选中 >=2）：在节点内容区左上角显示一个圆形单选标记，用来"一眼看出这个节点在不在选中集里"。
 * 只在多选时才出现 —— 单选时卡片本身已有选中环，再叠一个圆点反而多余。
 * 低缩放（进入 LOD）时默认不画：那时整个节点都在简化渲染，再叠一个标记只会更糊；
 * 想让它一直在，把「多选标记低缩放显示」开关打开（配置 nodeMultiRadioShowInLowDetail）。
 */
const showMultiRadio = computed(
  () =>
    isSelected.value &&
    selectedCount.value > 1 &&
    (!lowDetail.value || MULTI_RADIO.value.showInLowDetail),
)

/**
 * 圆圈的大小 + 反缩放 + 颜色（与标题同一套语义）：保持"屏幕上的大小恒定"，
 * 否则缩到 0.2x 时它会小成一个点、完全起不到指示作用。三个值都来自本插件 Config。
 */
const radioStyle = computed(() =>
  multiRadioStyle({
    size: MULTI_RADIO.value.size,
    color: MULTI_RADIO.value.color,
    zoom: zoom.value,
    minZoom: TITLE_MIN_ZOOM.value,
  }),
)

/**
 * resize 拖柄的反缩放（与标题/多选圆点同一套语义）：保持"屏幕上的大小恒定"，
 * 否则缩到 0.2x 时拖柄会小成一个点，很难点到。
 */
const resizeHandleScale = computed(() => 1 / Math.max(zoom.value, TITLE_MIN_ZOOM.value))

// —— 节点标题（data.label ?? type）——
const nodeLabel = computed(() => {
  const label = props.data?.label as string | undefined
  return label || props.type || '节点'
})

// ============ 卡片固定尺寸 + resize（useNodeCardSize）============
const card = useNodeCardSize({
  nodeId: props.id,
  data: () => props.data ?? {},
  type: props.type,
  writeback: nodeWrite ?? undefined,
  zoom: () => zoom.value,
  // 拖拽实时把新尺寸同步进 VueFlow 内部并重算：否则端口位置/相连边端点会停在旧尺寸
  // （渲染层 updateNodeVisualSize = updateNode(style) + updateNodeInternals）
  onVisualSize: (w, h) => updateNodeVisualSize(props.id, w, h),
})
const cardWidth = card.cardWidth
const cardHeight = card.cardHeight
// 顶层解构：模板里 ref 自动解包，才能让 v-if 拿到布尔值(而非恒真的 ref 对象)。
const cardResizable = card.resizable
const cardIsResizing = card.isResizing

// 标题反缩宽度：DOM 宽 = cardWidth * max(zoom, minZoom)（屏幕宽 = 卡片屏幕宽）
const titleCanvasWidth = computed(() => cardWidth.value * Math.max(zoom.value, TITLE_MIN_ZOOM.value))
// 卡片边框反缩放补偿：标题要对齐到"卡片外缘"，所以得把边框那点宽度算回来。
// frameless 的类型没有边框（边框宽度为 0），补偿量就是 0 —— 否则标题会莫名偏出去 1px。
const cardBorderComp = computed(() => (cap.frameless.value ? 0 : Math.max(1 / zoom.value, 1)))
const titlePositionStyle = computed(() => ({
  transform: `scale(${titleScale.value})`,
  transformOrigin: 'left bottom',
  left: `${-cardBorderComp.value}px`,
  bottom: `calc(100% + ${TITLE_OFFSET.value * titleScale.value + cardBorderComp.value}px)`,
  width: `${titleCanvasWidth.value}px`,
}))

// 卡片外观（边框/圆角/选中环）统一由 cardFrame 决策：普通类型画 1px 边框，
// 声明 frameless 的类型（如图片：内容铺满整张卡）不画 —— 那一圈边框对它只是多余的缝。
// 选中环与边框独立，去掉边框后选中照样看得见（见 cardFrame 的契约测试）。
const cardFrame = computed(() =>
  resolveCardFrame({
    zoom: zoom.value,
    frameless: cap.frameless.value,
    transparent: cap.transparent.value,
    selected: showSelectionOutline.value,
  }),
)

// 卡片行内样式：尺寸 + 3D 连接倾斜 transform + 反缩放边框
const cardInlineStyle = computed<Record<string, string>>(() => ({
  width: `${cardWidth.value}px`,
  height: `${cardHeight.value}px`,
  transform: cardTransform.value,
  borderWidth: cardFrame.value.borderWidth,
  borderRadius: cardFrame.value.borderRadius,
  '--card-outline-width': cardFrame.value.outlineWidth,
  // 表面/投影由类型能力决定（transparent 容器型类型：底透明 + 无投影 → 连接线透出卡片区域）
  '--card-surface': cardFrame.value.surface,
  '--card-shadow': cardFrame.value.shadow,
  '--card-content-surface': cardFrame.value.contentSurface,
}))

// ============ 就地重命名 ============
const isEditingTitle = ref(false)

watch(
  () => props.selected,
  (sel) => {
    if (sel) document.addEventListener('keydown', onTitleEditKeydown)
    else {
      document.removeEventListener('keydown', onTitleEditKeydown)
      if (isEditingTitle.value) cancelTitleEdit()
    }
  },
  { immediate: true },
)

function onTitleEditKeydown(e: KeyboardEvent) {
  if (e.key !== 'F2' || isEditingTitle.value) return
  const t = e.target as HTMLElement | null
  if (!t) return
  const tag = t.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable) return
  if (!nodeWrite) return
  startTitleEdit()
}

function startTitleEdit() {
  if (isEditingTitle.value) return
  isEditingTitle.value = true
  // "适当聚焦"：只在该节点没完整露在视野里时才把视图挪过去 —— 每次改名都强制滚动画布会很烦。
  // 标题浮在卡片上方，所以判定矩形要把标题自身的高度也算进去（PAD）。
  focusNodeIfNeeded()
}

/**
 * 编辑前确保节点可见：不在视野内才 setCenter 挪过去（保留当前缩放，不打断用户视野）。
 * 拿不到 nodeLayout/visibleRect（未挂载/无 DOM 的测试环境）时静默跳过，不影响编辑本身。
 */
function focusNodeIfNeeded(): void {
  const layout = ctx?.get<{ getNodeRect(id: string): { x: number; y: number; w: number; h: number } | null } | undefined>('nodeLayout')
  const rect = layout?.getNodeRect(props.id)
  const view = visibleRect?.value
  if (!rect || !view) return
  // 标题条在卡片上方：把判定范围向上扩 PAD，避免"节点刚好看得见、标题却被裁掉"
  const withTitle = { x: rect.x, y: rect.y - TITLE_FOCUS_PAD, w: rect.w, h: rect.h + TITLE_FOCUS_PAD }
  if (isRectFullyVisible(withTitle, view)) return
  ctx?.get<{ setCenter(x: number, y: number, zoom?: number): void } | undefined>('viewport')
    ?.setCenter(rect.x + rect.w / 2, rect.y + rect.h / 2, zoom.value)
}

/** 标题空间余量（flow 坐标）：判定聚焦时向上多留这么多，保证标题不被视口裁掉 */
const TITLE_FOCUS_PAD = 32

function commitTitleEdit(value: string): void {
  const next = value || undefined
  if (nodeWrite) {
    // 先结束编辑态再写回：写回会让 label 变化，此时组件已是"非编辑态"，插值能正常刷新成归一化结果
    isEditingTitle.value = false
    nodeWrite(props.id, next === undefined ? { label: undefined } : { label: next })
    return
  }
  isEditingTitle.value = false
}

function cancelTitleEdit() {
  isEditingTitle.value = false
}
onBeforeUnmount(() => document.removeEventListener('keydown', onTitleEditKeydown))

// ============ 段组件路由（未注册段 = 不渲染/默认）============
// —— 选中态读取：多选相关显隐要用；走内核 selection（选中单源），不依赖 VueFlow 内部态 ——
interface SelectionPeek {
  readonly ids: ReadonlySet<string>
  onChange(cb: () => void): () => void
}
const selTick = ref(0)
const selectionPeek = ctx?.get<SelectionPeek | undefined>('selection')
const selOff = selectionPeek?.onChange(() => void (selTick.value += 1))
onBeforeUnmount(() => selOff?.())
/** 我是否在选中集里 */
const isSelected = computed(() => {
  void selTick.value
  return selectionPeek ? selectionPeek.ids.has(props.id) : Boolean(props.selected)
})
/** 当前选中节点数 */
const selectedCount = computed(() => {
  void selTick.value
  return selectionPeek ? selectionPeek.ids.size : (props.selected ? 1 : 0)
})

const content = computed(() => resolveSegment(registry, props.type, 'content'))
const customTitle = computed(() => resolveSegment(registry, props.type, 'title'))
// 上/下两个插槽：**可叠加** —— 基座段组件 + 其它插件经 ctx.nodes.contribute 叠上来的 occupant，
// 按 order 依次渲染（数据层的 nodeSegmentStack 早已支持，壳这里把它真的画出来，
// 以前只取基座，第三方挂上来的按钮到不了 DOM）。
// 取带稳定 id 的版本：列表 key 用注册时那个 id（基座='base'），插件热装卸时不会错位复用组件实例。
const topSlots = computed(() => nodeSegmentStackEntries(registry, props.type, 'top-toolbar'))
const bottomSlots = computed(() => nodeSegmentStackEntries(registry, props.type, 'bottom-toolbar'))
/**
 * overlay 段：编辑类浮层（裁剪框 / 扩展框）。
 *
 * **与 content 分开、且画在卡片外面**（用户要求"放在和上下操控栏同级位置"）：
 * content 住在 .v2-content-clip（overflow:hidden），浮层挂那里会被卡片边界裁掉 ——
 * 用户实测报的"裁剪区域被节点切掉"就是这个原因。overlay 与上/下控制栏同级，
 * 覆盖整张卡片且 overflow 可见，于是框能贴到卡片边缘（扩展框还要能画到卡片之外）。
 *
 * 它自带定位（跟随卡片尺寸），所以不走 resolveNodeSlotStyle 那套"贴边+居中+反缩放"——
 * 浮层的坐标必须与卡片内容严格对齐，一旦反缩放就会与底下的画面错位。
 */
const overlaySlots = computed(() => nodeSegmentStackEntries(registry, props.type, 'overlay'))
const editable = computed(() => Boolean(nodeWrite))

// ============ 上/下插槽的定位（由壳统一负责，插件只管内容）============
// 用户要求："定位交给 BaseNode 而不是单独的组件 —— 基础节点已经把位置算出来了，
// 然后把插槽留给对应的插件实现（插件只把按钮组件放进来即可）"。
// 于是"贴边距离 + 水平居中 + 反缩放"三件事都在壳这一层算：此前三个段组件各抄一遍，
// 而"居中"与"反缩放"必须合进同一个 transform（分开写会互相顶掉，图片面板当初因此错位过）。
const slotOffsets = useToolbarOffsets()
/** 浮层贴在卡片上缘之外：绝对定位，不参与节点 flex 布局，所以不会把节点撑高 */
const topSlotsStyle = computed(() =>
  resolveNodeSlotStyle({ side: 'top', offset: slotOffsets.value.top, zoom: zoom.value }),
)
/** 浮层贴在卡片下缘之外，同上 */
const bottomSlotsStyle = computed(() =>
  resolveNodeSlotStyle({ side: 'bottom', offset: slotOffsets.value.bottom, zoom: zoom.value }),
)

/**
 * 编辑浮层的定位：**与卡片完全重合**（同宽同高、无偏移、不反缩放）。
 *
 * 为什么不像上/下控制栏那样反缩放：裁剪框的坐标必须与底下的画面像素严格对齐，
 * 一旦按 1/zoom 反缩放，框与画面就会错位（用户拖到的位置与框显示的位置不一致）。
 * 所以这里只做"贴在卡片上"这一件事。
 */
const overlayLayerStyle = computed<Record<string, string>>(() => ({
  width: `${cardWidth.value}px`,
  height: `${cardHeight.value}px`,
}))

// ============ 端口能力显隐（按 type）============
const cap = useNodeCapability(props.type)
const showTargetHandle = cap.hasTarget
const showSourceHandle = cap.hasSource
// 标题左侧图标 = 类型注册时声明的 icon（opaque 句柄；未声明则为 undefined，BaseTitle 不渲染图标位）
const titleIcon = cap.icon

// ============ hover 状态（控制端口醒目与阴影）============
/** 鼠标在卡片上（卡片根 enter/leave 单一权威，勿被端口 zone 覆写） */
const isHovered = ref(false)
/** 鼠标在本节点的某个端口 zone 上（MovingHandle @hover 写入，与 isHovered 互不干扰） */
const portHovered = ref(false)
// —— 拖线瞄准上报（前端 mouse 事件驱动 aimedTarget，取代后端几何命中）——
// 端口 zone 瞄准侧：null=无端口 hover；'input'=target 输入口 / 'output'=source 输出口
const aimPortSide = ref<null | 'input' | 'output'>(null)
// 卡片 body 瞄准（鼠标在卡片主体、非端口 zone）
const aimBody = ref(false)

// ============ 连接反馈（消费 connectionState）============
const isConnecting = computed(() => connectionState.isConnecting.value)
const activeConnection = computed(() => connectionState.activeConnection.value)
/**
 * 拖线源是否是我自己（拖线时压住自己端口 + 禁止对自己 3D）。
 *
 * 走渲染层的 isConnectionSource（不是直接比 sourceNodeId）：多选批量连线是"一次拖出、多个源"，
 * 只认一个 sourceNodeId 的话，选中集里除第一个之外的节点都不算源 —— 它们的端口不会压住，
 * 自己还会被当成可连目标亮起 3D。用户报的"判断的是只有单个连接线"就是这里。
 */
const isCurrentConnectingNode = computed(
  () => isConnecting.value && isConnectionSource(activeConnection.value, props.id),
)
/** 拖线时是否全局压端口（源口之外也隐藏其余端口，避免干扰） */
const suppressHandles = computed(() => connectionState.suppressHandles.value)

const connectionHover = computed(() => {
  const h = connectionState.hoverNode.value
  return h && h.nodeId === props.id ? h : null
})
const isConnectionValidTarget = computed(() => connectionHover.value?.status === 'valid')
const isConnectionInvalidTarget = computed(() => connectionHover.value?.status === 'invalid')
/** 悬停到我且本连接会使输入口满额挤最老一条（UI 提示"将替换"） */
const isWillEvictTarget = computed(() => connectionHover.value?.willEvict === true)

/** 是否对我做"可连接"3D 反馈：仅由数据层「合法连接目标」(hoverNode.status=valid) 决定，
 *  与物理鼠标 hover 无关（物理 hover 只控制端口显隐 shouldShowHandles）。 */
const showConnectFeedback = computed(
  () =>
    isConnecting.value &&
    !isCurrentConnectingNode.value &&
    !isConnectionInvalidTarget.value &&
    !lowDetail.value &&
    isConnectionValidTarget.value,
)

// ============ 拖线瞄准上报：前端 mouse 事件 → connectionState.aimedTarget ============
// 卡片根 enter/leave：维护物理 hover + body 瞄准；同时给两个端口做"从卡片方向离场"的兜底归位
// （鼠标从卡内往卡内更深处走、永远不越过 zone 外沿时，端口球会卡在卡内一侧，这里把它拉回静止位）。
const targetHandleRef = ref<InstanceType<typeof MovingHandle> | null>(null)
const sourceHandleRef = ref<InstanceType<typeof MovingHandle> | null>(null)
function onCardMouseEnter(): void {
  isHovered.value = true
  aimBody.value = true
}
function onCardMouseLeave(): void {
  isHovered.value = false
  aimBody.value = false
  targetHandleRef.value?.handleCardLeave(true)
  sourceHandleRef.value?.handleCardLeave(true)
}
// 吸附带元素（真正触发吸附的区域）：复用 useNodeDebugOverlay 的 SnapZoneConfig 几何定位 ——
// 左侧 target 输入口吸附带 / 右侧 source 输出口吸附带，各自 mouseenter/leave 上报 aim（input/output）。
// 只在拖线期间、且非源自身时参与命中（pointer-events 由 CSS 控制），平时不挡卡片 hover。
function onInputSnapEnter(): void {
  aimPortSide.value = 'input'
}
function onOutputSnapEnter(): void {
  aimPortSide.value = 'output'
}
function onSnapLeave(): void {
  aimPortSide.value = null
}
/** 吸附带是否可命中（拖线期间、非源自身、非低细节） */
const snapZonesActive = computed(
  () => isConnecting.value && !isCurrentConnectingNode.value && !lowDetail.value,
)
// 吸附带定位（卡内本地坐标，可负 x 溢出卡片，由 overflow:visible 承载）
const inputSnapStyle = computed(() => ({
  left: `${debugOverlay.leftBand.value.x}px`,
  top: `${debugOverlay.leftBand.value.y}px`,
  width: `${debugOverlay.leftBand.value.width}px`,
  height: `${debugOverlay.leftBand.value.height}px`,
}))
const outputSnapStyle = computed(() => ({
  left: `${debugOverlay.rightBand.value.x}px`,
  top: `${debugOverlay.rightBand.value.y}px`,
  width: `${debugOverlay.rightBand.value.width}px`,
  height: `${debugOverlay.rightBand.value.height}px`,
}))
// 端口 hover（MovingHandle @hover）。
// 关键：**不能**写进 isHovered —— isHovered 是"鼠标在卡片上"（卡片根 enter/leave 的单一权威），
// 而本回调是"鼠标在这个端口 zone 上"，两者语义不同。之前合并成一个 ref 时，鼠标从卡片移向端口
// 的缝隙里，zone 的 mouseleave 与卡片的 mouseenter 会互相覆写，谁后到听谁的 → 端口按钮随机显隐。
// 现在各自独立：卡片 hover 归 isHovered，端口 hover 归 portHovered，显示条件取"或"。
function onPortHover(value: boolean): void {
  portHovered.value = value
}
/** 命中端口吸附带时，用真实渲染高度 cardHeight 算端口锚点 flow 坐标（保证端点居中，不依赖存储 dimensions）。
 *  input(target 输入口)=左缘中点；output(source 输出口)=右缘中点。 */
function snapAnchorFor(side: 'input' | 'output'): { x: number; y: number } | undefined {
  const node = vf.getNodes.value.find((n) => n.id === props.id)
  const pos = (node?.computedPosition || node?.position) as { x: number; y: number } | undefined
  if (!pos) return undefined
  const y = pos.y + cardHeight.value / 2
  const x = side === 'input' ? pos.x : pos.x + cardWidth.value
  return { x, y }
}
// 综合前端瞄准信号写进共享 aimedTarget：仅拖线期间、且非源自身时生效
watch(
  [aimPortSide, aimBody, isConnecting, isCurrentConnectingNode],
  () => {
    const aimed = connectionState.aimedTarget.value
    // 拖线结束 / 我是源自身：若 aimedTarget 还是我则清空（不覆盖别的节点）
    if (!isConnecting.value || isCurrentConnectingNode.value) {
      if (aimed?.nodeId === props.id) connectionState.aimedTarget.value = null
      return
    }
    let next: AimedTarget | null = null
    // 容器型/无端口类型（inputs 与 outputs 全空，如分组）：拖线瞄准直接忽略 ——
    // 它没有输入口/输出口，body 命中只会产生"目标节点没有输入口"这类无意义提示（用户实测反馈）。
    const connectable = cap.hasTarget.value || cap.hasSource.value
    if (aimPortSide.value && connectable) {
      next = { nodeId: props.id, side: aimPortSide.value, anchor: snapAnchorFor(aimPortSide.value) }
    } else if (aimBody.value && connectable) {
      next = { nodeId: props.id, side: 'body' }
    }
    if (next) {
      connectionState.aimedTarget.value = next
    } else if (aimed?.nodeId === props.id) {
      // 我不再瞄准且 aimedTarget 仍是我 → 清空（离开节点回到空白）
      connectionState.aimedTarget.value = null
    }
  },
  { immediate: true },
)

// 端口"允许显示"门（传给 MovingHandle 作上层压制）：非低细节 && 非拖线全局压 && 非源自身 && 非真拖拽
// && (鼠标在卡片上 || 鼠标在端口 zone 上 || 选中)。
// 前 4 项是"暂时不该显示"的压制门；第 5 项是"该显示"的激励门，三个来源取或、各自独立：
//   isHovered  —— 卡片根 hover（鼠标在卡上，让端口有机会被点亮）
//   portHovered—— 端口 zone hover（鼠标已在端口上，必须在 180ms 淡出窗口内立刻续上，不允许被卡片事件打断）
//   selected   —— 节点选中，常显
// 三者分开写、不做互相覆写，避免缝隙处 enter/leave 顺序竞争导致随机显隐。
//
// 【为什么不用 interaction.isBusyDragging】：它把 paneDragging 也算进去，而 paneDragging 由
// CanvasHost.onMoveStart 写入、**滚轮缩放与 pan 共用同一套 VueFlow move 事件**（见 CanvasHost.vue:397 注释）。
// 于是"滚一下滚轮缩放"就会把 isBusyDragging 抬成 true；若 start/end 事件不配对（漏发 moveEnd、
// 或 host 重挂载丢了 end），它会**永久卡在 true**，把所有端口永久压死 —— 表现为"hover 上去端口死活不出现"。
// 端口的语义只是"拖节点/拖线时别干扰"，滚轮缩放不该压端口，故这里只认 nodeDragging，
// 不再吃 paneDragging/zooming。真拖拽期间仍由 disabled(拖线源) 与 suppressHandles(拖线) 负责压制。
//
// 注意：这只是"允许"，按钮最终显隐在 MovingHandle 内部——zone hover(keepVisible) 或 选中(selected) 才真正亮。
// 鼠标只停卡片 body（未进任何 zone）时 visible 虽 true，但 keepVisible/selected 均 false → 不亮（只亮靠近的端口）。
const shouldShowHandles = computed(
  () =>
    !lowDetail.value &&
    !suppressHandles.value &&
    !isCurrentConnectingNode.value &&
    !interaction.isNodeDragging.value &&
    // 多选时压掉自身端口：十几个节点的圆球会和多选框上的"批量连线端口"混在一起，
    // 分不清该拖哪个（用户要求：多选时节点的 MouseHandle 全不显示）。
    !isMultiSelected.value &&
    (isHovered.value || portHovered.value || props.selected),
)

// ============ 拖线"禁止端口落线"（隐藏与源同类型的端口，避免输入连输入/输出连输出）============
// 语义：拖线进行中，其它节点上与拖拽源**同类型**的端口被整体禁用/隐藏，只剩反向(可接)端口对用户可见。
//   - 从 source(输出/右)口拖出 → activeConnection.sourceHandle==='source' → 屏蔽其它节点的 source 口
//   - 从 target(输入/左)口反向拖出 → sourceHandle==='target' → 屏蔽其它节点的 target 口
// 源自身节点(isCurrentConnectingNode)的端口另由 disabled 单独压住，此处不重复。
const dragSameTypeBlocked = computed(
  () => isConnecting.value && !isCurrentConnectingNode.value,
)
const blockedTargetPort = computed(
  () => dragSameTypeBlocked.value && activeConnection.value?.sourceHandle === 'target',
)
const blockedSourcePort = computed(
  () => dragSameTypeBlocked.value && activeConnection.value?.sourceHandle === 'source',
)

// 注：这里曾有"blocked 状态变化 → updateNodeInternals 重测 handleBounds"的兜底，现已移除。
// 原因：MovingHandle 不再按 blockedXxxPort 切 v-if（DOM 始终保留 → handleBounds 稳定），
// 端口的方向性筛选改由 :disabled 表达，不存在 stale bounds 把线吸到错位置的问题。
// blockedXxxPort 仍被下方 MovingHandle 的 :disabled 消费，见模板 target/source 两处。
// ============ 调试可视化（端口调试 handleDebug / 吸附调试 connectionSnapDebugVisible）============
/** 端口调试：是否给端口画半圆/圆心/归位/鼠标点辅助线（进 MovingHandle :debug） */
const debugHandle = computed(() => Boolean(debug.handleDebug))
/** 是否画本节点"端口半圆接收区"叠加（handleDebug 打开且本节点非拖线源、非低细节时展示端口几何） */
const showHandleDebugOverlay = computed(
  () => debugHandle.value && !lowDetail.value && !suppressHandles.value,
)
/** 吸附调试：开关打开后**持续**显示卡片接收区 + 端口吸附带（无需拖线中也显示，
 *  便于设计/排错时直观知道哪些节点会接收到拖线、snap 带多大范围）。 */
const showSnapDebugOverlay = computed(
  () =>
    Boolean(debug.connectionSnapDebugVisible) &&
    showTargetHandle.value &&
    !lowDetail.value,
)
// 吸附带/接收区几何（与 resolveFeedback 同源）
// 端口区域宽 portZoneWidth 是端口交互区矩形的主尺寸；吸附带宽未显式给(缺省)时才用它兜底。
// 设 0 等于"清零"（不兜底，带塌成 0 宽）；默认值由 DEFAULT_THEME_HANDLE.portZoneWidth = 86 提供。
const portZoneWidth = computed(() => Number(handleParams.portZoneWidth) || 0)
const portZoneHeight = computed(() => cardHeight.value * Math.min(Math.max(Number(handleParams.portZoneHeightRatio) || 0.8, 0), 1))
const portZoneOffset = computed(() => Number(handleParams.portZoneOffset) || 0)
const portZoneShape = computed(() => handleParams.portZoneShape ?? 'arc')
const portZoneArcRatio = computed(() => Math.min(Math.max(Number(handleParams.portZoneArcRatio) ?? 1, 0.2), 1))
const debugOverlay = useNodeDebugOverlay({
  cardWidth,
  cardHeight,
  handleRadius: portZoneWidth,
  snapZone,
})
// SVG viewBox = 卡内坐标 [0..cardWidth] × [0..cardHeight]（吸附带可负 x 溢出，靠 overflow:visible）
const debugViewBox = computed(() => `0 0 ${cardWidth.value} ${cardHeight.value}`)
// 卡片接收区矩形（四舍五入避免小数边）
const bodyRect = computed(() => ({
  x: 0,
  y: 0,
  width: cardWidth.value,
  height: cardHeight.value,
}))

watch(showSnapDebugOverlay, (on) => {
  log.log(`[${props.id}/${props.type}] 吸附调试叠加 ${on ? '显示' : '隐藏'} handleDebug=${debugHandle.value} isConnecting=${isConnecting.value}`)
})
watch(debugHandle, (on) => {
  log.log(`[${props.id}/${props.type}] 端口调试 ${on ? '开' : '关'}`)
})

// 3D 倾斜：随鼠标在卡内位置翘
const cardTransform = computed(() => {
  if (isConnectionInvalidTarget.value) return ''
  if (!showConnectFeedback.value) return ''
  const p = feedbackMousePosition.value
  const rotateX = (p.y - 0.5) * CONNECT_FEEDBACK.rotateX
  const rotateY = (p.x - 0.5) * -CONNECT_FEEDBACK.rotateY
  return `perspective(${CONNECT_FEEDBACK.perspective}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(10px) scale(${CONNECT_FEEDBACK.scale})`
})

/** 物理鼠标在卡内 0~1（3D 倾斜 fallback 输入） */
const mousePosition = ref({ x: 0.5, y: 0.5 })
function updateCardMousePosition(event: MouseEvent) {
  if (!showConnectFeedback.value) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  mousePosition.value = {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  }
}

/** 合法悬停时用 hoverNode.flowPosition 换算卡内百分比（比物理鼠标更贴"拖线终点"） */
const feedbackMousePosition = computed(() => {
  const h = connectionHover.value
  if (h?.status === 'valid') {
    const node = vf.getNodes.value.find((n) => n.id === props.id)
    const pos = (node?.computedPosition || node?.position) as { x: number; y: number } | undefined
    if (pos && cardWidth.value > 0) {
      return {
        x: clamp((h.flowPosition.x - pos.x) / cardWidth.value, 0, 1),
        y: clamp((h.flowPosition.y - pos.y) / cardHeight.value, 0, 1),
      }
    }
  }
  return mousePosition.value
})

// ============ 非法气泡定位 ============
const invalidTooltipStyle = computed(() => {
  const h = connectionHover.value
  const pos = (() => {
    const node = vf.getNodes.value.find((n) => n.id === props.id)
    return (node?.computedPosition || node?.position) as { x: number; y: number } | undefined
  })()
  if (h?.status === 'invalid' && pos && cardWidth.value > 0) {
    const x = clamp((h.flowPosition.x - pos.x) / cardWidth.value, 0.06, 0.94)
    const y = clamp((h.flowPosition.y - pos.y) / cardHeight.value, 0.08, 0.92)
    return { left: `${x * 100}%`, top: `${y * 100}%` }
  }
  return { left: '8%', top: '50%' }
})

// ============ 选中环 ============
const showSelectionOutline = computed(() => props.selected && !props.data?._overlay)

// ============ 工具函数 ============
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
</script>

<template>
  <div class="v2-node" :class="{
    'is-selected': showSelectionOutline,
    'is-pointer-hovered': isHovered,
    'is-low-detail': lowDetail,
    'is-connection-valid': isConnectionValidTarget,
    'is-connection-invalid': isConnectionInvalidTarget,
  }" @mouseenter="onCardMouseEnter" @mouseleave="onCardMouseLeave">
    <!-- 上插槽：可叠多个 occupant，位置（贴边 + 居中 + 反缩放）由壳这一层算好，插件只管往里放内容。
         压制条件沿用既有语义：框选中整排收起、多选收起（见 hideToolbars）。 -->
    <div
      v-if="topSlots.length > 0 && !hideToolbars"
      class="v2-slot v2-slot--top nodrag nopan"
      :style="topSlotsStyle"
    >
      <component v-for="seg in topSlots" :key="'top-' + seg.id" :is="seg.component" :id="id" :data="data" />
    </div>

    <div class="v2-card" :class="{
      'is-connecting-hover': showConnectFeedback,
      'is-connection-invalid': isConnectionInvalidTarget,
    }" :style="cardInlineStyle" @mousemove="updateCardMousePosition">
      <!-- 多选标记：内容区左上角的圆形单选点（只在多选时出现；大小/颜色/缩放都来自本插件 Config）。
           纯指示，不接事件 —— 点击行为交给卡片本身（Shift+点节点 = 从选中集里去掉它）。 -->
      <div
        v-if="showMultiRadio"
        class="v2-multi-radio nodrag nopan"
        :style="radioStyle"
        role="presentation"
        aria-hidden="true"
      >
        <!-- 自绘 SVG（不用 CSS 画圆）：矢量、走当前颜色 currentColor（= 配置里的标记颜色）、任意缩放都清晰。
             选中态 = 外圈 + 中心实心点（"这个节点在选中集里"）。 -->
        <svg class="v2-multi-radio-icon" viewBox="0 0 20 20" aria-hidden="true">
          <circle class="v2-multi-radio-ring" cx="10" cy="10" r="8.25" />
          <circle class="v2-multi-radio-dot" cx="10" cy="10" r="4.25" />
        </svg>
      </div>
      <!-- 标题条：卡片内部、继承卡片 transform，反向缩放（BaseTitle / 就地改名） -->
      <div v-if="showTitle" class="v2-title nodrag nopan" :style="titlePositionStyle"
        @dblclick.stop="editable && startTitleEdit()" @pointerdown.stop>
        <component :is="customTitle" v-if="customTitle" :id="id" :data="data" />
        <BaseTitle v-else :interactive="true" :editing="isEditingTitle" :title-icon="titleIcon">
          <template #title-label>
            <!-- 编辑用 contenteditable（同一元素切换属性），不换 <input>：换元素会改行高把标题条撑变形 -->
            <TitleLabel :label="nodeLabel" :editing="isEditingTitle" @commit="commitTitleEdit"
              @cancel="cancelTitleEdit" />
          </template>
        </BaseTitle>
      </div>

      <!-- 非法连接气泡 -->
      <div v-if="isConnectionInvalidTarget" class="invalid-connection-tooltip" :style="invalidTooltipStyle">
        {{ connectionHover?.reason || '无法连接' }}
      </div>

      <!-- 输入口满额"将替换最老一条"提示（willEvict；UI 可选渲染，仅当目标输入口将挤掉旧连接时显示） -->
      <div v-if="isWillEvictTarget" class="will-evict-tooltip" :style="invalidTooltipStyle">
        <span class="we-dot" />将替换已有连接
      </div>

      <!-- 调试叠加：吸附带 + 卡片接收区（吸附调试 connectionSnapDebugVisible，拖线目标态才显示）。
           用 SVG 在卡内坐标画，overflow:visible 让负 x 的吸附带也能画出去（v1 用 clip-path div，效果差）。 -->
      <svg v-if="showSnapDebugOverlay" class="v2-debug-overlay" :viewBox="debugViewBox">
        <!-- 卡片接收区（body） -->
        <rect class="v2-debug-body" :x="bodyRect.x" :y="bodyRect.y" :width="bodyRect.width" :height="bodyRect.height"
          rx="8" />
        <!-- 左侧 target 输入口吸附带：shape=rect 用矩形、arc 用半椭圆弧（圆心在左缘锚点 (0, anchorY)，
             rx=带宽、ry=带高/2，经 overflow:visible 向左画出卡片） -->
        <rect v-if="debugOverlay.shape.value === 'rect'" class="v2-debug-band" :x="debugOverlay.leftBand.value.x"
          :y="debugOverlay.leftBand.value.y" :width="debugOverlay.leftBand.value.width"
          :height="debugOverlay.leftBand.value.height" />
        <ellipse v-else class="v2-debug-band" :cx="0" :cy="debugOverlay.anchorY.value"
          :rx="debugOverlay.leftBand.value.width" :ry="debugOverlay.leftBand.value.height / 2" />
        <!-- 右侧 source 输出口吸附带（镜像到右缘，圆心在 (cardWidth, anchorY)） -->
        <rect v-if="debugOverlay.shape.value === 'rect'" class="v2-debug-band is-source"
          :x="debugOverlay.rightBand.value.x" :y="debugOverlay.rightBand.value.y"
          :width="debugOverlay.rightBand.value.width" :height="debugOverlay.rightBand.value.height" />
        <ellipse v-else class="v2-debug-band is-source" :cx="cardWidth" :cy="debugOverlay.anchorY.value"
          :rx="debugOverlay.rightBand.value.width" :ry="debugOverlay.rightBand.value.height / 2" />
        <!-- 目标锚点短线标注 -->
        <!-- <line class="v2-debug-anchor" :x1="0" :y1="debugOverlay.anchorY.value - 6" :x2="0"
          :y2="debugOverlay.anchorY.value + 6" /> -->
      </svg>

      <!-- 吸附带（真正触发吸附判定的区域，与端口按钮跟随区 .port-follow-zone 分离）：
           左侧 target 输入口吸附带 / 右侧 source 输出口吸附带，几何与 SnapZoneConfig 吸附带同源。
           mouseenter/leave 上报 aim(input/output)，后端据此吸到端口锚点 + 判边；平时 pointer-events:none 不挡卡片。 -->
      <div v-if="showTargetHandle" class="snap-band snap-band--input" :class="{ 'is-active': snapZonesActive }"
        :style="inputSnapStyle" @mouseenter="onInputSnapEnter" @mouseleave="onSnapLeave" />
      <div v-if="showSourceHandle" class="snap-band snap-band--output" :class="{ 'is-active': snapZonesActive }"
        :style="outputSnapStyle" @mouseenter="onOutputSnapEnter" @mouseleave="onSnapLeave" />

      <!-- 左侧输入口(target)：有输入能力才渲染。
           拖线中"同类型(target)端口"只传 :disabled（DOM 一直保留 → VueFlow handleBounds 稳定），
           加上 Strict 模式 isValidHandle 类型校验，行为门是双保险。 -->
      <MovingHandle v-if="showTargetHandle" ref="targetHandleRef" id="target" type="target" :position="Position.Left"
        :visible="shouldShowHandles" :disabled="isCurrentConnectingNode || blockedTargetPort" :selected="props.selected"
        :rest-offset="handleParams.handleRestOffset" :cursor-gap="handleParams.handleCursorGap"
        :button-size="handleParams.handleButtonSize" :zone-width="portZoneWidth" :zone-height="portZoneHeight"
        :zone-offset="portZoneOffset" :zone-shape="portZoneShape" :zone-arc-ratio="portZoneArcRatio"
        :debug="debugHandle && !isConnecting" @hover="onPortHover" />

      <!-- 内容裁剪层：overflow hidden 确保不溢出卡片圆角 -->
      <div class="v2-content-clip">
        <component :is="content" v-if="content" :id="id" :data="data" />
        <div v-else class="v2-content-missing">（type "{{ type }}" 未注册 content 段）</div>
      </div>

      <!-- 右下角 resize 拖拽句柄（类型声明 resizable 或 data.resizable === true 时显示；useNodeCardSize 门）。
           反缩放：屏幕大小恒定，transform-origin 在右下角（钉在卡片角上不漂移）。
           只在 pointerdown 起手；move/up 由 useNodeCardSize 绑到全局 document —— 指针移出手柄也不会断。 -->
      <div v-if="cardResizable" class="resize-handle" :class="{ 'is-resizing': cardIsResizing }"
        :style="{ transform: `scale(${resizeHandleScale})` }" @pointerdown="card.onResizePointerDown">
        <svg viewBox="0 0 8 8" fill="none" class="resize-handle-icon">
          <path d="M7 1L1 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
          <path d="M7 5L5 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
        </svg>
      </div>

      <!-- 右侧输出口(source)：同 target。 -->
      <MovingHandle v-if="showSourceHandle" ref="sourceHandleRef" id="source" type="source" :position="Position.Right"
        :visible="shouldShowHandles" :disabled="isCurrentConnectingNode || blockedSourcePort" :selected="props.selected"
        :rest-offset="handleParams.handleRestOffset" :cursor-gap="handleParams.handleCursorGap"
        :button-size="handleParams.handleButtonSize" :zone-width="portZoneWidth" :zone-height="portZoneHeight"
        :zone-offset="portZoneOffset" :zone-shape="portZoneShape" :zone-arc-ratio="portZoneArcRatio"
        :debug="debugHandle && !isConnecting" @hover="onPortHover" />
    </div>

    <!-- 下插槽：同上方，定位由壳统一给出 -->
    <div
      v-if="bottomSlots.length > 0 && !hideToolbars"
      class="v2-slot v2-slot--bottom nodrag nopan"
      :style="bottomSlotsStyle"
    >
      <component v-for="seg in bottomSlots" :key="'bottom-' + seg.id" :is="seg.component" :id="id" :data="data" />
    </div>

    <!-- 编辑浮层（裁剪框/扩展框）：与卡片**同级**、画在卡片外面，所以不会被内容层的 overflow:hidden 裁掉。
         尺寸与卡片严格一致（不反缩放）—— 浮层必须和底下的画面像素对齐，缩放会错位。
         z-index 高于卡片但低于上/下控制栏：编辑框盖住画面，但"确认/取消"按钮仍在最上层可点。 -->
    <div
      v-if="overlaySlots.length > 0 && !hideToolbars"
      class="v2-overlay nodrag nopan"
      :style="overlayLayerStyle"
    >
      <component v-for="seg in overlaySlots" :key="'overlay-' + seg.id" :is="seg.component" :id="id" :data="data" />
    </div>
  </div>
</template>

<style scoped>
/* —— 节点根 —— */
.v2-node {
  position: relative;
  display: flex;
  flex-direction: column;
  font-family: system-ui, sans-serif;
}

/* —— 上/下插槽定位层（位置由壳给，插件只放内容）——
   浮在卡片外侧：绝对定位、不占布局高度（节点不会被撑高）。
   贴边距离 / 水平居中 / 反缩放全在 :style 里（resolveNodeSlotStyle）；这里只给"排一行"的默认排版：
   插槽里可能只放一个插件组件，也可能叠了好几个 occupant 并排。 */
.v2-slot {
  position: absolute;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

/* —— 卡片 —— */
.v2-card {
  position: relative;
  box-sizing: border-box;
  transform-origin: center;
  border-style: solid;
  border-color: var(--canvas-node-border, rgb(209 213 219 / 0.95));
  background: var(--card-surface, var(--canvas-node-surface, #f9fafb));
  box-shadow: var(--card-shadow, 0 1px 3px var(--canvas-node-shadow-subtle, rgb(0 0 0 / 0.06)));
  overflow: visible;
  /* SVG 吸附调试带可负 x 溢出左缘，必须 visible */
  transition:
    border-color 240ms cubic-bezier(0.2, 0.8, 0.2, 1),
    box-shadow 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.v2-node.is-low-detail .v2-card {
  transition: none;
  box-shadow: none;
}

/* 选中态：边框色 + 外侧 2px 环 */
.v2-node.is-selected .v2-card {
  border-color: var(--canvas-node-border-selected, rgb(17 24 39 / 0.85));
}

.v2-node.is-selected .v2-card::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: 0 0 0 var(--card-outline-width, 0px) var(--canvas-node-ring-soft, rgb(17 24 39 / 0.38));
  pointer-events: none;
}

/* 连接中可连：边框高亮 + 光晕 */
.v2-card.is-connecting-hover {
  border-color: var(--canvas-node-border-selected, rgb(17 24 39 / 0.85));
}

/* 非法连接：灰框 + 内容模糊遮罩 */
.v2-card.is-connection-invalid {
  border-color: rgba(156, 163, 175, 0.45);
}

.v2-card.is-connection-invalid::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 25;
  border-radius: inherit;
  background: rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(1.5px);
  pointer-events: none;
}

/* 非法气泡 */
.invalid-connection-tooltip {
  position: absolute;
  z-index: 60;
  transform: translate(-50%, -50%);
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(31, 41, 55, 0.94);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
}

/* 满额"将替换"提示（蓝色系，与红气泡区分） */
.will-evict-tooltip {
  position: absolute;
  z-index: 60;
  transform: translate(-50%, -50%);
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.95);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  pointer-events: none;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
}

.will-evict-tooltip .we-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #fff;
}

/* —— 调试叠加（SVG）—— */
.v2-debug-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  /* 吸附带向左可出卡片 */
  pointer-events: none;
  z-index: 22;
}

.v2-debug-body {
  fill: var(--canvas-node-target-zone-surface, rgba(17, 24, 39, 0.08));
  stroke: var(--canvas-node-target-zone-border, rgba(17, 24, 39, 0.55));
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}

.v2-debug-band {
  fill: var(--canvas-node-snap-zone-surface, rgba(17, 24, 39, 0.12));
  stroke: var(--canvas-node-snap-zone-border, rgba(17, 24, 39, 0.9));
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}

.v2-debug-band.is-source {
  fill: var(--canvas-node-snap-zone-source-surface, rgba(37, 99, 235, 0.12));
  stroke: var(--canvas-node-snap-zone-source-border, rgba(37, 99, 235, 0.9));
}

.v2-debug-anchor {
  stroke: var(--canvas-node-snap-zone-highlight, #dc2626);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

/* —— 吸附带 .snap-band（真正触发吸附判定的区域）——
   绝对定位在卡内，几何与 SnapZoneConfig 吸附带同源（useNodeDebugOverlay）。
   平时 pointer-events:none 完全不挡卡片 hover/点击；拖线期间(非源自身)才 pointer-events:auto 接收 mouseenter。 */
.snap-band {
  position: absolute;
  z-index: 21;
  pointer-events: none;
}

.snap-band.is-active {
  pointer-events: auto;
}

/* —— 多选标记：内容区左上角的圆形单选点（自绘 SVG）—— */
.v2-multi-radio {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 26;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 尺寸 / 反缩放 / 颜色由 multiRadioStyle() 内联给（配置驱动），这里只管定位与不接事件 */
  pointer-events: none;
}

.v2-multi-radio-icon {
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
  /* 圆环与圆点都吃父元素给的色（= 配置里那一项，默认值是主题的"选中色"变量，浅色/深色主题下都跟随） */
  color: inherit;
  /* 白底圆：让标记在任何节点内容上都看得清（SVG 里画白底而不是靠 CSS 底色） */
  filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.28));
}

/* 外圈：白底 + 主题色描边（用描边而不是实心，视觉更轻、不压内容） */
.v2-multi-radio-ring {
  fill: #ffffff;
  stroke: currentColor;
  stroke-width: 2;
}

/* 中心实心点：选中态 */
.v2-multi-radio-dot {
  fill: currentColor;
}

/* —— 标题条：卡片上缘外、反向缩放 —— */
.v2-title {
  position: absolute;
  z-index: 3;
  display: flex;
  align-items: center;
  cursor: text;
}

/* 选中态标题加深（文案元素在 TitleLabel 子组件内，需 :deep 穿透 scoped） */
.v2-node.is-selected :deep(.title-label) {
  color: var(--canvas-node-text-strong, #111827);
}

/* —— 编辑浮层（裁剪/扩展框）——
   与卡片同级、画在卡片外面：不受内容层 overflow:hidden 裁剪（用户报的"裁剪区域被节点切掉"）。
   绝对定位到卡片左上角，尺寸由内联样式给（= 卡片尺寸），所以浮层与底下的画面严格对齐。
   z-index 取 25：高过卡片内容与端口，低过 30 的上/下控制栏 ——
   编辑框盖住画面，但"确认/取消"按钮永远在最上层可点。 */
.v2-overlay {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 25;
  overflow: visible;
  pointer-events: none;
}

/* —— content 裁剪层 —— */
.v2-content-clip {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--card-content-surface, #eee);
}

.v2-content-missing {
  color: #b45309;
  padding: 8px;
  font-size: 12px;
}

/* —— resize 拖拽句柄 —— */
.resize-handle {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 24px;
  height: 24px;
  cursor: nwse-resize;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.4;
  transition: opacity 140ms ease;
  touch-action: none;
  /* 反缩放时钉在卡片右下角（跟标题 left bottom 原点同一套语义） */
  transform-origin: 100% 100%;
}

.resize-handle:not(.is-resizing):hover,
.v2-node.is-pointer-hovered .resize-handle,
.v2-node.is-selected .resize-handle {
  opacity: 0.85;
}

.resize-handle-icon {
  width: 12px;
  height: 12px;
  color: var(--canvas-node-resize-handle, #9ca3af);
  pointer-events: none;
}

/**.resize-handle:hover .resize-handle-icon,
.v2-node.is-pointer-hovered .resize-handle .resize-handle-icon,
.v2-node.is-selected .resize-handle .resize-handle-icon {
  color: var(--canvas-node-resize-handle-active, #111827);
} */

.resize-handle:hover .resize-handle-icon {
  color: var(--canvas-node-resize-handle-active, #111827);
}

/* LOD：隐标题条、隐拖柄 */
.v2-node.is-low-detail .v2-title,
.v2-node.is-low-detail .resize-handle {
  display: none;
}
</style>
