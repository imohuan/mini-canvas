import type { UiKitSize } from '../../shared/types'

export type ButtonGroupOrientation = 'horizontal' | 'vertical'

export interface ButtonGroupProps {
  orientation?: ButtonGroupOrientation
  size?: UiKitSize
  /** 按钮之间是否留缝 */
  attached?: boolean
  /** 整组占满宽度 */
  block?: boolean
  ariaLabel?: string
}
