<script setup lang="ts">
import { Position, useVueFlow } from '@vue-flow/core'
import type { NodeProps, GraphNode } from '@vue-flow/core'
import { computed, ref, watch, onUnmounted } from 'vue'
import MovingHandle from './MovingHandle.vue'
import { useCanvasStore } from '../../composables/useCanvasStore'
import { createCappedStyle } from '../../utils/viewportSpace'

const props = defineProps<NodeProps & {
  cardWidth?: number
  cardHeight?: number
}>()

const canvas = useCanvasStore()
const vf = useVueFlow()

/**
 * 画布当前的缩放比例。
 * 所有节点的"反向缩放"（counter-scale）都依赖这个值。
 * 最小保证 0.01，防止除零或负缩放导致节点消失。
 */
const zoom = computed(() => Math.max(vf.viewport.value.zoom || 1, 0.01))

/**
 * 卡片外框的"反向缩放"样式。
 * 画布缩小时节点视觉会变小，这里通过 scale(1/zoom) 把卡片内部元素撑回原大小。
 * 同时把圆角和选中环的粗细也按 zoom 缩放，保证不管画布怎么缩放，外观一致。
 */
const cardFrameStyle = computed(() => ({
  width: `${zoom.value * 100}%`,
  height: `${zoom.value * 100}%`,
  borderRadius: `${8 * zoom.value}px`,
  '--node-base-ring-width': `${1 * zoom.value}px`,
  '--node-selected-ring-width': `${2 * zoom.value}px`,
  transform: `scale(${1 / zoom.value}) translateZ(0)`,
  transformOrigin: 'top left',
}))

/**
 * 标题栏的缩放跟随样式。
 * 标题放在卡片上方绝对定位，zoom 变化时通过 createCappedStyle
 * 同时调整文字大小和上移距离，避免标题和卡片重叠或离太远。
 * zoom=1 时封顶，不再继续放大。
 */
const titleTransformStyle = computed(() => createCappedStyle(zoom.value, { topOffset: -20 }))

/**
 * 卡片实际宽度（响应式 ref）。
 * 初始值来自 data.cardWidth 或 prop.cardWidth，默认 256。
 * 拖拽 resize 时会实时更新，外部修改 data.cardWidth 也会同步进来。
 */
const cardWidth = ref((props.data?.cardWidth as number) || props.cardWidth || 256)

/**
 * 卡片实际高度（响应式 ref）。
 * 逻辑同上，初始值来自 data.cardHeight 或 prop.cardHeight，默认 256。
 */
const cardHeight = ref((props.data?.cardHeight as number) || props.cardHeight || 256)

/**
 * 监听外部对 data.cardWidth 的修改（比如设置面板改了尺寸），同步到本地 ref。
 * 如果当前正在拖拽 resize，则跳过同步，防止冲突。
 */
watch(() => props.data?.cardWidth, (w) => {
  if (w !== undefined && !isResizing.value) cardWidth.value = w as number
})

/**
 * 监听外部对 data.cardHeight 的修改，同步到本地 ref。逻辑同上。
 */
watch(() => props.data?.cardHeight, (h) => {
  if (h !== undefined && !isResizing.value) cardHeight.value = h as number
})

/**
 * 是否允许拖拽 resize。
 * 默认关闭，只有节点的 data.resizable 设为 true 时，右下角才出现拖拽句柄。
 */
const resizable = computed(() => props.data?.resizable === true)

// ============ Resize 拖拽逻辑 ============

/** 是否正在拖拽 resize */
const isResizing = ref(false)

/** resize 时卡片的最小宽度 */
const MIN_WIDTH = 120

/** resize 时卡片的最小高度 */
const MIN_HEIGHT = 80

/** resize 拖拽的快照状态：记录起点坐标和初始尺寸，用于计算 delta */
interface ResizeState {
  /** 拖拽起点屏幕坐标 x（clientX） */
  startScreenX: number
  /** 拖拽起点屏幕坐标 y（clientY） */
  startScreenY: number
  startWidth: number
  startHeight: number
}

const resizeState = ref<ResizeState | null>(null)

/**
 * resize 拖拽开始：记录起点位置和当前尺寸，并捕获指针事件。
 * 只在 resizable 为 true 时生效。
 */
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

/**
 * resize 拖拽移动：根据鼠标位移计算新的卡片宽高。
 * 屏幕像素差需要除以当前 zoom 换算成 CSS 像素变化。
 */
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

