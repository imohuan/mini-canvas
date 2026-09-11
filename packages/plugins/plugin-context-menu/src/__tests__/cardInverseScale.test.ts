import { describe, expect, it } from 'vitest'
import {
  inverseScaleForZoom,
  inverseScaleOrigin,
  normalizePortSide,
} from '../cardInverseScale'

describe('inverseScaleForZoom', () => {
  it('zoom=1 时不缩放（k=1）', () => {
    expect(inverseScaleForZoom(1)).toBe(1)
  })

  it('zoom 越大卡片越小（k=1/zoom）', () => {
    expect(inverseScaleForZoom(2)).toBe(0.5)
    expect(inverseScaleForZoom(0.5)).toBe(2)
  })

  it('非法/非正 zoom 兜底为 1，不产生除零或负缩放', () => {
    expect(inverseScaleForZoom(0)).toBe(1)
    expect(inverseScaleForZoom(-2)).toBe(1)
    expect(inverseScaleForZoom(Number.NaN)).toBe(1)
    expect(inverseScaleForZoom(Number.POSITIVE_INFINITY)).toBe(1)
  })

  it('不变量：卡片布局尺寸 × k × zoom = 布局尺寸（屏幕尺寸恒定）', () => {
    for (const zoom of [0.25, 0.5, 1, 1.75, 3]) {
      const k = inverseScaleForZoom(zoom)
      expect(100 * k * zoom).toBeCloseTo(100, 10)
    }
  })
})

describe('inverseScaleOrigin', () => {
  it('端口在左 → 钉左边中点；端口在右 → 钉右边中点（缩放钉住松手点）', () => {
    expect(inverseScaleOrigin('left')).toBe('left center')
    expect(inverseScaleOrigin('right')).toBe('right center')
  })

  it('未知/缺省侧回退左边中点', () => {
    expect(inverseScaleOrigin(null)).toBe('left center')
    expect(inverseScaleOrigin(undefined)).toBe('left center')
  })
})

describe('normalizePortSide', () => {
  it('只认 right，其余（含非法值）都归 left', () => {
    expect(normalizePortSide('right')).toBe('right')
    expect(normalizePortSide('left')).toBe('left')
    expect(normalizePortSide(undefined)).toBe('left')
    expect(normalizePortSide('bogus')).toBe('left')
  })
})
