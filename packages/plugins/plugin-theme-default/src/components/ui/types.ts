/**
 * UI 通用组件的公开类型。
 *
 * 为什么单独一个 .ts：这些类型原先声明在 .vue 里（script setup 顶层 export），而 .vue 的具名
 * 类型导出只能被 vue-tsc 解析 —— 普通 tsc（各插件包的 typecheck）跟随依赖时会报
 * "has no exported member"。挪到 .ts 后两边都能解析，且组件 props 与外部消费方引用同一份定义。
 */

/** 下拉的触发方式：click 左键 | hover 悬停 | contextmenu 右键 */
export type DropdownTrigger = 'click' | 'hover' | 'contextmenu'

/** 下拉选项的最小形状（主题无关） */
export interface SelectOption {
  label: string
  value: string | number
  disabled?: boolean
  /**
   * 可选一句话说明（悬停/聚焦该行时从名称下方浮现）。
   * 视觉与右键菜单的 hover 描述同一套动效（Select 的样式的 .sel-option-copy）。
   */
  description?: string
  /**
   * 可选图标（opaque 句柄，与节点类型 icon 同一写法：SVG 字符串或 Vue 组件）。
   * 行左侧渲染一个 28×28 的图标托（照仓库右键菜单 / 主题菜单的 look）——
   * 有图标时该行自动变「图标 + 名称（+ hover 描述）」两段式。
   */
  icon?: unknown
  /**
   * 可选分组名：相邻选项的 group 不同时，中间插一条分隔线（与右键菜单的分块同款）。
   * 不给 group 的列表**完全不受影响**（一条线都不画）。
   */
  group?: string
}

/**
 * 工具栏下拉菜单的一项（ToolbarDropdownButton 用）。
 *
 * children 非空 = 带二级菜单：二级面板是**独立浮层**（teleport 到 body，贴着这一行右侧），
 * 不再往主面板内部叠一块内嵌区域（那是 2026-10-29 用户截图里的错误形态）。
 *
 * panel 非空 = 这一项展开的是**自定义面板**（如宫格选择器），同样在右侧独立浮层里渲染。
 * 两种都给了时 panel 优先；只想显示一串文字子项时继续用 children。
 */
export interface ToolbarMenuNode {
  key: string
  label: string
  /** 图标（opaque 句柄；今天只在按钮触发器上用，菜单行保留字段便于将来带图标） */
  icon?: unknown
  disabled?: boolean
  danger?: boolean
  /** 子项非空 = 这一行是二级菜单入口 */
  children?: ToolbarMenuNode[]
  /** 自定义二级面板（组件或 render 渲染函数）；有它时这一行右侧显示 › */
  panel?: ToolbarMenuPanel
}

/**
 * 自定义二级面板的上下文。
 *
 * render 写法能直接拿到 close / pick：面板里点「确定」后调 close()，
 * 下拉会一起收起；点某一格需要当成一次选择时调 pick(key)。
 */
export interface ToolbarMenuPanelContext {
  /** 当前菜单项的 key */
  key: string
  /** 当前菜单项的文案 */
  label: string
  /** 从一级菜单到当前项的路径（当前工具栏下拉只有两级） */
  path: string[]
  /** 当前项的原始配置 */
  node: ToolbarMenuNode
  /** 只关闭右侧面板，主菜单保留 */
  closePanel: () => void
  /** 关闭整个下拉（主菜单 + 右侧面板） */
  close: () => void
  /** 当成选中一个菜单项：触发 pick 事件并关闭整个下拉 */
  pick: (key?: string, path?: string[]) => void
  /** 面板里要用的共享状态（直接引调用方定义的对象；不要写进画布 data） */
  state?: Record<string, unknown>
}

/**
 * 工具栏下拉的自定义面板配置。
 *
 * 两种写法：
 * - component + props：适合纯展示或自己处理事件的面板；
 * - render：适合需要「点确定后关闭下拉」这类联动，能拿到 close / pick。
 */
export interface ToolbarMenuPanel {
  /** 直接渲染的 Vue 组件 */
  component?: import('vue').Component
  /** 透传给 component 的 props（事件写成 onXxx） */
  props?: Record<string, unknown>
  /** 自定义渲染；拿到面板上下文自己画 */
  render?: (ctx: ToolbarMenuPanelContext) => import('vue').VNodeChild
  /** 面板最小宽度；缺省跟主菜单一致 */
  width?: string
  /**
   * 面板要读取的共享状态。面板每次打开拿到的都是最新值；
   * 调用方改这个对象不会触发重绘（需要响应式时传 reactive / ref 进去）。
   */
  state?: Record<string, unknown>
}

/**
 * ToolbarDropdownButton 的选择事件载荷。
 *
 * 第三个参数 close 用来收起整个下拉：自定义面板里点「确定」后，
 * 既能处理业务，也能把菜单收起来，不必再自己找 Dropdown 的关闭方法。
 */
export type ToolbarMenuPick = [key: string, path: string[], close: () => void]
