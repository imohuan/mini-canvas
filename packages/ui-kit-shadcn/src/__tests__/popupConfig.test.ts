/**
 * 浮层统一配置契约：六类浮层共用同一份箭头 / 间距 / 选中样式。
 *
 * 用户口径（2026-11-03）：不要再让每个调用点手写 side-offset 和 arrow；
 * 设置页改一次，DropdownMenu / Select / Popover / Tooltip / ContextMenu / Combobox 一起生效。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_POPUP_CONFIG,
  POPUP_GAP_CHOICES,
  POPUP_ARROW_HEIGHT,
  applyPopupBridge,
  clearPopupBridge,
  popupArrowVisible,
  popupConfig,
  popupDirectArrowSideOffset,
  popupSideOffset,
  popupSubSideOffset,
  resolvePopupGap,
} from '../popup/popupConfig'

beforeEach(() => {
  clearPopupBridge()
})

describe('浮层统一配置', () => {
  it('默认档保留原观感：提示气泡显示箭头，其余下拉先不显示', () => {
    expect(DEFAULT_POPUP_CONFIG.gap).toBe(8)
    expect([...POPUP_GAP_CHOICES]).toEqual([4, 8, 12])
    expect(popupArrowVisible('tooltip')).toBe(true)
    for (const kind of ['dropdown', 'select', 'popover', 'context', 'combobox'] as const) {
      expect(popupArrowVisible(kind), kind).toBe(false)
    }
  })

  it('箭头可统一显示 / 隐藏；间距档位和子菜单偏移一起更新', () => {
    applyPopupBridge({ arrow: 'show', gap: resolvePopupGap(12), subGap: resolvePopupGap(4), selectedStyle: 'check' })
    for (const kind of ['dropdown', 'select', 'popover', 'tooltip', 'context', 'combobox'] as const) {
      expect(popupArrowVisible(kind), kind).toBe(true)
    }
    expect(popupConfig.gap).toBe(12)
    expect(popupConfig.subGap).toBe(4)
    // dropdown 箭头高 8：reka 会自动再加箭头高度，配置 12 时要扣掉，可见尖端仍是 12
    expect(popupSideOffset('dropdown')).toBe(4)
    expect(popupSubSideOffset()).toBe(4)

    applyPopupBridge({ arrow: 'hide', gap: 8, subGap: 8, selectedStyle: 'check' })
    for (const kind of ['dropdown', 'select', 'popover', 'tooltip', 'context', 'combobox'] as const) {
      expect(popupArrowVisible(kind), kind).toBe(false)
    }
  })

  it('Tooltip 的可见间距扣掉箭头高度（允许负 sideOffset）', () => {
    // Tooltip 用标准 10×5 箭头；reka 会再加 5，配置 8 时 sideOffset 应为 3。
    // 可见尖端距离 = 3 + 5 = 8px。
    applyPopupBridge({ arrow: 'auto', gap: 8, subGap: 8, selectedStyle: 'check' })
    expect(popupSideOffset('tooltip')).toBe(3)
    // 箭头隐藏时没有额外的 5px：配置多少就是多少
    applyPopupBridge({ arrow: 'hide', gap: 8, subGap: 8, selectedStyle: 'check' })
    expect(popupSideOffset('tooltip')).toBe(8)
  })

  it('箭头高度表覆盖六类浮层，Select 直接绘制的箭头也有正确高度', () => {
    expect(POPUP_ARROW_HEIGHT.tooltip).toBe(5)
    expect(POPUP_ARROW_HEIGHT.select).toBe(5)
    expect(POPUP_ARROW_HEIGHT.dropdown).toBe(8)
    for (const kind of ['dropdown', 'select', 'popover', 'tooltip', 'context', 'combobox'] as const) {
      expect(POPUP_ARROW_HEIGHT[kind], kind).toBeGreaterThan(0)
    }
  })

  it('自绘箭头把高度加回浮层边缘，尖端仍保持配置的可见间距', () => {
    applyPopupBridge({ arrow: 'show', gap: 8, subGap: 8, selectedStyle: 'check' })
    // Select 的箭头是自绘 SVG，reka 不会再替它补 5px：浮层边缘要放在 13px。
    expect(popupDirectArrowSideOffset('select')).toBe(13)
    applyPopupBridge({ arrow: 'hide', gap: 8, subGap: 8, selectedStyle: 'check' })
    expect(popupDirectArrowSideOffset('select')).toBe(8)
    expect(popupDirectArrowSideOffset('select', 24)).toBe(24)
  })

  it('显式传入的 sideOffset / arrow 仍优先（业务特殊补偿不被吃掉）', () => {
    applyPopupBridge({ arrow: 'show', gap: 8, subGap: 8, selectedStyle: 'check' })
    expect(popupSideOffset('dropdown', 24)).toBe(24)
    expect(popupArrowVisible('dropdown', false)).toBe(false)
  })

  it('未知档位回落默认值，不抛错', () => {
    expect(resolvePopupGap('huge')).toBe(DEFAULT_POPUP_CONFIG.gap)
    applyPopupBridge({ arrow: 'wat' as never, gap: Number.NaN, subGap: Number.NaN, selectedStyle: 'wat' as never })
    expect(popupConfig.arrow).toBe(DEFAULT_POPUP_CONFIG.arrow)
    expect(popupConfig.gap).toBe(DEFAULT_POPUP_CONFIG.gap)
    expect(popupConfig.selectedStyle).toBe(DEFAULT_POPUP_CONFIG.selectedStyle)
  })
})
