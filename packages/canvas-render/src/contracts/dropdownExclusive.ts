/**
 * dropdownExclusive —— 「同屏只开一个下拉浮层」的进程内登记表。
 *
 * 为什么住在渲染层（而不是某个主题插件里）：
 *   这份表要被**所有**下拉实现共用，才能保证互斥。现在应用里同时存在两处下拉实现 ——
 *   `@mini-canvas/ui` 的全局下拉（成品应用注册进目录的那份）与主题默认件
 *   （`@mini-canvas/plugin-theme-default` 的 Dropdown，它被同包的 Select 直接复用）。
 *   两处若各拿一份表，就会同时开出两个浮层。放在共同依赖里，两边 import 同一份。
 *
 * 为什么必须是独立模块（不写在组件的 `<script setup>` 里）：
 *   `<script setup>` 的顶层代码会被编译进 **setup() 函数体**，于是每个组件实例各拿一份
 *   「模块级」变量 —— 登记表在实例之间根本不通、互斥自然失效
 *   （实测：两个下拉同时开着）。要真模块作用域，就得放在独立 .ts 模块里。
 *
 * 语义：谁打开就把自己的 closer 登记进来，并**先把别的都关掉**；关闭/卸载时摘掉自己。
 */

const openClosers = new Set<() => void>()

/**
 * 「关掉所有下拉」的广播事件名（window 上的 CustomEvent，不带载荷）。
 *
 * 为什么要一条广播、而不是让调用方 import 某个下拉组件：
 *   拖拽/缩放这类"环境变了"的时刻，发起方（Agent 外壳）**不该知道**下拉是谁实现的、
 *   更不该 import 它。它只管广播一句"都关了吧"，谁开着的谁自己收 ——
 *   两套实现（应用全局件 / 主题默认件）都监听同一条，天然不会漏。
 */
export const DROPDOWN_CLOSE_ALL_EVENT = 'mini-canvas:dropdown-close-all'

/**
 * 「关掉所有**二级**菜单」的广播事件名（detail = 请求方 id；null = 全部关）。
 *
 * 为什么二级菜单要单独一条：一级菜单各自 claim 互斥，但**二级菜单的逻辑父级是一级菜单**，
 * 它不能去 claim 互斥（那样会把父菜单一起关掉）。于是改成：
 * - 一级菜单关闭时广播 null → 挂在它下面的二级菜单全收（二级浮层是 teleport 出去的，不在父 DOM 里，收不到别的信号）；
 * - 二级菜单打开时广播自己的 id → 同级的兄弟菜单互相关掉（父菜单不受影响）。
 */
export const SUB_MENU_CLOSE_EVENT = 'mini-canvas:submenu-close'

/** 关掉所有二级菜单（一级菜单关闭时调用） */
export function closeAllSubMenus(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SUB_MENU_CLOSE_EVENT, { detail: null }))
}

/** 关掉除 keepId 之外的二级菜单（某个二级菜单打开时调用） */
export function broadcastSubMenuOpen(keepId: string): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SUB_MENU_CLOSE_EVENT, { detail: keepId }))
}

/** 广播「关掉所有下拉」（任何实现都会收到） */
export function broadcastCloseAllDropdowns(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(DROPDOWN_CLOSE_ALL_EVENT))
}

/** 打开自己：先把**其它**还开着的浮层关掉（保证同屏只有一个） */
export function claimDropdownExclusive(self: () => void): void {
  for (const closer of [...openClosers]) {
    if (closer !== self) closer()
  }
  openClosers.add(self)
}

/** 关闭自己：从登记表摘掉（幂等，重复调用无副作用） */
export function releaseDropdown(self: () => void): void {
  openClosers.delete(self)
}

/**
 * 把当前开着的浮层**全关掉**（一个不留）。
 *
 * 用途：拖拽/缩放这类"环境变了、浮层不该还挂着"的时刻。消费方（如 Agent 外壳拖拽）
 * 经 window 事件通知，不必 import 任何下拉组件 —— 谁家的浮层都会被这条广播收掉，
 * 所以两套实现（应用全局件 / 主题默认件）都不会漏。
 */
export function closeAllDropdowns(): void {
  for (const closer of [...openClosers]) closer()
}

/** 当前开着的浮层数（仅供测试/调试：断言互斥是否真的生效） */
export function openDropdownCount(): number {
  return openClosers.size
}
