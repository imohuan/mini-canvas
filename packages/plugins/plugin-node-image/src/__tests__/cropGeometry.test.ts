/**
 * cropGeometry —— 裁剪几何纯函数契约（用户可见行为：框能不能拖、会不会越界、会不会缩没）。
 *
 * 锁的重点：
 * - object-contain 的显示几何（含"容器未量测 =0"不回 NaN 的兜底）；
 * - 拖动不越界、贴边停住；
 * - 缩放固定对角、不会翻面、不会小于最小边；
 * - 屏幕像素 → 图片像素的换算（缩放比非正时不除零）。
 */
import { describe, it, expect } from 'vitest'
import {
  clampRect,
  computeFit,
  defaultCropRect,
  minCropEdge,
  moveRect,
  placeActionBar,
  rectToDisplay,
  resizeRect,
  screenDeltaToImage,
  toCropPixels,
  MIN_CROP_IMAGE,
} from '../cropGeometry'

describe('computeFit：object-contain 显示几何', () => {
  it('宽图按宽铺满、上下留边并居中', () => {
    // 容器 200×200，图 400×200（宽高比 2）→ 铺满宽 200，高 100，上下各留 50
    const fit = computeFit(200, 200, 400, 200)
    expect(fit.dw).toBe(200)
    expect(fit.dh).toBe(100)
    expect(fit.ox).toBe(0)
    expect(fit.oy).toBe(50)
    expect(fit.scale).toBe(0.5)
  })

  it('高图按高铺满、左右留边并居中', () => {
    // 容器 200×200，图 100×400 → 铺满高 200，宽 50，左右各留 75
    const fit = computeFit(200, 200, 100, 400)
    expect(fit.dw).toBe(50)
    expect(fit.dh).toBe(200)
    expect(fit.ox).toBe(75)
    expect(fit.oy).toBe(0)
    expect(fit.scale).toBe(0.5)
  })

  it('容器未量测（0）不产生 NaN / Infinity', () => {
    const fit = computeFit(0, 0, 100, 50)
    for (const v of [fit.dw, fit.dh, fit.ox, fit.oy, fit.scale]) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })
})

describe('minCropEdge：屏幕最小边与像素最小边取大者', () => {
  it('大图（缩放比极小）时按屏幕 8px 折算，避免框缩成一条线', () => {
    expect(minCropEdge(0.01)).toBe(800)
  })

  it('放大显示时用图片像素下限 20', () => {
    expect(minCropEdge(4)).toBe(MIN_CROP_IMAGE)
  })

  it('缩放比非法（0）时不除零、回落到图片像素下限', () => {
    expect(minCropEdge(0)).toBe(MIN_CROP_IMAGE)
  })
})

describe('defaultCropRect：初始框', () => {
  it('居中且边长为短边 80%', () => {
    const rect = defaultCropRect(1000, 800, 1)
    expect(rect.width).toBe(640)
    expect(rect.height).toBe(640)
    expect(rect.x).toBe(180)
    expect(rect.y).toBe(80)
  })

  it('小图也不会超出图像边界', () => {
    const rect = defaultCropRect(30, 30, 1)
    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.y).toBeGreaterThanOrEqual(0)
    expect(rect.x + rect.width).toBeLessThanOrEqual(30)
    expect(rect.y + rect.height).toBeLessThanOrEqual(30)
  })
})

describe('clampRect：收进图像且不小于最小边', () => {
  it('超出右下角时贴边', () => {
    const rect = clampRect({ x: 900, y: 700, width: 300, height: 300 }, 1000, 800, 20)
    expect(rect.x + rect.width).toBe(1000)
    expect(rect.y + rect.height).toBe(800)
  })

  it('负坐标贴到左上角', () => {
    const rect = clampRect({ x: -50, y: -50, width: 200, height: 200 }, 1000, 800, 20)
    expect(rect.x).toBe(0)
    expect(rect.y).toBe(0)
  })

  it('过小尺寸被抬到最小边', () => {
    const rect = clampRect({ x: 10, y: 10, width: 1, height: 1 }, 1000, 800, 20)
    expect(rect.width).toBe(20)
    expect(rect.height).toBe(20)
  })

  it('图像本身比最小边还小时，最小边退化为图像尺寸（不撑出界）', () => {
    const rect = clampRect({ x: 0, y: 0, width: 5, height: 5 }, 5, 5, 20)
    expect(rect.width).toBe(5)
    expect(rect.height).toBe(5)
  })
})

