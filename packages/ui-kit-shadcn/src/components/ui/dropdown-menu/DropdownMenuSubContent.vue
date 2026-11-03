<script setup lang="ts">
import type { DropdownMenuSubContentEmits, DropdownMenuSubContentProps } from 'reka-ui'
import { computed, ref, type HTMLAttributes, type Ref } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { cn } from 'cn'
import {
  DropdownMenuSubContent,
  useForwardPropsEmits,
} from 'reka-ui'
import DropdownMenuArrow from './DropdownMenuArrow.vue'
import { popupArrowVisible, popupSubSideOffset } from '../../../popup/popupConfig'
import { useSubMenuGap } from '../../../popup/useSubMenuGap'

const props = withDefaults(
  defineProps<DropdownMenuSubContentProps & { class?: HTMLAttributes['class']; arrow?: boolean }>(),
  {
    arrow: undefined,
    sideOffset: undefined,
  },
)
const emits = defineEmits<DropdownMenuSubContentEmits>()

const arrowVisible = computed(() => popupArrowVisible('dropdown', props.arrow))
/**
 * 子菜单与父菜单的**可见边缘**间距（默认 8px）。
 *
 * `popupSubSideOffset` 只是兜底值；真正生效的是挂载后按父面板矩形实时算出来的
 * `offset` —— reka 从触发行边框量起，而触发行缩在父面板内边距里，写死数值会量出
 * 2px 甚至负数（2026-11-03 实测 -8px，子菜单压在父菜单上）。详见 `useSubMenuGap`。
 */
/**
 * 用内容层里的内层滚动 div 当锚点：reka 的根组件是 Teleport + 片段，
 * 组件 ref 上的 $el 是注释节点，量不到任何矩形。
 */
const innerRef = ref<HTMLElement | null>(null)
const subGap = useSubMenuGap(innerRef as Ref<unknown>, 'dropdown-menu-sub-content')
const effectiveSideOffset = computed(() => subGap.offset.value ?? popupSubSideOffset(props.sideOffset))
const delegatedProps = reactiveOmit(props, 'class', 'arrow', 'sideOffset')

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <DropdownMenuSubContent
    data-slot="dropdown-menu-sub-content"
    :data-sub-gap="subGap.offset.value ?? undefined"
    v-bind="{ ...forwarded, sideOffset: effectiveSideOffset }"
    :class="cn('data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/5 dark:ring-foreground/10 bg-popover text-popover-foreground min-w-36 rounded-3xl p-1.5 shadow-lg ring-1 duration-100 cn-menu-translucent z-50 max-w-(--reka-dropdown-menu-content-available-width) origin-(--reka-dropdown-menu-content-transform-origin) overflow-visible', props.class)"
  >
    <div ref="innerRef" class="min-h-0 max-h-(--reka-dropdown-menu-content-available-height) overflow-x-hidden overflow-y-auto">
      <slot />
    </div>
    <DropdownMenuArrow v-if="arrowVisible" :width="16" :height="8" class="fill-popover stroke-line" />
  </DropdownMenuSubContent>
</template>
