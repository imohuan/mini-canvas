/**
 * 把「颜色配方」挂进设置页：外观 → 主题 → 主题工作台。
 *
 * 这个入口原来由 demo-kit 注册；颜色配方本质是默认主题的能力（读写的都是
 * 主题色板），所以搬到这里，跟着默认主题一起常驻、一起回收。
 */
import { markRaw } from 'vue'
import type { Context } from '@plume-canvas/canvas-base'
import { SETTINGS_HIDDEN_FIELD, SETTINGS_HIDDEN_KEY, type SettingsHiddenDecl } from '../settings/navCategory'
import ThemeStudio from './ThemeStudio.vue'

/** 设置面板里这一节的导航名（= Config 分组名 = settingsGroup 槽键） */
export const THEME_STUDIO_NAV_ID = '外观/主题工作台'

/**
 * 颜色配方要隐藏掉的设置项。
 *
 * 配方里已经有全部取色器（还能成套换模板），所以原来那两个分组里的 24 个
 * 零散取色器就是重复项 —— 用户口径：「我设计了这个工作台之后，主题配置就
 * 没有什么必要了」。
 *
 * 这里登记的是**整组**；如果以后只想藏单项，改成 { group, key } 即可。
 */
export const HIDDEN_SETTINGS: readonly SettingsHiddenDecl[] = [
  { group: '外观/主题配色' },
  { group: '外观/暗色主题配色' },
]

/**
 * 注册整页正文。
 *
 * 只注册 settingsGroup 槽：左侧导航「外观 → 主题 → 主题工作台」由 defaultMenu 的
 * section（group = 主题工作台）负责，不需要再额外注册一个一级入口。
 */
export function registerThemeStudio(ctx: Context): void {
  registerHiddenSettings(ctx)
  ctx.slots.register('settingsGroup/' + THEME_STUDIO_NAV_ID, {
    id: 'theme-components/theme-studio',
    order: 6,
    component: markRaw(ThemeStudio),
    meta: { mode: 'replace', title: THEME_STUDIO_NAV_ID },
  })
}

/**
 * 把「隐藏声明」登记进 settings/hidden 场域。
 *
 * 单独一个函数：以后别的整页（例如某个专门的画布页）想隐藏自己的零散配置，
 * 照着调用即可，不必经过颜色配方。
 */
export function registerHiddenSettings(ctx: Context): void {
  const field = ctx.registryOf<SettingsHiddenDecl>(SETTINGS_HIDDEN_FIELD)
  for (const decl of HIDDEN_SETTINGS) {
    const id = [decl.group, decl.key].filter(Boolean).join('#')
    field.add(SETTINGS_HIDDEN_KEY, decl, { id })
  }
}

export { ThemeStudio }

