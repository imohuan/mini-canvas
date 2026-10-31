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
  /** 箭头额外的类名：调用方要给箭头换色/换形状时用（箭头由库定位，类名由调用方提供）。 */
  arrowClass?: string
  align?: 'start' | 'center' | 'end' | 'auto'
  /** 浮层 role，默认 menu；选项列表用 listbox */
  menuRole?: string
  /** 浮层层级：不填走 Provider 的 --mck-z-dropdown；宿主已有层叠带时传同一个值。 */
  zIndex?: number | string
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
  /**
   * 本浮层的稳定链标识；嵌套下拉用，父面板会带上 attr。
   * 默认自动生成，调用方一般不用传。
   */
  chainId?: string
  /**
   * 显式父浮层链（空格分隔）。用于触发器不在父面板 DOM 里的子浮层
   * （行尾按钮在列表外，但菜单应算列表的子浮层）；不传则读自己的 DOM 祖先。
   */
  parentChain?: string
  /**
   * 父浮层是否还开着（仅显式父链时用）。父关 → 自己跟着收，避免留下孤儿菜单。
   * 不传 = 不跟随（等价于独立浮层）。
   */
  parentOpen?: () => boolean | undefined
  /** 聚焦回触发器：Esc/选择关闭后把键盘焦点还给按钮，默认 true。 */
  restoreFocus?: boolean
  /**
   * 宿主「全部关闭」广播的事件名（window CustomEvent，无载荷）。
   * 拖拽/缩放这类环境变化时，宿主不必知道浮层是谁实现的，广播一句即可。
   * 留空 = 不监听（独立使用组件库时没有宿主广播）。
   */
  closeAllEvent?: string
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
