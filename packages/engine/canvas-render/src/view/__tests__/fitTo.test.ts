import { describe, expect, it } from 'vitest'
import { computeFitTo, resolvePadding } from '../fitTo'

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
    // 0.1 比例按较短边 600 换算 = 每边 60px → 可用区 680×480
    expect(r.zoom).toBeCloseTo(680 / 300, 4)
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

  it('margin 是屏幕像素：zoom=2 时 24px 只相当于 12 flow 单位', () => {
    // 视口 flow 宽度 = 800/2 = 400；右沿留 24 屏幕像素 = 12 flow 单位。
    // 388 的右沿正好压在边界上，算可见；389 越过，判为不可见。
    const visible = computeFitTo({
      rects: [{ id: 'a', x: 12, y: 12, w: 376, h: 276 }],
      viewport: { w: 800, h: 600 },
      viewportState: { x: 0, y: 0, zoom: 2 },
      opts: { onlyIfOutOfView: true, margin: 24 },
    })
    expect(visible.moved).toBe(false)

    const outside = computeFitTo({
      rects: [{ id: 'a', x: 12, y: 12, w: 377, h: 276 }],
      viewport: { w: 800, h: 600 },
      viewportState: { x: 0, y: 0, zoom: 2 },
      opts: { onlyIfOutOfView: true, margin: 24 },
    })
    expect(outside.moved).toBe(true)
  })

  it('fitTo 结果把目标中心放到视口中心（成功的平移坐标也要可验）', () => {
    const r = computeFitTo({
      rects: [{ id: 'a', x: 200, y: 100, w: 100, h: 100 }],
      viewport: { w: 800, h: 600 },
      opts: { zoom: 2, animate: false },
    })
    // 中心 = (250,150)；视口中心 = (400,300)；translate = center - target*zoom
    expect(r.viewport.x).toBe(400 - 250 * 2)
    expect(r.viewport.y).toBe(300 - 150 * 2)
    expect(r.viewport.zoom).toBe(2)
  })

  it('minZoom / maxZoom 真正夹取计算出的缩放', () => {
    const tiny = computeFitTo({
      rects: [{ id: 'a', x: 0, y: 0, w: 100, h: 10_000 }],
      viewport: { w: 800, h: 600 },
      opts: { heightRatio: 0.5, minZoom: 0.3, maxZoom: 2 },
    })
    expect(tiny.zoom).toBe(0.3)

    const huge = computeFitTo({
      rects: [{ id: 'a', x: 0, y: 0, w: 10, h: 10 }],
      viewport: { w: 800, h: 600 },
      opts: { heightRatio: 0.9, minZoom: 0.1, maxZoom: 3 },
    })
    expect(huge.zoom).toBe(3)
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

  it('includeBars: top 扣顶部栏，内容居中到剩下的那块而不是整块屏幕', () => {
    const r = computeFitTo({
      rects: [{ id: 'a', x: 0, y: 0, w: 200, h: 100 }],
      viewport: { w: 800, h: 600 },
      opts: { heightRatio: 0.5, includeBars: 'top' },
      barHeight: { top: 60, bottom: 40 },
    })
    // 可用高 = 600 - 60 = 540；内容高 100、占一半 → zoom = 2.7
    expect(r.zoom).toBeCloseTo((540 * 0.5) / 100, 5)
    // 内容中心 (100, 50)；可用区中心 x=400、y=60+270=330
    expect(r.viewport.x).toBeCloseTo(400 - 100 * 2.7, 5)
    expect(r.viewport.y).toBeCloseTo(330 - 50 * 2.7, 5)
  })

  it('padding 是像素时：缩小可用区，并真的影响缩放倍率', () => {
    const plain = computeFitTo({
      rects: [{ id: 'a', x: 0, y: 0, w: 100, h: 100 }],
      viewport: { w: 800, h: 600 },
      opts: { heightRatio: 1, maxZoom: 20 },
    })
    const padded = computeFitTo({
      rects: [{ id: 'a', x: 0, y: 0, w: 100, h: 100 }],
      viewport: { w: 800, h: 600 },
      opts: { heightRatio: 1, maxZoom: 20, padding: 50 },
    })
    expect(plain.zoom).toBeCloseTo(6, 5)
    // 上下各留 50 → 可用高 500
    expect(padded.zoom).toBeCloseTo(5, 5)
  })

  it('padding 支持 2 / 3 / 4 个值，效果和 CSS 一致', () => {
    // 2 个值：上下 100、左右 10 → 可用高 = 600 - 200
    const r = computeFitTo({
      rects: [{ id: 'a', x: 0, y: 0, w: 100, h: 100 }],
      viewport: { w: 800, h: 600 },
      opts: { heightRatio: 1, maxZoom: 20, padding: [100, 10] },
    })
    expect(r.zoom).toBeCloseTo(4, 5)

    // 3 个值：上 100、左右 10、下 0 → 可用高 = 600 - 100
    const three = computeFitTo({
      rects: [{ id: 'a', x: 0, y: 0, w: 100, h: 100 }],
      viewport: { w: 800, h: 600 },
      opts: { heightRatio: 1, maxZoom: 20, padding: [100, 10, 0] },
    })
    expect(three.zoom).toBeCloseTo(5, 5)

    // 4 个值：上 100、右 20、下 0、左 0
    const four = computeFitTo({
      rects: [{ id: 'a', x: 0, y: 0, w: 100, h: 100 }],
      viewport: { w: 800, h: 600 },
      opts: { heightRatio: 1, maxZoom: 20, padding: [100, 20, 0, 0] },
    })
    expect(four.zoom).toBeCloseTo(5, 5)
    // 可用区中心偏移：左 0、右 20 → 中心 = 400 - 10 = 390
    expect(four.viewport.x).toBeCloseTo(390 - 50 * 5, 5)
  })

  it('resolvePadding：≤1 是比例，>1 是像素；负数与非法值当 0', () => {
    const vp = { w: 800, h: 600 }
    // 0.1 比例 → 按较短边 600 换算 = 60px
    expect(resolvePadding(0.1, vp)).toEqual({ top: 60, right: 60, bottom: 60, left: 60 })
    // 48 像素原样
    expect(resolvePadding(48, vp)).toEqual({ top: 48, right: 48, bottom: 48, left: 48 })
    // 2 / 3 / 4 值展开
    expect(resolvePadding([10, 20], vp)).toEqual({ top: 10, right: 20, bottom: 10, left: 20 })
    expect(resolvePadding([10, 20, 30], vp)).toEqual({ top: 10, right: 20, bottom: 30, left: 20 })
    expect(resolvePadding([10, 20, 30, 40], vp)).toEqual({ top: 10, right: 20, bottom: 30, left: 40 })
    // 组里只要有一个 > 1，整组按像素
    expect(resolvePadding([0.5, 100], vp)).toEqual({ top: 0.5, right: 100, bottom: 0.5, left: 100 })
    // 负数 / NaN 当 0
    expect(resolvePadding([-50, Number.NaN], vp)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    expect(resolvePadding(undefined, vp)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })

  it('留白大于视口时按比例收缩，绝不出现负可用区或 0 缩放', () => {
    const r = computeFitTo({
      rects: [{ id: 'a', x: 0, y: 0, w: 100, h: 100 }],
      viewport: { w: 200, h: 120 },
      opts: { heightRatio: 0.5, padding: 1000 },
    })
    expect(Number.isFinite(r.zoom)).toBe(true)
    expect(r.zoom).toBeGreaterThan(0)
    expect(Number.isFinite(r.viewport.x)).toBe(true)
    expect(Number.isFinite(r.viewport.y)).toBe(true)
  })

  it('空目标不动、不除零', () => {
    const r = computeFitTo({ rects: [], viewport: { w: 800, h: 600 }, viewportState: { x: 3, y: 4, zoom: 2 } })
    expect(r).toEqual({ moved: false, viewport: { x: 3, y: 4, zoom: 2 }, zoom: 2 })
  })

  /**
   * 回归：反复按 F 时画面越缩越小。
   *
   * 根因是节点控制栏高度被「屏幕像素 ÷ 当前 zoom」塞进包围盒 ——
   * 包围盒反过来依赖本次要算的缩放，形成反馈环，每次聚焦都会再缩一点。
   * 现在标题条作为固定屏幕像素先扣掉，包围盒只与数据有关 → 多次结果必须一致。
   */
  it('节点顶栏是固定屏幕像素：连续聚焦结果稳定，不会越缩越小', () => {
    const base = { rects: [{ id: 'a', x: 0, y: 0, w: 200, h: 200 }], viewport: { w: 800, h: 600 } }
    const opts = { heightRatio: 0.5, padding: 0 }
    const chrome = 40

    let state = { x: 0, y: 0, zoom: 1 }
    const zooms: number[] = []
    for (let i = 0; i < 6; i++) {
      const r = computeFitTo({ ...base, viewportState: state, opts, nodeTopBarHeight: chrome })
      zooms.push(Math.round(r.zoom * 1e6) / 1e6)
      state = r.viewport
    }
    // 第一次就该到位，之后每一次都完全一样
    expect(new Set(zooms).size).toBe(1)
    // 可用高 600、顶栏 40、内容占一半 → zoom = (600-40)*0.5/200 = 1.4
    expect(zooms[0]).toBeCloseTo(1.4, 6)
  })

  it('从不同起始缩放聚焦到同一目标：结果相同（与当前缩放无关）', () => {
    const base = { rects: [{ id: 'a', x: 0, y: 0, w: 200, h: 200 }], viewport: { w: 800, h: 600 } }
    const opts = { heightRatio: 0.5, padding: 0 }
    const chrome = 40
    const zooms = [0.3, 1, 4].map((z) =>
      computeFitTo({ ...base, viewportState: { x: 0, y: 0, zoom: z }, opts, nodeTopBarHeight: chrome }).zoom,
    )
    expect(zooms[1]).toBeCloseTo(zooms[0], 6)
    expect(zooms[2]).toBeCloseTo(zooms[0], 6)
  })

  it('节点顶栏留出位置后，卡片与顶栏整体在可用区居中', () => {
    const r = computeFitTo({
      rects: [{ id: 'a', x: 0, y: 0, w: 100, h: 100 }],
      viewport: { w: 800, h: 600 },
      opts: { heightRatio: 0.5, padding: 0 },
      nodeTopBarHeight: 20,
    })
    // 可用高 600、扣掉顶栏 20 后 580，内容占一半 → zoom = 2.9
    expect(r.zoom).toBeCloseTo(2.9, 6)
    // 内容中心应落在「扣掉顶栏后的那块」中心，而不是屏幕中心
    const screenCenterY = r.viewport.y + 50 * r.zoom
    expect(screenCenterY).toBeCloseTo(300 + 20 / 2, 5)
  })
})
