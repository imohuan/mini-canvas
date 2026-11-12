import { describe, it, expect } from 'vitest'
import { viewportRectInFlow, rectsOverlap, expandRect, type FlowRect } from '../visibleArea'

describe('viewportRectInFlow —— 视口变换 → flow 可视矩形', () => {
  it('zoom=1 平移 (0,0)：可视矩形即 pane 像素矩形', () => {
    expect(viewportRectInFlow({ x: 0, y: 0, zoom: 1 }, 800, 600)).toEqual({ x: 0, y: 0, w: 800, h: 600 })
  })

  it('pan 后可视区左上角 = -viewport/zoom', () => {
    // viewport.x=200 → 内容左移200px → 可视区在 flow 里起点 x = -200/1
    expect(viewportRectInFlow({ x: 200, y: 100, zoom: 1 }, 800, 600)).toEqual({ x: -200, y: -100, w: 800, h: 600 })
  })

  it('zoom>1：可视 flow 范围等比缩小（看得更少）', () => {
    // zoom=2 → 800px pane 只覆盖 400 flow 单位
    const r = viewportRectInFlow({ x: -400, y: -300, zoom: 2 }, 800, 600)
    expect(r).toEqual({ x: 200, y: 150, w: 400, h: 300 })
  })

  it('zoom=0 兜底为 1，不除零', () => {
    expect(viewportRectInFlow({ x: 0, y: 0, zoom: 0 }, 800, 600)).toEqual({ x: 0, y: 0, w: 800, h: 600 })
  })
})

describe('rectsOverlap —— 矩形相交', () => {
  it('部分相交为 true', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 50, w: 100, h: 100 })).toBe(true)
  })
  it('完全不相交为 false', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 0, w: 10, h: 10 })).toBe(false)
  })
  it('恰好压边不相交（严格小于）', () => {
    // a 右缘 100，b 左缘 100 → 仅接触不重叠
    expect(rectsOverlap({ x: 0, y: 0, w: 100, h: 100 }, { x: 100, y: 0, w: 100, h: 100 })).toBe(false)
  })
  it('内含为 true', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 200, h: 200 }, { x: 50, y: 50, w: 50, h: 50 })).toBe(true)
  })
  it('退化(零尺寸)矩形恒不相交', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 0, h: 100 }, { x: 0, y: 0, w: 100, h: 100 })).toBe(false)
  })
})

describe('expandRect —— 外扩边距', () => {
  it('四周均匀外扩 margin', () => {
    expect(expandRect({ x: 100, y: 200, w: 50, h: 60 }, 8)).toEqual({ x: 92, y: 192, w: 66, h: 76 })
  })
  it('margin=0 不变', () => {
    expect(expandRect({ x: 1, y: 2, w: 3, h: 4 }, 0)).toEqual({ x: 1, y: 2, w: 3, h: 4 })
  })
  it('不改动原矩形', () => {
    const r: FlowRect = { x: 0, y: 0, w: 10, h: 10 }
    expandRect(r, 5)
    expect(r).toEqual({ x: 0, y: 0, w: 10, h: 10 })
  })
})
