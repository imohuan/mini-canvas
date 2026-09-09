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
import { useVueFlow, Position, useCanvasRender, createV2Logger } from '@mini-canvas/canvas-render'
import type { NodeProps, AimedTarget } from '@mini-canvas/canvas-render'
import { resolveSegment } from '@mini-canvas/canvas-core-v2'
import MovingHandle from './MovingHandle.vue'
import BaseTitle from './BaseTitle.vue'
import { useNodeCapability } from '../../composables/useNodeCapability'
import { useNodeCardSize } from '../../composables/useNodeCardSize'
import { useNodeDebugOverlay } from '../../composables/useNodeDebugOverlay'

const log = createV2Logger('base-node')
const props = defineProps<NodeProps>()
// 节点类型都是本组件(VueFlow nodeTypes 全指到 BaseNode)，透传的 selected 等内部 prop 不落到根
defineOptions({ inheritAttrs: false })

// 统一渲染上下文（CanvasHost provide）——单入口取 registry/写回回调/端口外观/连接反馈/内核上下文
const { ctx, registry, nodeWrite, handleParams, connectionState, interaction, debug, snapZone } = useCanvasRender()
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
// 节点外观阈值：全部来自本插件 Config（节点/标题、节点/LOD），对齐 v1 core 的 nodeTitleOffset /
// nodeTitleScaleMinZoom / nodeLodLowDetailZoom。settings 单一数据源非 Vue 响应式，故这里用 ref +
// onChange 订阅把配置改动实时驱动到渲染（改设置面板即生效，不整图重建）。
const settingsStore = () => ctx?.get<{ get(key: string): unknown }>('settings')
const numOf = (key: string, fallback: number): number => {
  const v = settingsStore()?.get(key)
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
const TITLE_OFFSET = ref(numOf('titleOffset', 12))
const TITLE_MIN_ZOOM = ref(numOf('titleScaleMinZoom', 0.5))
const LOW_DETAIL_ZOOM = ref(numOf('nodeLodLowDetailZoom', 0.4))
const applyTitleSetting = (key: string, value: unknown): void => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return
  if (key === 'titleOffset') TITLE_OFFSET.value = value
  else if (key === 'titleScaleMinZoom') TITLE_MIN_ZOOM.value = value
  else if (key === 'nodeLodLowDetailZoom') LOW_DETAIL_ZOOM.value = value
}
// 全局订阅配置变化，按 key 过滤出本节点关心的 3 项（不按插件 scope 过滤，避免命名/装配差异导致不触发）。
const titleSettingOff = ctx?.get<{ onChange(cb: (key: string, value: unknown) => void): { dispose(): void } }>('settings')?.onChange(
  (key, value) => applyTitleSetting(key, value),
)
onBeforeUnmount(() => titleSettingOff?.dispose())

const lowDetail = computed(() => zoom.value < LOW_DETAIL_ZOOM.value)
const titleScale = computed(() => 1 / Math.max(zoom.value, TITLE_MIN_ZOOM.value))

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
})
const cardWidth = card.cardWidth
const cardHeight = card.cardHeight
// 顶层解构：模板里 ref 自动解包，才能让 v-if 拿到布尔值(而非恒真的 ref 对象)。
const cardResizable = card.resizable
const cardIsResizing = card.isResizing

// 标题反缩宽度：DOM 宽 = cardWidth * max(zoom, minZoom)（屏幕宽 = 卡片屏幕宽）
const titleCanvasWidth = computed(() => cardWidth.value * Math.max(zoom.value, TITLE_MIN_ZOOM.value))
// 卡片边框反缩放补偿
const cardBorderComp = computed(() => Math.max(1 / zoom.value, 1))
const titlePositionStyle = computed(() => ({
  transform: `scale(${titleScale.value})`,
  transformOrigin: 'left bottom',
  left: `${-cardBorderComp.value}px`,
  bottom: `calc(100% + ${TITLE_OFFSET.value * titleScale.value + cardBorderComp.value}px)`,
  width: `${titleCanvasWidth.value}px`,
}))

// 卡片行内样式：尺寸 + 3D 连接倾斜 transform + 反缩放边框
const cardInlineStyle = computed<Record<string, string>>(() => ({
  width: `${cardWidth.value}px`,
  height: `${cardHeight.value}px`,
  transform: cardTransform.value,
  borderWidth: `${1 / zoom.value}px`,
  borderRadius: '8px',
  '--card-outline-width': showSelectionOutline.value ? `${2 / zoom.value}px` : '0px',
}))

