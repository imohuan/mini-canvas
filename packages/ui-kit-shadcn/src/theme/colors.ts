/**
 * 预览页的色板：底色（surface）+ 主题色（accent）两组，各给亮 / 暗两套 shadcn 变量。
 *
 * 这**只是预览页用的一份小色板**，不是全站配色真源：
 * 真实应用的语义色一直由 canvas-render 的 `--ui-*` 色板提供，host.css 再把它们映射成
 * shadcn 的 `--background` / `--primary` …。预览页没有宿主，才需要自带一份能点着玩的颜色。
 *
 * 之前这里存了 7 套底色 × 24 套主题色 × 24 套图表色（约 700 行），其中图表色整块没有任何
 * 组件在读，属于纯占位。这里收成：4 种底色 + 6 种主题色，够验证「换色确实生效」。
 */

export const BASE_COLORS = ['neutral', 'stone', 'zinc', 'mauve'] as const
export type BaseColor = (typeof BASE_COLORS)[number]

export const THEME_COLORS = ['neutral', 'blue', 'violet', 'emerald', 'amber', 'rose'] as const
export type ThemeColor = (typeof THEME_COLORS)[number]

export interface ThemePalette {
  light: Record<string, string>
  dark: Record<string, string>
}

/** 底色：背景 / 卡片 / 浮层 / 文字 / 边框这一圈。 */
const BASE_PALETTES: Record<BaseColor, ThemePalette> = {
  neutral: {
    light: {
      background: 'oklch(1 0 0)',
      foreground: 'oklch(0.145 0 0)',
      card: 'oklch(1 0 0)',
      'card-foreground': 'oklch(0.145 0 0)',
      popover: 'oklch(1 0 0)',
      'popover-foreground': 'oklch(0.145 0 0)',
      secondary: 'oklch(0.97 0 0)',
      'secondary-foreground': 'oklch(0.205 0 0)',
      muted: 'oklch(0.97 0 0)',
      'muted-foreground': 'oklch(0.556 0 0)',
      accent: 'oklch(0.97 0 0)',
      'accent-foreground': 'oklch(0.205 0 0)',
      border: 'oklch(0.922 0 0)',
      input: 'oklch(0.922 0 0)',
    },
    dark: {
      background: 'oklch(0.145 0 0)',
      foreground: 'oklch(0.985 0 0)',
      card: 'oklch(0.205 0 0)',
      'card-foreground': 'oklch(0.985 0 0)',
      popover: 'oklch(0.205 0 0)',
      'popover-foreground': 'oklch(0.985 0 0)',
      secondary: 'oklch(0.269 0 0)',
      'secondary-foreground': 'oklch(0.985 0 0)',
      muted: 'oklch(0.269 0 0)',
      'muted-foreground': 'oklch(0.708 0 0)',
      accent: 'oklch(0.269 0 0)',
      'accent-foreground': 'oklch(0.985 0 0)',
      border: 'oklch(1 0 0 / 10%)',
      input: 'oklch(1 0 0 / 15%)',
    },
  },
  stone: {
    light: {
      background: 'oklch(1 0 0)',
      foreground: 'oklch(0.147 0.004 49.25)',
      card: 'oklch(1 0 0)',
      'card-foreground': 'oklch(0.147 0.004 49.25)',
      popover: 'oklch(1 0 0)',
      'popover-foreground': 'oklch(0.147 0.004 49.25)',
      secondary: 'oklch(0.97 0.001 106.424)',
      'secondary-foreground': 'oklch(0.216 0.006 56.043)',
      muted: 'oklch(0.97 0.001 106.424)',
      'muted-foreground': 'oklch(0.553 0.013 58.071)',
      accent: 'oklch(0.97 0.001 106.424)',
      'accent-foreground': 'oklch(0.216 0.006 56.043)',
      border: 'oklch(0.923 0.003 48.717)',
      input: 'oklch(0.923 0.003 48.717)',
    },
    dark: {
      background: 'oklch(0.147 0.004 49.25)',
      foreground: 'oklch(0.985 0.001 106.423)',
      card: 'oklch(0.216 0.006 56.043)',
      'card-foreground': 'oklch(0.985 0.001 106.423)',
      popover: 'oklch(0.216 0.006 56.043)',
      'popover-foreground': 'oklch(0.985 0.001 106.423)',
      secondary: 'oklch(0.268 0.007 34.298)',
      'secondary-foreground': 'oklch(0.985 0.001 106.423)',
      muted: 'oklch(0.268 0.007 34.298)',
      'muted-foreground': 'oklch(0.709 0.01 56.259)',
      accent: 'oklch(0.268 0.007 34.298)',
      'accent-foreground': 'oklch(0.985 0.001 106.423)',
      border: 'oklch(1 0 0 / 10%)',
      input: 'oklch(1 0 0 / 15%)',
    },
  },
  zinc: {
    light: {
      background: 'oklch(1 0 0)',
      foreground: 'oklch(0.141 0.005 285.823)',
      card: 'oklch(1 0 0)',
      'card-foreground': 'oklch(0.141 0.005 285.823)',
      popover: 'oklch(1 0 0)',
      'popover-foreground': 'oklch(0.141 0.005 285.823)',
      secondary: 'oklch(0.967 0.001 286.375)',
      'secondary-foreground': 'oklch(0.21 0.006 285.885)',
      muted: 'oklch(0.967 0.001 286.375)',
      'muted-foreground': 'oklch(0.552 0.016 285.938)',
      accent: 'oklch(0.967 0.001 286.375)',
      'accent-foreground': 'oklch(0.21 0.006 285.885)',
      border: 'oklch(0.92 0.004 286.32)',
      input: 'oklch(0.92 0.004 286.32)',
    },
    dark: {
      background: 'oklch(0.141 0.005 285.823)',
      foreground: 'oklch(0.985 0 0)',
      card: 'oklch(0.21 0.006 285.885)',
      'card-foreground': 'oklch(0.985 0 0)',
      popover: 'oklch(0.21 0.006 285.885)',
      'popover-foreground': 'oklch(0.985 0 0)',
      secondary: 'oklch(0.274 0.006 286.033)',
      'secondary-foreground': 'oklch(0.985 0 0)',
      muted: 'oklch(0.274 0.006 286.033)',
      'muted-foreground': 'oklch(0.705 0.015 286.067)',
      accent: 'oklch(0.274 0.006 286.033)',
      'accent-foreground': 'oklch(0.985 0 0)',
      border: 'oklch(1 0 0 / 10%)',
      input: 'oklch(1 0 0 / 15%)',
    },
  },
  mauve: {
    light: {
      background: 'oklch(1 0 0)',
      foreground: 'oklch(0.145 0.008 326)',
      card: 'oklch(1 0 0)',
      'card-foreground': 'oklch(0.145 0.008 326)',
      popover: 'oklch(1 0 0)',
      'popover-foreground': 'oklch(0.145 0.008 326)',
      secondary: 'oklch(0.96 0.003 325.6)',
      'secondary-foreground': 'oklch(0.212 0.019 322.12)',
      muted: 'oklch(0.96 0.003 325.6)',
      'muted-foreground': 'oklch(0.542 0.034 322.5)',
      accent: 'oklch(0.96 0.003 325.6)',
      'accent-foreground': 'oklch(0.212 0.019 322.12)',
      border: 'oklch(0.922 0.005 325.62)',
      input: 'oklch(0.922 0.005 325.62)',
    },
    dark: {
      background: 'oklch(0.145 0.008 326)',
      foreground: 'oklch(0.985 0 0)',
      card: 'oklch(0.212 0.019 322.12)',
      'card-foreground': 'oklch(0.985 0 0)',
      popover: 'oklch(0.212 0.019 322.12)',
      'popover-foreground': 'oklch(0.985 0 0)',
      secondary: 'oklch(0.263 0.024 320.12)',
      'secondary-foreground': 'oklch(0.985 0 0)',
      muted: 'oklch(0.263 0.024 320.12)',
      'muted-foreground': 'oklch(0.711 0.019 323.02)',
      accent: 'oklch(0.263 0.024 320.12)',
      'accent-foreground': 'oklch(0.985 0 0)',
      border: 'oklch(1 0 0 / 10%)',
      input: 'oklch(1 0 0 / 15%)',
    },
  },
}

