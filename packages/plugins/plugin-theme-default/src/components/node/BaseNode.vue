<script setup lang="ts">
// BaseNode —— 节点"壳"（v2 视觉完善版，消费 canvas-render 的连接反馈能力 + 类型能力 + 主题变量）。
// 职责：
//   1. 消费 NodeRenderer：按 node.type 路由 content/title/top/bottom 段组件渲染（保留 M2 契约）。
//   2. 卡片外观对齐 v1 Decoration：固定可 resize 尺寸 + 内容裁剪层 + 圆角；标题条(BaseTitle)就地重命名。
//   3. 端口按节点类型能力显隐(useNodeCapability)；浮动端口外观全来自 handleParams。
//   4. 拖线反馈(消费 useCanvasRender().connectionState)：3D 倾斜 / 非法气泡 / valid/invalid / 拖线时压源口。
//   5. LOD：zoom 低时简化渲染。
// 依赖最新 API：useCanvasRender() 统一上下文（registry/nodeWrite/handleParams/connectionState + flow facade）。
import { computed, inject, nextTick, onBeforeUnmount, ref, watch, type Component } from 'vue'
import {
  Position,
  useCanvasRender,
  createV2Logger,
  useToolbarOffsets,
  resolveNodeSlotStyle,
  isConnectionSource,
  beginNodeResize,
  endNodeResize,
  NODE_TOOLBAR_HOST_KEY,
} from '@mini-canvas/canvas-render'
import type { NodeProps, AimedTarget } from '@mini-canvas/canvas-render'
import {
  createCapabilityCache,
  createCapabilityNodeContext,
  capabilityField,
  RegionEntryHost,
} from '@mini-canvas/canvas-render'
import { nodeRegionStackEntries } from '@mini-canvas/canvas-data'
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
import { CULLED_RENDERING_DEFAULT, culledPolicy, normalizeCulledRendering } from './culledRenderingPolicy'

const log = createV2Logger('base-node')
const props = defineProps<NodeProps>()
// 节点类型都是本组件(VueFlow nodeTypes 全指到 BaseNode)，透传的 selected 等内部 prop 不落到根
defineOptions({ inheritAttrs: false })

// 统一渲染上下文（CanvasHost provide）——单入口取 registry/写回回调/端口外观/连接反馈/内核上下文
// visibleRect = 当前可视区（flow 坐标）：进编辑时判断要不要挪视图；未挂载为 null，判定自动跳过
const { ctx, registry, nodeWrite, handleParams, connectionState, interaction, debug, snapZone, visibleRect, flow } = useCanvasRender()
// 视口 / 视觉尺寸写回统一走 flow facade（旧渲染上下文字段已下线）
const viewport = flow.viewport

const type = computed(() => props.type)

// 3D 连接反馈常量（对齐 v1 CONNECT_FEEDBACK）
const CONNECT_FEEDBACK = {
  rotateX: 18,
  rotateY: 18,
  perspective: 800,
  scale: 1.018,
}

