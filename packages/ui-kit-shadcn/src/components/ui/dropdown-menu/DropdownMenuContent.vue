<script setup lang="ts">
import type { DropdownMenuContentEmits, DropdownMenuContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { computed, useAttrs } from 'vue'
import { reactiveOmit } from '@vueuse/core'
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
const attrs = useAttrs()

/**
 * 集中合并透传属性（2026-11-07）：调用方绑的 class / style 经 $attrs 进来后，
 * 必须与 reka 生成的 props 合并，且**调用方的 style 放在最后**。
 * 之前模板里 v-bind={...$attrs} 会把 reka 内部生成的 style 覆盖掉调用方
 * 显式绑的 width，表现是「:style 绑的宽度时有时无」（底栏模型/动作菜单实测）。
 */
const contentBindings = computed(() => {
  const all = attrs as Record<string, unknown>
  const callerStyle = attrs.style
  const rest: Record<string, unknown> = { ...all }
  delete rest.style
  delete rest.class
  return {
    ...rest,
    ...forwarded.value,
    sideOffset: effectiveSideOffset.value,
    class: props.class,
    ...(callerStyle !== undefined ? { style: callerStyle } : {}),
  }
})
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
    <DropdownMenuContent v-bind="contentBindings">
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
