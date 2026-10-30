import type { DropdownAnchor, DropdownTrigger } from '../dropdown/types'

export interface TooltipProps {
  content?: string
  /** 九宫格方向，默认 top。 */
  placement?: DropdownAnchor
  delay?: number
  disabled?: boolean
  /** 触发器是否可以聚焦；默认 true */
  focusable?: boolean
  maxWidth?: string
  /** 触发方式；默认 hover，click 会让提示点一下才出现。 */
  trigger?: DropdownTrigger
  /** 悬停离开后延迟关闭。 */
  closeDelay?: number
  /** 显示指向触发器的小箭头。 */
  arrow?: boolean
  /** 浮层挂载容器，默认 body。 */
  appendTo?: string | HTMLElement
  /** 外部锚点：DOM / Ref / getter。 */
  anchor?: import('../dropdown/types').DropdownAnchorElement | null
  /**
   * 是否叠加 Dropdown 的默认面板外观。
   * 默认 false：Tooltip 自己画提示气泡（黑底小字），不会被套一层卡片。
   */
  bare?: boolean
}
