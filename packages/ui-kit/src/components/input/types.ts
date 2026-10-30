import type { UiKitSize } from '../../shared/types'

export interface InputProps {
  modelValue?: string | number
  size?: UiKitSize
  type?: 'text' | 'password' | 'email' | 'search' | 'url' | 'tel'
  placeholder?: string
  disabled?: boolean
  readonly?: boolean
  clearable?: boolean
  invalid?: boolean
  /** 错误提示；传了就显示在输入框下方 */
  error?: string
  /** 辅助说明 */
  hint?: string
  maxlength?: number
  minlength?: number
  name?: string
  autocomplete?: string
  /** 前缀图标区域 */
  prefix?: string
  /** 读屏名称；没有可见 label 时必填 */
  ariaLabel?: string
}
