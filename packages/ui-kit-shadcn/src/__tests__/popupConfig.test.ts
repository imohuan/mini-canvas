/**
 * 浮层定位常量契约。
 *
 * 2026-11-04 删掉了「箭头显示 / 触发器间距 / 子菜单间距 / 选中样式」四项设置：
 * 它们只有单一或近乎单一的可选值，用户改不出有价值的效果，却给每个浮层多挂一层全局状态。
 * 现在固定成删除时的默认观感；这里锁住「删设置不改观感」这件事。
 */
import { describe, it, expect } from 'vitest'
import {
  POPUP_ARROW_HEIGHT,
  popupArrowVisible,
  popupDirectArrowSideOffset,
  popupSideOffset,
  popupSubSideOffset,
  type PopupKind,
} from '../theme/popup/popupConfig'
import { DEFAULT_COMPONENT_CONFIG, componentConfig, resetComponentConfig } from '../componentConfig'

const KINDS: PopupKind[] = ['dropdown', 'select', 'popover', 'tooltip', 'context', 'combobox']

describe('浮层定位常量', () => {
  it('默认间距沿用原来的 8px（现在来自组件配置）', () => {
    resetComponentConfig()
    expect(DEFAULT_COMPONENT_CONFIG.gap).toBe(8)
    expect(DEFAULT_COMPONENT_CONFIG.subGap).toBe(8)
    expect(DEFAULT_COMPONENT_CONFIG.offset).toBe(0)
  })

  it('箭头只默认给 Tooltip，其余五类不画（与删除前「按组件默认」一致）', () => {
    expect(popupArrowVisible('tooltip')).toBe(true)
    for (const kind of KINDS.filter((k) => k !== 'tooltip')) {
      expect(popupArrowVisible(kind), kind).toBe(false)
    }
  })

  it('调用点显式传 arrow 永远优先（一次性补偿仍可用）', () => {
    expect(popupArrowVisible('dropdown', true)).toBe(true)
    expect(popupArrowVisible('tooltip', false)).toBe(false)
  })

  it('有箭头时扣掉箭头高度，保证可见间距仍是 8px', () => {
    resetComponentConfig()
    for (const kind of KINDS) {
      expect(POPUP_ARROW_HEIGHT[kind], kind).toBeGreaterThan(0)
      const arrow = popupArrowVisible(kind)
      expect(popupSideOffset(kind), kind).toBe(arrow ? 8 - POPUP_ARROW_HEIGHT[kind] : 8)
    }
  })

  it('自绘箭头（Select）把箭头高度加回浮层边缘', () => {
    resetComponentConfig()
    expect(popupDirectArrowSideOffset('select')).toBe(8)
    expect(popupDirectArrowSideOffset('select', 3)).toBe(3)
  })

  it('子菜单间距直接就是两侧可见边缘的间距', () => {
    resetComponentConfig()
    expect(popupSubSideOffset()).toBe(8)
    expect(popupSubSideOffset(5)).toBe(5)
  })

  it('offset 与 gap 是累加：0 时箭头贴着触发器，正值把它推到容器外', () => {
    resetComponentConfig()
    componentConfig.gap = 8
    componentConfig.offset = 0
    const flush = popupSideOffset('tooltip')
    componentConfig.offset = 12
    expect(popupSideOffset('tooltip')).toBe(flush + 12)
    resetComponentConfig()
  })
})
