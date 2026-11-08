import { computed } from 'vue'
import type { ThemeLabColorEntry, ThemeLabMode } from './catalog'
import type { LabTheme } from './storage'
import type { ThemeStudioState } from './state'

export function useThemeStudioColors(state: ThemeStudioState) {
  const { mode, rawGet, entries, entryOf } = state

  function isHex(value: string): boolean {
    return /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)
  }

  function keyOf(entry: ThemeLabColorEntry, forMode: ThemeLabMode): string {
    return forMode === 'light' ? entry.keys.light : entry.keys.dark
  }

  function rawValueOf(entry: ThemeLabColorEntry, forMode: ThemeLabMode = mode.value): string {
    const value = rawGet(keyOf(entry, forMode))
    return typeof value === 'string' ? value.trim() : ''
  }

  /** 当前 settings 里的真实颜色；可清空的格子解析成“跟随主题”后的可见色。 */
  function colorForBase(base: string, forMode: ThemeLabMode = mode.value, seen = new Set<string>()): string {
    const entry = entryOf(base)
    if (!entry || seen.has(base)) return ''
    seen.add(base)
    const direct = rawValueOf(entry, forMode)
    if (direct) return direct
    if (entry.followKey) {
      const followed = colorForBase(entry.followKey, forMode, seen)
      if (followed) return followed
    }
    return forMode === 'light' ? entry.defaults.light : entry.defaults.dark
  }

  function valueOf(entry: ThemeLabColorEntry, forMode: ThemeLabMode = mode.value): string {
    return colorForBase(entry.id, forMode)
  }

  /** 主题卡片里的颜色：优先看这套模板自己的覆盖值，没有就取该字段默认值。 */
  function colorFromTheme(theme: LabTheme, base: string, forMode: ThemeLabMode, seen = new Set<string>()): string {
    const entry = entryOf(base)
    if (!entry || seen.has(base)) return ''
    seen.add(base)
    const key = keyOf(entry, forMode)
    if (theme.overrides[key]) return theme.overrides[key]
    const fallback = forMode === 'light' ? entry.defaults.light : entry.defaults.dark
    if (fallback) return fallback
    if (entry.followKey) return colorFromTheme(theme, entry.followKey, forMode, seen)
    return ''
  }

  /** 模板缩略图只表现配色气质：真正可交互的是右侧预览卡。 */
  function themeVisualStyle(theme: LabTheme): Record<string, string> {
    const accent = colorFromTheme(theme, 'accentColor', 'light') || 'currentColor'
    return {
      '--tpl-accent': accent,
      '--tpl-accent-ink': inkFor(accent),
      '--tpl-danger': colorFromTheme(theme, 'dangerColor', 'light') || 'currentColor',
      '--tpl-warn': colorFromTheme(theme, 'warnColor', 'light') || 'currentColor',
      '--tpl-flow': colorFromTheme(theme, 'edgeFlowColor', 'light') || accent,
    }
  }

  function inkFor(hex: string): string {
    const raw = String(hex || '').replace('#', '').trim()
    const expanded = raw.length === 3 || raw.length === 4 ? raw.slice(0, 3).split('').map((ch) => ch + ch).join('') : raw.slice(0, 6)
    if (expanded.length !== 6) return 'white'
    const r = parseInt(expanded.slice(0, 2), 16)
    const g = parseInt(expanded.slice(2, 4), 16)
    const b = parseInt(expanded.slice(4, 6), 16)
    if (![r, g, b].every(Number.isFinite)) return 'white'
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.62 ? 'black' : 'white'
  }

  const previewColors = computed(() => {
    const out: Record<string, string> = {}
    const fallback = (base: string, otherwise: string): string => colorForBase(base) || otherwise
    const accent = fallback('accentColor', 'currentColor')
    out['--ui-accent'] = accent
    out['--ui-accent-hover'] = fallback('accentHoverColor', accent)
    out['--ui-on-accent'] = inkFor(accent)
    out['--ui-danger'] = fallback('dangerColor', 'currentColor')
    out['--ui-warn'] = fallback('warnColor', 'currentColor')
    out['--ui-edge-rail'] = fallback('edgeRailColor', 'currentColor')
    out['--ui-edge-flow'] = fallback('edgeFlowColor', accent)
    out['--ui-select-box'] = fallback('multiSelectBoxColor', accent)
    out['--ui-select-outer'] = fallback('multiSelectFrameOuterColor', accent)
    out['--ui-select-inner'] = fallback('multiSelectFrameInnerColor', accent)
    out['--ui-guide'] = fallback('alignGuideColor', accent)
    out['--edge-cutting-path-color'] = fallback('pathColor', out['--ui-accent-hover'])
    out['--edge-cutting-blade-color'] = fallback('bladeColor', accent)
    return out
  })

  const previewSwatches = computed(() =>
    ['accentColor', 'warnColor', 'dangerColor', 'edgeRailColor', 'edgeFlowColor', 'pathColor', 'bladeColor']
      .map((base) => (entryOf(base) ? colorForBase(base) : ''))
      .filter(Boolean),
  )

  return {
    isHex,
    keyOf,
    rawValueOf,
    colorForBase,
    valueOf,
    colorFromTheme,
    themeVisualStyle,
    inkFor,
    previewColors,
    previewSwatches,
  }
}




