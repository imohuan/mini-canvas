<script setup lang="ts">
import type { DropdownMenuSubContentEmits, DropdownMenuSubContentProps } from 'reka-ui'
import { computed, type HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { cn } from 'cn'
import {
  ContextMenuSubContent,
  ContextMenuArrow,
  useForwardPropsEmits,
} from 'reka-ui'
import { popupArrowVisible, popupSubSideOffset } from '../../../theme/popup/popupConfig'

const props = withDefaults(
  defineProps<DropdownMenuSubContentProps & { class?: HTMLAttributes['class']; arrow?: boolean }>(),
  {
    arrow: undefined,
    sideOffset: undefined,
  },
)
const emits = defineEmits<DropdownMenuSubContentEmits>()

const arrowVisible = computed(() => popupArrowVisible('context', props.arrow))
const effectiveSideOffset = computed(() => popupSubSideOffset(props.sideOffset))
const delegatedProps = reactiveOmit(props, 'class', 'arrow', 'sideOffset')

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <ContextMenuSubContent
    data-slot="context-menu-sub-content"
    v-bind="{ ...forwarded, sideOffset: effectiveSideOffset }"
    :class="
      cn(
        'data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/5 dark:ring-foreground/10 bg-popover text-popover-foreground flex min-w-32 flex-col rounded-3xl p-1.5 shadow-lg ring-1 duration-100 cn-menu-translucent z-50 origin-(--reka-context-menu-content-transform-origin) overflow-visible',
        props.class,
      )
    "
  >
    <div class="min-h-0 max-h-(--reka-context-menu-content-available-height) flex-1 overflow-x-hidden overflow-y-auto">
      <slot />
    </div>
    <ContextMenuArrow v-if="arrowVisible" :width="10" :height="5" class="fill-popover stroke-line" />
  </ContextMenuSubContent>
</template>
