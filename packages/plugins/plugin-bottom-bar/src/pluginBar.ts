/**
 * pluginBar —— PluginModule 出口（装配清单用 { name, inject, apply }；HMR reload 按 name）。
 * 逻辑都在 nodeBarPlugin.ts（服务 + 注册糖 + apply），这里只做一次转发。
 */
import { name, inject, apply } from './nodeBarPlugin'

export { name, inject, apply, BOTTOM_BAR_SLOT } from './nodeBarPlugin'

export const pluginBottomBar = { name, inject, apply }

