<script setup lang="ts">
// MovingHandle —— v2 移动式浮动端口（移植自 v1 Decoration/MovingHandle.vue，金标准 core-node-contract §3）。
// 职责：端口锚点(1×1px 真实 VueFlow Handle) + 半圆可移动区 + 浮动圆球按钮。
//       鼠标进入半圆区圆球从节点边缘"跳出"跟随鼠标；离开 180ms 内归位淡出。
//       非 preview 时底层就是真实 VueFlow <Handle> 连接点(端口 hover/选中才可见但始终可连)。
// 与 v1 差异：无 pinia 依赖（v1 本无 store，纯 props）。几何/状态机逻辑与 v1 逐行一致。
//       CSS 消费本插件自建 --canvas-node-* 主题变量（styles/node-theme.css）。
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Handle, Position } from '@mini-canvas/canvas-render'

/** 把 value 限制在 [min,max]（v1 viewportSpace.clamp 移植） */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

const props = defineProps<{
  id: string
  type: 'source' | 'target'
  position: Position
  visible?: boolean
  disabled?: boolean
  /** 半圆形可移动区域半径 px（主项目 handleRadius=86） */
  radius?: number
  /** 离开后圆球回到节点外侧默认偏移 px（handleRestOffset=36） */
  restOffset?: number
  /** 圆球跟鼠标错开距离，避免被盖住（handleCursorGap=24） */
  cursorGap?: number
  /** 圆球尺寸 px（handleButtonSize=32） */
  buttonSize?: number
  /** 半圆向节点内侧覆盖后被裁掉的宽度 px（handleOverlap=16） */
  overlap?: number
  zoneWidth?: number
  zoneHeight?: number
  zoneOffset?: number
  zoneShape?: 'rect' | 'arc'
  /** 半椭圆弧垂直胖瘦系数 0.2~1（1 = rx=ry 半圆） */
  zoneArcRatio?: number
  /** 展示模式：只复用外观，不注册 VueFlow 真实连接点 */
  preview?: boolean
  /** 调试模式：画半圆/圆心/rest/mouse 辅助线 */
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
const zoneWidth = computed(() => props.zoneWidth ?? radius.value)
const zoneHeight = computed(() => props.zoneHeight ?? radius.value)
const zoneOffset = computed(() => props.zoneOffset ?? 0)
const zoneShape = computed(() => props.zoneShape ?? 'arc')
const zoneArcRatio = computed(() => Math.min(Math.max(Number(props.zoneArcRatio ?? 1), 0.2), 1))
const isShown = computed(() => !props.disabled && (props.visible || keepVisible.value))

// 连接拖拽会临时禁用源端口：必须同步清本地 hover，否则松开后圆球因残留 keepVisible 再显示
watch(
  () => props.disabled,
  (disabled) => {
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
  },
)

// CSS 变量必须定义在 anchor 根上：zone 与 debug svg 是兄弟元素，各自定位都读同一组变量，
// 若只写在 zone 的 inline style 上，debug(left: calc(var(...))) 会取不到值而失效错位。
const anchorStyle = computed(() => ({
  '--port-zone-width': `${zoneWidth.value}px`,
  '--port-zone-offset': `${zoneOffset.value}px`,
  '--moving-handle-overlap': `${overlap.value}px`,
}))

const zoneStyle = computed(() => ({
  width: `${zoneWidth.value}px`,
  height: `${zoneHeight.value}px`,
}))

/** debug svg 定位：与 zone 同位置同尺寸，完全重叠覆盖（宽高 + left 由锚点根上的 CSS 变量决定） */
const debugStyle = computed(() => ({
  width: `${zoneWidth.value}px`,
  height: `${zoneHeight.value}px`,
}))

const buttonStyle = computed(() => {
  const style: Record<string, string> = {
    width: `${buttonSize.value}px`,
    height: `${buttonSize.value}px`,
    top: `${buttonY.value}px`,
    transform: `translate(-50%, -50%) scale(${isMoving.value ? 1.06 : 1})`,
  }
  if (isSource.value) {
    style.left = `${buttonX.value}px`
  } else {
    style.left = `${buttonX.value}px`
  }
  return style
})

const debugArcPath = computed(() => {
  const w = zoneWidth.value
  const h = zoneHeight.value
  if (zoneShape.value === 'rect') return `M 0 0 H ${w} V ${h} H 0 Z`
  // arc 模式：半椭圆弧，圆心在端口锚点（卡缘中点）、弧朝外侧鼓出（与 BaseNode
  // v2-debug-overlay / resolveFeedback 的吸附带视觉同源：命中按矩形，shape 只影响视觉）。
  // zone 盒 = 卡缘向外伸出的一块 (w×h)，本地坐标：
  //   - source(卡右缘)：盒 x=0 贴卡缘、向外(右)到 x=w；平坦边在卡缘 x=0，
  //     弧从 (0,0) 扫到 (0,h)、鼓向 +x、最鼓点达 (w, h/2) —— rx=w、ry=h/2 的右半椭圆。
  //   - target(卡左缘)：盒 x=w 贴卡缘、向外(左)到 x=0；平坦边在卡缘 x=w，
  //     弧鼓向 -x、最鼓点达 (0, h/2) —— 左半椭圆。
  // 两点 (0,0)→(0,h) 竖直间距 h=2·ry，恰为椭圆对径，弧即半个椭圆，半圆/弧朝外不畸变。
  const rx = Math.max(w, 1)
  const ry = Math.max(h / 2, 1)
  return isSource.value
    ? `M 0 0 A ${rx} ${ry} 0 0 1 0 ${h} Z`
    : `M ${w} 0 A ${rx} ${ry} 0 0 0 ${w} ${h} Z`
})
const debugCenter = computed(() => ({ x: isSource.value ? 0 : zoneWidth.value, y: zoneHeight.value / 2 }))
const debugRestPoint = computed(() => ({
  x: isSource.value ? restOffset.value : zoneWidth.value - restOffset.value,
  y: zoneHeight.value / 2,
}))
const debugMousePoint = computed(() => ({
  x: isSource.value ? mouseX.value : zoneWidth.value - mouseX.value,
  y: zoneHeight.value / 2 + mouseY.value,
}))
const debugViewBox = computed(() => `0 0 ${zoneWidth.value} ${zoneHeight.value}`)

resetPosition()

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
  const localX = rect.width > 0 ? ((event.clientX - rect.left) / rect.width) * zoneWidth.value : 0
  const localY =
    rect.height > 0 ? ((event.clientY - rect.top) / rect.height) * zoneHeight.value : zoneHeight.value / 2
  // 必须用"区域本地坐标"，不能直接用屏幕 px：VueFlow 缩放后 rect 是缩放后尺寸，混算会偏移
  const outward = isSource.value ? localX : zoneWidth.value - localX
  const rawY = localY - zoneHeight.value / 2
  mouseX.value = clamp(outward, 0, zoneWidth.value)
  mouseY.value = clamp(rawY, -zoneHeight.value / 2, zoneHeight.value / 2)

  const maxDistance = zoneWidth.value - buttonSize.value / 2
  const mouseDistance = Math.hypot(mouseX.value, mouseY.value)
  const mouseAngle = Math.atan2(mouseY.value, mouseX.value || 0.0001)
  const followDistance = clamp(mouseDistance + cursorGap.value, 0, maxDistance)
  const ballX = Math.cos(mouseAngle) * followDistance
  const ballY = Math.sin(mouseAngle) * followDistance
  commitPosition(direction.value * (ballX - overlap.value), ballY)
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
  // 先从当前位置跟随方向快速归位，动画完成后再隐藏
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
  <component
    :is="preview ? 'span' : Handle"
    :id="id"
    :type="type"
    :position="position"
    class="moving-handle-anchor"
    :class="{
      'moving-handle-anchor--source': isSource,
      'moving-handle-anchor--target': !isSource,
      'is-visible': isShown,
      'is-moving': isMoving,
      'is-restoring': isRestoring,
      'is-disabled': disabled,
      'is-preview': preview,
    }"
    :style="anchorStyle"
  >
    <span
      class="moving-handle-zone"
      :class="{
        'moving-handle-zone--source': isSource,
        'moving-handle-zone--target': !isSource,
      'is-debug': debug,
        'moving-handle-zone--rect': zoneShape === 'rect',
      }"
      :style="zoneStyle"
      @mouseenter="if (!disabled) { keepVisible = true; emit('hover', true) }"
      @mouseleave="handleLeave"
      @mousemove="updatePosition"
    />

    <div class="moving-handle-button" :style="buttonStyle" @mousedown="handlePreviewMouseDown">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
        <path d="M12 5v14M5 12h14" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </div>

    <!-- 调试可视化（移到 zone 外：zone 有 clip-path 裁掉 input 视觉边缘，clip 会同时裁掉 debug svg）。
         用绝对定位覆盖 zone 区域，确保 center/rest/mouse 辅助线全显示不受裁剪影响。 -->
    <svg v-if="debug" class="moving-handle-debug" :viewBox="debugViewBox" preserveAspectRatio="none" :style="debugStyle">
      <path class="moving-handle-debug__arc" :d="debugArcPath" />
      <circle class="moving-handle-debug__center" :cx="debugCenter.x" :cy="debugCenter.y" r="3" />
      <text class="moving-handle-debug__label" :x="debugCenter.x + (isSource ? 6 : -6)" :y="debugCenter.y - 8" :text-anchor="isSource ? 'start' : 'end'">center</text>
      <circle class="moving-handle-debug__rest" :cx="debugRestPoint.x" :cy="debugRestPoint.y" r="3" />
      <text class="moving-handle-debug__label" :x="debugRestPoint.x" :y="debugRestPoint.y + 14" text-anchor="middle">rest</text>
      <circle class="moving-handle-debug__mouse" :cx="debugMousePoint.x" :cy="debugMousePoint.y" r="3" />
      <text class="moving-handle-debug__label" :x="debugMousePoint.x" :y="debugMousePoint.y + 14" text-anchor="middle">mouse</text>
    </svg>
  </component>
