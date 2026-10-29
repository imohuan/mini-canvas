import type { UiKitSize } from '../../shared/types'

export interface TabItem {
  value: string
  label: string
  disabled?: boolean
  badge?: string | number
}

export interface TabsProps {
  modelValue?: string
  items: TabItem[]
  size?: UiKitSize
  /** 是否占满整行 */
  block?: boolean
  ariaLabel?: string
}
