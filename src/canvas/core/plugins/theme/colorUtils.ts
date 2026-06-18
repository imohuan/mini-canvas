/**
 * 颜色计算工具
 *
 * 提供 hex ↔ rgb 互转、lighten/darken、hex 插值等函数。
 * 所有函数都是纯函数，无副作用。
 */

// ============================================================================
// Hex ↔ RGB 转换
// ============================================================================

/** RGB 三元组 */
export interface RGB {
  r: number
  g: number
  b: number
}

/** 将 hex 颜色字符串解析为 RGB 对象 */
export function hexToRgb(hex: string): RGB {
  let h = hex.replace('#', '')
  // 支持简写 #RGB → #RRGGBB
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  }
  const num = parseInt(h, 16)
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  }
}

/** 将 RGB 对象转为 hex 字符串（不含 # 前缀） */
export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return (
    clamp(r).toString(16).padStart(2, '0') +
    clamp(g).toString(16).padStart(2, '0') +
    clamp(b).toString(16).padStart(2, '0')
  )
}

/** RGB 对象 → "#RRGGBB" */
export function rgbToHexString(rgb: RGB): string {
  return '#' + rgbToHex(rgb.r, rgb.g, rgb.b)
}

/** RGB 对象 → "r g b" 字符串（用于 CSS rgb() 函数） */
export function rgbToCssSpace(rgb: RGB): string {
  return `${Math.round(rgb.r)} ${Math.round(rgb.g)} ${Math.round(rgb.b)}`
}

/** RGB 对象 → "rgb(r g b / alpha)"（完整的 CSS rgb() 函数） */
export function rgbToCssAlpha(rgb: RGB, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha))
  const val = a.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return `rgb(${Math.round(rgb.r)} ${Math.round(rgb.g)} ${Math.round(rgb.b)} / ${val})`
}

// ============================================================================
// 颜色明度计算
// ============================================================================

/**
 * 计算相对亮度（用于 WCAG 对比度计算）
 * 范围 0.0（黑）~ 1.0（白）
 */
export function luminance(rgb: RGB): number {
  const toLinear = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b)
}

// ============================================================================
// Lighten / Darken
// ============================================================================

/**
 * lighten(color, amount)
 * amount = -1.0 ~ 1.0（正数变亮，负数变暗）
 */
export function lighten(hex: string, amount: number): string {
  const rgb = hexToRgb(hex)
  const factor = 1 + amount
  return rgbToHexString({
    r: rgb.r * factor,
    g: rgb.g * factor,
    b: rgb.b * factor,
  })
}

/**
 * darken(color, amount)
 * amount = 0.0 ~ 1.0
 */
export function darken(hex: string, amount: number): string {
  return lighten(hex, -amount)
}

// ============================================================================
// 颜色混合
// ============================================================================

/**
 * 在两个颜色之间按 ratio 插值
 * ratio = 0 → colorA, ratio = 1 → colorB
 */
export function mix(hexA: string, hexB: string, ratio: number): string {
  const a = hexToRgb(hexA)
  const b = hexToRgb(hexB)
  const r = 1 - ratio
  return rgbToHexString({
    r: a.r * r + b.r * ratio,
    g: a.g * r + b.g * ratio,
    b: a.b * r + b.b * ratio,
  })
}

// ============================================================================
// 从基准色计算完整主题 CSS 变量
// ============================================================================

/**
 * 单个 CSS 变量的计算值
 */
export type ComputedVars = Record<string, string>

/**
 * 从 accent + surface 两个基准色计算所有 --canvas-node-* CSS 变量值
 *
 * 算法策略：
 * - surface 层次：surface → panel-surface(纯白) → panel-hover(mix 5% accent) → panel-active(mix 10% accent)
 * - 文本层次：text-strong(accent) → text(lighten accent 30%) → text-muted(lighten accent 45%)
 * - 边框：mix accent 与 surface，按不同比例
 * - 环/阴影/区域：直接使用 accent RGB + 不同 alpha
 * - 调试色：使用 text-strong / text / text-muted + 固定 alpha
 *
 * @param accent - 强调色 HEX（如 #111827）
 * @param surface - 表面色 HEX（如 #f9fafb）
 * @returns CSS 变量名 → CSS 值的映射（变量名不含 -- 前缀）
 */
