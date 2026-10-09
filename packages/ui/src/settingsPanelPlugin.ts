/**
 * 设置面板"换皮"插件 —— 把本应用成品的设置界面（AppSettingsPanel）注册到可替换槽 `settingsPanel`。
 * 注册进去的是**中间层**（左导航 + 内容）；最外层 Dialog 由渲染层 SettingsShell 提供。
 *
 * 为什么单独立一个插件（而不是改 theme-default）：
 *   settingsPanel 是**主题单赢家槽**，谁 order 小谁赢。theme-default 注册的默认皮 order=0；
 *   这里用 order=-1 顶替它 → 宿主 `<SettingsHost/>` 一行不动就会渲染本界面。
 *   想换回默认皮：把本插件从 APP_PLUGINS 移除即可（或改 order），零代码改动。
 *
 * 契约与默认皮完全一致：皮只渲染**中间层**（props 收 { settings }）；最外层 Dialog（遮罩 / 居中 / 框 / 标题栏 / ✕ / Esc
 * / 点遮罩关闭 / 浮动窗口 / 悬浮球）由渲染层 <SettingsShell> 统一提供，换皮不必重画窗口、也不管怎么关。
*/
import type { PluginModule } from '@mini-canvas/kernel'
import AppSettingsPanel from './components/settings/AppSettingsPanel.vue'

const name = 'ui-settings-panel'

export const uiSettingsPanelPlugin: PluginModule = {
  name,
  apply(ctx: { theme: { register(slot: string, comp: unknown, opts?: { id?: string; order?: number }): void } }) {
    // order 比默认皮(0)小 → 顶替它成为 settingsPanel 赢家
    ctx.theme.register('settingsPanel', AppSettingsPanel, { id: name, order: -1 })
  },
}
