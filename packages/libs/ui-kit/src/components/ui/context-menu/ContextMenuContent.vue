<script setup lang="ts">
import type { ContextMenuContentEmits, ContextMenuContentProps } from 'reka-ui'
import { computed, type HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { cn } from 'cn'
import {
  ContextMenuContent,
  ContextMenuPortal,
  ContextMenuArrow,
  useForwardPropsEmits,
} from 'reka-ui'
import { popupArrowVisible } from '../../../theme/popup/popupConfig'

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(
  defineProps<ContextMenuContentProps & { class?: HTMLAttributes['class']; arrow?: boolean }>(),
  {
    arrow: undefined,
  },
)
const emits = defineEmits<ContextMenuContentEmits>()

const arrowVisible = computed(() => popupArrowVisible('context', props.arrow))
// 右键菜单的坐标来自鼠标位置，不用 sideOffset；它只消费箭头与选中样式。
const delegatedProps = reactiveOmit(props, 'class', 'arrow')

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <ContextMenuPortal>
    <ContextMenuContent
      data-slot="context-menu-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="cn(
        'data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/5 dark:ring-foreground/10 bg-popover text-popover-foreground flex min-w-48 flex-col rounded-3xl p-1.5 shadow-lg ring-1 duration-100 cn-menu-translucent z-50 max-h-(--reka-context-menu-content-available-height) origin-(--reka-context-menu-content-transform-origin) overflow-visible',
        props.class,
      )"
    >
      <div class="min-h-0 max-h-(--reka-context-menu-content-available-height) flex-1 overflow-x-hidden overflow-y-auto">
        <slot />
      </div>
      <ContextMenuArrow v-if="arrowVisible" :width="10" :height="5" class="fill-popover stroke-line" />
    </ContextMenuContent>
  </ContextMenuPortal>
</template>
