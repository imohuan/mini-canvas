/**
 * 浮层统一配置：箭头 / 可见间距 / 子菜单间距 / 选中样式。
 *
 * 这四项由默认主题写进 `--mct-popup-*`，也同步到本模块的响应式对象。
 * DropdownMenu、Select、Popover、Tooltip、ContextMenu、Combobox 都从这里读默认值；
 * 调用点仍可显式传 `arrow` 或 `sideOffset` 做一次性补偿。
 */
import { reactive } from 'vue'

export type PopupKind = 'dropdown' | 'select' | 'popover' | 'tooltip' | 'context' | 'combobox'
export type PopupArrowMode = 'auto' | 'show' | 'hide'
export type PopupSelectedStyle = 'check'

export interface PopupConfig {
  arrow: PopupArrowMode
  /** 浮层可见边缘到触发器的距离（px） */
  gap: number
  /** 子菜单可见边缘到父菜单可见边缘的距离（px） */
  subGap: number
  selectedStyle: PopupSelectedStyle
}

export const POPUP_GAP_CHOICES = [4, 8, 12] as const
export type PopupGapChoice = (typeof POPUP_GAP_CHOICES)[number]

export const POPUP_GAP_LABELS: Readonly<Record<PopupGapChoice, string>> = {
  4: '紧凑（4px）',
  8: '标准（8px）',
  12: '宽松（12px）',
}

export const POPUP_ARROW_CHOICES = ['auto', 'show', 'hide'] as const
export const POPUP_ARROW_LABELS: Readonly<Record<PopupArrowMode, string>> = {
  auto: '按组件默认',
  show: '全部显示',
  hide: '全部隐藏',
}

/**
 * 箭头高度：reka 会把这个高度自动加进 sideOffset，量“可见边缘”时要扣掉。
 * 这里的值必须与各组件实际渲染的 SVG height 一致：
 * Dropdown 16×8；Select / Popover / Context / Combobox 10×5；Tooltip 10×5。
 */
export const POPUP_ARROW_HEIGHT: Readonly<Record<PopupKind, number>> = {
  dropdown: 8,
  select: 5,
  popover: 5,
  tooltip: 5,
  context: 5,
  combobox: 5,
}

/** 没改设置前：Dropdown/Select/Popover/Context/Combobox 不画箭头，Tooltip 保持旧行为。 */
const LEGACY_ARROW: Readonly<Record<PopupKind, boolean>> = {
  dropdown: false,
  select: false,
  popover: false,
  tooltip: true,
  context: false,
  combobox: false,
}

export const DEFAULT_POPUP_CONFIG: PopupConfig = Object.freeze({
  arrow: 'auto',
  gap: 8,
  subGap: 8,
  selectedStyle: 'check',
})

/** 组件读取的当前配置（响应式；设置面板改一次，已挂载的浮层一起更新）。 */
export const popupConfig = reactive<PopupConfig>({ ...DEFAULT_POPUP_CONFIG })

export function resolvePopupGap(value: unknown, fallback = DEFAULT_POPUP_CONFIG.gap): PopupGapChoice {
  const n = typeof value === 'number' ? value : Number(value)
  return POPUP_GAP_CHOICES.includes(n as PopupGapChoice) ? (n as PopupGapChoice) : (fallback as PopupGapChoice)
}

export function resolvePopupArrow(value: unknown): PopupArrowMode {
  return POPUP_ARROW_CHOICES.includes(value as PopupArrowMode)
    ? (value as PopupArrowMode)
    : DEFAULT_POPUP_CONFIG.arrow
}

export function resolvePopupSelectedStyle(value: unknown): PopupSelectedStyle {
  return value === 'check' ? 'check' : DEFAULT_POPUP_CONFIG.selectedStyle
}

/** 单个浮层是否显示箭头；显式 prop 永远优先。 */
export function popupArrowVisible(kind: PopupKind, explicit?: boolean): boolean {
  if (typeof explicit === 'boolean') return explicit
  if (popupConfig.arrow === 'show') return true
  if (popupConfig.arrow === 'hide') return false
  return LEGACY_ARROW[kind]
}

/**
 * 单个浮层的 reka `sideOffset`。
 *
 * 配置量的是“可见边缘距离”；有箭头时 reka 会自动再加箭头高度，所以这里先扣掉，
 * 保证箭头尖端到触发器仍是配置值。显式传入的 sideOffset 不扣，按调用点原值保留。
 */
export function popupSideOffset(kind: PopupKind, explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit
  const gap = popupConfig.gap
  // 允许负值：Tooltip 箭头高 10px，配置 8px 时 reka 的 offset 会再加 10，
  // 必须从 sideOffset 里扣成 -2，箭头尖端才真正停在 8px 处。夹到 0 会让它变 10px。
  return popupArrowVisible(kind) ? gap - POPUP_ARROW_HEIGHT[kind] : gap
}

/**
 * 直接绘制 SVG 箭头的浮层（目前是 Select）不能用上面的算法。
 *
 * reka 只在它自己渲染 Arrow 时才把箭头高度加进定位；自绘箭头必须由调用方
 * 把「箭头高度」加回浮层边缘，才能保证箭头尖端到触发器仍是配置的可见间距。
 */
export function popupDirectArrowSideOffset(kind: PopupKind, explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit
  return popupConfig.gap + (popupArrowVisible(kind) ? POPUP_ARROW_HEIGHT[kind] : 0)
}

/** 子菜单默认 sideOffset：配置直接就是两侧可见边缘的间距。 */
export function popupSubSideOffset(explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit
  return popupConfig.subGap
}

export function applyPopupBridge(input: Partial<PopupConfig>): void {
  popupConfig.arrow = resolvePopupArrow(input.arrow)
  popupConfig.gap = resolvePopupGap(input.gap)
  popupConfig.subGap = resolvePopupGap(input.subGap)
  popupConfig.selectedStyle = resolvePopupSelectedStyle(input.selectedStyle)
}

export function clearPopupBridge(): void {
  Object.assign(popupConfig, DEFAULT_POPUP_CONFIG)
}

/** 主题桥接写的 CSS 变量（未接响应式配置的自绘菜单也能读）。 */
export const POPUP_BRIDGE_VARS = {
  arrow: '--mct-popup-arrow',
  gap: '--mct-popup-gap',
  subGap: '--mct-popup-sub-gap',
  selectedStyle: '--mct-popup-selected-style',
} as const

export function resolvePopupCssVars(input: Partial<PopupConfig>): Record<string, string> {
  const arrow = resolvePopupArrow(input.arrow)
  const gap = resolvePopupGap(input.gap)
  const subGap = resolvePopupGap(input.subGap)
  const selectedStyle = resolvePopupSelectedStyle(input.selectedStyle)
  return {
    [POPUP_BRIDGE_VARS.arrow]: arrow === 'hide' ? '0' : arrow === 'show' ? '1' : 'auto',
    [POPUP_BRIDGE_VARS.gap]: String(gap),
    [POPUP_BRIDGE_VARS.subGap]: String(subGap),
    [POPUP_BRIDGE_VARS.selectedStyle]: selectedStyle,
  }
}