// ============ 就地重命名 ============
const isEditingTitle = ref(false)
const draftTitle = ref('')
const titleInputRef = ref<HTMLInputElement | null>(null)
const skipBlurCommit = ref(false)

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
  draftTitle.value = nodeLabel.value
  isEditingTitle.value = true
  nextTick(() => {
    titleInputRef.value?.focus()
    titleInputRef.value?.select()
  })
}

function commitTitleEdit() {
  if (skipBlurCommit.value) {
    skipBlurCommit.value = false
    return
  }
  const value = draftTitle.value.trim()
  const next = value || undefined
  if (nodeWrite) nodeWrite(props.id, next === undefined ? { label: undefined } : { label: next })
  isEditingTitle.value = false
}

function cancelTitleEdit() {
  skipBlurCommit.value = true
  isEditingTitle.value = false
}
onBeforeUnmount(() => document.removeEventListener('keydown', onTitleEditKeydown))

// ============ 段组件路由（未注册段 = 不渲染/默认）============
const content = computed(() => resolveSegment(registry, props.type, 'content'))
const customTitle = computed(() => resolveSegment(registry, props.type, 'title'))
const topToolbar = computed(() => resolveSegment(registry, props.type, 'top-toolbar'))
const bottomToolbar = computed(() => resolveSegment(registry, props.type, 'bottom-toolbar'))
const editable = computed(() => Boolean(nodeWrite))

// ============ 端口能力显隐（按 type）============
const cap = useNodeCapability(props.type)
const showTargetHandle = cap.hasTarget
const showSourceHandle = cap.hasSource

// ============ hover 状态（控制端口醒目与阴影）============
const isHovered = ref(false)
// —— 拖线瞄准上报（前端 mouse 事件驱动 aimedTarget，取代后端几何命中）——
// 端口 zone 瞄准侧：null=无端口 hover；'input'=target 输入口 / 'output'=source 输出口
const aimPortSide = ref<null | 'input' | 'output'>(null)
// 卡片 body 瞄准（鼠标在卡片主体、非端口 zone）
const aimBody = ref(false)

