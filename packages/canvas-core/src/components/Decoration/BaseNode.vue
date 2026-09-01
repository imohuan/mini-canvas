<script setup lang="ts">
import { Position, useVueFlow } from '@vue-flow/core'
import type { NodeProps, GraphNode } from '@vue-flow/core'
import { computed, ref, shallowRef, watch, onUnmounted } from 'vue'
import MovingHandle from './MovingHandle.vue'
import BaseTitle from './BaseTitle.vue'
import { useCanvasStore } from '../../composables/useCanvasStore'
import { useCanvasRuntime } from '../../runtime/useCanvasRuntime'
import { createNodeTitleLocalLayout, clamp } from '../../utils/viewportSpace'
import { CONNECT_FEEDBACK } from '../../utils/constants'

const props = defineProps<NodeProps & {
  cardWidth?: number
  cardHeight?: number
}>()

const canvas = useCanvasStore()
const vf = useVueFlow()
const runtime = useCanvasRuntime()

/** 节点类型定义（含 titleIcon） */
const nodeDef = computed(() => {
  const nodeType = props.data?.nodeType as string | undefined
  if (!nodeType) return null
  return runtime.nodeRegistry.get(nodeType)
})

/**
 * 输入端口（左侧 target handle）是否显示。
 * 优先用节点数据里显式设置的 targetPosition；未设置时根据节点类型定义
 * （canReceiveInput）动态决定——端口由“节点类型是否有输入能力”决定，
 * 而不是由创建节点时附带的数据决定。
 */
const showTargetHandle = computed(() =>
  props.targetPosition !== undefined ? Boolean(props.targetPosition) : (nodeDef.value?.canReceiveInput ?? true)
)

/** 输出端口（右侧 source handle）是否显示。逻辑同 showTargetHandle。 */
const showSourceHandle = computed(() =>
  props.sourcePosition !== undefined ? Boolean(props.sourcePosition) : (nodeDef.value?.canProduceOutput ?? true)
)

/**
 * 画布当前的缩放比例。
 * 所有节点的"反向缩放"（counter-scale）都依赖这个值。
 * 最小保证 0.01，防止除零或负缩放导致节点消失。
 */
const zoom = computed(() => Math.max(vf.viewport.value.zoom || 1, 0.01))

const titleLayout = computed(() => createNodeTitleLocalLayout(zoom.value, {
  offset: canvas.state.core.nodeTitleOffset,
  minZoom: canvas.state.core.nodeTitleScaleMinZoom,
}))

/**
 * 低细节模式（LOD）：缩放低于阈值时整体简化节点渲染，减少缩放/平移时的重绘成本。
 * 关闭 3D 连接反馈、隐藏连接点/工具栏、去掉卡片阴影过渡，让浏览器只做纯 transform 合成。
 */
const lowDetail = computed(() => zoom.value < (canvas.state.core.nodeLodLowDetailZoom ?? 0.4))

const titleOffset = computed(() => titleLayout.value.offset)
const cardBorderCompensation = computed(() => Math.max(1 / zoom.value, 1))
// 标题在画布坐标系下的 DOM 宽度。设计意图：让标题反缩放后屏幕宽度 == 卡片屏幕宽度。
// 推导：标题屏幕宽 = (DOM 宽 * zoom) / max(zoom, minZoom) = 卡片屏幕宽 = cardWidth * zoom
// 解得 DOM 宽 = cardWidth * max(zoom, minZoom)。
const titleMinZoom = computed(() => canvas.state.core.nodeTitleScaleMinZoom || 0.5)
const titleCanvasWidth = computed(() => cardWidth.value * Math.max(zoom.value, titleMinZoom.value))
const titlePositionStyle = computed(() => ({
  ...titleLayout.value.style,
  left: `${-cardBorderCompensation.value}px`,
  bottom: `calc(100% + ${titleOffset.value + cardBorderCompensation.value}px)`,
  width: `${titleCanvasWidth.value}px`,
}))

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
  !lowDetail.value &&
  !canvas.connectionState.suppressHandles &&
  !isCurrentConnectingNode.value &&
  (isHovered.value || props.selected)
)

/** 当前节点在连接状态机中的悬停反馈。区别于鼠标物理 hover。 */
const connectionHover = computed(() =>
  canvas.isConnecting && canvas.connectionState.hoverNode?.nodeId === props.id
    ? canvas.connectionState.hoverNode
    : null
)

const isConnectionSnapHovered = computed(() => connectionHover.value?.zone === 'snap')
const isConnectionBodyHovered = computed(() => connectionHover.value?.zone === 'body')
const isConnectionValidTarget = computed(() => connectionHover.value?.status === 'valid')
const isConnectionInvalidTarget = computed(() => connectionHover.value?.status === 'invalid')

