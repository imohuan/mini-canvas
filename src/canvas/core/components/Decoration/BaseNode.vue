<script setup lang="ts">
import { Position, useVueFlow } from '@vue-flow/core'
import type { NodeProps, GraphNode } from '@vue-flow/core'
import { computed, ref, watch, onUnmounted } from 'vue'
import MovingHandle from './MovingHandle.vue'
import { useCanvasStore } from '../../useCanvasStore'
import { createCappedStyle } from '../../utils/viewportSpace'

const props = defineProps<NodeProps & {
  cardWidth?: number
  cardHeight?: number
}>()

const canvas = useCanvasStore()
const vf = useVueFlow()

const zoom = computed(() => Math.max(vf.viewport.value.zoom || 1, 0.01))
const cardFrameStyle = computed(() => ({
  width: `${zoom.value * 100}%`,
  height: `${zoom.value * 100}%`,
  borderRadius: `${8 * zoom.value}px`,
  '--node-base-ring-width': `${1 * zoom.value}px`,
  '--node-selected-ring-width': `${2 * zoom.value}px`,
  transform: `scale(${1 / zoom.value}) translateZ(0)`,
  transformOrigin: 'top left',
}))

/** 标题文字大小和位置跟随缩放，zoom=1 时封顶 */
const titleTransformStyle = computed(() => createCappedStyle(zoom.value, { topOffset: -20 }))

/** 卡片实际宽度（ref，拖拽 resize 时实时更新） */
const cardWidth = ref((props.data?.cardWidth as number) || props.cardWidth || 256)
/** 卡片实际高度（ref，拖拽 resize 时实时更新） */
const cardHeight = ref((props.data?.cardHeight as number) || props.cardHeight || 256)

/** 外部修改 data.cardWidth/cardHeight 时同步到 ref */
watch(() => props.data?.cardWidth, (w) => {
  if (w !== undefined && !isResizing.value) cardWidth.value = w as number
})
watch(() => props.data?.cardHeight, (h) => {
  if (h !== undefined && !isResizing.value) cardHeight.value = h as number
})

/** 是否允许 resize，默认关闭，通过 data.resizable: true 开启 */
const resizable = computed(() => props.data?.resizable === true)

// ============ Resize 拖拽逻辑 ============

const isResizing = ref(false)
const MIN_WIDTH = 120
const MIN_HEIGHT = 80

interface ResizeState {
  /** 拖拽起点屏幕坐标 x（clientX） */
  startScreenX: number
  /** 拖拽起点屏幕坐标 y（clientY） */
  startScreenY: number
  startWidth: number
  startHeight: number
}

const resizeState = ref<ResizeState | null>(null)

function onResizePointerDown(e: PointerEvent) {
  if (!resizable.value) return
  e.preventDefault()
  e.stopPropagation()
  isResizing.value = true
  resizeState.value = {
    startScreenX: e.clientX,
    startScreenY: e.clientY,
    startWidth: cardWidth.value,
    startHeight: cardHeight.value,
  }
    ; (e.target as HTMLElement).setPointerCapture(e.pointerId)
}

function onResizePointerMove(e: PointerEvent) {
  if (!isResizing.value || !resizeState.value) return
  const ds = resizeState.value
  // 节点 CSS 尺寸是屏幕像素，屏幕 delta 需除以当前 zoom 还原成 CSS 像素变化
  const z = vf.viewport.value.zoom || 1
  const dx = (e.clientX - ds.startScreenX) / z
  const dy = (e.clientY - ds.startScreenY) / z
  cardWidth.value = Math.max(MIN_WIDTH, ds.startWidth + dx)
  cardHeight.value = Math.max(MIN_HEIGHT, ds.startHeight + dy)
}

function onResizePointerUp(e: PointerEvent) {
  if (!isResizing.value) return
  isResizing.value = false
  resizeState.value = null
    ; (e.target as HTMLElement).releasePointerCapture(e.pointerId)
  vf.updateNode(props.id, {
    data: {
      ...props.data,
      cardWidth: cardWidth.value,
      cardHeight: cardHeight.value,
    },
  })
}

onUnmounted(() => {
  isResizing.value = false
  resizeState.value = null
})

// ============ 原有逻辑 ============

