<script setup lang="ts">
import type { DropdownMenuContentEmits, DropdownMenuContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { cn } from 'cn'
import {
  DropdownMenuContent,
  DropdownMenuPortal,
  useForwardPropsEmits,
} from 'reka-ui'
import DropdownMenuArrow from './DropdownMenuArrow.vue'
import { popupArrowVisible, popupSideOffset } from '../../../theme/popup/popupConfig'

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(
  defineProps<
    DropdownMenuContentProps & {
      class?: HTMLAttributes['class']
      /** 是否画箭头；缺省读「设置 → 外观 → 浮层」。 */
      arrow?: boolean
    }
  >(),
  {
    align: 'start',
    arrow: undefined,
    sideOffset: undefined,
  },
)
const emits = defineEmits<DropdownMenuContentEmits>()

const arrowVisible = computed(() => popupArrowVisible('dropdown', props.arrow))
const effectiveSideOffset = computed(() => popupSideOffset('dropdown', props.sideOffset))
const delegatedProps = reactiveOmit(props, 'class', 'arrow', 'sideOffset')

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <DropdownMenuPortal>
    <!--
      滚动区放在菜单**内部**，菜单本体只负责定位、底色、圆角与描边。

      原因（2026-11-02 实测）：菜单自己 overflow-y:auto 时，Agent 模型菜单的
      整块面板被撑到 2752px，滚动条从菜单顶贯穿到底，连标题和底部一起穿过去，
      用户明确说这个滚动条不好看。内容进内层滚动区后，滚动条只出现在列表旁边，
      标题、搜索栏、底部统计都固定不动。

      外层必须 overflow-visible：箭头是绝对定位的兄弟节点，放在滚动容器里会被裁掉。
    -->
    <DropdownMenuContent
      data-slot="dropdown-menu-content"
      v-bind="{ ...$attrs, ...forwarded, sideOffset: effectiveSideOffset }"
      :class="cn('data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/5 dark:ring-foreground/10 bg-popover text-popover-foreground flex min-w-48 flex-col rounded-3xl p-1.5 shadow-lg ring-1 duration-100 cn-menu-translucent z-50 max-h-(--reka-dropdown-menu-content-available-height) w-(--reka-dropdown-menu-trigger-width) origin-(--reka-dropdown-menu-content-transform-origin) overflow-visible', props.class)"
    >
      <div
        data-slot="dropdown-menu-scroll"
        class="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain"
      >
        <slot />
      </div>
      <DropdownMenuArrow v-if="arrowVisible" :width="16" :height="8" rounded class="fill-popover stroke-line" />
    </DropdownMenuContent>
  </DropdownMenuPortal>
</template>
