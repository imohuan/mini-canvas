import type { UiKitSize } from '../../shared/types'

export interface SelectOption {
  value: string | number
  label: string
  description?: string
  disabled?: boolean
  group?: string
  icon?: string
}

export interface SelectProps {
  modelValue?: string | number | null
  options: SelectOption[]
  size?: UiKitSize
  placeholder?: string
  searchable?: boolean
  searchPlaceholder?: string
  disabled?: boolean
  invalid?: boolean
  error?: string
  clearable?: boolean
  /** 无匹配时的文案 */
  emptyText?: string
  ariaLabel?: string
  /** 下拉最小宽度 */
  menuMinWidth?: string
}
