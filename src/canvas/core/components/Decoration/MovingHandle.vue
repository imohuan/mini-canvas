<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps<{
  id: string
  type: 'source' | 'target'
  position: Position
  visible?: boolean
  disabled?: boolean
  /** 半圆形可移动区域半径，单位 px */
  radius?: number
  /** 离开区域后，圆球回到节点外侧的默认偏移，单位 px */
  restOffset?: number
  /** 圆球跟随鼠标时，和鼠标错开的距离，避免被鼠标盖住 */
  cursorGap?: number
  /** 圆球尺寸，单位 px */
  buttonSize?: number
  /** 区域向节点内侧覆盖后被裁掉的宽度，单位 px */
  overlap?: number
  /** 展示模式：只复用端口外观，不注册 VueFlow 真实连接点 */
  preview?: boolean
  /** 调试模式：显示半圆区域、圆心、半径、默认点、鼠标点等辅助线 */
  debug?: boolean
}>()

const emit = defineEmits<{
  hover: [value: boolean]
  connectStart: [payload: { event: MouseEvent; type: 'source' | 'target' }]
}>()

const buttonX = ref(0)
const buttonY = ref(0)
const isMoving = ref(false)
const isRestoring = ref(false)
const keepVisible = ref(false)
const mouseX = ref(0)
const mouseY = ref(0)
let frameId = 0
let nextX = 0
let nextY = 0
let hideTimer: ReturnType<typeof setTimeout> | null = null
const restoreDuration = 180

const isSource = computed(() => props.type === 'source')
const direction = computed(() => (isSource.value ? 1 : -1))
const radius = computed(() => props.radius ?? 76)
const restOffset = computed(() => props.restOffset ?? 36)
const cursorGap = computed(() => props.cursorGap ?? 22)
const buttonSize = computed(() => props.buttonSize ?? 32)
const overlap = computed(() => props.overlap ?? buttonSize.value / 2)
const isShown = computed(() => !props.disabled && (props.visible || keepVisible.value))

// 连接拖拽会临时禁用源端口。这里必须同步清掉本地 hover 状态，
// 否则松开临时连接线后，端口按钮会因为残留的 keepVisible/父层 hover 再次显示。
watch(() => props.disabled, (disabled) => {
  if (disabled) {
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
    isMoving.value = false
    isRestoring.value = false
    keepVisible.value = false
    emit('hover', false)
    restorePosition()
    return
  }

  if (!props.visible) {
    keepVisible.value = false
    emit('hover', false)
  }
})

const zoneStyle = computed(() => ({
  width: `${radius.value}px`,
  height: `${radius.value}px`,
  '--moving-handle-overlap': `${overlap.value}px`,
  // top: `${-radius.value - buttonY .value}px`,
}))

const buttonStyle = computed(() => ({
  width: `${buttonSize.value}px`,
  height: `${buttonSize.value}px`,
  left: `${buttonX.value}px`,
  top: `${buttonY.value}px`,
  transform: `translate(-50%, -50%) scale(${isMoving.value ? 1.06 : 1})`,
}))

const debugArcPath = computed(() => {
  const r = radius.value
  const cy = r / 2
  return isSource.value
    ? `M 0 0 H ${cy} A ${cy} ${cy} 0 0 1 ${cy} ${r} H 0`
    : `M ${r} 0 H ${cy} A ${cy} ${cy} 0 0 0 ${cy} ${r} H ${r}`
})

const debugCenter = computed(() => ({
  x: isSource.value ? 0 : radius.value,
  y: radius.value / 2,
}))

const debugRestPoint = computed(() => ({
  x: isSource.value ? restOffset.value : radius.value - restOffset.value,
  y: radius.value / 2,
}))

const debugMousePoint = computed(() => ({
  x: isSource.value ? mouseX.value : radius.value - mouseX.value,
  y: radius.value / 2 + mouseY.value,
}))

const debugViewBox = computed(() => `0 0 ${radius.value} ${radius.value}`)

resetPosition()

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function resetPosition() {
  nextX = direction.value * (restOffset.value - overlap.value)
  nextY = 0
  mouseX.value = restOffset.value
  mouseY.value = 0
  buttonX.value = nextX
  buttonY.value = nextY
}

function restorePosition() {
  mouseX.value = restOffset.value
  mouseY.value = 0
  commitPosition(direction.value * (restOffset.value - overlap.value), 0)
}

function commitPosition(x: number, y: number) {
  nextX = x
  nextY = y

  if (frameId) return
  frameId = requestAnimationFrame(() => {
    buttonX.value = nextX
    buttonY.value = nextY
    frameId = 0
  })
}

