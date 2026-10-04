/**
 * ui-dropdown —— 把「全局通用下拉」注册进包 UI。
 *
 * 用户口径（2026-10-03）：
 *   「你这个 drop down 组件，我看到好像你有多个实现方式……你必须在 package UI 这个库里
 *    进行 drop down 组件的注册。因为如果两个地方同时注册，优先级最高的地方会优先使用，
 *    这相当于 package UI 里面的这个组件优先级最高，那么你其他地方就可以正常地使用原来的
 *    这个组件，它会自动变成最新版本的」
 *
 * 做法与 uiSettingsPanel 完全一致：**注册到同一个场**（registryOf('ui') 的 dropdown 键），
 * 给一个比插件默认件更小的 order —— 谁 order 小谁赢（见 kernel/registry 决策 2）。
 *
 * 于是：
 *   · 任何插件里的 `useUiComponent('dropdown')` 会自动拿到**这一份**，不必改它们的代码；
 *   · 成品应用自己的底栏 / 状态栏 / 左抽屉也直接 import 同一个组件 —— 全应用只剩一份实现；
 *   · 想换一份实现（回退到插件默认件 / 换成别的主题的件），把本插件从 APP_PLUGINS 移除即可，
 *     零代码改动。
 *
 * 为什么挂在应用层：它是「成品应用的全局外观」——底部状态栏、快捷键面板、项目菜单、
 * Agent 面板用的都是它。挂在应用层，这层外观跟着应用走，而不必去改主题插件。
 */
import type { PluginModule } from '@mini-canvas/kernel'
import AxDropdown from './components/AxDropdown.vue'

export const name = 'ui-dropdown'

/** 本件在被注册的场里的 id（诊断时能一眼看出是谁顶替了默认件） */
export const DROPDOWN_ID = name

interface UiField {
  add(key: string, value: unknown, opts?: { id?: string; order?: number }): unknown
}

export const uiDropdownPlugin: PluginModule = {
  name,
  apply(ctx: { registryOf<T>(kind: string): UiField }) {
    const ui = ctx.registryOf<unknown>('ui') as UiField
    // order 比主题默认件(0)小 → 顶替它成为 'dropdown' 的赢家。
    // 所有 useUiComponent('dropdown') 的调用方立刻换成这一份，自己一行都不用改。
    ui.add('dropdown', AxDropdown, { id: DROPDOWN_ID, order: -1 })
  },
}
