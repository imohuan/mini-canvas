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

// 统一渲染上下文（CanvasHost provide）——单入口取 registry/写回回调/端口外观/连接反馈
const { registry, nodeWrite, handleParams, connectionState, debug, snapZone } = useCanvasRender()
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
const LOW_DETAIL_ZOOM = 0.4
const TITLE_MIN_ZOOM = 0.5
const TITLE_OFFSET = 12
const lowDetail = computed(() => zoom.value < LOW_DETAIL_ZOOM)
const titleScale = computed(() => 1 / Math.max(zoom.value, TITLE_MIN_ZOOM))

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
const titleCanvasWidth = computed(() => cardWidth.value * Math.max(zoom.value, TITLE_MIN_ZOOM))
// 卡片边框反缩放补偿
const cardBorderComp = computed(() => Math.max(1 / zoom.value, 1))
const titlePositionStyle = computed(() => ({
  transform: `scale(${titleScale.value})`,
  transformOrigin: 'left bottom',
  left: `${-cardBorderComp.value}px`,
  bottom: `calc(100% + ${TITLE_OFFSET * titleScale.value + cardBorderComp.value}px)`,
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

/** 是否对我做"可连接"3D 反馈：拖线中、非源自身、非非法、非低细节、且 hover/物理悬停或我已是合法目标 */
const showConnectFeedback = computed(
  () =>
    isConnecting.value &&
    !isCurrentConnectingNode.value &&
    !isConnectionInvalidTarget.value &&
    !lowDetail.value &&
    (isHovered.value || isConnectionValidTarget.value),
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
// 端口 zone 瞄准（MovingHandle @aim）：即时上报，无 180ms 归位延迟
function onPortAim(payload: { side: 'input' | 'output'; active: boolean }): void {
  aimPortSide.value = payload.active ? payload.side : null
}
// 端口 hover（MovingHandle @hover）：维持原 isHovered 视觉语义
function onPortHover(value: boolean): void {
  isHovered.value = value
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
    if (aimPortSide.value) next = { nodeId: props.id, side: aimPortSide.value }
    else if (aimBody.value) next = { nodeId: props.id, side: 'body' }
    if (next) {
      connectionState.aimedTarget.value = next
    } else if (aimed?.nodeId === props.id) {
      // 我不再瞄准且 aimedTarget 仍是我 → 清空（离开节点回到空白）
      connectionState.aimedTarget.value = null
    }
  },
  { immediate: true },
)

// 端口显示：非低细节 && 非全局压端口 && (非源自身) && (hover 或选中)
const shouldShowHandles = computed(
  () =>
    !lowDetail.value &&
    !suppressHandles.value &&
    !isCurrentConnectingNode.value &&
    (isHovered.value || props.selected),
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
        <line class="v2-debug-anchor" :x1="0" :y1="debugOverlay.anchorY.value - 6" :x2="0"
          :y2="debugOverlay.anchorY.value + 6" />
      </svg>

      <!-- 左侧输入口(target)：有输入能力才渲染；悬停/选中显示 -->
      <MovingHandle v-if="showTargetHandle" id="target" type="target" :position="Position.Left"
        :visible="shouldShowHandles" :disabled="isCurrentConnectingNode" :rest-offset="handleParams.handleRestOffset"
        :cursor-gap="handleParams.handleCursorGap" :button-size="handleParams.handleButtonSize"
        :zone-width="portZoneWidth" :zone-height="portZoneHeight" :zone-offset="portZoneOffset"
        :zone-shape="portZoneShape" :zone-arc-ratio="portZoneArcRatio" :debug="debugHandle"
        @hover="onPortHover" @aim="onPortAim" />

      <!-- 内容裁剪层：overflow hidden 确保不溢出卡片圆角 -->
      <div class="v2-content-clip">
        <component :is="content" v-if="content" :id="id" :data="data" />
        <div v-else class="v2-content-missing">（type "{{ type }}" 未注册 content 段）</div>
      </div>

      <!-- 右下角 resize 拖拽句柄（data.resizable === true 时） -->
      <div v-if="cardResizable" class="resize-handle" :class="{ 'is-resizing': cardIsResizing }"
        @pointerdown="card.onResizePointerDown" @pointermove="card.onResizePointerMove"
        @pointerup="card.onResizePointerUp">
        <svg viewBox="0 0 8 8" fill="none" class="resize-handle-icon">
          <path d="M7 1L1 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
          <path d="M7 5L5 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
        </svg>
      </div>

      <!-- 右侧输出口(source) -->
      <MovingHandle v-if="showSourceHandle" id="source" type="source" :position="Position.Right"
        :visible="shouldShowHandles" :disabled="isCurrentConnectingNode" :rest-offset="handleParams.handleRestOffset"
        :cursor-gap="handleParams.handleCursorGap" :button-size="handleParams.handleButtonSize"
        :zone-width="portZoneWidth" :zone-height="portZoneHeight" :zone-offset="portZoneOffset"
        :zone-shape="portZoneShape" :zone-arc-ratio="portZoneArcRatio" :debug="debugHandle"
        @hover="onPortHover" @aim="onPortAim" />
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
