/**
 * mediaFit —— 裁剪/扩展共用的纯几何契约（Node 直接跑）。
 *
 * 这是图片与视频两个节点共用的唯一一份实现，所以断言要覆盖**两种约束**：
 * 裁剪框不许出画面、扩展框必须包住画面。这两条一旦搞反，用户看到的分别是
 * "框拖到画面外框住一片空白"与"扩展把原图切掉一块"。
 */
import { describe, it, expect } from 'vitest'
import {
  ALL_DIRS,
  clampCropRect,
  clampExpandRect,
  computeMediaFit,
  CORNER_DIRS,
  defaultCropRect,
  defaultExpandRect,
  DEFAULT_CROP_RATIO,
  framedMediaStyle,
  isUsableRect,
  minFrameEdge,
  MIN_FRAME_DISPLAY_EDGE,
  MIN_FRAME_MEDIA,
  moveCropRect,
  moveExpandRect,
  rectToDisplay,
  resizeCropRect,
  resizeExpandRect,
  screenDeltaToMedia,
  toPixelRect,
} from '../mediaFit'

describe('computeMediaFit：object-contain 的显示几何', () => {
  it('宽画面：宽度铺满、上下留黑边', () => {
    const fit = computeMediaFit(400, 400, 1600, 800)
    expect(fit.dw).toBe(400)
    expect(fit.dh).toBe(200)
    expect(fit.ox).toBe(0)
    expect(fit.oy).toBe(100)
    expect(fit.scale).toBeCloseTo(0.25, 6)
  })

  it('窄画面：高度铺满、左右留黑边', () => {
    const fit = computeMediaFit(400, 400, 800, 1600)
    expect(fit.dw).toBe(200)
    expect(fit.dh).toBe(400)
    expect(fit.ox).toBe(100)
    expect(fit.oy).toBe(0)
  })

  it('容器或画面尺寸为 0（未量测）→ 按 1 处理，绝不回 NaN', () => {
    const fit = computeMediaFit(0, 0, 0, 0)
    for (const v of [fit.dw, fit.dh, fit.ox, fit.oy, fit.scale]) expect(Number.isFinite(v)).toBe(true)
  })
})

describe('minFrameEdge：大画面下框也不缩成一条线', () => {
  it('取「像素下限」与「屏幕至少 8px」的较大值', () => {
    expect(minFrameEdge(1)).toBe(MIN_FRAME_MEDIA)
    expect(minFrameEdge(0.01)).toBe(MIN_FRAME_DISPLAY_EDGE / 0.01)
  })

  it('scale 非法（0/NaN）时不回 NaN', () => {
    expect(Number.isFinite(minFrameEdge(0))).toBe(true)
    expect(Number.isFinite(minFrameEdge(Number.NaN))).toBe(true)
  })
})

describe('默认框', () => {
  it('裁剪框居中、边长 = min(宽,高) × 0.8', () => {
    const rect = defaultCropRect(1600, 900, 1)
    const side = 900 * DEFAULT_CROP_RATIO
    expect(rect.width).toBeCloseTo(side, 6)
    expect(rect.height).toBeCloseTo(side, 6)
    expect(rect.x).toBeCloseTo((1600 - side) / 2, 6)
    expect(rect.y).toBeCloseTo((900 - side) / 2, 6)
  })

  it('扩展框初始就是整幅画面（从原样开始往外拉）', () => {
    expect(defaultExpandRect(1200, 800)).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
  })
})

describe('clampCropRect：裁剪框必须在画面之内', () => {
  it('越界向左上 → 贴到 0', () => {
    expect(clampCropRect({ x: -50, y: -50, width: 200, height: 200 }, 1000, 800, 20)).toEqual({
      x: 0, y: 0, width: 200, height: 200,
    })
  })

  it('越界向右下 → 贴到右下缘（尺寸不变）', () => {
    expect(clampCropRect({ x: 950, y: 780, width: 200, height: 200 }, 1000, 800, 20)).toEqual({
      x: 800, y: 600, width: 200, height: 200,
    })
  })

  it('画面本身比最小边还小 → 最小边退化为画面尺寸（不撑出界）', () => {
    expect(clampCropRect({ x: 0, y: 0, width: 5, height: 5 }, 10, 10, 20)).toEqual({ x: 0, y: 0, width: 10, height: 10 })
  })
})

