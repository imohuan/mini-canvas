/**
 * pluginBar —— PluginModule 出口（装配清单用 { name, inject, apply }；HMR reload 按 name）。
 * 逻辑都在 nodeBarPlugin.ts（服务 + 注册糖 + apply），这里只做一次转发。
 */


import { name, inject, apply, Config } from './nodeBarPlugin'

/**
 * ⚠️ Config **必须**出现在插件模块对象上：内核（Context.activate）读的是 `mod.Config`，
 * 只按名 re-export 而不放进对象里，等于这一步被静默丢掉 —— 设置面板不会出现「底栏」分组，
 * 挂在 settingsGroup/底栏 的自绘页也就永远没有宿主（2026-10-27 实测踩过）。
 */
export { name, inject, apply, Config, BOTTOM_BAR_SLOT } from './nodeBarPlugin'

export const pluginBottomBar = { name, inject, apply, Config }