describe('moveRect：整体平移', () => {
  it('平移后保持尺寸、不越界', () => {
    const moved = moveRect({ x: 0, y: 0, width: 100, height: 100 }, 950, 0, 1000, 800, 20)
    expect(moved.width).toBe(100)
    expect(moved.height).toBe(100)
    expect(moved.x).toBe(900)
  })

  it('往左上平移到头即贴边', () => {
    const moved = moveRect({ x: 100, y: 100, width: 100, height: 100 }, -9999, -9999, 1000, 800, 20)
    expect(moved.x).toBe(0)
    expect(moved.y).toBe(0)
  })
})

describe('resizeRect：拖角缩放', () => {
  const start = { x: 100, y: 100, width: 200, height: 200 }

  it('拖右下角：左上角固定，只变大', () => {
    const next = resizeRect(start, 'se', 50, 30, 1000, 800, 20)
    expect(next.x).toBe(100)
    expect(next.y).toBe(100)
    expect(next.width).toBe(250)
    expect(next.height).toBe(230)
  })

  it('拖左上角：右下角固定，位置跟着动', () => {
    const next = resizeRect(start, 'nw', -40, -30, 1000, 800, 20)
    expect(next.x).toBe(60)
    expect(next.y).toBe(70)
    expect(next.x + next.width).toBe(300)
    expect(next.y + next.height).toBe(300)
  })

  it('拖过头不会翻面：最小边兜住（不会变成负尺寸）', () => {
    const next = resizeRect(start, 'nw', 9999, 9999, 1000, 800, 20)
    expect(next.width).toBeGreaterThanOrEqual(20)
    expect(next.height).toBeGreaterThanOrEqual(20)
  })

  it('拖出图像外被边界夹住', () => {
    const next = resizeRect(start, 'se', 9999, 9999, 1000, 800, 20)
    expect(next.x + next.width).toBe(1000)
    expect(next.y + next.height).toBe(800)
  })
})

describe('换算与提交', () => {
  it('rectToDisplay：图片像素 → 显示坐标（含 letterbox 偏移）', () => {
    const fit = computeFit(200, 200, 400, 200) // ox0 oy50 scale0.5
    const display = rectToDisplay({ x: 100, y: 100, width: 200, height: 200 }, fit)
    expect(display).toEqual({ x: 50, y: 100, width: 100, height: 100 })
  })

  it('screenDeltaToImage：除以缩放比；缩放比非法时按 1（不除零）', () => {
    expect(screenDeltaToImage(50, -30, 0.5)).toEqual({ dx: 100, dy: -60 })
    expect(screenDeltaToImage(10, 10, 0)).toEqual({ dx: 10, dy: 10 })
  })

  it('toCropPixels：整数化且宽高至少 1px', () => {
    expect(toCropPixels({ x: 10.4, y: 20.6, width: 30.2, height: 40.7 })).toEqual({
      x: 10,
      y: 21,
      width: 31,
      // 右/下边各自取整后相减：round(20.6+40.7)=61，61-21=40
      height: 40,
    })
    expect(toCropPixels({ x: 5, y: 5, width: 0, height: 0 })).toEqual({ x: 5, y: 5, width: 1, height: 1 })
  })
})

describe('placeActionBar：操作条落点', () => {
  it('下方放得下时贴在框下方', () => {
    const place = placeActionBar({ x: 50, y: 50, width: 100, height: 100 }, 300, 400, 96, 32, 10)
    expect(place.left).toBe(100)
    expect(place.top).toBe(160)
  })

  it('下方不够时上移到框内底部，且不出界', () => {
    const place = placeActionBar({ x: 0, y: 200, width: 300, height: 100 }, 300, 320, 96, 32, 10)
    expect(place.top).toBeLessThanOrEqual(320 - 32)
    expect(place.top).toBeGreaterThanOrEqual(0)
  })

  it('框贴左边时中心被收进容器内（不溢出）', () => {
    const place = placeActionBar({ x: 0, y: 0, width: 20, height: 20 }, 300, 300, 96, 32, 10)
    expect(place.left).toBeGreaterThanOrEqual(48)
  })
})
