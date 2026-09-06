// @mini-canvas/ui —— UI 成品输出包（渲染抽象层 canvas-render 之上的一层"开箱即用成品 UI"）。
//
// 与 canvas-render 的关系：
// - canvas-render 只做"渲染抽象/宿主"（CanvasHost/SlotHost/SettingsHost/槽机制/注入令牌/面板数据契约），
//   本包把"开箱即用的成品 UI 组件"（如 schema 驱动设置面板 PluginSettingsPanel）收拢为主输出出口。
// - 依赖方向：@mini-canvas/ui → canvas-render（抽象）→ canvas-core-v2（内核），单向不反向。
//
// 消费方（宿主装配 / theme-default 注册默认皮 / dev 演示）从这里取成品面板与默认装配，canvas-render 不再自带成品 UI。

// 成品：schema 驱动设置面板（读 ctx.settings 组/schema 自动长控件）。数据契约/合帧工具来自 canvas-render。
export { default as PluginSettingsPanel } from './components/PluginSettingsPanel.vue'
export type { SettingsPanelSource, SettingSchema, SettingEntry } from '@mini-canvas/canvas-render'
// 成品装配：把本包 PluginSettingsPanel 注册进 settingsPanel 槽的默认装配模块（plugins 数组加它即得默认设置面板）
export { default as uiDefaultSettingsPlugin, registerUiDefaultSettingsPanel } from './defaultSettingsPlugin'
