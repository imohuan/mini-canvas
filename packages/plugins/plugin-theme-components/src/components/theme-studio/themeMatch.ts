/**
 * 模板匹配 —— 纯函数。
 *
 * 目的：回答一个用户看得见的问题——"我现在这套配色，还算不算某套模板？"
 * 改过任意一格颜色后答案应变成"不是"，于是界面把选择卡片切到「自定义」。
 *
 * 关键：必须按**每一格的实际期望值**比对，不能只比模板声明过的 overrides。
 * 否则「雾青」这种 overrides 为空的模板会匹配任何配色，永远被选中。
 */
import type { LabTheme } from './storage'
import { CUSTOM_THEME_ID } from './storage'
import type { ThemeLabColorEntry, ThemeLabMode } from './catalog'

/** 要参与比对的格子：每个颜色 token 的亮/暗两格。 */
export function themeKeys(entries: readonly ThemeLabColorEntry[], modes: readonly ThemeLabMode[]): string[] {
  const keys: string[] = []
  for (const entry of entries) {
    for (const mode of modes) keys.push(mode === 'light' ? entry.keys.light : entry.keys.dark)
  }
  return keys
}

/** 这套模板在某一格上期望的值：声明过就用它，没声明就回落字段默认值。 */
export function expectedValue(theme: LabTheme, entry: ThemeLabColorEntry, forMode: ThemeLabMode): string {
  const key = forMode === 'light' ? entry.keys.light : entry.keys.dark
  const declared = theme.overrides[key]
  if (declared !== undefined) return declared
  return forMode === 'light' ? entry.defaults.light : entry.defaults.dark
}

/**
 * 当前 settings 里的值是否完全等于这套模板。
 *
 * @param values 当前每格的值（settings key → 值）。缺 key 视为空串。
 */
export function matchesThemeValues(
  theme: LabTheme,
  entries: readonly ThemeLabColorEntry[],
  modes: readonly ThemeLabMode[],
  values: Readonly<Record<string, string>>,
): boolean {
  for (const entry of entries) {
    for (const mode of modes) {
      const key = mode === 'light' ? entry.keys.light : entry.keys.dark
      const actual = String(values[key] ?? '').trim()
      const expected = String(expectedValue(theme, entry, mode) ?? '').trim()
      if (actual !== expected) return false
    }
  }
  return true
}

/** 返回第一套与当前值完全一致的模板 id；都不一致 → 自定义。 */
export function themeIdForValues(
  themes: readonly LabTheme[],
  entries: readonly ThemeLabColorEntry[],
  modes: readonly ThemeLabMode[],
  values: Readonly<Record<string, string>>,
): string {
  for (const theme of themes) {
    if (matchesThemeValues(theme, entries, modes, values)) return theme.id
  }
  return CUSTOM_THEME_ID
}
