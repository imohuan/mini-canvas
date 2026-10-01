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
}