const isHovered = ref(false)
const mousePosition = ref({ x: 0.5, y: 0.5 })
const debugHandle = computed(() => Boolean(canvas.state.handleDebug || props.data?.debugHandle || props.data?.debugHandles))
const isCurrentConnectingNode = computed(() =>
  canvas.connectionState.isConnecting &&
  canvas.connectionState.sourceNodeId === props.id
)
const shouldShowHandles = computed(() =>
  !canvas.connectionState.suppressHandles &&
  !isCurrentConnectingNode.value &&
  (isHovered.value || props.selected)
)

const showConnectFeedback = computed(() =>
  canvas.connectionState.isConnecting &&
  canvas.connectionState.sourceNodeId !== props.id &&
  (
    isHovered.value ||
    canvas.connectionState.hoverFeedbackNodeId === props.id
  )
)

const showTargetZones = computed(() =>
  canvas.connectionState.isConnecting &&
  canvas.connectionState.sourceNodeId !== props.id &&
  Boolean(props.targetPosition)
)

const shouldShowTargetZones = computed(() =>
  Boolean(props.targetPosition) &&
  (canvas.state.connectionSnapDebugVisible || showTargetZones.value)
)

const CONNECT_FEEDBACK_ROTATE_X = 18
const CONNECT_FEEDBACK_ROTATE_Y = 18
const CONNECT_FEEDBACK_PERSPECTIVE = 800
const CONNECT_FEEDBACK_SCALE = 1.018

const cardTransform = computed(() => {
  if (!showConnectFeedback.value) return ''
  const p = feedbackMousePosition.value
  const rotateX = (p.y - 0.5) * CONNECT_FEEDBACK_ROTATE_X
  const rotateY = (p.x - 0.5) * -CONNECT_FEEDBACK_ROTATE_Y
  return `perspective(${CONNECT_FEEDBACK_PERSPECTIVE}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(10px) scale(${CONNECT_FEEDBACK_SCALE})`
})

const feedbackMousePosition = computed(() => {
  const point = canvas.connectionState.hoverFeedbackPoint
  if (canvas.connectionState.hoverFeedbackNodeId !== props.id || !point) {
    return mousePosition.value
  }

  const node = (vf.getNodes.value as GraphNode[]).find((item) => item.id === props.id)
  const position = node?.computedPosition || node?.position
  if (!position) return mousePosition.value

  const w = cardWidth.value || node?.dimensions?.width || 256
  const h = cardHeight.value || node?.dimensions?.height || 256

  return {
    x: clamp((point.x - position.x) / w, 0, 1),
    y: clamp((point.y - position.y) / h, 0, 1),
  }
})

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function updateCardMousePosition(event: MouseEvent) {
  if (!showConnectFeedback.value && !debugHandle.value) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  mousePosition.value = {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  }
}

// ============ 标题栏信息 ============

const nodeLabel = computed(() => {
  const label = props.data?.label as string | undefined
  const nt = props.data?.nodeType as string | undefined
  return label || nt || '节点'
})

const nodeExtra = computed(() => {
  const w = props.data?.imageWidth as number || props.data?.videoWidth as number
  const h = props.data?.imageHeight as number || props.data?.videoHeight as number
  if (w && h) return `${w}×${h}`
  return ''
})
</script>