export function computeThemeVars(accent: string, surface: string): ComputedVars {
  const accentRgb = hexToRgb(accent)

  // Surface 层次
  const panelSurface = '#ffffff'
  const panelHover = darken(panelSurface, 0.04)
  const panelActive = darken(panelSurface, 0.08)

  // 文本层次
  const textStrong = accent
  const text = mix(accent, surface, 0.65)
  const textMuted = mix(accent, surface, 0.45)

  // 边框
  const border = rgbToCssAlpha(hexToRgb('#d1d5db'), 0.95) // 保留原色
  const borderSubtle = mix('#d1d5db', surface, 0.7)
  const borderHover = '#d1d5db'
  const borderSelected = rgbToCssAlpha(accentRgb, 0.85)

  // 环绕/阴影
  const ring = rgbToCssAlpha(accentRgb, 0.92)
  const ringSoft = rgbToCssAlpha(accentRgb, 0.38)
  const ringTransparent = rgbToCssAlpha(accentRgb, 0)

  const shadowStrong = rgbToCssAlpha(accentRgb, 0.20)
  const shadowSoft = rgbToCssAlpha(accentRgb, 0.12)
  const shadowSubtle = 'rgb(0 0 0 / 0.06)'
  const shadowPanel = rgbToCssAlpha(accentRgb, 0.12)

  // 调节手柄
  const resizeHandle = '#9ca3af'
  const resizeHandleActive = accent

  // 目标/吸附区
  const targetZoneSurface = rgbToCssAlpha(accentRgb, 0.08)
  const targetZoneBorder = rgbToCssAlpha(accentRgb, 0.55)
  const snapZoneSurface = rgbToCssAlpha(accentRgb, 0.10)
  const snapZoneBorder = rgbToCssAlpha(accentRgb, 0.90)
  const snapZoneHighlight = 'rgb(255 255 255 / 0.75)'
  const snapZoneShadow = rgbToCssAlpha(accentRgb, 0.28)

  // 调试色
  const debugDanger = rgbToCssAlpha(accentRgb, 0.65)
  const debugDangerFill = rgbToCssAlpha(accentRgb, 0.04)
  const debugCenter = textStrong
  const debugRest = text
  const debugMouse = mix(accent, surface, 0.55)
  const debugLabelStroke = '#ffffff'

  return {
    'canvas-node-surface': surface,
    'canvas-node-panel-surface': panelSurface,
    'canvas-node-panel-surface-hover': panelHover,
    'canvas-node-panel-surface-active': panelActive,
    'canvas-node-text-muted': textMuted,
    'canvas-node-text': text,
    'canvas-node-text-strong': textStrong,
    'canvas-node-border': border,
    'canvas-node-border-subtle': borderSubtle,
    'canvas-node-border-hover': borderHover,
    'canvas-node-border-selected': borderSelected,
    'canvas-node-ring': ring,
    'canvas-node-ring-soft': ringSoft,
    'canvas-node-ring-transparent': ringTransparent,
    'canvas-node-shadow-strong': shadowStrong,
    'canvas-node-shadow-soft': shadowSoft,
    'canvas-node-shadow-subtle': shadowSubtle,
    'canvas-node-shadow-panel': shadowPanel,
    'canvas-node-resize-handle': resizeHandle,
    'canvas-node-resize-handle-active': resizeHandleActive,
    'canvas-node-target-zone-surface': targetZoneSurface,
    'canvas-node-target-zone-border': targetZoneBorder,
    'canvas-node-snap-zone-surface': snapZoneSurface,
    'canvas-node-snap-zone-border': snapZoneBorder,
    'canvas-node-snap-zone-highlight': snapZoneHighlight,
    'canvas-node-snap-zone-shadow': snapZoneShadow,
    'canvas-node-debug-danger': debugDanger,
    'canvas-node-debug-danger-fill': debugDangerFill,
    'canvas-node-debug-center': debugCenter,
    'canvas-node-debug-rest': debugRest,
    'canvas-node-debug-mouse': debugMouse,
    'canvas-node-debug-label-stroke': debugLabelStroke,
  }
}

/**
 * 将计算后的变量映射写入 :root 的 CSS 自定义属性
 *
 * @param vars - computeThemeVars 的输出（key 不含 -- 前缀）
 * @param overrides - 用户手动覆盖的变量（优先级最高）
 */
export function applyThemeToDOM(
  vars: ComputedVars,
  overrides?: Record<string, string>,
): void {
  const root = document.documentElement
  const merged = { ...vars, ...(overrides || {}) }

  let count = 0
  for (const [name, value] of Object.entries(merged)) {
    root.style.setProperty(`--${name}`, value)
    count++
  }
  console.log('[🎨 colorUtils] applyThemeToDOM: wrote', count, 'CSS vars to :root')
  console.log('[🎨 colorUtils] sample --canvas-node-surface:', merged['canvas-node-surface'])
  console.log('[🎨 colorUtils] sample --canvas-node-border-selected:', merged['canvas-node-border-selected'])
}
