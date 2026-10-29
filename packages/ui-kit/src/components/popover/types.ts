import type { UiKitPlacement } from '../../shared/types'

export interface PopoverProps {
  modelValue?: boolean
  placement?: UiKitPlacement
  offset?: number
  title?: string
  description?: string
  width?: string
  maxWidth?: string
  disabled?: boolean
  closeOnOutside?: boolean
  closeOnEscape?: boolean
}
