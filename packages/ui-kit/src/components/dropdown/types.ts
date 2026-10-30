import type { UiKitPlacement } from '../../shared/types'
import type { Ref } from 'vue'

export type DropdownTrigger = 'click' | 'hover' | 'contextmenu' | 'always'
export type DropdownLayout = 'overlay-scroll' | 'inner-scroll'
/**
 * 九宫格方向：前半是主方向（top/right/bottom/left），后半是沿边对齐。
 * bottom-center、right-center 这种没有 start/end 的写法等于“贴边居中”。
 */
export type DropdownAnchor = 'top-start' | 'top' | 'top-end'
  | 'left-start' | 'left' | 'left-end'
  | 'right-start' | 'right' | 'right-end'
  | 'bottom-start' | 'bottom' | 'bottom-end'

/** 允许传 DOM、Ref、getter 三种形式；响应式用 Ref。 */
export type DropdownAnchorElement =
  | HTMLElement
  | Ref<HTMLElement | null | undefined>
  | (() => HTMLElement | null | undefined)

/** 坐标锚点：菜单贴到这个视口坐标上（右键菜单用）。 */
export interface DropdownPoint {
  x: number
  y: number
}

export interface DropdownProps {
  modelValue?: boolean
  placement?: UiKitPlacement
  /** 外部锚点：可以是深层 DOM 元素、Ref 或 getter。 */
  anchor?: DropdownAnchorElement | null
  /**
   * 坐标锚点：直接贴到某个视口坐标。
   * 右键菜单用这个把菜单钉在鼠标点上；设置后 anchor / 触发器都不再参与定位。
   */
  point?: DropdownPoint | null
  /** 浮层挂在锚点的方向；支持九宫格写法。 */
  anchorPlacement?: DropdownAnchor
  offset?: number
  matchWidth?: boolean
  trigger?: DropdownTrigger
  hoverCloseDelay?: number
  /** 悬停后延迟多久打开，默认 0（立即）。 */
  hoverOpenDelay?: number
  menuWidth?: string
  /** 浮层固定高度；不填时由内容撑开 */
  menuHeight?: string
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
  /**
   * 裸面板：去掉默认面板的内边距、边框、圆角、底色和阴影，
   * 只保留定位与滚动外壳。插槽内容自己就是完整的面板 UI。
   *
   * 给 Tooltip 这类「外壳由调用方决定」的组件复用；
   * 普通下拉不要开，否则会丢掉库内统一的浮层外观。
   */
  bare?: boolean
  /** 点面板/触发器以外的地方是否关闭，默认 true。 */
  closeOnOutside?: boolean
  /** 按 Esc 是否关闭，默认 true。 */
  closeOnEscape?: boolean
}

/** 浮层控制接口：给外部“绑定 + 开关”用的服务对象。 */
export interface DropdownController {
  show: () => void
  hide: () => void
  toggle: () => void
  readonly isOpen: boolean
}

export interface DropdownTriggerSlot {
  open: boolean
  toggle: () => void
  close: () => void
}
