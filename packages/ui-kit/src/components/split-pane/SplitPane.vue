<script setup lang="ts">
/**
 * SplitPane —— 可拖拽的两栏容器。
 *
 * 业务来源：D:\Code\Git\loadout\frontend\src\components\SplitPane.vue。
 * 迁进 ui-kit 时保持原有 API（minLeft / minRight / initial / snap / heightClass），
 * 新增 direction 支持纵向；视觉改为组件库自己的 token，不再依赖 Tailwind。
 *
 * 行为约定：
 * 1. 两栏各有限制，正常拖动不会小于最小尺寸；
 * 2. 继续越过最小尺寸一段距离，对应栏收成 0，另一栏占满；
 * 3. divider 跟手移动；双击恢复 initial；
 * 4. 键盘左右 / 上下键按 16px 调整，Home 回到初始比例。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import '../../styles/ui-kit.css'

const props = withDefaults(
  defineProps<{
    /** 左侧（横向）或上方（纵向）最小尺寸，px */
    minLeft?: number
    /** 右侧（横向）或下方（纵向）最小尺寸，px */
    minRight?: number
    /** 初始占比（0~1，左/上侧占比） */
    initial?: number
    /** 越过最小限制多少 px 后收成一栏，另一栏占满 */
    snap?: number
    /** 高度类（保留原 API；组件库内也可用 class 透传） */
    heightClass?: string
    /** 分栏方向，默认左右 */
    direction?: 'horizontal' | 'vertical'
  }>(),
  {
    minLeft: 180,
    minRight: 180,
    initial: 0.5,
    snap: 56,
    heightClass: '',
    direction: 'horizontal',
  },
)

/** divider 的可拖动宽度。数值与样式里的 --mck-split-divider-size 一致。 */
const DIVIDER_W = 10
const KEYBOARD_STEP = 16

const rootRef = ref<HTMLElement | null>(null)
const containerSize = ref(0)
const ratio = ref(props.initial)
const collapsed = ref<'left' | 'right' | null>(null)
const dragging = ref(false)
const focused = ref(false)
let grabOffset = 0
let containerStart = 0

const isVertical = computed(() => props.direction === 'vertical')
const maxFirst = computed(() => Math.max(props.minLeft, containerSize.value - props.minRight))
const firstSize = computed(() => {
  const size = containerSize.value
  if (size <= 0) return 0
  if (collapsed.value === 'left') return 0
  if (collapsed.value === 'right') return size
  return Math.min(Math.max(ratio.value * size, props.minLeft), maxFirst.value)
})
const firstStyle = computed(() =>
  isVertical.value
    ? { height: firstSize.value + 'px' }
    : { width: firstSize.value + 'px' },
)
const rootClass = computed(() => [
  'mck-split',
  isVertical.value ? 'is-vertical' : 'is-horizontal',
  props.heightClass,
])

let observer: ResizeObserver | null = null

function measure(): void {
  const el = rootRef.value
  if (!el) return
  const total = isVertical.value ? el.clientHeight : el.clientWidth
  containerSize.value = Math.max(0, total - DIVIDER_W)
}

function onResize(): void {
  if (!dragging.value) measure()
}

onMounted(async () => {
  measure()
  await nextTick()
  const size = containerSize.value
  if (size > 0) {
    ratio.value = Math.min(Math.max(ratio.value, props.minLeft / size), maxFirst.value / size)
  }
  observer = new ResizeObserver(onResize)
  if (rootRef.value) observer.observe(rootRef.value)
  window.addEventListener('resize', measure)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('resize', measure)
  endDrag()
})

watch(containerSize, (size) => {
  if (size <= 0 || dragging.value || collapsed.value) return
  ratio.value = Math.min(Math.max(ratio.value, props.minLeft / size), maxFirst.value / size)
})

watch(
  () => props.direction,
  () => nextTick(measure),
)

function axisOf(event: PointerEvent): number {
  return isVertical.value ? event.clientY : event.clientX
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 && event.pointerType === 'mouse') return
  const el = rootRef.value
  if (!el) return
  measure()
  const rect = el.getBoundingClientRect()
  containerStart = isVertical.value ? rect.top : rect.left
  grabOffset = axisOf(event) - (containerStart + firstSize.value)
  dragging.value = true
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  document.body.style.cursor = isVertical.value ? 'row-resize' : 'col-resize'
  document.body.style.userSelect = 'none'
  event.preventDefault()
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return
  const size = containerSize.value
  if (size <= 0) return
  const target = axisOf(event) - grabOffset - containerStart
  if (target < props.minLeft - props.snap) {
    collapsed.value = 'left'
    return
  }
  if (target > maxFirst.value + props.snap) {
    collapsed.value = 'right'
    return
  }
  collapsed.value = null
  ratio.value = Math.min(Math.max(target, props.minLeft), maxFirst.value) / size
}