/**
 * resize 拖拽结束：释放指针捕获，并把最终尺寸写回节点 data。
 * 这样尺寸会被持久化，下次加载画布时能恢复。
 */
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

/** 鼠标是否悬停在此节点上 */
const isHovered = ref(false)

/**
 * 鼠标在节点卡片内的相对位置（0~1 归一化）。
 * 用于连接反馈时的 3D 倾斜效果：鼠标在哪边，卡片就往那边翘。
 */
const mousePosition = ref({ x: 0.5, y: 0.5 })

/**
 * 是否显示 debug 辅助线。
 * 由画布全局 debug 开关或节点自身的 debugHandle / debugHandles 数据控制。
 */
const debugHandle = computed(() => Boolean(canvas.state.core.handleDebug || props.data?.debugHandle || props.data?.debugHandles))
/**
 * 当前节点是否是正在拖线的起点。
 * 如果是，则隐藏自己的端口按钮，避免拖线时端口还在显示干扰操作。
 */
const isCurrentConnectingNode = computed(() =>
  canvas.isConnecting &&
  canvas.connectionState.activeConnection?.sourceNodeId === props.id
)

/**
 * 是否显示端口按钮（左侧输入/右侧输出的小圆球）。
 * 条件：未被抑制 && 不是拖线起点 && （鼠标悬停 或 节点被选中）。
 */
const shouldShowHandles = computed(() =>
  !canvas.connectionState.suppressHandles &&
  !isCurrentConnectingNode.value &&
  (isHovered.value || props.selected)
)

/**
 * 是否显示"可连接"反馈效果（3D 倾斜 + 高亮边框 + 光晕）。
 * 条件：正在拖线、不是拖线起点、不是禁止连接节点、
 * 且鼠标悬停在此节点上或此节点是当前反馈目标。
 */
const showConnectFeedback = computed(() =>
  canvas.isConnecting &&
  canvas.connectionState.activeConnection?.sourceNodeId !== props.id &&
  !isInvalidConnectionTarget.value &&
  (
    isHovered.value ||
    (canvas.connectionState.hoverNode?.nodeId === props.id &&
     canvas.connectionState.hoverNode?.status === 'valid')
  )
)

/**
 * 当前节点是否被标记为"禁止连接"。
 * 触发条件：拖线时鼠标落在某个节点上，但连接会被拦截（重复/循环/方向不对等）。
 * 此时节点会显示模糊禁用效果 + "无法连接"提示气泡。
 */
const isInvalidConnectionTarget = computed(() =>
  canvas.isConnecting &&
  canvas.connectionState.hoverNode?.nodeId === props.id &&
  canvas.connectionState.hoverNode?.status === 'invalid'
)

/**
 * 是否显示目标吸附区域（debug 模式下的黄色矩形 + 绿色节点主体）。
 * 仅在拖线中且当前节点有输入端口时显示。
 */
/**
 * 是否显示目标吸附区域（debug 模式下的黄色矩形 + 绿色节点主体）。
 * 仅在拖线中且当前节点有输入端口时显示。
 */
const showTargetZones = computed(() =>
  canvas.isConnecting &&
  canvas.connectionState.activeConnection?.sourceNodeId !== props.id &&
  Boolean(props.targetPosition)
)

/**
 * 是否显示目标吸附区域的 debug 可视化。
 * 需要同时满足：节点有输入端口 && (debug 开关打开 或 正在拖线)。
 */
/**
 * 是否显示目标吸附区域的 debug 可视化。
 * 需要同时满足：节点有输入端口 && (debug 开关打开 或 正在拖线)。
 */
const shouldShowTargetZones = computed(() =>
  Boolean(props.targetPosition) &&
  (canvas.state.core.connectionSnapDebugVisible || showTargetZones.value)
)

/** 3D 倾斜效果：绕 X 轴旋转的最大角度（度） */
const CONNECT_FEEDBACK_ROTATE_X = 18
/** 3D 倾斜效果：绕 Y 轴旋转的最大角度（度） */
const CONNECT_FEEDBACK_ROTATE_Y = 18
/** 3D 倾斜效果：透视距离（px），值越小倾斜感越强 */
const CONNECT_FEEDBACK_PERSPECTIVE = 800
/** 3D 倾斜效果：hover 时卡片微微放大，增强浮起感 */
const CONNECT_FEEDBACK_SCALE = 1.018

