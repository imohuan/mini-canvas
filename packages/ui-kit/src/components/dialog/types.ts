export interface DialogProps {
  modelValue?: boolean
  title?: string
  description?: string
  width?: string
  maxWidth?: string
  maxHeight?: string
  closeOnOverlay?: boolean
  closeOnEscape?: boolean
  showClose?: boolean
  /** 不锁滚动适合侧栏临时面板 */
  lockScroll?: boolean
  panelClass?: string
}