<template>
  <!-- 节点根元素：relative 定位容器，绑定选中/悬停状态，控制 handles 显示/隐藏 -->
  <div class="custom-node-root relative" :class="{ 'is-selected': selected, 'is-hovered': isHovered }"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false; if (!canvas.connectionState.isConnecting) canvas.connectionState.suppressHandles = false">
    <!-- 顶部工具栏（各节点类型自定义，如图片裁剪、视频控制等） -->
    <slot name="top-toolbar" />

    <!-- 节点标题栏：卡片上方居中显示图标 + 名称 + 额外信息（如尺寸） -->
    <slot name="title">
      <!-- 标题容器：绝对定位在卡片上方，pointer-events-none 防止遮挡操作 -->
      <div class="absolute left-1 right-1 flex items-center gap-2 text-xs text-gray-500 pointer-events-none"
        :style="titleTransformStyle">
        <slot name="title-icon">
          <!-- 默认图标：根据 nodeType 显示图片/视频/文本类型图标 -->
          <svg v-if="data?.nodeType === 'image'" class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none" />
            <path d="M21 15l-5-5L5 21" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <svg v-else-if="data?.nodeType === 'video'" class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2">
            <polygon points="23 7 16 12 23 17" />
            <rect x="1" y="5" width="15" height="14" rx="2" />
          </svg>
          <svg v-else class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2">
            <polyline points="4 7 4 4 20 4 20 7" />
            <line x1="9" y1="20" x2="15" y2="20" />
            <line x1="12" y1="4" x2="12" y2="20" />
          </svg>
        </slot>
        <slot name="title-label">
          <!-- 节点名称：从 data.label 或 nodeType 自动生成 -->
          <span class="truncate">{{ nodeLabel }}</span>
        </slot>
        <slot name="title-extra">
          <!-- 额外信息：如图片/视频原始分辨率 "1920×1080" -->
          <span v-if="nodeExtra" class="text-gray-400 shrink-0 ml-auto">{{ nodeExtra }}</span>
        </slot>
      </div>
    </slot>

    <!-- 卡片主体：响应式尺寸，支持连接悬停 3D 倾斜反馈 -->
    <div class="custom-node-card relative flex items-center justify-center overflow-visible"
      :class="{ 'is-connecting-hover': showConnectFeedback }" :style="{
        width: cardWidth + 'px',
        height: cardHeight + 'px',
        transform: cardTransform,
      }" @mousemove="updateCardMousePosition">

      <!-- Debug：目标吸附区域可视化（仅连接中 + debug 模式可见） -->
      <template v-if="shouldShowTargetZones && debugHandle">
        <div class="target-feedback-zone target-feedback-zone--body" />
        <div class="target-snap-zone" :style="{
          width: `${canvas.state.handleRadius * (canvas.state.connectionSnapOuterRatio + canvas.state.connectionSnapInnerRatio)}px`,
          height: `${canvas.state.handleRadius * canvas.state.connectionSnapHeightRatio}px`,
          left: `${-canvas.state.handleRadius * canvas.state.connectionSnapOuterRatio}px`,
          top: `calc(50% - ${canvas.state.handleRadius * canvas.state.connectionSnapHeightRatio / 2}px)`,
        }" />
      </template>

      <!-- 左侧连接点（target handle）：悬停/选中时显示，用于接收连线 -->
      <MovingHandle v-if="targetPosition" id="target" type="target" :position="Position.Left"
        :visible="shouldShowHandles" :disabled="isCurrentConnectingNode" :radius="canvas.state.handleRadius"
        :rest-offset="canvas.state.handleRestOffset" :cursor-gap="canvas.state.handleCursorGap"
        :button-size="canvas.state.handleButtonSize" :overlap="canvas.state.handleOverlap" :node-size="cardWidth"
        :debug="debugHandle" @hover="isHovered = $event" />

      <!-- 背景与边框裁剪层：overflow hidden 确保不溢出卡片圆角 -->
      <div class="custom-node-content-clip">
        <!-- 卡片背景层：z-index: -1，位于内容下方 -->
        <div class="custom-node-frame" :class="selected ? 'is-selected' : 'is-idle'" />

        <div class="custom-node-content-clip">
          <!-- 节点内容：不受 counter-scale 影响，自然跟随画布缩放 -->
          <slot name="content">
            <!-- 默认占位：空图片图标 -->
            <svg class="w-12 h-12 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none" />
              <path d="M21 15l-5-5L5 21" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </slot>
        </div>

        <div class="custom-node-content-clip pointer-events-none" :style="cardFrameStyle">
          <!-- 边框叠加层：z-index: 1，选中环 / idle 边框 / hover 阴影 -->
          <div class="custom-node-border-layer" :class="selected ? 'is-selected' : 'is-idle'" />
        </div>

      </div>

      <!-- Resize 拖拽句柄：右下角对角线图标，pointer 事件控制节点尺寸 -->
      <div v-if="resizable" class="resize-handle" :class="{ 'is-resizing': isResizing }"
        @pointerdown="onResizePointerDown" @pointermove="onResizePointerMove" @pointerup="onResizePointerUp">
        <svg viewBox="0 0 8 8" fill="none" class="resize-handle-icon">
          <path d="M7 1L1 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
          <path d="M7 5L5 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
        </svg>
      </div>

      <!-- 右侧连接点（source handle）：悬停/选中时显示，用于拖出连线 -->
      <MovingHandle v-if="sourcePosition" id="source" type="source" :position="Position.Right"
        :visible="shouldShowHandles" :disabled="isCurrentConnectingNode" :radius="canvas.state.handleRadius"
        :rest-offset="canvas.state.handleRestOffset" :cursor-gap="canvas.state.handleCursorGap"
        :button-size="canvas.state.handleButtonSize" :overlap="canvas.state.handleOverlap" :node-size="cardWidth"
        :debug="debugHandle" @hover="isHovered = $event" />
    </div>

    <!-- 底部工具栏（各节点类型自定义，如文本编辑、格式控制等） -->
    <slot name="bottom-toolbar" />
  </div>