/**
 * 是否显示"可连接"反馈效果（3D 倾斜 + 高亮边框 + 光晕）。
 * 条件：正在拖线、不是拖线起点、不是禁止连接节点、
 * 且鼠标悬停在此节点上或此节点是当前反馈目标。
 */
const showConnectFeedback = computed(() =>
  canvas.isConnecting &&
  canvas.connectionState.activeConnection?.sourceNodeId !== props.id &&
  !isConnectionInvalidTarget.value &&
  !lowDetail.value &&
  (isHovered.value || isConnectionValidTarget.value)
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
  showTargetHandle.value
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
  showTargetHandle.value &&
  (canvas.state.core.connectionSnapDebugVisible || showTargetZones.value)
)

/**
 * 卡片 3D 倾斜变换 CSS 字符串。
 * 当有合法连接反馈时，根据鼠标位置计算旋转角度，产生"卡片跟着鼠标翘"的效果。
 * 如果是禁止连接状态，不应用任何变换（只用模糊效果）。
 */
const cardTransform = computed(() => {
  if (isConnectionInvalidTarget.value) return ''
  if (!showConnectFeedback.value) return ''
  const p = feedbackMousePosition.value
  const rotateX = (p.y - 0.5) * CONNECT_FEEDBACK.rotateX
  const rotateY = (p.x - 0.5) * -CONNECT_FEEDBACK.rotateY
  return `perspective(${CONNECT_FEEDBACK.perspective}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(10px) scale(${CONNECT_FEEDBACK.scale})`
})

/**
 * 卡片行内样式：尺寸 + 3D 倾斜 + 边框（counter-scale）。
 * 选中环用 outline 叠加在 border 外侧，不参与盒模型。
 * 用 shallowRef + watch 稳定引用，避免每次 computed 返回新对象触发不必要重绘。
 */
/**
 * 是否显示选中边框。
 * 进入特殊模式（裁剪/扩展等 _overlay 存在时）隐藏选中环，避免干扰。
 */
const showSelectionOutline = computed(() =>
  props.selected && !props.data?._overlay
)

/**
 * 卡片行内样式：尺寸 + 3D 倾斜 + 边框（counter-scale）。
 * 选中环用 outline 叠加在 border 外侧，不参与盒模型。
 * 用 shallowRef + watch 稳定引用，避免每次 computed 返回新对象触发不必要重绘。
 */
const cardInlineStyle = shallowRef<Record<string, string>>({
  width: cardWidth.value + 'px',
  height: cardHeight.value + 'px',
  transform: cardTransform.value,
  borderWidth: `${1 / zoom.value}px`,
  borderRadius: '8px',
  '--card-outline-width': showSelectionOutline.value ? `${2 / zoom.value}px` : '0px',
})
watch(
  () => ({
    w: cardWidth.value,
    h: cardHeight.value,
    t: cardTransform.value,
    z: zoom.value,
    sel: showSelectionOutline.value,
  }),
  ({ w, h, t, z, sel }) => {
    cardInlineStyle.value = {
      width: w + 'px',
      height: h + 'px',
      transform: t,
      borderWidth: `${1 / z}px`,
      borderRadius: '8px',
      '--card-outline-width': sel ? `${2 / z}px` : '0px',
    }
  },
)

/**
 * "无法连接"提示气泡在卡片内的相对位置（0~1 归一化）。
 * 无法连接提示气泡在卡片内的相对位置（0~1 归一化）。
 * 根据拖线时鼠标在画布中的位置，换算成节点内部的百分比坐标。
 * 气泡会跟随鼠标大致位置显示，但限制在卡片内部 6%~94% 范围内不会跑出边界。
 */