/**
 * 卡片 3D 倾斜变换 CSS 字符串。
 * 当有合法连接反馈时，根据鼠标位置计算旋转角度，产生"卡片跟着鼠标翘"的效果。
 * 如果是禁止连接状态，不应用任何变换（只用模糊效果）。
 */
/**
 * 卡片 3D 倾斜变换 CSS 字符串。
 * 当有合法连接反馈时，根据鼠标位置计算旋转角度，产生卡片跟着鼠标翘的效果。
 * 如果是禁止连接状态，不应用任何变换（只用模糊效果）。
 */
const cardTransform = computed(() => {
  if (isInvalidConnectionTarget.value) return ''
  if (!showConnectFeedback.value) return ''
  const p = feedbackMousePosition.value
  const rotateX = (p.y - 0.5) * CONNECT_FEEDBACK_ROTATE_X
  const rotateY = (p.x - 0.5) * -CONNECT_FEEDBACK_ROTATE_Y
  return `perspective(${CONNECT_FEEDBACK_PERSPECTIVE}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(10px) scale(${CONNECT_FEEDBACK_SCALE})`
})

/**
 * "无法连接"提示气泡在卡片内的相对位置（0~1 归一化）。
 * 根据拖线时鼠标在画布中的位置，换算成节点内部的百分比坐标。
 * 气泡会跟随鼠标大致位置显示，但限制在卡片内部 6%~94% 范围内不会跑出边界。
 */
/**
 * 无法连接提示气泡在卡片内的相对位置（0~1 归一化）。
 * 根据拖线时鼠标在画布中的位置，换算成节点内部的百分比坐标。
 * 气泡会跟随鼠标大致位置显示，但限制在卡片内部 6%~94% 范围内不会跑出边界。
 */
const invalidFeedbackPosition = computed(() => {
  const point = canvas.connectionState.hoverNode?.status === 'invalid'
    ? canvas.connectionState.hoverNode.flowPosition
    : null
  if (!isInvalidConnectionTarget.value || !point) return { x: 0.08, y: 0.5 }

  const node = (vf.getNodes.value as GraphNode[]).find((item) => item.id === props.id)
  const position = node?.computedPosition || node?.position
  if (!position) return { x: 0.08, y: 0.5 }

  const w = cardWidth.value || node?.dimensions?.width || 256
  const h = cardHeight.value || node?.dimensions?.height || 256

  return {
    x: clamp((point.x - position.x) / w, 0.06, 0.94),
    y: clamp((point.y - position.y) / h, 0.08, 0.92),
  }
})

/**
 * "无法连接"提示气泡的 CSS 定位样式。
 * 使用 left/top 百分比定位，配合 transform: translate(-50%, -50%) 居中。
 */
/**
 * 无法连接提示气泡的 CSS 定位样式。
 * 使用 left/top 百分比定位，配合 transform: translate(-50%, -50%) 居中。
 */
const invalidTooltipStyle = computed(() => ({
  left: `${invalidFeedbackPosition.value.x * 100}%`,
  top: `${invalidFeedbackPosition.value.y * 100}%`,
}))

/**
 * 连接反馈时，鼠标在卡片内的相对位置（0~1 归一化）。
 * 用于驱动 3D 倾斜效果：卡片会朝鼠标位置微微翘起。
 * 只在当前节点是反馈目标时计算，否则返回默认的鼠标位置（卡片中心）。
 */
/**
 * 连接反馈时，鼠标在卡片内的相对位置（0~1 归一化）。
 * 用于驱动 3D 倾斜效果：卡片会朝鼠标位置微微翘起。
 * 只在当前节点是反馈目标时计算，否则返回默认的鼠标位置（卡片中心）。
 */
