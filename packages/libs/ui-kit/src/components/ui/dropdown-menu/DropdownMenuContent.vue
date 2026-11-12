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
    /** 'optimized'（默认）只按需重算；浮层内容会主动改宽高时（卡片/分栏切换）传 'always' */
    updatePositionStrategy: undefined,
  },
)
const emits = defineEmits<DropdownMenuContentEmits>()

const arrowVisible = computed(() => popupArrowVisible('dropdown', props.arrow))
const effectiveSideOffset = computed(() => popupSideOffset('dropdown', props.sideOffset))
const delegatedProps = reactiveOmit(props, 'class', 'arrow', 'sideOffset', 'updatePositionStrategy')

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
    updatePositionStrategy: props.updatePositionStrategy,
    /**
     * data-slot 必须在这里显式给：v-bind 集中透传后，模板上的静态 data-slot 不再渲染
     * —— 而 ui-layers.css / host.css 的层级与外观规则全靠它选中（漏掉时菜单 z-50
     * 被弹窗 100000 压住，实测弹窗里的模型菜单整个被盖住）。子组件自己的 slot 名在
     * forwarded 里不带，这里固定为 content。
     */
    'data-slot': 'dropdown-menu-content',
    /**
     * 默认外观类必须保留在 JS 合并里（不能只写在模板上）：重构成 v-bind 集中透传后，
     * 模板上的 class 字符串不再渲染 —— 实测「生成模型」面板整个变透明（用户 2026-11-07
     * 截图：卡片/分栏面板背景穿透）。这里 = reka 原默认类 + 调用方 class。
     */
    class: [
      'bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/5 dark:ring-foreground/10 flex min-w-48 flex-col rounded-3xl p-1.5 shadow-lg ring-1 duration-100 cn-menu-translucent z-50 max-h-(--reka-dropdown-menu-content-available-height) w-(--reka-dropdown-menu-trigger-width) origin-(--reka-dropdown-menu-content-transform-origin) overflow-visible',
      props.class,
    ],
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