</template>

<style scoped>
.moving-handle-anchor {
  position: absolute !important;
  width: 0;
  height: 0;
  /* VueFlow .vue-flow__handle 强制 min-width/min-height: 5px，
     必须压回 0：source anchor(right:0) 若残留 5px 会占据卡内 [right-5,right]，
     其 zone(left:0 相对 anchor 左缘) 整体向卡内缩 5px，两侧不对称。 */
  min-width: 0 !important;
  min-height: 0 !important;
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
  transition: top 180ms ease-out, left 180ms ease-out, right 180ms ease-out;
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
.moving-handle-zone--source {
  /* 左端贴卡右缘（offset 决定向卡内缩进），右端伸出卡外。透明纯命中区，
     半椭圆/圆弧等视觉统一由 debug svg（.moving-handle-debug__arc）绘制。 */
  left: calc(var(--port-zone-offset) * -1);
}
.moving-handle-zone--target {
  /* 右端贴卡左缘（offset 决定向卡内缩进），左端伸出卡外。透明纯命中区。 */
  left: calc(var(--port-zone-width) * -1 + var(--port-zone-offset));
}

/* 矩形形状：直角矩形接收区（命中与视觉都按矩形） */
.moving-handle-zone--rect {
  border-radius: 0;
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
  transition:
    left 180ms ease-out,
    top 180ms ease-out,
    transform 180ms ease-out,
    opacity 180ms ease,
    color 120ms ease,
    border-color 120ms ease,
    box-shadow 120ms ease;
}

/* 端口按钮只能由 is-visible 状态控制，不能加 :hover 兜底：
   连线释放瞬间鼠标仍可能压区，:hover 会绕过状态机把按钮重新顶出 */
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
  /* 与 handle 锚点同位（卡片水平边垂直中点）：
     anchor 是 1px×1px 容器，绝对定位 target=left:0 / source=right:0 + top:50% translateY(-50%)。
     debug svg 宽高 = radius px（inline style），用 left/right + top:50% + translate(-50%,-50%) 让 svg 中心对齐 anchor 中心。 */
  top: 50%;
  transform: translateY(-50%) translateZ(0);
  pointer-events: none;
  overflow: visible;
  z-index: 3; /* 在 button(z=2) 上层，确保 debug 标签不被 button 圆盖住 */
  backface-visibility: hidden;
}
.moving-handle-anchor--source .moving-handle-debug {
  left: calc(var(--port-zone-offset) * -1);
}
.moving-handle-anchor--target .moving-handle-debug {
  left: calc(var(--port-zone-width) * -1 + var(--port-zone-offset));
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
