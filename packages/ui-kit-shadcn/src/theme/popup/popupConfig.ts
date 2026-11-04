/**
 * 浮层定位常量：箭头高度 / 可见间距 / 子菜单间距。
 *
 * 箭头开关 / 间距 / 偏移**不在本文件**：它们统一由 `componentConfig` 提供（响应式、
 * 主题设置改一次全站实时生效），这里只保留“怎么算”的几何与各浮层的尺寸常量。
 * 没配置时的默认观感与历史一致：只有 Tooltip 画箭头，其余五类不画，间距 8px。
 * 调用点仍可显式传 `arrow` / `sideOffset` 做一次性补偿。
 */
import { componentConfig, popupTotalGap } from '../../componentConfig'

export type PopupKind = 'dropdown' | 'select' | 'popover' | 'tooltip' | 'context' | 'combobox'
export type PopupArrowMode = 'auto' | 'show' | 'hide'

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

/** 单个浮层是否显示箭头；显式 prop 永远优先，否则按各组件的历史默认。 */
export function popupArrowVisible(kind: PopupKind, explicit?: boolean): boolean {
  if (typeof explicit === 'boolean') return explicit
  // 全局配置只管“其余的默认”；Tooltip 没有配置时仍保留历史观感（有箭头）。
  if (kind === 'tooltip') return componentConfig.arrowVisible || LEGACY_ARROW.tooltip
  return componentConfig.arrowVisible
}

/**
 * 单个浮层的 reka `sideOffset`。
 *
 * 配置量的是“可见边缘距离”；有箭头时 reka 会自动再加箭头高度，所以这里先扣掉，
 * 保证箭头尖端到触发器仍是配置值。显式传入的 sideOffset 不扣，按调用点原值保留。
 */
export function popupSideOffset(kind: PopupKind, explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit
  // gap 与 offset 是**累加**：offset 用来把浮层推到外层容器之外，不是覆盖 gap。
  const gap = popupTotalGap()
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
  return popupTotalGap() + (popupArrowVisible(kind) ? POPUP_ARROW_HEIGHT[kind] : 0)
}

/** 子菜单默认 sideOffset：配置直接就是两侧可见边缘的间距。 */
export function popupSubSideOffset(explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit
  return componentConfig.subGap
}