describe('clampExpandRect：扩展框必须包住画面（否则会切掉原图）', () => {
  it('往右上收缩 → 被挡回画面边界', () => {
    // 用户想把右边收进画面内（width 变小）→ 必须保底到画面宽
    expect(clampExpandRect({ x: 0, y: 0, width: 500, height: 300 }, 1000, 800)).toEqual({
      x: 0, y: 0, width: 1000, height: 800,
    })
  })

  it('左边界不能为正（否则左边切掉原图）', () => {
    // 左边界被压回 0，而**右边界保持不动**（拖左手柄时右手柄不该跟着跑）→ 宽度随之变大。
    // 结果是"包住原图且左边还多出一点"，安全方向永远是多留、不是切掉。
    const r = clampExpandRect({ x: 100, y: 0, width: 1000, height: 800 }, 1000, 800)
    expect(r.x).toBe(0)
    expect(r.x + r.width).toBe(1100)
  })

  it('往外扩（负 x / 更大宽高）原样保留，不设上限', () => {
    expect(clampExpandRect({ x: -200, y: -100, width: 1400, height: 1000 }, 1000, 800)).toEqual({
      x: -200, y: -100, width: 1400, height: 1000,
    })
  })
})

describe('平移', () => {
  it('moveCropRect：平移越界即贴边，尺寸不变', () => {
    const moved = moveCropRect({ x: 100, y: 100, width: 200, height: 200 }, -9999, -9999, 1000, 800, 20)
    expect(moved).toEqual({ x: 0, y: 0, width: 200, height: 200 })
  })

  it('moveExpandRect：往左上移会把框拉得更大（新画布加在左上）', () => {
    const moved = moveExpandRect({ x: 0, y: 0, width: 1000, height: 800 }, -100, -50, 1000, 800)
    expect(moved.x).toBe(-100)
    expect(moved.y).toBe(-50)
    // 右/下缘仍贴住原画面右/下缘 → 尺寸变大
    expect(moved.x + moved.width).toBe(1000)
    expect(moved.y + moved.height).toBe(800)
  })

  it('moveExpandRect：往右下移过头 → 被挡回（右/下缘不许离开画面）', () => {
    const moved = moveExpandRect({ x: -100, y: -100, width: 1200, height: 1000 }, 9999, 9999, 1000, 800)
    expect(moved.x + moved.width).toBeGreaterThanOrEqual(1000)
    expect(moved.y + moved.height).toBeGreaterThanOrEqual(800)
  })
})

describe('缩放裁剪框：只动该方向影响的边，翻不过对角', () => {
  it('拖左上角到右下之外 → 收到最小边的位置（不反向）', () => {
    const r = resizeCropRect({ x: 100, y: 100, width: 200, height: 200 }, 'nw', 9999, 9999, 1000, 800, 20)
    expect(r.x).toBe(300 - 20)
    expect(r.width).toBe(20)
  })

  it('拖右下角放大 → 受画面边界限制', () => {
    const r = resizeCropRect({ x: 0, y: 0, width: 100, height: 100 }, 'se', 9999, 9999, 500, 400, 20)
    expect(r.width).toBe(500)
    expect(r.height).toBe(400)
  })

  it('拖边手柄只改一个方向（拖右边不改高度）', () => {
    const r = resizeCropRect({ x: 0, y: 0, width: 100, height: 100 }, 'e', 50, 9999, 500, 400, 20)
    expect(r.width).toBe(150)
    expect(r.height).toBe(100)
  })

  it('裁剪只用 4 个角（边没有意义，只能缩小）', () => {
    expect(CORNER_DIRS).toEqual(['nw', 'ne', 'sw', 'se'])
  })
})