// ============ 连接反馈（消费 connectionState）============
const isConnecting = computed(() => connectionState.isConnecting.value)
const activeConnection = computed(() => connectionState.activeConnection.value)
/** 拖线源是否是我自己（拖线时压住自己端口 + 禁止对自己 3D） */
const isCurrentConnectingNode = computed(() => isConnecting.value && activeConnection.value?.sourceNodeId === props.id)
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
// 卡片根 enter/leave：维护物理 hover + body 瞄准
function onCardMouseEnter(): void {
  isHovered.value = true
  aimBody.value = true
}
function onCardMouseLeave(): void {
  isHovered.value = false
  aimBody.value = false
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
// 端口 hover（MovingHandle @hover）：维持原 isHovered 视觉语义
function onPortHover(value: boolean): void {
  isHovered.value = value
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
    if (aimPortSide.value) {
      next = { nodeId: props.id, side: aimPortSide.value, anchor: snapAnchorFor(aimPortSide.value) }
    } else if (aimBody.value) {
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

// 端口"允许显示"门（传给 MovingHandle 作上层压制）：非低细节 && 非拖线全局压 && 非源自身 && 非拖拽 busy。
// 注意：这只是"允许"，按钮最终显隐在 MovingHandle 内部——zone hover(keepVisible) 或 选中(selected) 才真正亮。
// isHovered 由卡片根 enter 与端口 zone @hover 共同置位：zone hover 时经它把 visible 抬到 true，配合 keepVisible 亮该端口。
// 鼠标只停卡片 body（未进任何 zone）时 visible 虽 true，但 keepVisible/selected 均 false → 不亮（只亮靠近的端口）。
const shouldShowHandles = computed(
  () =>
    !lowDetail.value &&
    !suppressHandles.value &&
    !isCurrentConnectingNode.value &&
    !interaction.isBusyDragging.value &&
    (isHovered.value || props.selected),
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

// 关键修复：v-if 摘掉 MovingHandle 时，节点尺寸没变，VueFlow 自身的 updateNodeDimensions 不会触发
//（doUpdate=false → 不重测 handleBounds），导致 node.handleBounds.source/target 残留旧坐标 →
// VueFlow 原生 useHandle.handlePointerDown → getClosestHandle 用 stale 坐标把线端吸到已不存在的端口上。
// 修复：blocked 状态变化时主动调 updateNodeInternals([id])，强制 VueFlow 重测 handleBounds；
// forceUpdate=true 下 handleBounds.source/target 会按当前 DOM 真实 Handle 重算（已 v-if 摘掉的 Handle 不再计入）。
// 注：VueFlow 原生 Handle mousedown 走 useHandle.ts 链路，全程不经过 CanvasHost.resolveFromAim，
// 因此我们那条 resolveFromAim 的方向校验挡不住原生吸附；只能从数据源清掉 stale bounds。
// watched `any` on purpose: `updateNodeInternals` is exposed on the vue-flow store instance; canvas-render
// doesn't ship a typed wrapper here, the call site is stable across vue-flow versions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vfAny = vf as any
watch(
  [blockedTargetPort, blockedSourcePort],
  () => {
    if (blockedTargetPort.value || blockedSourcePort.value) {
      // nextTick: 等 v-if 完成 DOM 摘除后再重测，否则 VueFlow 仍会读到旧 DOM
      nextTick(() => vfAny.updateNodeInternals?.([props.id]))
    } else {
      // blocked→false（v-if 恢复渲染）：等 handle 的 onMounted 注册完 handleBounds，再触发一次重测兜底
      nextTick(() => vfAny.updateNodeInternals?.([props.id]))
    }
  },
  { flush: 'post' },
)

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
// 端口区域宽 portZoneWidth 是端口交互区矩形的主尺寸（吸附带宽未显式给时也用它兜底，与 CanvasHost resolveAtClient 一致）
// 设 0 等于"清零"（不兜底，由上游决定）；默认值由 DEFAULT_THEME_HANDLE.portZoneWidth = 86 提供。
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
    <!-- 顶部工具栏（注册了才渲染） -->
    <div v-if="topToolbar" class="top-toolbar">
      <component :is="topToolbar" :id="id" :data="data" />
    </div>

    <div class="v2-card" :class="{
      'is-connecting-hover': showConnectFeedback,
      'is-connection-invalid': isConnectionInvalidTarget,
    }" :style="cardInlineStyle" @mousemove="updateCardMousePosition">
      <!-- 标题条：卡片内部、继承卡片 transform，反向缩放（BaseTitle / 就地改名） -->
      <div v-if="!lowDetail" class="v2-title nodrag nopan" :style="titlePositionStyle"
        @dblclick.stop="editable && startTitleEdit()" @pointerdown.stop>
        <component :is="customTitle" v-if="customTitle" :id="id" :data="data" />
        <BaseTitle v-else :interactive="true" :editing="isEditingTitle" :label="nodeLabel">
          <template #title-label>
            <input v-if="isEditingTitle" ref="titleInputRef" v-model="draftTitle" class="v2-title-input" type="text"
              @keydown.enter.prevent="commitTitleEdit" @keydown.escape.prevent="cancelTitleEdit" @blur="commitTitleEdit"
              @pointerdown.stop @dblclick.stop>
            <span v-else class="v2-title-label">{{ nodeLabel }}</span>
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
      <div v-if="showTargetHandle && !blockedTargetPort" class="snap-band snap-band--input"
        :class="{ 'is-active': snapZonesActive }" :style="inputSnapStyle" @mouseenter="onInputSnapEnter"
        @mouseleave="onSnapLeave" />
      <div v-if="showSourceHandle && !blockedSourcePort" class="snap-band snap-band--output"
        :class="{ 'is-active': snapZonesActive }" :style="outputSnapStyle" @mouseenter="onOutputSnapEnter"
        @mouseleave="onSnapLeave" />

      <!-- 左侧输入口(target)：有输入能力才渲染；悬停/选中显示。
           拖线中与源同类型(target)的端口整块从 DOM 摘掉，避免 VueFlow 真实 handle 残影并彻底不让其触发吸附。 -->
      <MovingHandle v-if="showTargetHandle && !blockedTargetPort" id="target" type="target" :position="Position.Left"
        :visible="shouldShowHandles" :disabled="isCurrentConnectingNode" :selected="props.selected"
        :rest-offset="handleParams.handleRestOffset" :cursor-gap="handleParams.handleCursorGap"
        :button-size="handleParams.handleButtonSize" :zone-width="portZoneWidth" :zone-height="portZoneHeight"
        :zone-offset="portZoneOffset" :zone-shape="portZoneShape" :zone-arc-ratio="portZoneArcRatio"
        :debug="debugHandle && !isConnecting" @hover="onPortHover" />

      <!-- 内容裁剪层：overflow hidden 确保不溢出卡片圆角 -->
      <div class="v2-content-clip">
        <component :is="content" v-if="content" :id="id" :data="data" />
        <div v-else class="v2-content-missing">（type "{{ type }}" 未注册 content 段）</div>
      </div>

      <!-- 右下角 resize 拖拽句柄（类型声明 resizable 或 data.resizable === true 时显示；useNodeCardSize 门） -->
      <div v-if="cardResizable" class="resize-handle" :class="{ 'is-resizing': cardIsResizing }"
        @pointerdown="card.onResizePointerDown" @pointermove="card.onResizePointerMove"
        @pointerup="card.onResizePointerUp">
        <svg viewBox="0 0 8 8" fill="none" class="resize-handle-icon">
          <path d="M7 1L1 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
          <path d="M7 5L5 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
        </svg>
      </div>

      <!-- 右侧输出口(source)：同 target 的处理：拖线中与源同类型(source)的端口整块从 DOM 摘掉。 -->
      <MovingHandle v-if="showSourceHandle && !blockedSourcePort" id="source" type="source" :position="Position.Right"
        :visible="shouldShowHandles" :disabled="isCurrentConnectingNode" :selected="props.selected"
        :rest-offset="handleParams.handleRestOffset" :cursor-gap="handleParams.handleCursorGap"
        :button-size="handleParams.handleButtonSize" :zone-width="portZoneWidth" :zone-height="portZoneHeight"
        :zone-offset="portZoneOffset" :zone-shape="portZoneShape" :zone-arc-ratio="portZoneArcRatio"
        :debug="debugHandle && !isConnecting" @hover="onPortHover" />
    </div>

    <!-- 底部工具栏（注册了才渲染） -->
    <div v-if="bottomToolbar" class="bottom-toolbar">
      <component :is="bottomToolbar" :id="id" :data="data" />
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

/* —— 卡片 —— */
.v2-card {
  position: relative;
  box-sizing: border-box;
  transform-origin: center;
  border-style: solid;
  border-color: var(--canvas-node-border, rgb(209 213 219 / 0.95));
  background: var(--canvas-node-surface, #f9fafb);
  box-shadow: 0 1px 3px var(--canvas-node-shadow-subtle, rgb(0 0 0 / 0.06));
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

/* —— 标题条：卡片上缘外、反向缩放 —— */
.v2-title {
  position: absolute;
  z-index: 3;
  display: flex;
  align-items: center;
  cursor: text;
}

.v2-title-label {
  display: inline-block;
  max-width: 100%;
  padding: 0 2px;
  font-size: 12px;
  line-height: 16px;
  color: var(--canvas-node-text-muted, #6b7280);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.v2-node.is-selected .v2-title-label {
  color: var(--canvas-node-text-strong, #111827);
}

/* 就地改名输入框 */
.v2-title-input {
  box-sizing: border-box;
  display: block;
  width: 100%;
  min-width: 40px;
  max-width: 100%;
  height: 16px;
  margin: 0;
  padding: 0 6px;
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  text-align: left;
  user-select: text;
  -webkit-user-select: text;
  color: var(--canvas-node-text, #4b5563);
  background: #fff;
  border: 1px solid var(--canvas-node-border-selected, rgb(17 24 39 / 0.85));
  border-radius: 5px;
  outline: none;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
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
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.4;
  transition: opacity 140ms ease;
  touch-action: none;
}

.resize-handle:not(.is-resizing):hover,
.v2-node.is-pointer-hovered .resize-handle,
.v2-node.is-selected .resize-handle {
  opacity: 0.85;
}

.resize-handle-icon {
  width: 8px;
  height: 8px;
  color: var(--canvas-node-resize-handle, #9ca3af);
  pointer-events: none;
}

.resize-handle:hover .resize-handle-icon,
.v2-node.is-pointer-hovered .resize-handle .resize-handle-icon,
.v2-node.is-selected .resize-handle .resize-handle-icon {
  color: var(--canvas-node-resize-handle-active, #111827);
}

/* LOD：隐标题条、隐拖柄 */
.v2-node.is-low-detail .v2-title,
.v2-node.is-low-detail .resize-handle {
  display: none;
}
</style>
