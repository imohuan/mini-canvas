<script setup lang="ts">
/**
 * Tooltip —— 通用悬浮提示（设计系统件，登记在 registryOf('ui') 的 'tooltip' 名下）。
 *
 * 为什么要有它：此前只有成品应用内部一个 AxTooltip（packages/ui），插件够不到 ——
 * 插件想给按钮加个悬浮提示只能自己写一套浮层。收进主题目录后，**任何插件**都能
 *   const ThemedTooltip = useUiComponent('tooltip')
 * 按名取用，换主题时提示气泡的观感跟着一起换（与 dropdown / button 同一条路）。
 *
 * 定位不引第三方库：与同目录的 Dropdown.vue 用同一套「fixed + 量尺寸 + 翻转 + 收进视口」，
 * 少一个依赖、行为可控（本包本来就不带 @floating-ui）。
 *
 * 用法：
 *   <Tooltip content="上下文剩余 96%"><span class="ring" /></Tooltip>
 *   需要自由内容时用 #content 插槽。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 提示文字（用 #content 插槽时可省略） */
    content?: string
    /** 气泡贴着触发器哪一侧：top / bottom / left / right */
    placement?: 'top' | 'bottom' | 'left' | 'right'
    /** 与触发器之间的间距（px） */
    offset?: number
    /** 是否画指向触发器的小三角 */
    arrow?: boolean
    /** 悬停多久才出现（ms）——太灵敏会让鼠标扫过时到处闪 */
    delay?: number
    disabled?: boolean
  }>(),
  { content: '', placement: 'top', offset: 8, arrow: true, delay: 120, disabled: false },
)

const triggerRef = ref<HTMLElement | null>(null)
const tipRef = ref<HTMLElement | null>(null)
const visible = ref(false)
const pos = ref<{ left: number; top: number }>({ left: -9999, top: -9999 })
/** 小三角沿气泡边缘的偏移（px，相对气泡左/上缘） */
const arrowShift = ref(0)
/** 三角朝向：气泡在触发器上方 → 三角在气泡下缘 */
const arrowSide = ref<'top' | 'bottom'>('bottom')
let timer: ReturnType<typeof setTimeout> | null = null

/** 视口内留白：气泡不让贴边，箭头也不会顶出屏幕 */
const MARGIN = 8
const ARROW = 10

function computePosition(): void {
  const trig = triggerRef.value
  const tip = tipRef.value
  if (!trig || !tip) return
  const tr = trig.getBoundingClientRect()
  const tw = tip.offsetWidth
  const th = tip.offsetHeight
  const gap = props.offset + (props.arrow ? ARROW / 2 : 0)
  const vw = window.innerWidth
  const vh = window.innerHeight

  // 主轴默认摆在触发器上方；放不下就翻到下方
  let left = tr.left + (tr.width - tw) / 2
  let top = tr.top - th - gap
  if (props.placement === 'bottom') top = tr.bottom + gap
  if (props.placement === 'top' && top < MARGIN && tr.bottom + th + gap < vh - MARGIN) top = tr.bottom + gap
  if (props.placement === 'bottom' && top + th > vh - MARGIN && tr.top - th - gap > MARGIN) top = tr.top - th - gap
  // 水平夹进视口（气泡比屏幕宽时靠 max-width 兜住）
  if (left + tw > vw - MARGIN) left = vw - tw - MARGIN
  if (left < MARGIN) left = MARGIN
  // 上下再夹一次：翻转后仍越界就顶住边
  if (top + th > vh - MARGIN) top = Math.max(MARGIN, vh - MARGIN - th)
  if (top < MARGIN) top = MARGIN

  pos.value = { left, top }
  arrowSide.value = top + th / 2 < tr.top ? 'bottom' : 'top'
  // 三角对准触发器中心，但不许跑出气泡两端
  arrowShift.value = Math.min(tw - ARROW * 1.5, Math.max(ARROW * 0.5, tr.left + tr.width / 2 - left - ARROW / 2))
}

function show(): void {
  if (props.disabled) return
  if (timer) clearTimeout(timer)
  if (props.delay <= 0) {
    visible.value = true
    return
  }
  timer = setTimeout(() => {
    visible.value = true
  }, props.delay)
}
function hide(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  visible.value = false
}

// 可见后量一次真实尺寸再定位（隐藏时 offsetWidth 为 0，量不到就没法居中）
watch(visible, (v) => {
  if (v) nextTick(() => computePosition())
})

/** 视口变化 / 面板滚动时重新贴合（浮层是 fixed，内容一动就会错位） */
function onReflow(): void {
  if (visible.value) computePosition()
}
onMounted(() => {
  window.addEventListener('resize', onReflow)
  window.addEventListener('scroll', onReflow, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onReflow)
  window.removeEventListener('scroll', onReflow, true)
  if (timer) clearTimeout(timer)
})

const hasContent = computed(() => Boolean(props.content))
</script>

<template>
  <span
    class="tlt-root"
    @mouseenter="show"
    @mouseleave="hide"
    @focusin="show"
    @focusout="hide"
    @pointerdown="hide"
  >
    <span ref="triggerRef" class="tlt-trigger"><slot /></span>
  </span>

  <Teleport to="body">
    <div
      v-if="visible && (hasContent || $slots.content)"
      ref="tipRef"
      class="tlt-bubble"
      :style="{ left: pos.left + 'px', top: pos.top + 'px' }"
      role="tooltip"
    >
      <slot name="content">{{ content }}</slot>
      <span
        v-if="props.arrow"
        class="tlt-arrow"
        :class="'is-' + arrowSide"
        :style="{ left: arrowShift + 'px' }"
      />
    </div>
  </Teleport>
</template>

<style>
/* 非 scoped：气泡被 Teleport 到 body，scoped 选择器命不中。类名带 tlt- 前缀避撞。 */
.tlt-root { display: inline-flex; }
.tlt-trigger { display: inline-flex; }
.tlt-bubble {
  position: fixed;
  z-index: 100001;
  max-width: 260px;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--ui-tip, rgb(0 0 0 / 0.9));
  color: var(--ui-tip-ink, #fff);
  box-shadow: 0 4px 6px -1px var(--ui-scrim-soft, rgb(0 0 0 / 0.1));
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
  pointer-events: none;
}
.tlt-arrow {
  position: absolute;
  width: 10px;
  height: 10px;
  background: var(--ui-tip, rgb(0 0 0 / 0.9));
  transform: rotate(45deg);
}
.tlt-arrow.is-bottom { bottom: -4px; }
.tlt-arrow.is-top { top: -4px; }
</style>

