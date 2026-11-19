<script setup lang="ts">
import type { PopoverContentEmits, PopoverContentProps } from 'reka-ui'
import { computed, mergeProps, onBeforeUnmount, onMounted, useAttrs, type HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { cn } from 'cn'
import {
  PopoverContent,
  PopoverPortal,
  PopoverArrow,
  useForwardPropsEmits,
} from 'reka-ui'
import { popupArrowVisible, popupSideOffset } from '../../../theme/popup/popupConfig'

defineOptions({
  inheritAttrs: false,
})

/** 业务侧传进来的监听（$attrs 在模板里叫 $attrs，脚本里要显式取） */
const attrs = useAttrs()

const props = withDefaults(
  defineProps<PopoverContentProps & { class?: HTMLAttributes['class']; arrow?: boolean }>(),
  {
    align: 'center',
    sideOffset: undefined,
    arrow: undefined,
  },
)
const emits = defineEmits<PopoverContentEmits>()

const arrowVisible = computed(() => popupArrowVisible('popover', props.arrow))
const effectiveSideOffset = computed(() => popupSideOffset('popover', props.sideOffset))
const delegatedProps = reactiveOmit(props, 'class', 'arrow', 'sideOffset')

const forwarded = useForwardPropsEmits(delegatedProps, emits)

/**
 * 外层浮层不该因为「点到了里层浮层」而关闭（用户 2026-11-18 报的 BUG）。
 *
 * 现场：参数面板里再开一个下拉，第二次点它的触发器时整个参数面板消失。
 * 原因很朴素 —— 里层下拉是 portal 到 body 的，不在外层面板的 DOM 树里，
 * 所以对外层来说那次点击就是「点到外面」，它把自己关了。
 *
 * 这里在**组件库这一层**兜住：这次点击落在任意浮层内容里、或刚刚点在自己的
 * 浮层上，就不让外层关闭。放到组件库而不是各业务组件里，是因为业务侧拿到的
 * 事件未必被转发下来。
 */
const LAYER_SELECTOR =
  '[data-slot="popover-content"], [data-slot="select-content"], [data-slot="dropdown-menu-content"], [role="listbox"], [role="menu"]'

function guardNestedLayer(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  const inside = Boolean(target.closest(LAYER_SELECTOR)) || anotherLayerIsOpen() || clickedLayerRecently()
  if (inside) event.preventDefault()
}

/**
 * 最近一次 pointerdown 是不是点在本面板或它弹出的浮层里（300ms 宽限）。
 *
 * 为什么需要时间窗：点内层下拉的触发器收起它时，内层浮层已经从 DOM 里摘掉了，
 * 「目标在浮层里」「还有别的层开着」都判不出来，但这一下确实是点在自己浮层上。
 */
let lastLayerPointerAt = 0
function onDocumentPointerDown(ev: PointerEvent): void {
  const t = ev.target
  if (!(t instanceof HTMLElement)) return
  if (t.closest(LAYER_SELECTOR)) lastLayerPointerAt = performance.now()
}
const clickedLayerRecently = (): boolean => performance.now() - lastLayerPointerAt < 300

/**
 * 还有没有**别的**浮层开着。
 *
 * 为什么需要这一条：点内层下拉的触发器收起它时，焦点会落到内层浮层的包裹元素上
 * —— 那是个普通 div，既不在本面板里，也不带任何浮层标记，靠 closest 认不出来。
 * 但此时内层浮层确实还挂在 DOM 上（收起是下一帧的事），所以「还有别的层」才是
 * 这一下真正要问的问题（用户 2026-11-18 实测：只认 closest 时面板照样被关）。
 *
 * 判据只看「可见浮层是否多于一层」：不靠保存自身引用去比较
 *（2026-11-18 实测：用 ref 存组件实例时 contains 抛错，把点击链整个打断了）。
 */
function anotherLayerIsOpen(): boolean {
  const visible = Array.from(document.querySelectorAll<HTMLElement>(LAYER_SELECTOR)).filter(
    (el) => el.getClientRects().length > 0,
  )
  return visible.length > 1
}

const contentProps = computed(() =>
  mergeProps(attrs, forwarded.value, { sideOffset: effectiveSideOffset.value }),
)

/**
 * 组件库这层保护必须**和业务侧的处理一起跑**。
 *
 * Reka 的这几个事件走的是自定义事件名（dismissableLayer.*），只有模板上的监听
 * 一定接得上；而模板监听会盖住 `v-bind` 里的同名项。所以这里自己从 $attrs 里
 * 取出业务侧的处理函数，拦完再调用它（用户 2026-11-18 实测：只挂模板监听时，
 * 业务侧的保护就失效了）。
 */
function runGuardAnd(event: Event): void {
  guardNestedLayer(event)
  const key = 'on' + event.type.charAt(0).toUpperCase() + event.type.slice(1)
  const outer = (attrs as Record<string, unknown>)[key]
  if (typeof outer === 'function') (outer as (e: Event) => void)(event)
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
})
</script>

<template>
  <PopoverPortal>
    <PopoverContent
      data-slot="popover-content"
      v-bind="contentProps"
      @interact-outside="runGuardAnd"
      @pointer-down-outside="runGuardAnd"
      @focus-outside="runGuardAnd"
      :class="
        cn(
          'bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-4 rounded-3xl p-4 text-sm shadow-lg ring-1 duration-100 z-50 w-72 max-w-(--reka-popover-content-available-width) origin-(--reka-popover-content-transform-origin) outline-hidden',
          props.class,
        )
      "
    >
      <slot />
      <PopoverArrow v-if="arrowVisible" :width="10" :height="5" class="fill-popover stroke-line" />
    </PopoverContent>
  </PopoverPortal>
</template>