</template>

<style scoped>
/* 注册可动画的 length 类型自定义属性，使 border-width 的 transition 生效 */
@property --anim-border-width {
  syntax: '<length>';
  inherits: false;
  initial-value: 1px;
}

.custom-node-card {
  transform-origin: center;
  transition: transform 90ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.custom-node-content-clip {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.custom-node-frame {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  box-sizing: border-box;
  background: var(--canvas-node-surface);
  border-radius: inherit;
  will-change: filter;
}

/* 边框叠加层：使用真实 border + @property 注册的可动画自定义属性 */
.custom-node-border-layer {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  box-sizing: border-box;
  border-radius: inherit;
  border-style: solid;
  --anim-border-width: var(--node-base-ring-width, 1px);
  border-width: var(--anim-border-width);
  border-color: var(--canvas-node-border);
  transition:
    --anim-border-width 240ms cubic-bezier(0.2, 0.8, 0.2, 1),
    border-color 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

/* idle 状态 */
.custom-node-border-layer.is-idle {
  --anim-border-width: var(--node-base-ring-width, 1px);
  border-color: var(--canvas-node-border);
}

/* selected 状态：加粗边框，@property 使 --anim-border-width 平滑过渡 */
.custom-node-border-layer.is-selected {
  --anim-border-width: calc(var(--node-base-ring-width, 1px) + var(--node-selected-ring-width, 2px));
  border-color: var(--canvas-node-border-selected);
}

/* connecting-hover 状态：高亮边框色 + 外部投影（仅用于发光效果） */
.custom-node-card.is-connecting-hover .custom-node-frame {
  filter: blur(0.8px);
  transition: filter 80ms ease;
}

.custom-node-card.is-connecting-hover .custom-node-border-layer {
  border-color: var(--canvas-node-border-selected);
  box-shadow:
    0 24px 54px var(--canvas-node-shadow-strong),
    0 10px 26px var(--canvas-node-shadow-soft);
  transition: border-color 120ms ease, box-shadow 120ms ease;
}

.target-feedback-zone,
.target-snap-zone {
  position: absolute;
  pointer-events: none;
}

.target-feedback-zone--body {
  inset: 0;
  z-index: 20;
  border-radius: 1rem;
  background: var(--canvas-node-target-zone-surface);
  border: 2px solid var(--canvas-node-target-zone-border);
}

.target-snap-zone {
  z-index: 24;
  border: 2px solid var(--canvas-node-snap-zone-border);
  background: var(--canvas-node-snap-zone-surface);
  box-shadow:
    inset 0 0 0 1px var(--canvas-node-snap-zone-highlight),
    0 0 4px var(--canvas-node-snap-zone-shadow);
}

/* ============ Resize 拖拽句柄 ============ */

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
.custom-node-root.is-hovered .resize-handle,
.custom-node-root.is-selected .resize-handle {
  opacity: 0.85;
}

.resize-handle-icon {
  width: 8px;
  height: 8px;
  color: var(--canvas-node-resize-handle);
  pointer-events: none;
}

.resize-handle:not(.is-resizing):hover .resize-handle-icon,
.custom-node-root.is-hovered .resize-handle .resize-handle-icon,
.custom-node-root.is-selected .resize-handle .resize-handle-icon {
  color: var(--canvas-node-resize-handle-active);
}
</style>
