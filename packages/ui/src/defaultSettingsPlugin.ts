/**
 * defaultSettingsPlugin —— @mini-canvas/ui 自带的"默认设置面板"装配模块。
 *
 * 定位：@mini-canvas/ui 是成品 UI 输出包，本体自带设置面板(PluginSettingsPanel)与把它挂进
 * settingsPanel 槽的最小装配，消费方(CanvasApp 演示 / 其它宿主)在 plugins 数组加本模块即获得默认设置面板，
 * 无需外借 theme-default/settings 那层。
 *
 * 机制：settingsPanel 是"可替换设置面板"的 theme 单赢家槽(渲染抽象层 SettingsHost 消费 winner)：
 * - 本模块把 PluginSettingsPanel 注册为默认皮(order:0)。想换皮就再装个 order 更小的插件
 *   `ctx.theme.register('settingsPanel', 新组件, {order:-1})` 顶替；热卸自动回退默认。
 * - 数据：SettingsHost 渲染赢家时把 ctx.settings 实时喂给面板(props.settings)。PluginSettingsPanel 声明同名 prop。
 *
 * 依赖方向：仅依赖内核(canvas-core-v2 的 Context/PluginModule) + 本包面板，不反向依赖宿主/theme-default。
 */
import type { PluginModule, PluginScope } from '@mini-canvas/canvas-core-v2'
import PluginSettingsPanel from './components/PluginSettingsPanel.vue'

/** 把默认设置面板注册进 settingsPanel 槽(theme 单赢家 order:0)。供宿主/其它插件复用调用 */
export function registerUiDefaultSettingsPanel(ctx: PluginScope): void {
  ctx.theme.register('settingsPanel', PluginSettingsPanel, { id: 'ui-default', order: 0 })
}

/** 独立可装配模块：CanvasApp/宿主在 plugins 数组加它即获得 @mini-canvas/ui 的默认设置面板 */
export const uiDefaultSettingsPlugin: PluginModule = {
  name: 'ui/default-settings',
  apply(ctx) {
    registerUiDefaultSettingsPanel(ctx)
  },
}

export default uiDefaultSettingsPlugin