function updatePosition(event: MouseEvent) {
  if (props.disabled) return
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }

  emit('hover', true)
  keepVisible.value = true
  isMoving.value = true
  isRestoring.value = false

  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const localX = rect.width > 0
    ? ((event.clientX - rect.left) / rect.width) * radius.value
    : 0
  const localY = rect.height > 0
    ? ((event.clientY - rect.top) / rect.height) * radius.value
    : radius.value / 2

  // 注意：这里必须用“区域本地坐标”，不能直接用屏幕 px。
  // VueFlow 缩放后 getBoundingClientRect() 是缩放后的尺寸，
  // 直接拿 radius(px) 和 clientX/clientY 混算会导致 debug mouse 点偏移。
  const outward = isSource.value ? localX : radius.value - localX
  const rawY = localY - radius.value / 2
  mouseX.value = clamp(outward, 0, radius.value)
  mouseY.value = clamp(rawY, -radius.value / 2, radius.value / 2)

  const maxDistance = radius.value - buttonSize.value / 2
  const mouseDistance = Math.hypot(mouseX.value, mouseY.value)
  const mouseAngle = Math.atan2(mouseY.value, mouseX.value || 0.0001)
  const followDistance = clamp(mouseDistance + cursorGap.value, 0, maxDistance)
  const ballX = Math.cos(mouseAngle) * followDistance
  const ballY = Math.sin(mouseAngle) * followDistance

  commitPosition(
    direction.value * (ballX - overlap.value),
    ballY,
  )
}

function handleLeave() {
  if (props.disabled) return
  isMoving.value = false
  isRestoring.value = true
  keepVisible.value = true
  if (frameId) {
    cancelAnimationFrame(frameId)
    frameId = 0
  }

  // 先从当前位置跟随连线方向快速归位，动画完成后再隐藏。
  restorePosition()

  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    keepVisible.value = false
    isRestoring.value = false
    emit('hover', false)
    hideTimer = null
  }, restoreDuration)
}

function handlePreviewMouseDown(event: MouseEvent) {
  if (!props.preview || props.disabled || event.button !== 0) return
  event.stopPropagation()
  event.preventDefault()
  emit('connectStart', { event, type: props.type })
}

onBeforeUnmount(() => {
  if (frameId) cancelAnimationFrame(frameId)
  if (hideTimer) clearTimeout(hideTimer)
})
</script>

<template>
  <component :is="preview ? 'span' : Handle" :id="id" :type="type" :position="position" class="moving-handle-anchor" :class="{
    'moving-handle-anchor--source': isSource,
    'moving-handle-anchor--target': !isSource,
    'is-visible': isShown,
    'is-moving': isMoving,
    'is-restoring': isRestoring,
    'is-disabled': disabled,
    'is-preview': preview,
  }">
    <span class="moving-handle-zone" :class="{
      'moving-handle-zone--source': isSource,
      'moving-handle-zone--target': !isSource,
      'is-debug': debug,
    }" :style="zoneStyle" @mouseenter="if (!disabled) { keepVisible = true; emit('hover', true) }"
      @mouseleave="handleLeave" @mousemove="updatePosition">
      <svg v-if="debug" class="moving-handle-debug" :viewBox="debugViewBox" preserveAspectRatio="none">
        <!-- 半圆边界 -->
        <path class="moving-handle-debug__arc" :d="debugArcPath" />

        <!-- 圆心 -->
        <circle class="moving-handle-debug__center" :cx="debugCenter.x" :cy="debugCenter.y" r="3" />
        <text class="moving-handle-debug__label" :x="debugCenter.x + (isSource ? 6 : -6)" :y="debugCenter.y - 8"
          :text-anchor="isSource ? 'start' : 'end'">
          center
        </text>

        <!-- 默认点 -->
        <circle class="moving-handle-debug__rest" :cx="debugRestPoint.x" :cy="debugRestPoint.y" r="3" />
        <text class="moving-handle-debug__label" :x="debugRestPoint.x" :y="debugRestPoint.y + 14" text-anchor="middle">
          rest
        </text>

        <!-- 当前鼠标点 -->
        <circle class="moving-handle-debug__mouse" :cx="debugMousePoint.x" :cy="debugMousePoint.y" r="3" />
        <text class="moving-handle-debug__label" :x="debugMousePoint.x" :y="debugMousePoint.y + 14"
          text-anchor="middle">
          mouse
        </text>
      </svg>

    </span>

    <span class="moving-handle-button" :style="buttonStyle" @mousedown="handlePreviewMouseDown">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
        <path d="M12 5v14M5 12h14" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </span>
  </component>
</template>

