export interface ContextMenuItem {
  id: string
  label: string
  icon?: string
  shortcut?: string
  description?: string
  disabled?: boolean
  danger?: boolean
  divider?: boolean
  group?: string
  children?: ContextMenuItem[]
}

export interface ContextMenuProps {
  items: ContextMenuItem[]
  x?: number
  y?: number
  /** 是否显示；受控时生效 */
  modelValue?: boolean
  minWidth?: string
  maxHeight?: string
}
