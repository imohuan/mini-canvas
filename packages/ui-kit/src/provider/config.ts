import type { UiKitContext, UiKitDensity, UiKitSize, UiKitSizeToken, UiKitTheme } from '../shared/types'
import type { UiKitProviderProps } from './types'

export const DEFAULT_SIZES: Record<UiKitSize, UiKitSizeToken> = {
  sm: { height: 28, fontSize: 12, paddingX: 10, icon: 14 },
  md: { height: 34, fontSize: 13, paddingX: 12, icon: 16 },
  lg: { height: 42, fontSize: 14, paddingX: 16, icon: 18 },
}

export const LIGHT_THEME: UiKitTheme = {
  accent: '#0891b2',
  accentHover: '#0e7490',
  danger: '#ef4444',
  success: '#16a34a',
  warning: '#d97706',
  info: '#2563eb',
  ink: '#18202b',
  inkMuted: '#8c95a3',
  panel: '#ffffff',
  panelSoft: '#f7f8fa',
  line: '#e2e5ea',
  hover: 'rgb(0 0 0 / 0.05)',
  chip: 'rgb(0 0 0 / 0.07)',
  shadow: '0 18px 44px rgb(15 23 42 / 0.16)',
}

export const DARK_THEME: UiKitTheme = {
  accent: '#22b8d8',
  accentHover: '#3cc9e6',
  danger: '#f87171',
  success: '#4ade80',
  warning: '#fbbf24',
  info: '#60a5fa',
  ink: '#f4f5f7',
  inkMuted: '#9aa3ae',
  panel: '#212429',
  panelSoft: '#191b1f',
  line: '#3a3f46',
  hover: 'rgb(255 255 255 / 0.08)',
  chip: 'rgb(255 255 255 / 0.1)',
  shadow: '0 20px 48px rgb(0 0 0 / 0.42)',
}

const DENSITY_GAP: Record<UiKitDensity, number> = {
  compact: 4,
  comfortable: 6,
  spacious: 10,
}

const DENSITY_PAD: Record<UiKitDensity, number> = {
  compact: 8,
  comfortable: 12,
  spacious: 16,
}

/** 把 props 收成组件统一消费的上下文与 CSS 变量。 */
export function resolveConfig(props: UiKitProviderProps): UiKitContext {
  const base = props.dark ? DARK_THEME : LIGHT_THEME
  const theme: UiKitTheme = {
    ...base,
    accent: props.accent?.trim() || base.accent,
    accentHover: props.accentHover?.trim() || props.accent?.trim() || base.accentHover,
    danger: props.danger?.trim() || base.danger,
    success: props.success?.trim() || base.success,
    warning: props.warning?.trim() || base.warning,
    info: props.info?.trim() || base.info,
  }
  const size = props.size ?? 'md'
  const density = props.density ?? 'comfortable'
  const radius = Number.isFinite(props.radius) ? Math.min(Math.max(props.radius ?? 8, 0), 32) : 8
  const sizes = { ...DEFAULT_SIZES }
  for (const key of ['sm', 'md', 'lg'] as const) {
    sizes[key] = { ...DEFAULT_SIZES[key], ...(props.sizes?.[key] ?? {}) }
  }
  const z = props.zIndexBase ?? 90000
  const cssVars: Record<string, string> = {
    '--mck-accent': theme.accent,
    '--mck-accent-hover': theme.accentHover,
    '--mck-danger': theme.danger,
    '--mck-success': theme.success,
    '--mck-warning': theme.warning,
    '--mck-info': theme.info,
    '--mck-ink': theme.ink,
    '--mck-ink-muted': theme.inkMuted,
    '--mck-panel': theme.panel,
    '--mck-panel-soft': theme.panelSoft,
    '--mck-line': theme.line,
    '--mck-hover': theme.hover,
    '--mck-chip': theme.chip,
    '--mck-shadow': theme.shadow,
    '--mck-radius-control': radius + 'px',
    '--mck-radius-panel': Math.max(radius + 6, 12) + 'px',
    '--mck-gap': DENSITY_GAP[density] + 'px',
    '--mck-pad': DENSITY_PAD[density] + 'px',
    '--mck-size-sm': sizes.sm.height + 'px',
    '--mck-size-md': sizes.md.height + 'px',
    '--mck-size-lg': sizes.lg.height + 'px',
    '--mck-font-sm': sizes.sm.fontSize + 'px',
    '--mck-font-md': sizes.md.fontSize + 'px',
    '--mck-font-lg': sizes.lg.fontSize + 'px',
    '--mck-icon-sm': sizes.sm.icon + 'px',
    '--mck-icon-md': sizes.md.icon + 'px',
    '--mck-icon-lg': sizes.lg.icon + 'px',
    '--mck-pad-x-sm': sizes.sm.paddingX + 'px',
    '--mck-pad-x-md': sizes.md.paddingX + 'px',
    '--mck-pad-x-lg': sizes.lg.paddingX + 'px',
  }
  return {
    size,
    density,
    radius,
    theme,
    sizes,
    cssVars,
    zIndex: {
      dropdown: z,
      popover: z + 10,
      modal: z + 100,
      toast: z + 200,
    },
  }
}