const feedbackMousePosition = computed(() => {
  const point = canvas.connectionState.hoverNode?.status === 'valid'
    ? canvas.connectionState.hoverNode.flowPosition
    : null
  if (canvas.connectionState.hoverNode?.nodeId !== props.id || !point) {
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

/**
 * 数值限制工具函数：把 value 夹在 min 和 max 之间。
 * 用于确保鼠标相对位置不会超出 0~1 范围。
 */
/**
 * 数值限制工具函数：把 value 夹在 min 和 max 之间。
 * 用于确保鼠标相对位置不会超出 0~1 范围。
 */
function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/**
 * 鼠标在卡片上移动时更新相对位置。
 * 只在有连接反馈或 debug 模式时才计算，避免不必要的性能开销。
 * 计算方式：(鼠标坐标 - 卡片左上角) / 卡片尺寸，结果归一化到 0~1。
 */
/**
 * 鼠标在卡片上移动时更新相对位置。
 * 只在有连接反馈或 debug 模式时才计算，避免不必要的性能开销。
 * 计算方式：(鼠标坐标 - 卡片左上角) / 卡片尺寸，结果归一化到 0~1。
 */
function updateCardMousePosition(event: MouseEvent) {
  if (!showConnectFeedback.value && !debugHandle.value) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  mousePosition.value = {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  }
}

// ============ 标题栏信息 ============

/**
 * 节点显示的标题文字。
 * 优先级：data.label > data.nodeType > 默认"节点"。
 */
/**
 * 节点显示的标题文字。
 * 优先级：data.label > data.nodeType > 默认节点。
 */
const nodeLabel = computed(() => {
  const label = props.data?.label as string | undefined
  const nt = props.data?.nodeType as string | undefined
  return label || nt || '节点'
})

/**
 * 节点标题栏的额外信息。
 * 目前用于显示图片/视频的原始分辨率，如 "1920×1080"。
 * 如果节点不是图片/视频类型，返回空字符串。
 */
/**
 * 节点标题栏的额外信息。
 * 目前用于显示图片/视频的原始分辨率，如 1920×1080。
 * 如果节点不是图片/视频类型，返回空字符串。
 */
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
    @mouseleave="isHovered = false; if (!canvas.isConnecting) canvas.connectionState.suppressHandles = false">
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
      :class="{ 'is-connecting-hover': showConnectFeedback, 'is-connection-invalid': isInvalidConnectionTarget }" :style="{
        width: cardWidth + 'px',
        height: cardHeight + 'px',
        transform: cardTransform,
      }" @mousemove="updateCardMousePosition">

      <div
        v-if="isInvalidConnectionTarget"
        class="invalid-connection-tooltip"
        :style="invalidTooltipStyle"
      >
        {{ canvas.connectionState.hoverNode?.message || '无法连接' }}
      </div>

      <!-- Debug：目标吸附区域可视化（仅连接中 + debug 模式可见） -->
      <template v-if="shouldShowTargetZones && debugHandle">
        <div class="target-feedback-zone target-feedback-zone--body" />
        <div class="target-snap-zone" :style="{
          width: `${canvas.state.core.handleRadius * (canvas.state.core.connectionSnapOuterRatio + canvas.state.core.connectionSnapInnerRatio)}px`,
          height: `${canvas.state.core.handleRadius * canvas.state.core.connectionSnapHeightRatio}px`,
          left: `${-canvas.state.core.handleRadius * canvas.state.core.connectionSnapOuterRatio}px`,
          top: `calc(50% - ${canvas.state.core.handleRadius * canvas.state.core.connectionSnapHeightRatio / 2}px)`,
        }" />
      </template>

      <!-- 左侧连接点（target handle）：悬停/选中时显示，用于接收连线 -->
      <MovingHandle v-if="targetPosition" id="target" type="target" :position="Position.Left"
        :visible="shouldShowHandles" :disabled="isCurrentConnectingNode" :radius="canvas.state.core.handleRadius"
        :rest-offset="canvas.state.core.handleRestOffset" :cursor-gap="canvas.state.core.handleCursorGap"
        :button-size="canvas.state.core.handleButtonSize" :overlap="canvas.state.core.handleOverlap" :node-size="cardWidth"
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
        :visible="shouldShowHandles" :disabled="isCurrentConnectingNode" :radius="canvas.state.core.handleRadius"
        :rest-offset="canvas.state.core.handleRestOffset" :cursor-gap="canvas.state.core.handleCursorGap"
        :button-size="canvas.state.core.handleButtonSize" :overlap="canvas.state.core.handleOverlap" :node-size="cardWidth"
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

.custom-node-card.is-connection-invalid .custom-node-content-clip {
  filter: blur(4px) saturate(0.55) brightness(0.72);
  transition: filter 120ms ease;
}

.custom-node-card.is-connection-invalid .custom-node-border-layer {
  border-color: rgba(239, 68, 68, 0.78);
  box-shadow:
    0 0 0 2px rgba(239, 68, 68, 0.22),
    0 18px 44px rgba(0, 0, 0, 0.22);
}

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

