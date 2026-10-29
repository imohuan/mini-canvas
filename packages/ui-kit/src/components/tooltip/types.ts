import type { UiKitPlacement } from '../../shared/types'

export interface TooltipProps {
  content?: string
  placement?: UiKitPlacement
  delay?: number
  disabled?: boolean
  /** 触发器是否可以聚焦；默认 true */
  focusable?: boolean
  maxWidth?: string
}
