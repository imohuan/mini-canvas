import { describe, expect, it } from 'vitest'
import {
  inverseScaleForZoom,
  inverseScaleOrigin,
  tempMenuCardStyle,
} from '../tempMenuCardTransform'

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
  it('端口在左 → 钉左边中点；端口在右 → 钉右边中点', () => {
    expect(inverseScaleOrigin('left')).toBe('left center')
    expect(inverseScaleOrigin('right')).toBe('right center')
  })

  it('未知/缺省侧回退左边中点', () => {
    expect(inverseScaleOrigin(null)).toBe('left center')
    expect(inverseScaleOrigin(undefined)).toBe('left center')
  })
})

describe('tempMenuCardStyle', () => {
  it('输出 scale(1/zoom) + 端口侧锚点', () => {
    expect(tempMenuCardStyle({ zoom: 2, side: 'left' })).toMatchObject({
      transform: 'scale(0.5)',
      transformOrigin: 'left center',
    })
    expect(tempMenuCardStyle({ zoom: 0.5, side: 'right' })).toMatchObject({
      transform: 'scale(2)',
      transformOrigin: 'right center',
    })
  })

  it('边框/选中环用裸 px：卡片内 1px 就是屏幕 1px（scale 与画布 zoom 相抵）', () => {
    expect(tempMenuCardStyle({ zoom: 2, side: 'left', selected: false })).toMatchObject({
      borderWidth: '1px',
      '--card-outline-width': '0px',
    })
    expect(tempMenuCardStyle({ zoom: 2, side: 'left', selected: true })).toMatchObject({
      borderWidth: '1px',
      '--card-outline-width': '2px',
    })
  })
})
