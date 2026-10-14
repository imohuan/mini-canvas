<script setup lang="ts">
// AxTooltip —— 通用悬浮提示（思路照 web2api 的 AxTooltip：@floating-ui/vue 定位 +
// Teleport 到 body + arrow 中间件）。
// 差异只在样式：用 LibTV 画布实测的暗色 token
// （rgba(0,0,0,.9) 底 / #fff 字 / 12px / padding 4px 8px / 圆角 6px）。
//
// 用法：
//   <AxTooltip content="生成历史"><button aria-label="生成历史">…</button></AxTooltip>
//   需要自定义内容时用 #content 插槽。
import { computed, ref } from 'vue'
import { useFloating } from './hooks/useFloating'
import { useTeleportTarget } from './hooks/useTeleportTarget'

const props = withDefaults(
  defineProps<{
    content?: string
    placement?: string
    offset?: number
    /** 是否显示小箭头（目标页的纯文字气泡不带箭头，默认关） */
    arrow?: boolean
    /** 悬停多久才显示（ms） */
    delay?: number
    /** 应用到触发器根节点的 class（组件是 span + Teleport 双根，外部 class 会被丢掉） */
    triggerClass?: string
    disabled?: boolean
  }>(),
  {
    content: '',
    placement: 'top',
    offset: 8,
    arrow: false,
    delay: 200,
    triggerClass: '',
    disabled: false,
  },
)

const teleportTarget = useTeleportTarget()
const triggerRef = ref<HTMLElement | null>(null)
const tooltipRef = ref<HTMLElement | null>(null)
const arrowRef = ref<HTMLElement | null>(null)
const visible = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

const { floatingStyles, isPositioned, middlewareData, placement } = useFloating(
  triggerRef,
  tooltipRef,
  {
    placement: computed(() => props.placement),
    offset: computed(() => props.offset),
    arrowRef: props.arrow ? arrowRef : undefined,
  },
)

// 防闪：位置就绪前放在视口外
const tooltipStyle = computed(() =>
  isPositioned.value
    ? floatingStyles.value
    : { position: 'fixed' as const, left: '-9999px', top: '-9999px' },
)

const staticSideMap: Record<string, string> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
const ARROW_HALF = 5
const arrowStyle = computed(() => {
  const arrowData = middlewareData.value?.arrow
  const side = placement.value?.split('-')[0] ?? 'top'
  const style: Record<string, string> = { position: 'absolute', [staticSideMap[side] ?? 'bottom']: `-${ARROW_HALF}px` }
  if (arrowData) {
    if (arrowData.x != null) style.left = `${arrowData.x}px`
    if (arrowData.y != null) style.top = `${arrowData.y}px`
  }
  return style
})

const hasContent = computed(() => Boolean(props.content) || true)

function show(): void {
  if (props.disabled) return
  if (timer) clearTimeout(timer)
  if (props.delay <= 0) { visible.value = true; return }
  timer = setTimeout(() => { visible.value = true }, props.delay)
}
function hide(): void {
  if (timer) { clearTimeout(timer); timer = null }
  visible.value = false
}
</script>

<template>
  <span
    ref="triggerRef"
    :class="['axt-root', triggerClass]"
    @mouseenter="show"
    @mouseleave="hide"
    @focusin="show"
    @focusout="hide"
    @pointerdown="hide"
    @mouseenter.stop="show"
  >
    <slot />
  </span>
  <Teleport :to="teleportTarget">
    <Transition name="axt">
      <div
        v-if="visible && hasContent"
        ref="tooltipRef"
        :style="tooltipStyle"
        class="axt-bubble"
        role="tooltip"
      >
        <slot name="content">{{ content }}</slot>
        <span v-if="props.arrow" ref="arrowRef" :style="arrowStyle" class="axt-arrow" />
      </div>
    </Transition>
  </Teleport>
</template>

<style>
/* 非 scoped：气泡被 Teleport 到 body，scoped 选择器命不中。 */
.axt-root { display: inline-flex; }
.axt-bubble {
  position: fixed;
  /* z-index 走画布层叠带变量（--layer-modal-top）；modal 里也要能弹提示 */
  z-index: var(--layer-modal-top, 100001);
  max-width: 260px;
  padding: 4px 8px;
  color: var(--ui-tip-ink);
  border-radius: 6px;
  background: var(--ui-tip);
  box-shadow: 0 4px 6px -1px var(--ui-scrim-soft, rgb(0 0 0 / 0.1));
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
  pointer-events: none;
}
.axt-arrow { width: 10px; height: 10px; background: var(--ui-tip); transform: rotate(45deg); }
.axt-enter-active { transition: opacity .1s ease-out; }
.axt-leave-active { transition: opacity .075s ease-in; }
.axt-enter-from, .axt-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .axt-enter-active, .axt-leave-active { transition: none; }
}
</style>
