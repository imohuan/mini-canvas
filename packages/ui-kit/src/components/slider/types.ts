import type { UiKitSize } from '../../shared/types'

export interface SliderProps {
  modelValue?: number
  min?: number
  max?: number
  step?: number
  size?: UiKitSize
  disabled?: boolean
  /** 是否显示数值 */
  showValue?: boolean
  /** 数值格式化，默认四舍五入 */
  format?: (value: number) => string
  ariaLabel?: string
}
