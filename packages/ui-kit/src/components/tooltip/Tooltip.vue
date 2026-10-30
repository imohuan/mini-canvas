<script setup lang="ts">
/**
 * Tooltip 是 Dropdown 的一层「悬停提示」预设。
 *
 * 方向、箭头、外部锚点、挂载容器都来自 Dropdown；
 * 额外只保留提示特有的「悬停延迟」和「焦点可触发」。
 * 传 bare 可以完全自定义提示外观。
 */
import { computed, ref } from 'vue'
import Dropdown from '../dropdown/Dropdown.vue'
import type { DropdownProps } from '../dropdown/types'
import type { TooltipProps } from './types'
import './tooltip.css'

defineOptions({ name: 'MckTooltip' })

const props = withDefaults(defineProps<TooltipProps>(), {
  content: '',
  placement: 'top',
  delay: 180,
  disabled: false,
  focusable: true,
  maxWidth: '280px',
  trigger: 'hover',
  closeDelay: 0,
  arrow: false,
  appendTo: 'body',
  anchor: null,
  bare: true,
})

const dropdown = ref<InstanceType<typeof Dropdown> | null>(null)

const dropdownProps = computed<Partial<DropdownProps>>(() => ({
  anchorPlacement: props.placement,
  anchor: props.anchor,
  offset: 8,
  trigger: props.trigger,
  hoverOpenDelay: props.delay,
  hoverCloseDelay: props.closeDelay,
  appendTo: props.appendTo,
  arrow: props.arrow,
  menuMaxWidth: props.maxWidth,
  disabled: props.disabled || !props.content,
  bare: props.bare,
  menuRole: 'tooltip',
}))

/** 键盘聚焦也显示提示：焦点进来时手动开，离开时关。 */
function onFocusIn(): void {
  if (!props.focusable) return
  dropdown.value?.show()
}

function onFocusOut(): void {
  if (!props.focusable) return
  dropdown.value?.hide()
}
</script>

<template>
  <Dropdown
    ref="dropdown"
    v-bind="dropdownProps"
    class="mck-tooltip-root"
  >
    <template #trigger>
      <!--
        触发器只负责「可聚焦」。悬停由 Dropdown 的外层触发区接管，
        所以不要把 mouseenter/mouseleave 绑在这里 —— 会和外层重复。
      -->
      <span
        class="mck-tooltip-trigger"
        :tabindex="focusable ? 0 : undefined"
        @focusin="onFocusIn"
        @focusout="onFocusOut"
        @keydown.esc="dropdown?.hide()"
      >
        <slot />
      </span>
    </template>
    <template #default>
      <span class="mck-tooltip mck-tooltip__body"><slot name="content">{{ content }}</slot></span>
    </template>
  </Dropdown>
</template>