// —— 缩放 / LOD / 标题反缩放（v2 固定卡尺寸，标题宽=cardWidth×max(zoom,minZoom)）——
const zoom = computed(() => Math.max(viewport.value?.zoom || 1, 0.01))
// 节点外观：全部来自本插件 Config（节点/标题、节点/低细节、节点/多选标记），对齐 v1 core 的
// nodeTitleOffset / nodeTitleScaleMinZoom / nodeLodLowDetailZoom。settings 单一数据源非 Vue 响应式，
// 故这里用 ref + onChange 订阅把配置改动实时驱动到渲染（改设置面板即生效，不整图重建）。
// T05：settings 已是集中登记类型的服务（T03）；返回类型由服务名决定
const settingsStore = () => ctx?.get('settings')
const numOf = (key: string, fallback: number): number => {
  const v = settingsStore()?.get(key)
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
const boolOf = (key: string, fallback: boolean): boolean => {
  const v = settingsStore()?.get(key)
  return typeof v === 'boolean' ? v : fallback
}
const TITLE_OFFSET = ref(numOf('titleOffset', 12))
const TITLE_MIN_ZOOM = ref(numOf('titleScaleMinZoom', 0.5))
/** 是否显示标题条（本插件 Config 的 titleVisible；关掉 = 整块标题不画） */
const TITLE_VISIBLE = ref(boolOf('titleVisible', true))
const LOW_DETAIL_ZOOM = ref(numOf('nodeLodLowDetailZoom', 0.4))
/**
 * 画布是否处于「移动」工具（= 节点可拖拽）。抓手工具会把它按成 false。
 *
 * 端口的语义是「拖节点用的手柄」：抓手模式下拖动是平移画布、节点根本不会被拖走，
 * 端口留着只会误导（用户要求：抓手模式不显示端口球）。故这里读宿主级设置 `nodesDraggable`
 * （分组「常规/画布」，缺省 true）喂进端口显示门；设置面板改它、底栏「移动/抓手」按钮改它，
 * 都与端口显隐同源，不存在第二份开关。
 */
const CANVAS_NODES_DRAGGABLE = ref(boolOf('nodesDraggable', true))
/**
 * 是否处于「抓手工具」（= 关掉了节点拖拽）。
 *
 * 抓手模式下拖动是**平移画布**、节点根本不会被拖走，所以挂在节点上的那些「操作这个节点」的
 * 浮层都是误导（用户要求：「抓手工具」下不显示上下两排状态栏）。判据与端口压制同源：
 * 宿主级设置 `nodesDraggable`（底栏「移动 / 抓手」按钮与设置面板「节点可拖拽」改的都是它），
 * 不存在第二份开关。
 */
const isHandTool = computed(() => !CANVAS_NODES_DRAGGABLE.value)
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
  // 画布工具（移动 / 抓手）：抓手 = nodesDraggable=false → 压掉端口显示
  if (key === 'nodesDraggable') {
    CANVAS_NODES_DRAGGABLE.value = value !== false
    return
  }
  // 标题总开关：布尔项，必须走在下面那道"只要数字"的门之前
  if (key === 'titleVisible') {
    TITLE_VISIBLE.value = value !== false
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

// ============ 视口外节点状态与绘制深度（2026-10-26，docs/plan/2026-10-26-node-visibility-states.md）============
/**
 * 宿主下发的节点可见状态（data._cullState）：visible=画布内(+缓冲带)；culled=画布外且无连线；
 * culled-linked=画布外但有连线（至少一端在画布内，连线必须保持完整显示）；
 * transient 节点宿主不下发（永不剔除，走全量绘制）。
 * 为什么壳常驻：VueFlow EdgeWrapper 对 hidden 端点的边整体不画 —— 剔除绝不能再用 hidden，
 * 否则画布内节点的连线凭空断掉（用户实测）。壳在这里按状态决定"画多深"。
 */
const CULLED_STATE_KEY = '_cullState'
const rawCullState = computed(() => (props.data as Record<string, unknown> | undefined)?.[CULLED_STATE_KEY])
const isCulled = computed(() => rawCullState.value === 'culled' || rawCullState.value === 'culled-linked')
const isCulledLinked = computed(() => rawCullState.value === 'culled-linked')

/**
 * 视口外节点绘制深度（本插件 Config：culledNodeRendering）。
 * skeleton = 骨架：卡片隐身占位，标题条与端口锚点保留（连线端点锚在真实几何上）；
 *           内容段/控制栏/多选标记/区域条/编辑浮层全部不挂载 —— 性能回收在"内容不渲染"。
 * full     = 全量绘制（等价关闭降级；回到 2026-10-15 之前的完整渲染）。
 * ghost    = 占位框：内容不挂载，卡片画一个可见的空心细边框（远端连线走向一目了然）。
 * culled 与 culled-linked 共用同一画法（默认主题不区分这两档；状态本身仍下发，
 * 自定义壳可按 culled-linked 给更明显的提示 —— 比如沿连线方向的渐隐占位）。
 */
const CULLED_RENDERING_KEY = 'culledNodeRendering'
type CulledRendering = 'skeleton' | 'full' | 'ghost'
const culledRendering = ref<CulledRendering>(CULLED_RENDERING_DEFAULT)
const applyCulledRendering = (key: string, value: unknown): void => {
  if (key !== CULLED_RENDERING_KEY) return
  culledRendering.value = normalizeCulledRendering(value)
}
const culledSettingsOff = ctx?.get<{ onChange(cb: (key: string, value: unknown) => void): { dispose(): void } }>('settings')?.onChange(
  (key, value) => applyCulledRendering(key, value),
)
// 初值从 settings 读（settings 单一数据源；onChange 只管后续变化）
{
  const v = settingsStore()?.get(CULLED_RENDERING_KEY)
  culledRendering.value = normalizeCulledRendering(v)
}
onBeforeUnmount(() => culledSettingsOff?.dispose())

/**
 * 骨架/占位框生效门：culled 两档都降级（full 档不降级）。
 * 降级 = 内容不挂载 + 卡片本体隐身(skeleton)或空心框(ghost)。
 */
const culledReduced = computed(() => culledPolicy(rawCullState.value, culledRendering.value).reduced)
const culledGhost = computed(() => culledPolicy(rawCullState.value, culledRendering.value).ghost)
const titleScale = computed(() => 1 / Math.max(zoom.value, TITLE_MIN_ZOOM.value))

// ============ 多选相关显隐（配置由 multi-select 插件声明）============
/** 多选（选中 >=2）时是否隐藏标题条：列表更干净，也不再和大框的"上方间距"打架 */
const hideTitleOnMulti = computed(
  () => HIDE_TITLES_ON_MULTI.value && isSelected.value && selectedCount.value > 1,
)
/**
 * 标题条可见性：总开关关掉 = 一律不画；低细节不画；开了"多选隐藏标题"且处于多选时也不画。
 * 总开关（本插件 Config 的 titleVisible）排在最前 —— 它是用户的显式选择，不该被其它条件翻转回来。
 */
const showTitle = computed(
  () => TITLE_VISIBLE.value && !lowDetail.value && !hideTitleOnMulti.value,
)

/**
 * 是否隐藏上下控制栏（NodeToolbar）。两部分：
 * - 框选手势进行中：那一排操作条/状态栏会被一起框进来、也挡视线 → 无条件收起。
 * - 多选（>=2）时：多选下这些栏没有意义（面板都是"恰好选中一个"的语义）→ 收起。
 * - 本节点正在被 resize（拖右下角拖柄改尺寸）：那排栏正挡在指针经过处、也会被新尺寸甩走
 *   → 收起，松手立刻恢复（用户要求："节点 resize 的时候……不显示上下的控制栏"）。
 *   判定读渲染层共享 activity 的 nodeResizeId（不是壳自己的局部 isResizing）：分组节点的
 *   控制栏挂在节点之外的 overlay 槽，两条路径要读同一份信号才一致。
 * 单选时的显隐仍由各段组件自己的 useSoleNodeSelected 决定，这里只做"不该出现"的压制。
 */
const hideToolbars = computed(
  () =>
    interaction?.isSelecting?.value === true ||
    (isSelected.value && selectedCount.value > 1) ||
    interaction?.nodeResizeId?.value === props.id,
)

/**
 * 卡片覆盖层（over:inset）是否收起。
 *
 * 多选、框选都不收起它：任务失败提示、加载进度、裁剪框都挂在这里，
 * 收起会让用户看不到正在发生的事。调整节点大小时仍按原行为收起。
 */
const hideOverlays = computed(
  () => interaction?.nodeResizeId?.value === props.id,
)

/**
 * 上/下控制栏（out:top / out:bottom）是否收起 = hideToolbars 之上再加一条"画布上有节点正在被拖"。
 *
 * 为什么是**画布级**、不比节点 id（用户要求："不管拖拽的是哪一个节点，都不应该显示这边的上下控制"；
 * "画布可以有一个全局状态表示正在被拖拽"）：拖动时整排栏跟着卡片跑、被拖出来的新位置甩开，
 * 多选拖动时每张卡还会并排刷出一片 —— 所以拖任意一个节点，全画布的栏一起收，松手立刻恢复。
 * 直接读共享 activity 的 isNodeDragging（"有没有节点在拖"）就够，不需要判"被拖的是不是本节点"。
 *
 * 为什么不并进 hideToolbars：hideToolbars 还管多选、框选与 resize；覆盖层的可见条件单独放在
 * hideOverlays（多选与框选时保留、resize 时收起）。拖动节点时收掉任务进度显示是倒退，所以这里也不收它。
 * 所以拖动这条只收"浮在卡片外面的那两排栏"。
 *
 * 抓手工具（isHandTool）也并进这条（用户要求：抓手模式下不显示上下两排状态栏）：
 * 抓手模式下节点不可拖、端口也已整体压掉（见 handleBlocked），留在卡片外的操作栏只是噪音。
 * 与拖动那条同理，它只收 out:top / out:bottom 两排栏，不动卡片上的编辑浮层与任务进度。
 */
const hideSlotBars = computed(
  () => hideToolbars.value || interaction?.isNodeDragging?.value === true || isHandTool.value,
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
 * 圆圈的大小 + 反缩放（与标题同一套语义）：保持"屏幕上的大小恒定"，
 * 否则缩到 0.2x 时它会小成一个点、完全起不到指示作用。
 * 颜色**不在这里算** —— 它走主题强调色（--ui-accent，见样式里的 color），
 * 于是自动跟随「常规/主题配色」的强调色与亮/暗主题。
 */
const radioStyle = computed(() =>
  multiRadioStyle({
    size: MULTI_RADIO.value.size,
    zoom: zoom.value,
    minZoom: TITLE_MIN_ZOOM.value,
  }),
)

/**
 * resize 拖柄的反缩放（与标题/多选圆点同一套语义）：保持"屏幕上的大小恒定"，
 * 否则缩到 0.2x 时拖柄会小成一个点，很难点到。
 */
const resizeHandleScale = computed(() => 1 / Math.max(zoom.value, TITLE_MIN_ZOOM.value))

// —— 节点标题（data.label ?? 类型中文名 ?? type）——
// 名字的唯一来源是节点自身的 data.label（建节点时由数据层按类型模板生成，见 nodeStore.nextDefaultName）。
// 兜底顺序：类型表里的中文 label（图片/文本…），再退到 type、最后 '节点' ——
// 以前直接回落 props.type，没有 label 的老节点会显示英文 type。
const nodeLabel = computed(() => {
  const label = props.data?.label as string | undefined
  return label || cap.label.value || props.type || '节点'
})

// ============ 卡片固定尺寸 + resize（useNodeCardSize）============
/**
 * 抓点到卡片右下角的屏幕偏移（px）。
 *
 * 用户按下的位置是拖柄（中心不在卡片角上），而 resize 的语义是"卡片右下角跟住指针"，
 * 所以要在这段偏移上补回来 —— 不补的话，按下那一刻卡片会先跳一小段（缩放越大跳得越明显）。
 *
 * 量测用 DOM（卡片的渲染矩形右下角 − 指针点）。拿不到 DOM（SSR/测试）就回 undefined（不补偿）。
 */
function resizeGrabOffset(e: PointerEvent): { x: number; y: number } | undefined {
  const cardEl = (e.currentTarget as HTMLElement | null)?.closest('.v2-card') as HTMLElement | null
  if (!cardEl || typeof cardEl.getBoundingClientRect !== 'function') return undefined
  const r = cardEl.getBoundingClientRect()
  return { x: r.right - e.clientX, y: r.bottom - e.clientY }
}

const card = useNodeCardSize({
  nodeId: props.id,
  data: () => props.data ?? {},
  type: props.type,
  writeback: nodeWrite ?? undefined,
  // 每帧用**当前视口**换算：拖拽途中缩放变了也不会与鼠标脱手（只除以 zoom 会脱手）
  toFlow: (x, y) => flow.screenToFlow(x, y),
  grabOffset: resizeGrabOffset,
  // 拖拽实时把新尺寸同步进 VueFlow 内部并重算：否则端口位置/相连边端点会停在旧尺寸
  // （渲染层 updateNodeVisualSize = updateNode(style) + updateNodeInternals）
  onVisualSize: (w, h) => flow.updateNodeVisualSize(props.id, w, h),
  // 把"我正在被 resize"写进渲染层共享活动位：壳自己能用局部 isResizing 压上下插槽，
  // 但**挂在节点之外的**分组控制栏读不到局部状态，只能读这份共享信号（见 hideToolbars）。
  onResizeStart: () => beginNodeResize(interaction, props.id),
  onResizeEnd: () => endNodeResize(interaction, props.id),
})
const cardWidth = card.cardWidth
const cardHeight = card.cardHeight
// 顶层解构：模板里 ref 自动解包，才能让 v-if 拿到布尔值(而非恒真的 ref 对象)。
const cardResizable = card.resizable
const cardIsResizing = card.isResizing

/**
 * 拖拽 resize 期间缩放变了（滚轮/工具栏/触控板）→ 立刻按新视口重算尺寸。
 *
 * 为什么必须单独盯：滚轮缩放时指针通常**不动**，也就没有 pointermove —— 只靠 move 重算的话，
 * 卡片会停在旧尺寸上、与指针短暂脱手（用户报的"同时缩放就形成一点距离"）。
 * 只依赖 zoom：平移变化不影响这块几何（toFlow 的平移项在差值里相消）。
 */
watch(zoom, () => {
  if (cardIsResizing.value) card.refreshSize()
})

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
 * 编辑前确保节点可见：不在视野内才让视口挪过去（保留当前缩放，不打断用户视野）。
 * 拿不到 view/visibleRect（未挂载/无 DOM 的测试环境）时静默跳过，不影响编辑本身。
 */
function focusNodeIfNeeded(): void {
  const viewService = ctx?.tryGet('view')
  const rect = viewService?.getNodeRect(props.id)
  const view = visibleRect?.value
  if (!rect || !view || !viewService) return
  // 标题条在卡片上方：把判定范围向上扩 PAD，避免"节点刚好看得见、标题却被裁掉"
  const withTitle = { x: rect.x, y: rect.y - TITLE_FOCUS_PAD, w: rect.w, h: rect.h + TITLE_FOCUS_PAD }
  if (isRectFullyVisible(withTitle, view)) return
  // 取景统一走 view.fitTo：保留缩放 + 已可见不动；margin 让标题也在安全区内。
  // 标题额外 32px 的判定仍由上面的 withTitle 先做（fitTo 的矩形不含标题）。
  viewService.fitTo([props.id], { keepZoom: true, onlyIfOutOfView: true, margin: TITLE_FOCUS_PAD })
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
const selTick = ref(0)
const selectionPeek = ctx?.tryGet('selection')
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

// ============ 段组件路由 → 区域遍历（步骤 3：十个区域词见 canvas-data canvas/region.ts）============
// 老五段（content/title/top-toolbar/bottom-toolbar/overlay）改经区域映射层读：NodeRegistry 兼容层
// （基座 + 段级贡献）与 node/region 注册场（ctx.nodes.attach 落点，含 type='*' 通配）合成同一摞，
// 渲染结果与老路径等价（条目按 order 升序、同 id 去重、基座 id 固定 'base'）。
// 列表 key 用注册 id，插件热装卸时不会错位复用组件实例（契约 §1.4-20）。
const regionField = (() => {
  try {
    return ctx?.registryOf?.('node/region')
  } catch {
    return undefined
  }
})()
/**
 * 区域场变更计数器：场是**非响应式**的普通对象（内核不认识 Vue），所以在这里订一次，
 * 每次进出条目就 bump 一下，让下面所有 `regionEntries` 派生的 computed 重算。
 *
 * 为什么要它：此前节点**挂载那一刻**读出条目就定了，之后运行期直接往场里 `add`/`wrap`
 * （不经过插件装卸，比如主题插件换壳、或宿主脚本调试）**不会重渲染** ——
 * 表现为"注册成功了却什么都没出现"，正是最难查的一类静默失效（STATUS 曾把它列在遗留里）。
 * 插件装卸那条路本来就有生命周期事件驱动重挂，这条补的是"不装卸、直接改场"。
 */
const regionTick = ref(0)
const regionOff = regionField?.subscribe(() => void (regionTick.value += 1))
onBeforeUnmount(() => regionOff?.dispose())
const regionEntries = (region: string) =>
  (void regionTick.value, nodeRegionStackEntries(registry, regionField as never, props.type, region))
/** in 区域（老 content 段）：卡片内容，可叠多层 */
const contentStack = computed(() => regionEntries('in'))
/** title 区域（老 title 段）：单格换肤点，取最外一条（基座优先）替换默认标题条 */
const titleStack = computed(() => regionEntries('title'))
const customTitle = computed(() => titleStack.value[0]?.component)
/** 自定义标题条那条**完整条目**（能力包要读它的 needs/props，所以不能只留组件） */
const customTitleEntry = computed(() => (customTitle.value ? titleStack.value[0] : undefined))
/** out:top / out:bottom（老 top/bottom-toolbar 段）：可叠加插槽 */
const topSlots = computed(() => regionEntries('out:top'))
const bottomSlots = computed(() => regionEntries('out:bottom'))
/** over:inset（老 overlay 段）：编辑类浮层（裁剪框 / 扩展框）。
 *
 * **与 content 分开、且画在卡片外面**（用户要求"放在和上下操控栏同级位置"）：
 * content 住在 .v2-content-clip（overflow:hidden），浮层挂那里会被卡片边界裁掉 ——
 * 用户实测报的"裁剪区域被节点切掉"就是这个原因。overlay 与上/下控制栏同级，
 * 覆盖整张卡片且 overflow 可见，于是框能贴到卡片边缘（扩展框还要能画到卡片之外）。
 *
 * 它自带定位（跟随卡片尺寸），所以不走 resolveNodeSlotStyle 那套"贴边+居中+反缩放"——
 * 浮层的坐标必须与卡片内容严格对齐，一旦反缩放就会与底下的画面错位。
 */
const overlaySlots = computed(() => regionEntries('over:inset'))
// —— 新增五个区域渲染位（此前没有；容器只管"有没有"，默认给基础定位，组件可自带样式覆盖）——
/** out:left / out:right：卡片左右外侧（侧挂按钮、折叠把手） */
const leftRegions = computed(() => regionEntries('out:left'))
const rightRegions = computed(() => regionEntries('out:right'))
/** on:top / on:bottom：贴在卡片边框线上（进度条） */
const onTopRegions = computed(() => regionEntries('on:top'))
const onBottomRegions = computed(() => regionEntries('on:bottom'))
/** over:outset：盖住整张卡且允许超出卡片边界（拖拽手柄、悬停放大）——与 over:inset 同级但不受卡片裁剪 */
const outsetRegions = computed(() => regionEntries('over:outset'))
const editable = computed(() => Boolean(nodeWrite))

// ============ 能力包上下文（决策 9 / §4.5 案例 5）============
// 十个区域渲染位里的每条条目都经 RegionEntryHost 渲染，那层按条目的 needs 取袋并 provide。
// 实例**每节点一份**（决策 9 第②条）：同一节点上"按钮"与"它打开的面板"是两条条目，必须拿到同一个
// tools/node 实例才谈得上共享状态 —— 所以缓存建在**节点这一层**（BaseNode 的 setup 里），
// 随节点卸载 dispose。
// 这里另造一份**本节点上下文**（活引用：能力实例读到的永远是最新值，不是创建时的快照）。
const nodeDataRef = computed(() => (props.data ?? {}) as Record<string, unknown>)
/** 是否被**单独**选中（恰好选一个且就是我）——与操作栏显隐的既有语义同源 */
const isSoloSelected = computed(() => isSelected.value && selectedCount.value === 1)
const capabilityNode = createCapabilityNodeContext({
  ctx,
  id: props.id,
  type: props.type,
  data: nodeDataRef,
  selected: isSelected,
  solo: isSoloSelected,
  zoom,
  // 写回走宿主 nodeWrite（唯一图写入口：自动进历史 + 调度落盘）；缺 nodeWrite（只读宿主）时静默
  update: (patch) => nodeWrite?.(props.id, patch),
})
/** 本节点的能力实例缓存（每节点一份；节点卸载统一回收） */
const capabilityIsDev = ctx?.isDev === true
const capabilityCache = createCapabilityCache(
  capabilityField(ctx),
  capabilityNode,
  capabilityIsDev,
)
onBeforeUnmount(() => capabilityCache.dispose())

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

// ============ 控制栏脱层：DOM 传送到画布级宿主（2026-09-29）============
/**
 * 上/下控制栏为什么不在节点里画：
 *
 * `.vue-flow__node` 带 `transform`（VueFlow 用它定位），**必然**创建层叠上下文 —— 节点内部的
 * 任何 z-index 都出不去，越不过作为其**兄弟**的边层。用户开「连线显示在最上层」后，置顶连线
 * 就把控制栏整个盖住（实测：边横穿下控制栏，216/3888 个采样点命中边）。
 *
 * 解法：渲染宿主（CanvasSurface）在画布级提供一层 `.csurface-node-toolbars`
 * （层值 LAYERS.nodeToolbar，压在置顶连线之上），本组件把这三段**DOM 传送**过去。
 * 注意只搬 DOM、不搬逻辑：区域条目、能力实例缓存、定位样式**全部仍在本组件**，
 * 所以同一节点上「按钮」与「它打开的面板」照旧共享同一个能力实例（决策 9 第②条）。
 *
 * 缺省（没装该宿主：SSR 单测 / 极简宿主）→ 取不到令牌 → 原地渲染，行为与改动前逐字一致。
 */
const toolbarHostEl = inject(NODE_TOOLBAR_HOST_KEY, undefined)
/** 传送目标：宿主元素；null/未装 → 原样留在节点内 */
const toolbarHost = computed<HTMLElement | null>(() => toolbarHostEl?.value ?? null)
/**
 * 传送后的定位锚：与卡片**同位置同尺寸**（flow 绝对坐标）。
 *
 * 为什么要有它：`.v2-slot` 的 `bottom: calc(100% + offset)` 是相对**定位父元素**算的
 * （节点里就是卡片盒）。传送到画布层后父元素变成了零尺寸的宿主容器，所以必须补一块
 * 与卡片重合的锚点盒，`calc(100% ± offset)` 才仍然等于「离卡片这条边的距离」。
 * 反缩放（scale 1/zoom）与外层视口变换合起来仍在屏幕尺寸上恒定——与留在节点里时同一套数学。
 */
const toolbarAnchorStyle = computed<Record<string, string>>(() => ({
  left: `${props.position?.x ?? 0}px`,
  top: `${props.position?.y ?? 0}px`,
  width: `${cardWidth.value}px`,
  height: `${cardHeight.value}px`,
}))

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

/**
 * 标题右侧的附加文本（标题条最右那一格）。
 *
 * **来源只有一个**：节点类型注册时声明的 titleExtra（见 canvas-data 的 CanvasNodeType）。
 * 字符串 = 静态文案；函数 = 按节点 data 现算（图片/视频的"1280×720"就走这条 ——
 * 派生值不写进 data，免得每次改尺寸都多一条撤销记录）。壳只负责渲染，不认识任何业务类型。
 *
 * 空串 / 未声明 / 函数抛错都收敛成"这一格不渲染"：宁可少一格，也不要显示半截脏文案。
 */
const titleExtraText = computed(() => {
  const src = cap.titleExtra.value
  if (!src) return ''
  if (typeof src === 'string') return src
  try {
    return src((props.data ?? {}) as Record<string, unknown>) ?? ''
  } catch {
    return ''
  }
})
/**
 * 标题右侧的**组件插槽**（2026-10-16）：节点类型注册的 titleExtraSlot（Component）——
 * 典型用途是调试连接建立后常驻的"调试"标签。组件由声明方（业务插件）提供，
 * 壳只负责挂载，并以 nodeId/data 注入初始 props —— 声明方内部自持响应式状态。
 */
const titleExtraSlotComp = computed(() => cap.titleExtraSlot?.value as Component | undefined)

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
/**
 * 拖线非法/满额提示 → 渲染层 tip 服务（跟随鼠标的全局提示，与其它提示同一套观感）。
 * 节点内不再自绘气泡（用户口径 2026-10-26）。
 */
/** 本节点是否正持有提示（离场时只有持有者才 hide，避免多节点互相覆盖） */
let tipOwner = false
watch(
  () => [isConnectionInvalidTarget.value, isWillEvictTarget.value, connectionHover.value?.reason] as const,
  ([invalid, evict, reason]) => {
    const tip = ctx.tryGet<{ show(m: string): void; hide(): void }>('tip')
    if (!tip) return
    if (invalid) {
      tipOwner = true
      tip.show(reason || '无法连接')
    } else if (evict) {
      tipOwner = true
      tip.show('将替换已有连接')
    } else if (tipOwner) {
      tipOwner = false
      tip.hide()
    }
  },
  { immediate: true },
)

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
  // T04/T10：经 flow facade 读实时渲染位置（拖动中未落盘的位移也拿得到）
  const pos = flow.getNodeRenderPosition(props.id)
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
// 【抓手工具】：CANVAS_NODES_DRAGGABLE=false（= 抓手）时整体压掉端口球 —— 抓手模式下拖动是平移画布、
// 节点不会被拖走，端口留着只会误导（用户要求）。这是"移动 vs 抓手"工具语义的一部分，与
// 拖线/低细节/多选等压制项并列；移动工具下照常显示。
//
// 注意：这只是"允许"，按钮最终显隐在 MovingHandle 内部——zone hover(keepVisible) 或 选中(selected) 才真正亮。
// 鼠标只停卡片 body（未进任何 zone）时 visible 虽 true，但 keepVisible/selected 均 false → 不亮（只亮靠近的端口）。
/**
 * **硬压制**门：命中其一，端口区就该**完全不吃指针事件**（不只是按钮不亮）。
 *
 * 为什么必须单独抽出来（2026-10-03 实测踩到的真 bug）：以前只有 shouldShowHandles 一个布尔，
 * 它只传给 MovingHandle 的 :visible，而 :visible 只控制**按钮的 opacity** ——
 * 那圈透明的"端口吸附接收区"(.port-follow-zone) 始终 pointer-events: all、尺寸 87×176。
 * 于是多选（或抓手/低细节/拖节点）时按钮虽已隐藏，鼠标按住那块**看不见的区域**照样能起手拖出连线
 * （用户报："多选后依然能从框里的节点拖出连接线"）。把这几条抽成 handleBlocked 喂给接收区，
 * 它才真的不接事件。
 *
 * 注意它**不含** (isHovered || portHovered || selected)——那一项是"软可见"（hover/选中才亮），
 * 若并进来会在未 hover 时就把接收区关掉，鼠标就永远进不来（鸡生蛋）。
 */
const handleBlocked = computed(
  () =>
    isHandTool.value || // 抓手工具：拖动是平移画布，端口留着只会误导
    lowDetail.value || // 低细节：端口整体不画
    suppressHandles.value || // 拖线中全局压
    isCurrentConnectingNode.value || // 本节点是本次拖线源
    interaction.isNodeDragging.value || // 正在拖节点
    // 多选：十几个节点的圆球 + 接收区会和多选框上的"批量连线端口"混在一起，
    // 分不清该拖哪个（用户要求：多选时节点自身的端口全不接事件）。
    isMultiSelected.value,
)

/** 端口"允许显示"门 = 非硬压制 且 (鼠标在卡片上 || 鼠标在端口 zone 上 || 选中) */
const shouldShowHandles = computed(
  () => !handleBlocked.value && (isHovered.value || portHovered.value || props.selected),
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
// 设 0 等于"清零"（不兜底，带塌成 0 宽）；缺省才回落 portZoneWidth（主题默认 10）。
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
    const pos = flow.getNodeRenderPosition(props.id)
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
  const pos = flow.getNodeRenderPosition(props.id)
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
    'is-culled': isCulled,
    'is-culled-linked': isCulledLinked,
    'is-culled-ghost': culledGhost,
    'is-connection-valid': isConnectionValidTarget,
    'is-connection-invalid': isConnectionInvalidTarget,
  }" @mouseenter="onCardMouseEnter" @mouseleave="onCardMouseLeave">
    <!-- 上/下控制栏：装了解层宿主就 Teleport 过去（压过置顶连线），否则原地渲染（行为与改动前逐字一致）。
         逻辑与能力实例都不搬 —— Teleport 只换 DOM 位置，provide/inject 沿组件树传递，共享关系不变。
         压制条件：框选中整排收起、多选收起、本节点 resize 中（hideToolbars），再加"画布上有节点在拖"
          （hideSlotBars —— 拖动只收这两排栏，不动卡片上的覆盖层，见该 computed 的说明）。 -->
    <Teleport v-if="toolbarHost" :to="toolbarHost">
      <!-- 与卡片同位置同尺寸的锚点盒：.v2-slot 的 calc(100% +/- offset) 才仍等于「离卡片这条边的距离」 -->
      <div class="v2-toolbar-anchor" :data-node-id="id" :style="toolbarAnchorStyle">
        <div
          v-if="topSlots.length > 0 && !hideSlotBars && !culledReduced"
          class="v2-slot v2-slot--top nodrag nopan"
          :style="topSlotsStyle"
        >
          <RegionEntryHost v-for="seg in topSlots" :key="'top-' + seg.id" :entry="seg" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
        </div>
        <div
          v-if="bottomSlots.length > 0 && !hideSlotBars && !culledReduced"
          class="v2-slot v2-slot--bottom nodrag nopan"
          :style="bottomSlotsStyle"
        >
          <RegionEntryHost v-for="seg in bottomSlots" :key="'bottom-' + seg.id" :entry="seg" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
        </div>
      </div>
    </Teleport>
    <div
      v-else-if="topSlots.length > 0 && !hideSlotBars && !culledReduced"
      class="v2-slot v2-slot--top nodrag nopan"
      :style="topSlotsStyle"
    >
      <RegionEntryHost v-for="seg in topSlots" :key="'top-' + seg.id" :entry="seg" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
    </div>

    <div class="v2-card" :class="{
      'is-connecting-hover': showConnectFeedback,
      'is-connection-invalid': isConnectionInvalidTarget,
    }" :style="cardInlineStyle" @mousemove="updateCardMousePosition">
      <!-- 多选标记：内容区左上角的圆形单选点（只在多选时出现；大小/颜色/缩放都来自本插件 Config）。
           纯指示，不接事件 —— 点击行为交给卡片本身（Shift+点节点 = 从选中集里去掉它）。 -->
      <div
        v-if="showMultiRadio && !culledReduced"
        class="v2-multi-radio nodrag nopan mc-export-ignore"
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
      <div v-if="showTitle && !culledReduced" class="v2-title nodrag nopan" :style="titlePositionStyle"
        @dblclick.stop="editable && startTitleEdit()" @pointerdown.stop>
      <RegionEntryHost v-if="customTitleEntry" :entry="customTitleEntry" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
        <BaseTitle v-else :interactive="true" :editing="isEditingTitle" :title-icon="titleIcon">
          <template #title-label>
            <!-- 编辑用 contenteditable（同一元素切换属性），不换 <input>：换元素会改行高把标题条撑变形 -->
            <TitleLabel :label="nodeLabel" :editing="isEditingTitle" @commit="commitTitleEdit"
              @cancel="cancelTitleEdit" />
          </template>
          <!-- 标题右侧插槽：优先渲染节点类型注册的 titleExtraSlot 组件（调试标签等
               运行态内容由声明方自持）；否则回落到 titleExtra 文本。两者都空就不占位
               （BaseTitle 那一格本来就是 ≤20% 的收缩槽）。 -->
          <template v-if="titleExtraSlotComp" #title-extra>
            <component :is="titleExtraSlotComp" :node-id="id" :data="data" />
          </template>
          <template v-else-if="titleExtraText" #title-extra>
            <span class="v2-title-extra">{{ titleExtraText }}</span>
          </template>
        </BaseTitle>
      </div>

      <!-- 非法连接 / 满额替换提示：统一由渲染层 tip 服务显示（跟随鼠标，与其它提示同一套观感）。
           节点内不再自绘气泡 —— 用户口径 2026-10-26：提示是全局基础设施。 -->

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
        :blocked="handleBlocked"
        :rest-offset="handleParams.handleRestOffset" :cursor-gap="handleParams.handleCursorGap"
        :button-size="handleParams.handleButtonSize" :zone-width="portZoneWidth" :zone-height="portZoneHeight"
        :zone-offset="portZoneOffset" :zone-shape="portZoneShape" :zone-arc-ratio="portZoneArcRatio"
        :debug="debugHandle && !isConnecting" @hover="onPortHover" />

      <!-- 内容裁剪层：overflow hidden 确保不溢出卡片圆角 -->
      <div v-if="!culledReduced" class="v2-content-clip">
        <!-- in 区域（老 content 段）：基座 + attach 场条目按 order 同摞渲染 -->
      <RegionEntryHost v-for="seg in contentStack" :key="'in-' + seg.id" :entry="seg" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
        <div v-if="contentStack.length === 0" class="v2-content-missing">（type "{{ type }}" 未注册 content 段）</div>
      </div>

      <!-- 右下角 resize 拖拽句柄（类型声明 resizable 或 data.resizable === true 时显示；useNodeCardSize 门）。
           反缩放：屏幕大小恒定，transform-origin 在右下角（钉在卡片角上不漂移）。
           只在 pointerdown 起手；move/up 由 useNodeCardSize 绑到全局 document —— 指针移出手柄也不会断。 -->
      <div v-if="cardResizable && !culledReduced" class="resize-handle mc-export-ignore" :class="{ 'is-resizing': cardIsResizing }"
        :style="{ transform: `scale(${resizeHandleScale})` }" @pointerdown="card.onResizePointerDown">
        <svg viewBox="0 0 8 8" fill="none" class="resize-handle-icon">
          <path d="M7 1L1 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
          <path d="M7 5L5 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
        </svg>
      </div>

      <!-- 右侧输出口(source)：同 target。 -->
      <MovingHandle v-if="showSourceHandle" ref="sourceHandleRef" id="source" type="source" :position="Position.Right"
        :visible="shouldShowHandles" :disabled="isCurrentConnectingNode || blockedSourcePort" :selected="props.selected"
        :blocked="handleBlocked"
        :rest-offset="handleParams.handleRestOffset" :cursor-gap="handleParams.handleCursorGap"
        :button-size="handleParams.handleButtonSize" :zone-width="portZoneWidth" :zone-height="portZoneHeight"
        :zone-offset="portZoneOffset" :zone-shape="portZoneShape" :zone-arc-ratio="portZoneArcRatio"
        :debug="debugHandle && !isConnecting" @hover="onPortHover" />
    </div>

    <!-- 下插槽：装了解层宿主时已随上面一起 Teleport 过去；这里只在原地模式渲染。 -->
    <div
      v-if="!toolbarHost && bottomSlots.length > 0 && !hideSlotBars && !culledReduced"
      class="v2-slot v2-slot--bottom nodrag nopan"
      :style="bottomSlotsStyle"
    >
      <RegionEntryHost v-for="seg in bottomSlots" :key="'bottom-' + seg.id" :entry="seg" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
    </div>

    <!-- out:left / out:right（新增区域）：左右外侧，垂直居中；不参与卡片布局、不撑高节点 -->
    <div v-if="leftRegions.length > 0 && !lowDetail && !culledReduced" class="v2-region v2-region--out-left nodrag nopan">
      <RegionEntryHost v-for="seg in leftRegions" :key="'out-left-' + seg.id" :entry="seg" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
    </div>
    <div v-if="rightRegions.length > 0 && !lowDetail && !culledReduced" class="v2-region v2-region--out-right nodrag nopan">
      <RegionEntryHost v-for="seg in rightRegions" :key="'out-right-' + seg.id" :entry="seg" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
    </div>

    <!-- on:top / on:bottom（新增区域）：贴在卡片边框线上（骑线居中，如进度条） -->
    <div v-if="onTopRegions.length > 0 && !lowDetail && !culledReduced" class="v2-region v2-region--on-top nodrag nopan">
      <RegionEntryHost v-for="seg in onTopRegions" :key="'on-top-' + seg.id" :entry="seg" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
    </div>
    <div v-if="onBottomRegions.length > 0 && !lowDetail && !culledReduced" class="v2-region v2-region--on-bottom nodrag nopan">
      <RegionEntryHost v-for="seg in onBottomRegions" :key="'on-bottom-' + seg.id" :entry="seg" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
    </div>

    <!-- 编辑浮层（裁剪框/扩展框）：与卡片**同级**、画在卡片外面，所以不会被内容层的 overflow:hidden 裁掉。
         尺寸与卡片严格一致（不反缩放）—— 浮层必须和底下的画面像素对齐，缩放会错位。
         z-index 高于卡片但低于上/下控制栏：编辑框盖住画面，但"确认/取消"按钮仍在最上层可点。 -->
    <div
      v-if="overlaySlots.length > 0 && !hideOverlays && !culledReduced"
      class="v2-overlay nodrag nopan"
      :style="overlayLayerStyle"
    >
      <RegionEntryHost v-for="seg in overlaySlots" :key="'overlay-' + seg.id" :entry="seg" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
    </div>

    <!-- over:outset（新增区域）：盖住整张卡且允许超出卡片边界；与卡片重合（不反缩放，画面像素对齐优先），
         overflow 交给组件自带样式（拖拽手柄/悬停放大会出界）。 -->
    <div v-if="outsetRegions.length > 0 && !lowDetail && !culledReduced" class="v2-region v2-region--over-outset nodrag nopan" :style="overlayLayerStyle">
      <RegionEntryHost v-for="seg in outsetRegions" :key="'over-outset-' + seg.id" :entry="seg" :cache="capabilityCache" :node-id="id" :data="data" :is-dev="capabilityIsDev" />
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

/* —— 视口外节点（culled / culled-linked）骨架态 ——
   宿主常驻节点（VueFlow hidden 会连坐连线），壳把可见部分收干净：
   卡片本体隐身但保留盒子（占位 + 端口锚点几何），标题条与 MovingHandle 留在 DOM
   （连线端点读 handleBounds，隐身不影响）；内容/栏位/区域条已由模板不挂载。 */
.v2-node.is-culled .v2-card {
  visibility: hidden;
}
/* 骨架节点不响应指针：卡片隐身后不可点、不可框内起拖；端口锚点保留几何但不再起线 */
.v2-node.is-culled .v2-card * {
  pointer-events: none !important;
}
/* ghost 档：画一个可见的空心细边框（远端连线走向一目了然；随缩放反比保持屏幕 1px） */
.v2-node.is-culled-ghost .v2-card {
  visibility: visible;
  background: transparent;
  box-shadow: none;
  border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
  /* 圆角继承卡片本体（cardFrame 单一出处），不自造数值（ui-style-guide） */
  border-radius: inherit;
}

/* —— 上/下插槽定位层（位置由壳给，插件只放内容）——
   浮在卡片外侧：绝对定位、不占布局高度（节点不会被撑高）。
   贴边距离 / 水平居中 / 反缩放全在 :style 里（resolveNodeSlotStyle）；这里只给"排一行"的默认排版：
   插槽里可能只放一个插件组件，也可能叠了好几个 occupant 并排。 */

/* 控制栏脱层后的定位锚：与卡片同位置同尺寸（flow 绝对坐标），纯定位层不接事件。
   为什么需要：.v2-slot 的 bottom/top: calc(100% ± offset) 是相对**定位父元素**算的
   （留在节点里时父元素就是卡片盒）。传送到画布级层后父元素变成零尺寸宿主，
   补这一块与卡片重合的锚点盒，calc(100% ± offset) 才仍等于「离卡片这条边的距离」。 */
.v2-toolbar-anchor {
  position: absolute;
  pointer-events: none;
}

/* 传送宿主那层是 pointer-events:none（不挡画布交互），但控制栏里的按钮必须能点 ——
   留在节点里时它们从 .v2-node 继承 auto，传送后必须显式恢复，否则按钮全变"看得见点不到"。 */
.v2-slot--top,
.v2-slot--bottom {
  pointer-events: auto;
}

/* 上/下插槽的外层。
   z-index:30 是**节点内**渲染时的必需值：slot 与 .v2-card 是 .v2-node 下的兄弟，
   不加 z 会被卡片盖住（--top 在卡片之前、--bottom 在之后）。
   装了解层宿主时本层会被 Teleport 到画布级层（.csurface-node-toolbars，层值 LAYERS.nodeToolbar），
   那时这个 z 只在传送容器内部生效、不影响它与置顶连线的先后。 */
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
  border-color: var(--canvas-node-border-hover, rgba(156, 163, 175, 0.45));
}

.v2-card.is-connection-invalid::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 25;
  border-radius: inherit;
  background: var(--ui-hover-strong, rgba(255, 255, 255, 0.25));
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
  background: var(--ui-tip, rgba(31, 41, 55, 0.94));
  color: var(--ui-tip-ink, #fff);
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: var(--ui-shadow-lg, 0 10px 24px rgba(0, 0, 0, 0.28));
}

/* 满额"将替换"提示（蓝色系，与红气泡区分） */
.will-evict-tooltip {
  position: absolute;
  z-index: 60;
  transform: translate(-50%, -50%);
  padding: 6px 12px;
  border-radius: 999px;
  /* 满额替换提示：走蓝色系数据色（与红色非法气泡区分），不属主题外观 */
  /* 主题色白名单: 满额替换提示的蓝色语义色，需与非法连接的红色气泡区分 */
  background: rgba(37, 99, 235, 0.95);
  color: var(--ui-tip-ink, #fff);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  pointer-events: none;
  box-shadow: var(--ui-shadow-lg, 0 10px 24px rgba(0, 0, 0, 0.22));
}

.will-evict-tooltip .we-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ui-tip-ink, #fff);
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
  /* 尺寸 / 反缩放 由 multiRadioStyle() 内联给；**颜色走主题强调色**（不再有单独的颜色配置项，
     用户要求删掉它）—— 在「常规/主题配色」里改强调色或切亮/暗主题，这个标记自动跟随。 */
  color: var(--ui-accent, #0891b2);
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
  filter: drop-shadow(0 1px 2px var(--canvas-node-shadow-strong, rgb(0 0 0 / 0.28)));
}

/* 外圈：白底 + 主题色描边（用描边而不是实心，视觉更轻、不压内容） */
.v2-multi-radio-ring {
  /* 恒白：这个标记要浮在**任意节点内容**上都看得清（图片/视频/文本），
     跟随主题底色会在暗色下变成"深色环上的深色描边"、直接看不见 → 有意不跟随主题。 */
  /* 主题色白名单: 多选标记的恒白底，保证浮在任何节点内容上都可见 */
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

/*
 * 标题右侧附加文本（尺寸之类的派生信息）。
 * 靠右：BaseTitle 里 label 固定占 80%、extra 是剩下那 ≤20% 的收缩槽，
 * margin-left:auto 把这格推到标题条最右端（即卡片右上角）。
 * 用比标题更弱的字色：它是"顺带看一眼"的元信息，不该跟节点名字抢注意力。
 */
.v2-title-extra {
  margin-left: auto;
  flex: 0 0 auto;
  color: var(--canvas-node-text-faint, #9ca3af);
  font-variant-numeric: tabular-nums;
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

/* —— 新增区域容器（out:left / out:right / on:top / on:bottom / over:outset）——
   绝对定位、不占布局高度（节点不被撑高）、不接画布交互（nodrag/nopan 由 class 声明，
   pointer-events 交给子组件自己开）。位置是默认值，组件可自带样式/transform 覆盖。 */
.v2-region {
  position: absolute;
  z-index: 26;
  display: flex;
  align-items: center;
}

/* 左右外侧：垂直居中，left/right 贴卡缘（负偏移让容器悬在卡外） */
.v2-region--out-left {
  right: 100%;
  top: 50%;
  transform: translateY(-50%);
}

.v2-region--out-right {
  left: 100%;
  top: 50%;
  transform: translateY(-50%);
}

/* 贴边框线：水平居中、骑在上下缘上（translateY(-50%) 让组件垂直骑线） */
.v2-region--on-top {
  left: 50%;
  top: 0;
  transform: translate(-50%, -50%);
}

.v2-region--on-bottom {
  left: 50%;
  top: 100%;
  transform: translate(-50%, -50%);
}

/* over:outset：与卡片重合（不反缩放），overflow 可见允许出界 */
.v2-region--over-outset {
  left: 0;
  top: 0;
  overflow: visible;
}

.v2-content-missing {
  color: var(--ui-warn, #b45309);
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
