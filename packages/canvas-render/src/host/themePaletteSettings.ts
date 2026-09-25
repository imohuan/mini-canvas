/**
 * themePaletteSettings —— 把色板接进宿主的两个动作：**声明**（settings 单一数据源）与
 * **落值**（写 `<html>` 内联 CSS 变量）。
 *
 * 为什么由宿主直接装、不做成插件：与 `CANVAS_INTERACTION_SCHEMA`（canvasInteractionSettings.ts）
 * 同一套理由 —— 这是**渲染层自己的配置**，不是应用可装卸的业务插件。宿主声明（scope='canvas-render'）
 * 后，热卸任何插件都不会回收这组声明，用户配色不会因为装卸插件而丢。
 *
 * 为什么写内联变量而不是改 CSS 文件（沿用既有结论）：`<html style="--ui-accent: …">` 的内联优先级
 * 高于 ui-theme.css / app.css 里任何选择器（除非对方带 !important），一处写入全局生效，
 * 不怕加载顺序、不需要提高特异性。
 *
 * 与旧实现（packages/ui/src/themeColorPlugin.ts）的区别：**每个颜色两格**（亮/暗各一个变量），
 * 由 ui-theme.css 的 `:root` / `html.dark` 各挑一个 → 两套主题终于能各配一个值。
 */
import type { SettingsStore } from '@mini-canvas/kernel'
import type { SettingSchema } from '@mini-canvas/kernel'
import {
  buildThemeColorConfig,
  resolveThemeColorOverrides,
  isThemeColorKey,
  themeColorSlots,
  themeColorVarNames,
  type ThemePaletteSettingsLike,
} from '../contracts/themePalette'

/** 声明这组配色进 settings（幂等：已声明过就跳过，供多次 boot / 多宿主场景） */
export function defineThemePaletteSettings(settings: SettingsStore): void {
  const schema = buildThemeColorConfig()
  const first = Object.keys(schema)[0]
  if (first && settings.has(first)) return

  // 逐格 define：SettingsStore.define(group, items, scope) 以"组"为单位申报，
  // 而本表两格分属两个分组（亮/暗各一个页签），故按 group 分桶后各申报一次。
  const byGroup = new Map<string, Record<string, SettingSchema>>()
  for (const [key, field] of Object.entries(schema)) {
    const group = field.group ?? '常规/主题配色'
    const bucket = byGroup.get(group) ?? {}
    bucket[key] = field as unknown as SettingSchema
    byGroup.set(group, bucket)
  }
  for (const [group, items] of byGroup) {
    settings.define(group, items, 'canvas-render')
  }
}

/**
 * 接上色板：立刻写一次当前值，并订阅后续变化实时写。
 *
 * @param settings 内核 settings 服务（可缺省：缺省时只做一次"无值"同步，等价于不覆盖 CSS 默认）
 * @param root 变量落点，默认 `document.documentElement`（测试可传假元素）
 * @returns dispose：解除订阅并清掉内联覆盖（CSS 回落到 ui-theme.css 的默认值）
 */
export function installThemePalette(
  settings: ThemePaletteSettingsLike | undefined,
  root?: HTMLElement,
): () => void {
  const el = root ?? (typeof document === 'undefined' ? undefined : document.documentElement)
  if (!el) return () => {}

  const sync = (): void => {
    const overrides = new Map(
      resolveThemeColorOverrides((k) => settings?.get(k)).map((v) => [v.name, v.value]),
    )
    // 全格遍历：改过 → 写；没改过（或改回默认）→ 清掉内联，把控制权还给 CSS
    for (const slot of themeColorSlots()) {
      const value = overrides.get(slot.cssVar)
      if (value !== undefined) el.style.setProperty(slot.cssVar, value)
      else el.style.removeProperty(slot.cssVar)
    }
  }

  sync()

  if (!settings) return () => {}
  const off = settings.onChange((key) => {
    if (isThemeColorKey(key)) sync()
  })

  return () => {
    off.dispose()
    // 卸载/停用即清掉内联覆盖，否则"幽灵变量"会挡住下一个主题
    for (const name of themeColorVarNames()) el.style.removeProperty(name)
  }
}
