import type { UiKitPlacement, UiKitSize } from '../../shared/types'
import type { Component } from 'vue'

export interface SelectOption {
  value: string | number
  label: string
  description?: string
  disabled?: boolean
  group?: string
  /** 图标句柄：SVG 字符串按 HTML 渲染，Vue 组件按组件渲染。 */
  icon?: string | Component
}

export interface SelectProps {
  modelValue?: string | number | null
  options: SelectOption[]
  size?: UiKitSize
  placeholder?: string
  searchable?: boolean
  searchPlaceholder?: string
  /** 浮层方向：与 Dropdown 的 placement 同一套语义。 */
  placement?: UiKitPlacement
  /** 是否让浮层与触发器同宽（优先于 menuMinWidth）。 */
  matchWidth?: boolean
  disabled?: boolean
  invalid?: boolean
  error?: string
  clearable?: boolean
  /** 无匹配时的文案 */
  emptyText?: string
  ariaLabel?: string
  /** 下拉最小宽度 */
  menuMinWidth?: string
  /** 下拉最大宽度（CSS 值）。 */
  menuMaxWidth?: string
  /** 下拉最大高度（CSS 值）；超出在面板内滚动。 */
  menuMaxHeight?: string
  /** 触发器 id，供外部 <label for> 关联。 */
  inputId?: string
}
