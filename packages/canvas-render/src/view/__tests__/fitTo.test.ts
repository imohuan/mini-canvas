import { describe, expect, it } from 'vitest'
import { computeFitTo } from '../fitTo'

const rects = [
  { id: 'a', x: 0, y: 0, w: 100, h: 100 },
  { id: 'b', x: 200, y: 100, w: 100, h: 100 },
]

describe('fitTo · 唯一取景算法', () => {
  it('heightRatio 按内容高度占视口比例算缩放并夹在 [0.1,4]', () => {
    const r = computeFitTo({ rects, viewport: { w: 800, h: 600 }, opts: { heightRatio: 0.5 } })
    expect(r.zoom).toBeCloseTo(1.5, 5)
    expect(r.moved).toBe(true)
  })

  it('不给 heightRatio 时按 padding 比例适配整块内容', () => {
    const r = computeFitTo({ rects, viewport: { w: 800, h: 600 }, opts: { padding: 0.1 } })
    expect(r.zoom).toBeCloseTo(640 / 300, 4)
  })

  it('keepZoom 只平移、不改缩放', () => {
    const r = computeFitTo({ rects, viewport: { w: 800, h: 600 }, opts: { keepZoom: true }, currentZoom: 0.7 })
    expect(r.zoom).toBe(0.7)
  })

  it('onlyIfOutOfView：已完整可见时不动', () => {
    const r = computeFitTo({
      rects: [{ id: 'a', x: 10, y: 10, w: 100, h: 100 }],
      viewport: { w: 800, h: 600 },
      viewportState: { x: 0, y: 0, zoom: 1 },
      opts: { onlyIfOutOfView: true },
    })
    expect(r.moved).toBe(false)
  })

  it('margin 参与可见性判定', () => {
    const r = computeFitTo({
      rects: [{ id: 'a', x: 790, y: 10, w: 100, h: 100 }],
      viewport: { w: 800, h: 600 },
      viewportState: { x: 0, y: 0, zoom: 1 },
      opts: { onlyIfOutOfView: true, margin: 24 },
    })
    expect(r.moved).toBe(true)
  })

  it('zoom 指定时优先于 heightRatio', () => {
    const r = computeFitTo({ rects, viewport: { w: 800, h: 600 }, opts: { zoom: 1 } })
    expect(r.zoom).toBe(1)
  })

  it('includeBars 把底部栏高度从可用高度里扣掉', () => {
    const r = computeFitTo({
      rects,
      viewport: { w: 800, h: 600 },
      opts: { heightRatio: 0.5, includeBars: 'bottom' },
      barHeight: { top: 40, bottom: 100 },
    })
    expect(r.zoom).toBeCloseTo((500 * 0.5) / 200, 5)
  })

  it('空目标不动、不除零', () => {
    const r = computeFitTo({ rects: [], viewport: { w: 800, h: 600 }, viewportState: { x: 3, y: 4, zoom: 2 } })
    expect(r).toEqual({ moved: false, viewport: { x: 3, y: 4, zoom: 2 }, zoom: 2 })
  })
})
