<script setup lang="ts">
import type { TooltipContentEmits, TooltipContentProps } from 'reka-ui'
import { computed, type HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { cn } from 'cn'
import { TooltipArrow, TooltipContent, TooltipPortal, useForwardPropsEmits } from 'reka-ui'
import { popupArrowVisible, popupSideOffset } from '../../../popup/popupConfig'

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<TooltipContentProps & { class?: HTMLAttributes['class']; arrow?: boolean }>(), {
  sideOffset: undefined,
  arrow: undefined,
})

const emits = defineEmits<TooltipContentEmits>()

const arrowVisible = computed(() => popupArrowVisible('tooltip', props.arrow))
const effectiveSideOffset = computed(() => popupSideOffset('tooltip', props.sideOffset))
const delegatedProps = reactiveOmit(props, 'class', 'arrow', 'sideOffset')
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <TooltipPortal>
    <TooltipContent
      data-slot="tooltip-content"
      v-bind="{ ...forwarded, ...$attrs, sideOffset: effectiveSideOffset }"
      :class="cn('data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs has-data-[slot=kbd]:pr-1.5 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-lg bg-foreground text-background z-50 w-fit max-w-xs origin-(--reka-tooltip-content-transform-origin)', props.class)"
    >
      <slot />

      <!--
        箭头要「实打实 10px 高」，popupSideOffset 才能按 10px 扣出正确可见间距。
        之前用 size-2.5 + rotate-45：旋转后外接框只有 ~7px，reka 量到的高度与
        扣减用的 10px 对不上，箭头尖端会漂。这里按 reka 默认的 10×5 画，CSS 只染颜色。
      -->
      <TooltipArrow
        v-if="arrowVisible"
        :width="10"
        :height="5"
        class="z-50 fill-foreground stroke-foreground"
      />
    </TooltipContent>
  </TooltipPortal>
</template>
