/**
 * 设置面板"换皮"插件 —— 把本应用成品的设置界面（AppSettingsPanel）注册到可替换槽 `settingsPanel`。
 *
 * 为什么单独立一个插件（而不是改 theme-default）：
 *   settingsPanel 是**主题单赢家槽**，谁 order 小谁赢。theme-default 注册的默认皮 order=0；
 *   这里用 order=-1 顶替它 → 宿主 `<SettingsHost/>` 一行不动就会渲染本界面。
 *   想换回默认皮：把本插件从 APP_PLUGINS 移除即可（或改 order），零代码改动。
 *
 * 契约与默认皮完全一致：props 收 { settings }，✕ / 点遮罩 / Esc 通过 ctx.emit('settings:ui-close') 通知宿主关闭。
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
