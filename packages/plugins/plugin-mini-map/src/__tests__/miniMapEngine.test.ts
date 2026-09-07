import { describe, it, expect } from 'vitest'
import {
  computeContentBounds,
  unionRect,
  viewportRectInFlow,
  computeMapState,
  rectToMap,
  panViewport,
  mapPointToFlow,
} from '../miniMapEngine'

describe('computeContentBounds', () => {
  it('空数组 → null', () => {
    expect(computeContentBounds([])).toBeNull()
  })
  it('单矩形并集 = 自身', () => {
    expect(computeContentBounds([{ x: 10, y: 20, w: 30, h: 40 }])).toEqual({ x: 10, y: 20, w: 30, h: 40 })
  })
  it('多矩形取外接包围盒', () => {
    const rects = [
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 200, y: 100, w: 50, h: 80 },
      { x: -20, y: 40, w: 10, h: 10 },
    ]
    expect(computeContentBounds(rects)).toEqual({ x: -20, y: 0, w: 270, h: 180 })
  })
})

describe('unionRect', () => {
  it('任一 null 返回另一', () => {
    const a = { x: 0, y: 0, w: 1, h: 1 }
    expect(unionRect(a, null)).toEqual(a)
    expect(unionRect(null, a)).toEqual(a)
    expect(unionRect(null, null)).toBeNull()
  })
  it('两矩形并集', () => {
    expect(unionRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toEqual({ x: 0, y: 0, w: 15, h: 15 })
  })
})

describe('viewportRectInFlow', () => {
  it('视口原点换算 + 除以 zoom', () => {
    // viewport {x:100,y:50,zoom:2}, pane 800x600 → flow 可见 [−50,−25] 大小 400x300
    expect(viewportRectInFlow({ x: 100, y: 50, zoom: 2 }, 800, 600)).toEqual({ x: -50, y: -25, w: 400, h: 300 })
  })
  it('zoom 0 防御回退 1', () => {
    const r = viewportRectInFlow({ x: 0, y: 0, zoom: 0 }, 100, 100)
    expect(r.w).toBe(100)
    expect(r.h).toBe(100)
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
  })
})

describe('computeMapState', () => {
  it('等比缩放居中', () => {
    // bounds 200x100 → 内容区 200x100(pad8) → scale=1 → 宽高皆正好填满 → offsetX=8, offsetY=8
    const ms = computeMapState({ x: 0, y: 0, w: 200, h: 100 }, 216, 116, 8)
    expect(ms.scale).toBeCloseTo(1)
    expect(ms.offsetX).toBeCloseTo(8)
    expect(ms.offsetY).toBeCloseTo(8)
  })
  it('过宽时按宽缩放', () => {
    // bounds 400x100, 内容区 200x100 → scale=0.5；高度余量垂直居中
    const ms = computeMapState({ x: 0, y: 0, w: 400, h: 100 }, 216, 116, 8)
    expect(ms.scale).toBeCloseTo(0.5)
    expect(ms.offsetY).toBeCloseTo(8 + (100 - 100 * 0.5) / 2)
  })
})

describe('rectToMap', () => {
  it('flow 矩形 → 小地图 px 位置', () => {
    const ms = computeMapState({ x: 0, y: 0, w: 200, h: 100 }, 216, 116, 8)
    const r = rectToMap({ x: 50, y: 25, w: 100, h: 50 }, ms)
    expect(r.left).toBeCloseTo(58)
    expect(r.top).toBeCloseTo(33)
    expect(r.width).toBeCloseTo(100)
    expect(r.height).toBeCloseTo(50)
  })
  it('极窄矩形至少 1px', () => {
    const ms = computeMapState({ x: 0, y: 0, w: 100, h: 100 }, 216, 116, 8)
    expect(rectToMap({ x: 0, y: 0, w: 0.01, h: 100 }, ms).width).toBe(1)
  })
})

describe('panViewport', () => {
  const start = { x: 100, y: 50, zoom: 2 }
  it('向右拖 → 视口向左移（按 scale 与 zoom 换算）', () => {
    const vp = panViewport(start, { x: 0, y: 0 }, { x: 20, y: 0 }, 2)
    // dx=20, dx/scale=10 flow, ×zoom2=20 → x=100−20=80
    expect(vp.x).toBeCloseTo(80)
    expect(vp.y).toBeCloseTo(50)
  })
  it('向下拖 → 视口向上移', () => {
    const vp = panViewport(start, { x: 0, y: 0 }, { x: 0, y: 10 }, 1, 1, 2)
    // dy=20, /scale1=20, ×zoom2=40 → y=50−40=10
    expect(vp.y).toBeCloseTo(10)
  })
  it('灵敏度倍率生效', () => {
    const vp = panViewport(start, { x: 0, y: 0 }, { x: 10, y: 0 }, 1, 0.5)
    // dx=5, /1=5, ×2=10 → x=90
    expect(vp.x).toBeCloseTo(90)
  })
  it('zoom 0 防御回退 1（不 NaN）', () => {
    const vp = panViewport({ x: 0, y: 0, zoom: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, 1)
    expect(Number.isNaN(vp.x)).toBe(false)
    expect(vp.x).toBeCloseTo(-10)
  })
})

describe('mapPointToFlow', () => {
  it('map px → flow 坐标（scale 与 offset 逆运算）', () => {
    const ms = computeMapState({ x: 0, y: 0, w: 200, h: 100 }, 216, 116, 8)
    // scale=1, offset(8,8)：px(108,8) → flow(100,0)
    const p = mapPointToFlow(108, 8, ms)
    expect(p.x).toBeCloseTo(100)
    expect(p.y).toBeCloseTo(0)
  })
  it('非 1 scale 时换算含缩放', () => {
    const ms = computeMapState({ x: 100, y: 200, w: 400, h: 100 }, 216, 116, 8)
    // scale=0.5; offsetX=8+(200-200)/2=8; offsetY=8+(100-50)/2=33; flow = 100+(px-8)/0.5
    const p = mapPointToFlow(8, 8, ms)
    expect(p.x).toBeCloseTo(100)
    // flow = 200 + (8-33)/0.5 = 200 - 50 = 150
    expect(p.y).toBeCloseTo(150)
  })
})
