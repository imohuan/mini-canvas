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
  /**
   * 旧主题调用面兼容：'match' 与触发器同宽、'auto' 由内容决定、其它值当 CSS 宽度。
   * 内部仍交给同一个 Dropdown，不另做浮层。
   */
  dropdownWidth?: string
  /** 浮层最大宽度（CSS 值）。 */
  dropdownMaxWidth?: string
  /** 浮层最大高度（CSS 值）；超出在面板内滚动。 */
  dropdownMaxHeight?: string
  /** 浮层最小宽度（CSS 值）。 */
  dropdownMinWidth?: string
  disabled?: boolean
  invalid?: boolean
  error?: string
  clearable?: boolean
  /** 无匹配时的文案 */
  emptyText?: string
  ariaLabel?: string
  /** 下拉最小宽度 */
  menuMinWidth?: string
  /** 触发器 id，供外部 <label for> 关联。 */
  inputId?: string
}