const invalidFeedbackPosition = computed(() => {
  const point = canvas.connectionState.hoverNode?.status === 'invalid'
    ? canvas.connectionState.hoverNode.flowPosition
    : null
  if (!isConnectionInvalidTarget.value || !point) return { x: 0.08, y: 0.5 }

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

</script>

<template>
  <!-- 节点根元素：relative 定位容器，绑定选中/悬停状态，控制 handles 显示/隐藏 -->
  <div class="custom-node-root relative" :class="{
    'is-selected': showSelectionOutline,
    'is-pointer-hovered': isHovered,
    'is-connection-hovered': Boolean(connectionHover),
    'is-connection-snap-hovered': isConnectionSnapHovered,
    'is-connection-body-hovered': isConnectionBodyHovered,
    'is-connection-valid': isConnectionValidTarget,
    'is-connection-invalid': isConnectionInvalidTarget,
  }" @mouseenter="isHovered = true"
    @mouseleave="isHovered = false; if (!canvas.isConnecting) canvas.connectionState.suppressHandles = false">
    <!-- 顶部工具栏（各节点类型自定义，如图片裁剪、视频控制等） -->
    <slot name="top-toolbar" />

    <!-- 卡片主体：响应式尺寸，支持连接悬停 3D 倾斜反馈 -->
    <div class="custom-node-card relative flex items-center justify-center overflow-visible"
      :class="{ 'is-connecting-hover': showConnectFeedback, 'is-connection-invalid': isConnectionInvalidTarget, 'is-low-detail': lowDetail }"
      :style="cardInlineStyle" @mousemove="updateCardMousePosition">

      <!-- 标题放在卡片内部，继承卡片 3D transform；反向缩放保持原来的屏幕尺寸。 -->
      <div class="custom-node-title select-none nodrag nopan " :style="titlePositionStyle"
        @mouseenter="isHovered = false" @mouseleave="isHovered = true" @mousemove.stop @pointerdown.stop @pointerup.stop
        @click.stop @dblclick.stop>
        <slot name="title">
          <BaseTitle :title-icon="nodeDef?.titleIcon" :label="nodeLabel">
            <template v-if="$slots['title-icon']" #title-icon>
              <slot name="title-icon" />
            </template>
            <template #title-label>
              <slot name="title-label">
                <!-- 节点名称：从 data.label 或 nodeType 自动生成 -->
                <span class="truncate">{{ nodeLabel }}</span>
              </slot>
            </template>
            <template #title-extra>
              <slot name="title-extra" />
            </template>
          </BaseTitle>
        </slot>
      </div>

      <div v-if="isConnectionInvalidTarget" class="invalid-connection-tooltip" :style="invalidTooltipStyle">
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
      <MovingHandle v-if="showTargetHandle" id="target" type="target" :position="Position.Left"
        :visible="shouldShowHandles" :disabled="isCurrentConnectingNode" :radius="canvas.state.core.handleRadius"
        :rest-offset="canvas.state.core.handleRestOffset" :cursor-gap="canvas.state.core.handleCursorGap"
        :button-size="canvas.state.core.handleButtonSize" :overlap="canvas.state.core.handleOverlap"
        :node-size="cardWidth" :debug="debugHandle" @hover="isHovered = $event" />

      <!-- 内容裁剪层：overflow hidden 确保不溢出卡片圆角 -->
      <div class="custom-node-content-clip">
        <slot name="content">
          <svg class="w-12 h-12 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none" />
            <path d="M21 15l-5-5L5 21" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </slot>
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
      <MovingHandle v-if="showSourceHandle" id="source" type="source" :position="Position.Right"
        :visible="shouldShowHandles" :disabled="isCurrentConnectingNode" :radius="canvas.state.core.handleRadius"
        :rest-offset="canvas.state.core.handleRestOffset" :cursor-gap="canvas.state.core.handleCursorGap"
        :button-size="canvas.state.core.handleButtonSize" :overlap="canvas.state.core.handleOverlap"
        :node-size="cardWidth" :debug="debugHandle" @hover="isHovered = $event" />
    </div>

    <!-- 底部工具栏（各节点类型自定义，如文本编辑、格式控制等） -->
    <slot name="bottom-toolbar" />
  </div>
</template>

<style scoped>
.custom-node-card {
  transform-origin: center;
  box-sizing: border-box;
  border-style: solid;
  border-color: var(--canvas-node-border);
  background: var(--canvas-node-surface);
  transition:
    border-color 240ms cubic-bezier(0.2, 0.8, 0.2, 1),
    box-shadow 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

/* 低细节（缩略）模式：去掉阴影/过渡，避免缩放、平移时对每张卡片做昂贵重绘 */
.custom-node-card.is-low-detail {
  transition: none;
  box-shadow: none !important;
}

.custom-node-title {
  position: absolute;
  z-index: 1;
  display: flex;
}

/* selected — outline 叠加在 border 外侧，不挤压内容 */
.custom-node-root.is-selected .custom-node-card {
  border-color: var(--canvas-node-border-selected);
  /* outline: var(--card-outline-width) solid var(--canvas-node-border-selected);
  outline-offset: 0; */
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

/* connecting-hover — 仅切换边框颜色，不添加 outline/box-shadow */
.custom-node-card.is-connecting-hover {
  border-color: var(--canvas-node-border-selected);
}

.custom-node-card.is-connection-invalid {
  border-color: rgba(156, 163, 175, 0.45);
}

.custom-node-card.is-connection-invalid::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 25;
  border-radius: inherit;
  background: rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(1.5px);
  pointer-events: none;
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
.custom-node-root.is-pointer-hovered .resize-handle,
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
.custom-node-root.is-pointer-hovered .resize-handle .resize-handle-icon,
.custom-node-root.is-selected .resize-handle .resize-handle-icon {
  color: var(--canvas-node-resize-handle-active);
}
</style>
