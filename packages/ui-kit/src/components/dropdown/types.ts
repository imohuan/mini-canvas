import type { UiKitPlacement } from '../../shared/types'

export type DropdownTrigger = 'click' | 'hover' | 'contextmenu'
export type DropdownLayout = 'overlay-scroll' | 'inner-scroll'

export interface DropdownProps {
  modelValue?: boolean
  placement?: UiKitPlacement
  offset?: number
  matchWidth?: boolean
  trigger?: DropdownTrigger
  hoverCloseDelay?: number
  menuWidth?: string
  menuMinWidth?: string
  menuMaxWidth?: string
  menuMaxHeight?: string
  menuClass?: string
  bodyClass?: string
  teleport?: boolean
  arrow?: boolean
  align?: 'start' | 'center' | 'end' | 'auto'
  /** 浮层 role，默认 menu；选项列表用 listbox */
  menuRole?: string
  layout?: DropdownLayout
  disabled?: boolean
  /** 浮层要挂到的容器，默认 body */
  appendTo?: string | HTMLElement
}

export interface DropdownTriggerSlot {
  open: boolean
  toggle: () => void
  close: () => void
}