/** 主题色：只覆盖 primary / ring，不改背景。 */
const ACCENT_PALETTES: Record<ThemeColor, ThemePalette> = {
  neutral: {
    light: { primary: 'oklch(0.205 0 0)', 'primary-foreground': 'oklch(0.985 0 0)', ring: 'oklch(0.708 0 0)' },
    dark: { primary: 'oklch(0.922 0 0)', 'primary-foreground': 'oklch(0.205 0 0)', ring: 'oklch(0.556 0 0)' },
  },
  blue: {
    light: { primary: 'oklch(0.623 0.214 259.815)', 'primary-foreground': 'oklch(0.985 0 0)', ring: 'oklch(0.623 0.214 259.815)' },
    dark: { primary: 'oklch(0.707 0.165 254.624)', 'primary-foreground': 'oklch(0.205 0 0)', ring: 'oklch(0.707 0.165 254.624)' },
  },
  violet: {
    light: { primary: 'oklch(0.606 0.25 292.717)', 'primary-foreground': 'oklch(0.985 0 0)', ring: 'oklch(0.606 0.25 292.717)' },
    dark: { primary: 'oklch(0.702 0.183 293.541)', 'primary-foreground': 'oklch(0.205 0 0)', ring: 'oklch(0.702 0.183 293.541)' },
  },
  emerald: {
    light: { primary: 'oklch(0.696 0.17 162.48)', 'primary-foreground': 'oklch(0.985 0 0)', ring: 'oklch(0.696 0.17 162.48)' },
    dark: { primary: 'oklch(0.765 0.177 163.223)', 'primary-foreground': 'oklch(0.205 0 0)', ring: 'oklch(0.765 0.177 163.223)' },
  },
  amber: {
    light: { primary: 'oklch(0.769 0.188 70.08)', 'primary-foreground': 'oklch(0.205 0 0)', ring: 'oklch(0.769 0.188 70.08)' },
    dark: { primary: 'oklch(0.828 0.189 84.429)', 'primary-foreground': 'oklch(0.205 0 0)', ring: 'oklch(0.828 0.189 84.429)' },
  },
  rose: {
    light: { primary: 'oklch(0.645 0.246 16.439)', 'primary-foreground': 'oklch(0.985 0 0)', ring: 'oklch(0.645 0.246 16.439)' },
    dark: { primary: 'oklch(0.712 0.194 13.428)', 'primary-foreground': 'oklch(0.205 0 0)', ring: 'oklch(0.712 0.194 13.428)' },
  },
}

export interface ThemeSelection {
  baseColor: BaseColor
  theme: ThemeColor
}

/** 把两项选择合成一组 CSS 变量（亮 / 暗各一套）。 */
export function resolveThemeVars(selection: ThemeSelection): ThemePalette {
  const base = BASE_PALETTES[selection.baseColor]
  const accent = ACCENT_PALETTES[selection.theme]
  return {
    light: { ...base.light, ...accent.light },
    dark: { ...base.dark, ...accent.dark },
  }
}

/** 面板上的色块用：主题色的主色。 */
export function previewColor(name: ThemeColor, scheme: 'light' | 'dark'): string {
  return ACCENT_PALETTES[name][scheme].primary ?? ''
}
