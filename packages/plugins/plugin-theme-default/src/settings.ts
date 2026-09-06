/**
 * plugin-theme-default / settings —— 默认"设置面板"皮注册模块。
 *
 * 定位：theme-default 是"画布默认皮"插件（节点壳/边/背景/主题），设置面板这层"渲染 UI 皮"职责一致
 * （只渲染、不带业务），故 PluginSettingsPanel 本体与注册都在本包内(src/components + 本文件)。
 * 成品应用(如 @mini-canvas/ui)把本模块与 themeDefaultPlugin 并列装载，再用 SettingsHost(canvas-render)
 * 渲染即可获得默认设置面板。
 *
 * 机制：settingsPanel 是"可替换设置面板"的 theme 单赢家槽(渲染抽象层 SettingsHost 消费 winner)。
 * - 默认皮 = 本包 schema 驱动面板 PluginSettingsPanel(order:0)。想换皮装个 order 更小的插件
 *   `ctx.theme.register('settingsPanel', 新组件, {order:-1})` 即顶替；热卸自动回退默认。
 * - 数据：SettingsHost 渲染赢家时把 ctx.settings 实时喂给它(props.settings)。PluginSettingsPanel 声明同名 prop。
 *
 * 与主 index.ts 分开成独立模块，避免改动他人未提交的 index.ts；canvas-render/src/index.ts 注释提到本文件。
 */
import type { PluginScope } from '@mini-canvas/canvas-base'
import type { PluginModule } from '@mini-canvas/canvas-base'
import PluginSettingsPanel from './components/PluginSettingsPanel.vue'

/** 把默认设置面板注册进 settingsPanel 槽(theme 单赢家 order:0)。供宿主/成品应用复用调用 */
export function registerDefaultSettingsPanel(ctx: PluginScope): void {
  ctx.theme.register('settingsPanel', PluginSettingsPanel, { id: 'default', order: 0 })
}

/** 独立可装配模块：成品应用/宿主在 plugins 数组里加它即获得默认设置面板(与 themeDefaultPlugin 并列) */
export const settingsPanelPlugin: PluginModule = {
  name: 'theme-default/settings',
  apply(ctx) {
    registerDefaultSettingsPanel(ctx)
  },
}

export default settingsPanelPlugin
