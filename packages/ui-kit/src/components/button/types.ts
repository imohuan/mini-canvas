import type { UiKitSize } from '../../shared/types'

export const BUTTON_VARIANTS = ['primary', 'secondary', 'ghost', 'danger'] as const
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number]
export const BUTTON_SIZES = ['sm', 'md', 'lg'] as const
export type ButtonSize = UiKitSize

export interface ButtonProps {
  variant?: ButtonVariant
  /** 不传时跟随 Provider */
  size?: ButtonSize
  block?: boolean
  disabled?: boolean
  loading?: boolean
  type?: 'button' | 'submit' | 'reset'
  ariaLabel?: string
  title?: string
  iconOnly?: boolean
  round?: boolean
}
