/**
 * plugin-theme-default / settings —— 默认"设置面板"皮。
 *
 * 定位（settings-panel-slot-host-plan §三.B）：theme-default 本就是"画布默认皮"插件，把设置面板这层
 * "渲染 UI 皮"一并提供，职责仍一致(只渲染、不带业务)。与主 index.ts 分开成独立模块/插件，避免在他人
 * 未提交的 index.ts 上加行；demo/宿主把本模块与 themeDefaultPlugin 并列装载即可获得默认设置面板。
 *
 * 机制：settingsPanel 是一个"可替换设置面板"的 theme 单赢家槽(渲染层 SettingsHost 消费 winner)。
 * - 默认皮 = @mini-canvas/ui 导出的 schema 驱动成品面板 PluginSettingsPanel(order:0)。以后想换，装个 order 更小的插件
 *   `ctx.theme.register('settingsPanel', 新组件, {order:-1})` 即顶替；热卸该插件自动回退默认。
 * - 数据：SettingsHost 渲染赢家时把 ctx.settings 实时喂给它(props.settings)。PluginSettingsPanel 声明同名 prop。
 */
import { PluginSettingsPanel } from '@mini-canvas/ui'
import type { PluginScope } from '@mini-canvas/canvas-base'
import type { PluginModule } from '@mini-canvas/canvas-base'

/** 把默认设置面板注册进 settingsPanel 槽（theme 单赢家 order:0）。供宿主/其它插件复用调用 */
export function registerDefaultSettingsPanel(ctx: PluginScope): void {
  ctx.theme.register('settingsPanel', PluginSettingsPanel, { id: 'default', order: 0 })
}

/** 独立可装配模块：demo/宿主在 plugins 数组里加它即获得默认设置面板(与 themeDefaultPlugin 并列) */
export const settingsPanelPlugin: PluginModule = {
  name: 'theme-default/settings',
  apply(ctx) {
    registerDefaultSettingsPanel(ctx)
  },
}

export default settingsPanelPlugin
