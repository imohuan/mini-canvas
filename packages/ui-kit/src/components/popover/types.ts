import type { DropdownAnchor, DropdownLayout, DropdownTrigger } from '../dropdown/types'

export interface PopoverProps {
  modelValue?: boolean
  /** 九宫格方向；等价于 Dropdown 的 anchorPlacement。 */
  placement?: DropdownAnchor
  offset?: number
  title?: string
  description?: string
  width?: string
  maxWidth?: string
  disabled?: boolean
  closeOnOutside?: boolean
  closeOnEscape?: boolean
  /** 触发方式，默认 click；hover 让 Popover 像富内容 Tooltip。 */
  trigger?: DropdownTrigger
  hoverCloseDelay?: number
  /** 外部锚点：DOM / Ref / getter，等价于 Dropdown 的同名能力。 */
  anchor?: import('../dropdown/types').DropdownAnchorElement | null
  /** 浮层挂载容器，默认 body。 */
  appendTo?: string | HTMLElement
  /** 显示指向触发器的小箭头。 */
  arrow?: boolean
  /** 浮层固定高度；不填由内容撑开。 */
  menuHeight?: string
  /** 内容滚动结构，透传给 Dropdown。 */
  layout?: DropdownLayout
}
