<script setup lang="ts">
/**
 * Dropdown —— 默认主题对 @mini-canvas/ui-kit Dropdown 的**薄适配层**。
 *
 * 为什么还要这一层：主题的调用方（ColorField / Select / ToolParamGroup / 右键菜单…）
 * 早就在用 `menuWidth` 这套 props；直接让它们全部改名会把风险推给每个业务插件。
 * 这里只做三件事：
 *   1. 把旧 props 映射到 ui-kit 的同义参数；
 *   2. 保留旧版“menuWidth = 菜单最小宽度”的语义（ui-kit 的 menuWidth 是固定宽）；
 *   3. 给菜单外面加默认皮的那层 `dd-menu` 外观类。
 *
 * 浮层定位、翻转、外点/Esc 关闭、同屏互斥、祖先浮层豁免、焦点回触发器全在 ui-kit 里，
 * 本文件不再维护第二套实现。
 */
import { computed } from 'vue'
import { Dropdown as UiKitDropdown } from '@mini-canvas/ui-kit'
import type { DropdownTrigger } from './types'
import './dropdown-theme.css'

const props = withDefaults(
  defineProps<{
    modelValue?: boolean
    placement?: string
    offset?: number
    matchWidth?: boolean
    /** 触发方式：click 左键 | hover 悬停 | contextmenu 右键 */
    trigger?: DropdownTrigger
    /** hover 模式下鼠标离开触发器后延迟关闭的时间 (ms) */
    hoverCloseDelay?: number
    /** 菜单最小宽度（旧语义）；不填时由内容决定 */
    menuWidth?: string
    menuMaxWidth?: string
    /** 菜单贴着触发按钮那条边的小箭头（默认关） */
    arrow?: boolean
    /** 内容区扩展样式 */
    bodyClass?: string
    teleport?: boolean
    /** 浮层最大高度，超出滚动 */
    menuMaxHeight?: string
    /** 浮层 role（默认 menu；选项列表用 listbox） */
    menuRole?: string
    /** 浮层的滚动结构：整层滚 / 只让内容区滚 */
    layout?: 'overlay-scroll' | 'inner-scroll'
  }>(),
  {
    modelValue: false,
    placement: 'bottom-start',
    offset: 6,
    matchWidth: false,
    trigger: 'click',
    hoverCloseDelay: 150,
    menuWidth: '',
    menuMaxWidth: '',
    arrow: false,
    bodyClass: '',
    teleport: true,
    menuMaxHeight: '',
    menuRole: 'menu',
    layout: 'overlay-scroll',
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

/**
 * 旧版传给 ui-kit 的方向：它同时支持 placement 后缀与显式 align，
 * 这里保留原字符串即可；不再像旧实现那样自己解析九宫格。
 */
const placement = computed(() => (props.placement || 'bottom-start') as never)

/**
 * ui-kit 的 menuWidth 是固定宽度，旧语义是最小宽度。
 * 传 menuMinWidth 既保留“至少这么宽”，又允许内容继续撑开。
 */
const menuMinWidth = computed(() => props.menuWidth.trim())

function onOpenChange(value: boolean): void {
  emit('update:modelValue', value)
}
</script>

<template>
  <UiKitDropdown
    :model-value="modelValue"
    :placement="placement"
    :offset="offset"
    :match-width="matchWidth"
    :trigger="trigger"
    :hover-close-delay="hoverCloseDelay"
    :menu-min-width="menuMinWidth"
    :menu-max-width="menuMaxWidth"
    :menu-max-height="menuMaxHeight"
    :menu-class="'dd-menu ' + (layout === 'inner-scroll' ? 'dd-menu--inner-scroll' : '')"
    :body-class="bodyClass"
    :teleport="teleport"
    :arrow="arrow"
    :menu-role="menuRole"
    :layout="layout"
    @update:model-value="onOpenChange"
  >
    <template #trigger="slotProps">
      <div class="dd-trigger">
        <slot name="trigger" v-bind="slotProps" />
      </div>
    </template>
    <template #default="slotProps">
      <slot v-bind="slotProps" />
    </template>
  </UiKitDropdown>
</template>
