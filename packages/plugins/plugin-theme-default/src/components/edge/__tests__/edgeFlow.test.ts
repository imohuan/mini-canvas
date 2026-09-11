/**
 * edgeFlow —— 连线流光色块几何纯逻辑契约测试。
 *
 * 锚定用户口径：一条连线固定 N 个色块（线长、线短都是 N 个，不再"按距离铺满"）。
 * 算法：整条路径均分成 N 份 → 每份里放一个色块，色块长度 = 该份长度 × 占比(%)。
 */
import { describe, it, expect } from 'vitest'
import { computeFlowBlocks } from '../edgeFlow'
import { computeFlowAdvance } from '../edgeFlow'

const starts = (blocks: { start: number; end: number }[]) => blocks.map((b) => b.start)
const lengths = (blocks: { start: number; end: number }[]) => blocks.map((b) => b.end - b.start)

describe('computeFlowBlocks —— 固定数量', () => {
  it('长线也是 N 个（不再按距离铺满）', () => {
    const blocks = computeFlowBlocks({ totalLength: 600, count: 3, ratioPercent: 100, animDist: 0 })
    expect(starts(blocks)).toEqual([0, 200, 400])
    expect(lengths(blocks)).toEqual([200, 200, 200])
  })

  it('短线同样是 N 个（不再退化成 1 个）', () => {
    const blocks = computeFlowBlocks({ totalLength: 90, count: 3, ratioPercent: 100, animDist: 0 })
    expect(starts(blocks)).toEqual([0, 30, 60])
    expect(lengths(blocks)).toEqual([30, 30, 30])
  })

  it('数量 5 → 5 个，相邻起点距离 = 线长 / 5', () => {
    const blocks = computeFlowBlocks({ totalLength: 500, count: 5, ratioPercent: 10, animDist: 0 })
    expect(starts(blocks)).toEqual([45, 145, 245, 345, 445])
    expect(lengths(blocks)).toEqual([10, 10, 10, 10, 10])
  })
})

describe('computeFlowBlocks —— 占比是"每一份"的百分比', () => {
  it('占比 20%：色块长度 = 每份长度 × 20%', () => {
    const blocks = computeFlowBlocks({ totalLength: 300, count: 3, ratioPercent: 20, animDist: 0 })
    expect(starts(blocks)).toEqual([40, 140, 240])
    expect(lengths(blocks)).toEqual([20, 20, 20])
  })

  it('同样 20% 占比，长线的色块跟着变长（按比例，不是固定 px）', () => {
    const blocks = computeFlowBlocks({ totalLength: 600, count: 3, ratioPercent: 20, animDist: 0 })
    expect(starts(blocks)).toEqual([80, 280, 480])
    expect(lengths(blocks)).toEqual([40, 40, 40])
  })

  it('占比夹取在 [0,100]；0 不出色块', () => {
    expect(computeFlowBlocks({ totalLength: 300, count: 3, ratioPercent: 0, animDist: 0 })).toEqual([])
    const full = computeFlowBlocks({ totalLength: 300, count: 3, ratioPercent: 120, animDist: 0 })
    expect(lengths(full)).toEqual([100, 100, 100])
  })
})

describe('computeFlowBlocks —— 流动', () => {
  it('animDist 让色块整体前进同样距离', () => {
    const a = computeFlowBlocks({ totalLength: 300, count: 1, ratioPercent: 10, animDist: 0 })
    const b = computeFlowBlocks({ totalLength: 300, count: 1, ratioPercent: 10, animDist: 10 })
    expect(starts(a)).toEqual([135])
    expect(starts(b)).toEqual([145])
  })

  it('相位对"每份长度"取模 → 前进一整份后回到原位（无缝循环）', () => {
    const a = computeFlowBlocks({ totalLength: 300, count: 3, ratioPercent: 20, animDist: 0 })
    const b = computeFlowBlocks({ totalLength: 300, count: 3, ratioPercent: 20, animDist: 100 })
    expect(starts(b)).toEqual(starts(a))
  })

  it('两端越界不夹取（交给渲染器沿路径裁剪：头端滑入 + 尾端滑出）', () => {
    const blocks = computeFlowBlocks({ totalLength: 300, count: 3, ratioPercent: 20, animDist: 50 })
    expect(blocks).toEqual([
      { start: -10, end: 10 },
      { start: 90, end: 110 },
      { start: 190, end: 210 },
      { start: 290, end: 310 },
    ])
  })
})

describe('computeFlowBlocks —— 退化输入', () => {
  it('总长为 0 / 负数 → 空（几何未就绪）', () => {
    expect(computeFlowBlocks({ totalLength: 0, count: 3, ratioPercent: 20, animDist: 0 })).toEqual([])
    expect(computeFlowBlocks({ totalLength: -5, count: 3, ratioPercent: 20, animDist: 0 })).toEqual([])
  })

  it('数量 < 1 按 1 算；小数向下取整', () => {
    expect(computeFlowBlocks({ totalLength: 300, count: 0, ratioPercent: 100, animDist: 0 })).toEqual([
      { start: 0, end: 300 },
    ])
    expect(
      computeFlowBlocks({ totalLength: 300, count: 2.7, ratioPercent: 100, animDist: 0 }),
    ).toHaveLength(2)
  })
})

describe('computeFlowAdvance —— 走完整条线的时间固定（与线长无关）', () => {
  it('基准时间 × 1 倍速：任何长度的线都正好走完整条', () => {
    for (const totalLength of [80, 160, 400, 1200]) {
      expect(
        computeFlowAdvance({ totalLength, speedMultiplier: 1, deltaMs: 2000 }),
      ).toBeCloseTo(totalLength, 6)
    }
  })

  it('"同时到达"：长短两条线在同一段时间里都各自走完整条', () => {
    const short = computeFlowAdvance({ totalLength: 120, speedMultiplier: 1, deltaMs: 2000 })
    const long = computeFlowAdvance({ totalLength: 900, speedMultiplier: 1, deltaMs: 2000 })
    expect(short).toBeCloseTo(120, 6)
    expect(long).toBeCloseTo(900, 6)
    // 各自都到达终点 → 归一化进度相同
    expect(short / 120).toBeCloseTo(long / 900, 6)
  })

  it('倍速 = 线性加快：2 倍速用一半时间走完', () => {
    expect(computeFlowAdvance({ totalLength: 600, speedMultiplier: 2, deltaMs: 1000 })).toBeCloseTo(600, 6)
    expect(computeFlowAdvance({ totalLength: 600, speedMultiplier: 4, deltaMs: 500 })).toBeCloseTo(600, 6)
  })

  it('更长/更短的基准时间可按比例换算', () => {
    expect(
      computeFlowAdvance({ totalLength: 400, speedMultiplier: 1, deltaMs: 1000, baseSeconds: 4 }),
    ).toBeCloseTo(100, 6)
  })

  it('退化输入（线长/时间/倍速/基准非正）→ 0（不推进）', () => {
    expect(computeFlowAdvance({ totalLength: 0, speedMultiplier: 1, deltaMs: 16 })).toBe(0)
    expect(computeFlowAdvance({ totalLength: 400, speedMultiplier: 0, deltaMs: 16 })).toBe(0)
    expect(computeFlowAdvance({ totalLength: 400, speedMultiplier: 1, deltaMs: 0 })).toBe(0)
    expect(computeFlowAdvance({ totalLength: 400, speedMultiplier: 1, deltaMs: -5 })).toBe(0)
    expect(computeFlowAdvance({ totalLength: 400, speedMultiplier: 1, deltaMs: 16, baseSeconds: 0 })).toBe(0)
  })
})
