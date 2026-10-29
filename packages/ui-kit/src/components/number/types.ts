import type { UiKitSize } from '../../shared/types'

export interface NumberProps {
  modelValue?: number | null
  size?: UiKitSize
  min?: number
  max?: number
  step?: number
  precision?: number
  disabled?: boolean
  readonly?: boolean
  placeholder?: string
  /** 显示加减按钮 */
  controls?: boolean
  /** 数值后面显示的单位 */
  suffix?: string
  invalid?: boolean
  error?: string
}
