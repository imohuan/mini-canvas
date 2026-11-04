<script setup lang="ts">
import type { ComboboxContentEmits, ComboboxContentProps } from 'reka-ui'
import { computed, type HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { cn } from 'cn'
import { ComboboxArrow, ComboboxContent, ComboboxPortal, useForwardPropsEmits } from 'reka-ui'
import { popupArrowVisible, popupSideOffset } from '../../../theme/popup/popupConfig'

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<ComboboxContentProps & { class?: HTMLAttributes['class']; arrow?: boolean }>(), {
  position: 'popper',
  align: 'center',
  sideOffset: undefined,
  arrow: undefined,
})
const emits = defineEmits<ComboboxContentEmits>()

const arrowVisible = computed(() => popupArrowVisible('combobox', props.arrow))
const effectiveSideOffset = computed(() => popupSideOffset('combobox', props.sideOffset))
const delegatedProps = reactiveOmit(props, 'class', 'arrow', 'sideOffset')
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <ComboboxPortal>
    <ComboboxContent
      data-slot="combobox-content"
      v-bind="{ ...$attrs, ...forwarded, sideOffset: effectiveSideOffset }"
      :class="cn('bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/5 dark:ring-foreground/10 *:data-[slot=input-group]:bg-input/50 *:data-[slot=input-group]:border-input/30 max-h-72 min-w-36 overflow-visible rounded-3xl shadow-lg ring-1 duration-100 *:data-[slot=input-group]:m-1.5 *:data-[slot=input-group]:mb-0 *:data-[slot=input-group]:h-8 *:data-[slot=input-group]:shadow-none data-[side=inline-start]:slide-in-from-right-2 data-[side=inline-end]:slide-in-from-left-2 cn-menu-translucent group/combobox-content z-50 w-(--reka-combobox-trigger-width)', props.class)"
    >
      <div class="min-h-0 max-h-72 overflow-x-hidden overflow-y-auto">
        <slot />
      </div>
      <ComboboxArrow v-if="arrowVisible" :width="10" :height="5" class="fill-popover stroke-line" />
    </ComboboxContent>
  </ComboboxPortal>
</template>
