<script setup lang="ts">
import type { SelectContentEmits, SelectContentProps } from 'reka-ui'
import { computed, type HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { cn } from 'cn'
import {
  SelectContent,
  SelectPortal,
  SelectViewport,
  useForwardPropsEmits,
} from 'reka-ui'
import { SelectScrollDownButton, SelectScrollUpButton } from '.'
import { popupArrowVisible, popupDirectArrowSideOffset } from '../../../popup/popupConfig'

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(
  defineProps<SelectContentProps & { class?: HTMLAttributes['class']; arrow?: boolean }>(),
  {
    position: 'item-aligned',
    align: 'center',
    // 缺省必须是 undefined，不能交给 Vue 的布尔缺省 false；否则会盖掉全局浮层配置。
    arrow: undefined,
    sideOffset: undefined,
  },
)
const emits = defineEmits<SelectContentEmits>()

const arrowVisible = computed(() => popupArrowVisible('select', props.arrow))
/**
 * 直接 SVG 箭头不是 reka 的 SelectArrow，reka 不会替它加箭头高度，
 * 所以这里不能复用 `popupSideOffset('select')` 的“先扣 5px”算法；
 * 否则面板边缘只留 3px，箭头尖端会压到触发器。
 */
const effectiveSideOffset = computed(() => popupDirectArrowSideOffset('select', props.sideOffset))
const delegatedProps = reactiveOmit(props, 'class', 'arrow', 'sideOffset')

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <SelectPortal>
    <SelectContent
      data-slot="select-content"
      :data-align-trigger="position === 'item-aligned'"
      v-bind="{ ...$attrs, ...forwarded, sideOffset: effectiveSideOffset }"
      :class="cn(
        /*
         * p-1.5（6px）不能省：DropdownMenuContent / ContextMenuContent / MenubarContent
         * 都带这一档内边距，只有 SelectContent 的模板漏了，导致选项直接贴到菜单边框上
         * （用户 2026-11-02 反馈「下拉内部的 padding 被吃了」）。
         * 与那几处保持一致，菜单四边留 6px，选中高亮块才不会顶到圆角。
         */
        'bg-popover text-popover-foreground group/select data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/5 dark:ring-foreground/10 min-w-36 rounded-3xl p-1.5 shadow-lg ring-1 duration-100 data-[side=inline-start]:slide-in-from-right-2 data-[side=inline-end]:slide-in-from-left-2 cn-menu-translucent relative z-50 max-h-(--reka-select-content-available-height) origin-(--reka-select-content-transform-origin) overflow-visible data-[align-trigger=true]:animate-none',
        /* 不再额外 translate-y：那会叠加在 sideOffset 上，让同一档间距在 Select 上多出 4px。 */
        // 箭头必须画在外框的 overflow 之外：外框裁剪圆角，滚动交给里面那层 viewport。
        // 否则 overflow-y-auto 会把 SelectArrow 一起裁掉，设置里开了「全部显示」也看不见。
        props.class,
      )
      "
    >
      <SelectScrollUpButton />
      <div
        class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        data-slot="select-viewport-scroll"
      >
        <SelectViewport
          :data-position="position"
          :class="cn(
            'data-[position=popper]:h-(--reka-select-trigger-height) data-[position=popper]:w-full data-[position=popper]:min-w-(--reka-select-trigger-width)',
          )"
        >
          <slot />
        </SelectViewport>
      </div>
      <SelectScrollDownButton />
      <!--
        箭头用直接 SVG，不用 reka 的 SelectArrow：后者只在 position=popper 时渲染，
        而设置页的 Select 可能是 item-aligned；用户开「全部显示」时会静默少一个箭头。
        尺寸与 popupConfig 的 ARROW_HEIGHT.select=5 对齐。
      -->
      <svg
        v-if="arrowVisible"
        data-slot="select-arrow"
        width="10"
        height="5"
        viewBox="0 0 10 5"
        aria-hidden="true"
        class="absolute left-1/2 -translate-x-1/2 fill-popover stroke-line group-data-[side=bottom]/select:-top-[5px] group-data-[side=bottom]/select:-bottom-auto group-data-[side=bottom]/select:rotate-180 group-data-[side=top]/select:-bottom-[5px] group-data-[side=top]/select:-top-auto group-data-[side=left]/select:-right-[5px] group-data-[side=left]/select:-left-auto group-data-[side=left]/select:top-1/2 group-data-[side=left]/select:-translate-y-1/2 group-data-[side=left]/select:translate-x-0 group-data-[side=left]/select:rotate-90 group-data-[side=right]/select:-left-[5px] group-data-[side=right]/select:-right-auto group-data-[side=right]/select:top-1/2 group-data-[side=right]/select:-translate-y-1/2 group-data-[side=right]/select:translate-x-0 group-data-[side=right]/select:-rotate-90"
      >
        <path d="M0 0L5 5L10 0" />
      </svg>
    </SelectContent>
  </SelectPortal>
</template>