function endDrag(): void {
  if (!dragging.value) return
  dragging.value = false
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

function onPointerUp(): void {
  endDrag()
}

function restore(): void {
  collapsed.value = null
  ratio.value = props.initial
  measure()
}

function onKeydown(event: KeyboardEvent): void {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return
  event.preventDefault()
  if (event.key === 'Home') {
    restore()
    return
  }
  const size = containerSize.value
  if (size <= 0) return
  const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
  const delta = forward ? KEYBOARD_STEP : -KEYBOARD_STEP
  const next = Math.min(Math.max(firstSize.value + delta, props.minLeft), maxFirst.value)
  collapsed.value = null
  ratio.value = next / size
}
</script>

<template>
  <div
    ref="rootRef"
    :class="rootClass"
    :style="{ '--mck-split-divider': DIVIDER_W + 'px' }"
  >
    <div class="mck-split__pane" :style="firstStyle">
      <slot name="left" />
    </div>
    <div
      class="mck-split__divider"
      :class="{ 'is-dragging': dragging, 'is-focused': focused }"
      role="separator"
      :aria-orientation="isVertical ? 'horizontal' : 'vertical'"
      :aria-valuenow="Math.round(ratio * 100)"
      aria-valuemin="0"
      aria-valuemax="100"
      tabindex="0"
      @pointerdown="onPointerDown"
      @dblclick="restore"
      @keydown="onKeydown"
      @focus="focused = true"
      @blur="focused = false"
    >
      <div class="mck-split__line" aria-hidden="true"></div>
      <div class="mck-split__grip" aria-hidden="true"></div>
    </div>
    <div class="mck-split__pane mck-split__pane--second">
      <slot name="right" />
    </div>
  </div>
</template>

<style scoped>
.mck-split {
  display: flex;
  /* 与参考实现一致：默认自适应父级，不抢占高度。 */
  flex: 0 1 auto;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}


.mck-split.is-vertical {
  flex-direction: column;
}

.mck-split__pane {
  position: relative;
  flex: 0 0 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

/* 嵌在分栏里的分栏：用绝对定位填满，避免被内容反向撑高。 */
.mck-split__pane > .mck-split {
  position: absolute;
  inset: 0;
  height: auto;
}

.mck-split__pane--second {
  flex: 1;
}

.is-vertical > .mck-split__pane--second {
  flex: 1;
}

.mck-split__divider {
  position: relative;
  z-index: 20;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--mck-split-divider, 10px);
  height: 100%;
  box-sizing: border-box;
  cursor: col-resize;
  outline: none;
  touch-action: none;
  user-select: none;
}

.is-vertical > .mck-split__divider {
  width: 100%;
  height: var(--mck-split-divider, 10px);
  cursor: row-resize;
}

.mck-split__line {
  position: absolute;
  inset: 0 auto 0 50%;
  width: 1px;
  height: 100%;
  background: var(--mck-line);
  transform: translateX(-50%);
  transition: background-color 150ms ease;
}

.is-vertical > .mck-split__divider .mck-split__line {
  inset: 50% 0 auto 0;
  width: 100%;
  height: 1px;
  transform: translateY(-50%);
}

.mck-split__grip {
  position: relative;
  z-index: 1;
  width: 4px;
  height: 32px;
  border-radius: 999px;
  background: var(--mck-line);
  transition: background-color 150ms ease;
}

.is-vertical > .mck-split__divider .mck-split__grip {
  width: 32px;
  height: 4px;
}

.mck-split__divider:hover .mck-split__line,
.mck-split__divider.is-focused .mck-split__line,
.mck-split__divider.is-dragging .mck-split__line {
  background: color-mix(in srgb, var(--mck-accent) 62%, var(--mck-line));
}

.mck-split__divider:hover .mck-split__grip,
.mck-split__divider.is-focused .mck-split__grip,
.mck-split__divider.is-dragging .mck-split__grip {
  background: var(--mck-accent);
}

@media (prefers-reduced-motion: reduce) {
  .mck-split__line,
  .mck-split__grip {
    transition: none;
  }
}
</style>