describe('缩放扩展框：不许拉进画面之内', () => {
  it('往左拉 → 框变大、左边界变负（新画布加在左边）', () => {
    const r = resizeExpandRect({ x: 0, y: 0, width: 1000, height: 800 }, 'w', -300, 0, 1000, 800)
    expect(r.x).toBe(-300)
    expect(r.x + r.width).toBe(1000)
  })

  it('把左边往右推 → 被挡在 0（不切掉原图）', () => {
    const r = resizeExpandRect({ x: -300, y: 0, width: 1300, height: 800 }, 'w', 9999, 0, 1000, 800)
    expect(r.x).toBe(0)
  })

  it('把右边往左收 → 被挡在画面右缘（不切掉原图）', () => {
    const r = resizeExpandRect({ x: 0, y: 0, width: 1200, height: 800 }, 'e', -9999, 0, 1000, 800)
    expect(r.x + r.width).toBe(1000)
  })

  it('扩展给 8 个方向（要能只往一侧扩）', () => {
    expect(ALL_DIRS).toHaveLength(8)
  })
})

describe('坐标换算', () => {
  it('rectToDisplay：媒体像素 → 容器内显示矩形', () => {
    const fit = computeMediaFit(400, 400, 1600, 800)
    const disp = rectToDisplay({ x: 400, y: 200, width: 800, height: 400 }, fit)
    expect(disp.x).toBeCloseTo(100, 6)
    expect(disp.y).toBeCloseTo(150, 6)
    expect(disp.width).toBeCloseTo(200, 6)
    expect(disp.height).toBeCloseTo(100, 6)
  })

  it('screenDeltaToMedia：屏幕位移换算成媒体像素位移（除零守卫）', () => {
    expect(screenDeltaToMedia(100, 50, 0.5)).toEqual({ dx: 200, dy: 100 })
    expect(screenDeltaToMedia(100, 50, 0)).toEqual({ dx: 100, dy: 50 })
  })

  it('toPixelRect：取整、宽高至少 1px', () => {
    expect(toPixelRect({ x: 10.4, y: 20.6, width: 100.4, height: 0.2 })).toEqual({
      x: 10, y: 21, width: 101, height: 1,
    })
  })
})

describe('isUsableRect：脏数据守卫', () => {
  it('正的宽高 + 有限坐标才算可用', () => {
    expect(isUsableRect({ x: 0, y: 0, width: 10, height: 10 })).toBe(true)
    expect(isUsableRect(undefined)).toBe(false)
    expect(isUsableRect(null)).toBe(false)
    expect(isUsableRect({ x: 0, y: 0, width: 0, height: 10 })).toBe(false)
    expect(isUsableRect({ x: Number.NaN, y: 0, width: 10, height: 10 })).toBe(false)
  })
})

describe('framedMediaStyle：裁完画面正好填满卡片', () => {
  it('裁中间四分之一：放大 2 倍并往左上推', () => {
    expect(framedMediaStyle({ x: 400, y: 200, width: 800, height: 400 }, 1600, 800)).toEqual({
      width: '200%', height: '200%', left: '-50%', top: '-50%',
    })
  })

  it('裁右上角：只往左推、不往下推', () => {
    expect(framedMediaStyle({ x: 800, y: 0, width: 800, height: 800 }, 1600, 800)).toEqual({
      width: '200%', height: '100%', left: '-100%', top: '0%',
    })
  })

  it('没有裁框 → 空样式（整幅画面，不放大不偏移）', () => {
    expect(framedMediaStyle(undefined, 1600, 800)).toEqual({})
  })

  it('裁框/原画面尺寸非法 → 空样式（宁可显示整幅，也不给出会算出 NaN 的样式）', () => {
    expect(framedMediaStyle({ x: 0, y: 0, width: 0, height: 0 }, 1600, 800)).toEqual({})
    expect(framedMediaStyle({ x: 0, y: 0, width: 100, height: 100 }, 0, 0)).toEqual({})
  })
})
