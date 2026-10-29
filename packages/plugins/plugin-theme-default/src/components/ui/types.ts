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
}