<style scoped>
.moving-handle-anchor {
  position: absolute !important;
  width: 1px;
  height: 1px;
  top: 50% !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0;
  background: transparent;
  opacity: 1;
  pointer-events: all;
  z-index: 10;
  /* 锁死 transform：覆盖 VueFlow Handle 注入的内联 transform */
  transform: translateY(-50%) !important;
  overflow: visible;
}

.moving-handle-anchor.is-restoring {
  transition:
    top 180ms ease-out,
    left 180ms ease-out,
    right 180ms ease-out;
}

.moving-handle-anchor--source {
  right: 0;
}

.moving-handle-anchor--target {
  left: 0;
}

.moving-handle-zone {
  position: absolute;
  background: transparent;
  pointer-events: all;
  overflow: visible;
  transform: translate3d(0px, -50%, 0);
  backface-visibility: hidden;
}

.moving-handle-zone.is-debug {
  outline: 1px dashed var(--canvas-node-debug-danger);
}

.moving-handle-zone--source {
  left: calc(var(--moving-handle-overlap) * -1);
  border-radius: 0 9999px 9999px 0;
  clip-path: inset(0 0 0 var(--moving-handle-overlap));
}

.moving-handle-zone--target {
  right: calc(var(--moving-handle-overlap) * -1);
  border-radius: 9999px 0 0 9999px;
  clip-path: inset(0 var(--moving-handle-overlap) 0 0);
}

.moving-handle-button {
  position: absolute;
  width: 32px;
  height: 32px;
  border: 1px solid var(--canvas-node-border-subtle);
  border-radius: 9999px;
  background: var(--canvas-node-panel-surface);
  color: var(--canvas-node-text-muted);
  box-shadow: 0 1px 2px var(--canvas-node-shadow-subtle), 0 8px 18px var(--canvas-node-shadow-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  left: 0;
  top: 0;
  pointer-events: none;
  z-index: 2;
  will-change: left, top, transform;
  backface-visibility: hidden;
  transition:
    left 180ms cubic-bezier(0.25, 1, 0.5, 1),
    top 180ms cubic-bezier(0.25, 1, 0.5, 1),
    transform 200ms cubic-bezier(0.175, 0.885, 0.32, 1.275),
    opacity 160ms ease,
    color 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.moving-handle-anchor.is-moving .moving-handle-button {
  box-shadow: 0 1px 2px var(--canvas-node-shadow-subtle), 0 8px 18px var(--canvas-node-shadow-soft);
  transition:
    left 180ms cubic-bezier(0.25, 1, 0.5, 1),
    top 180ms cubic-bezier(0.25, 1, 0.5, 1),
    transform 200ms cubic-bezier(0.175, 0.885, 0.32, 1.275),
    opacity 120ms ease,
    color 120ms ease,
    border-color 120ms ease,
    box-shadow 120ms ease;
}

.moving-handle-anchor.is-restoring .moving-handle-button {
  opacity: 0;
}

.moving-handle-anchor.is-restoring .moving-handle-button {
  transition:
    left 180ms ease-out,
    top 180ms ease-out,
    transform 180ms ease-out,
    opacity 180ms ease,
    color 120ms ease,
    border-color 120ms ease,
    box-shadow 120ms ease;
}

/* 端口按钮只能由 is-visible 状态控制，不能重新加 :hover 兜底。
   连线释放瞬间鼠标仍可能压在端口区域上，:hover 会绕过状态机把按钮重新顶出来。 */
.moving-handle-anchor.is-visible:not(.is-restoring) .moving-handle-button {
  opacity: 1;
}

.moving-handle-anchor.is-preview .moving-handle-button {
  pointer-events: auto;
}

.moving-handle-button:hover {
  color: var(--canvas-node-text-strong);
  border-color: var(--canvas-node-border-hover);
}

.moving-handle-button svg {
  width: 16px;
  height: 16px;
  pointer-events: none;
}

.moving-handle-debug {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: visible;
  z-index: 0;
  transform: translateZ(0);
  backface-visibility: hidden;
}

.moving-handle-debug__arc {
  fill: var(--canvas-node-debug-danger-fill);
  stroke: var(--canvas-node-debug-danger);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}

.moving-handle-debug__center {
  fill: var(--canvas-node-debug-center);
}

.moving-handle-debug__rest {
  fill: var(--canvas-node-debug-rest);
}

.moving-handle-debug__mouse {
  fill: var(--canvas-node-debug-mouse);
}

.moving-handle-debug__label {
  fill: var(--canvas-node-debug-center);
  font-size: 9px;
  font-weight: 600;
  paint-order: stroke;
  stroke: var(--canvas-node-debug-label-stroke);
  stroke-width: 3px;
  vector-effect: non-scaling-stroke;
}
</style>
