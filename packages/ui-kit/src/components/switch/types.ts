import type { UiKitSize } from '../../shared/types'

export interface SwitchProps {
  modelValue?: boolean
  size?: UiKitSize
  disabled?: boolean
  loading?: boolean
  label?: string
  description?: string
}
