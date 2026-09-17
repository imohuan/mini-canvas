/**
 * cropRatio —— 裁剪框比例策略契约（纯函数，Node 直接跑）。
 *
 * 用户要求：「添加一个下拉配置，可以选择当前的裁剪框的比例，设置比例之后，
 * 你的裁剪框长宽比就会进行对应变化」。
 *
 * 这里锁三件事：
 * 1. 「自由」必须真的不锁比例（默认值就是它，最朴素的动作不能被强加比例）；
 * 2. 换比例后**长宽比确实等于所选比例**；
 * 3. 换比例**中心不动**、且结果一定合法（不越界、不小于最小边）——
 *    把框挪到别处会让用户"我框的东西跑掉了"。
 */
import { describe, it, expect } from 'vitest'
import {
  applyRatio,
  CROP_RATIO_OPTIONS,
  DEFAULT_CROP_RATIO_VALUE,
  ratioOf,
} from '../cropRatio'
import type { Rect } from '../mediaFit'

/** 测试用边界：2000×1500 的画面、最小边 20 */
const bounds = { width: 2000, height: 1500, minEdge: 20 }

describe('比例表', () => {
  it('默认是「自由」（不锁比例）—— 随手框一块是最朴素的动作', () => {
    expect(DEFAULT_CROP_RATIO_VALUE).toBe('free')
    expect(ratioOf(DEFAULT_CROP_RATIO_VALUE)).toBeNull()
  })

  it('常见比例都在表里，且键唯一', () => {
    const values = CROP_RATIO_OPTIONS.map((o) => o.value)
    expect(values).toContain('free')
    expect(values).toContain('1:1')
    expect(values).toContain('16:9')
    expect(values).toContain('9:16')
    expect(new Set(values).size).toBe(values.length)
  })

  it('每个选项的 label 与 ratio 自洽（label 写几比几，ratio 就是几除以几）', () => {
    for (const o of CROP_RATIO_OPTIONS) {
      if (o.value === 'free') continue
      const [w, h] = o.value.split(':').map(Number)
      expect(o.ratio).toBeCloseTo(w / h, 6)
    }
  })

  it('ratioOf：认识的键给数、不认识的键/空值给 null（视为自由，不锁）', () => {
    expect(ratioOf('1:1')).toBe(1)
    expect(ratioOf('16:9')).toBeCloseTo(16 / 9, 6)
    expect(ratioOf('9:16')).toBeCloseTo(9 / 16, 6)
    expect(ratioOf('nope')).toBeNull()
    expect(ratioOf('')).toBeNull()
    expect(ratioOf(undefined)).toBeNull()
  })
})

describe('applyRatio：按比例调框', () => {
  it('切成 1:1 → 框变正方形，且宽高比精确为 1', () => {
    const r = applyRatio({ x: 100, y: 100, width: 400, height: 200 }, 1, bounds)
    expect(r.width).toBeCloseTo(r.height, 6)
    expect(r.width / r.height).toBeCloseTo(1, 6)
  })

  it('切成 16:9 → 宽高比精确为 16/9', () => {
    const r = applyRatio({ x: 0, y: 0, width: 400, height: 400 }, 16 / 9, bounds)
    expect(r.width / r.height).toBeCloseTo(16 / 9, 3)
  })

  it('切成 9:16（竖版）→ 宽高比精确为 9/16，且不会突然盖满画面', () => {
    const r = applyRatio({ x: 0, y: 0, width: 400, height: 400 }, 9 / 16, bounds)
    expect(r.width / r.height).toBeCloseTo(9 / 16, 3)
    // 用短边做基准 → 高度不应暴涨到把画面盖满
    expect(r.height).toBeLessThanOrEqual(1500)
  })

  it('**中心不动**：换比例只改尺寸，不把框挪到别处', () => {
    const before: Rect = { x: 200, y: 150, width: 400, height: 300 }
    const after = applyRatio(before, 1, bounds)
    const cxBefore = before.x + before.width / 2
    const cyBefore = before.y + before.height / 2
    const cxAfter = after.x + after.width / 2
    const cyAfter = after.y + after.height / 2
    expect(cxAfter).toBeCloseTo(cxBefore, 6)
    expect(cyAfter).toBeCloseTo(cyBefore, 6)
  })

  it('ratio = null（自由）→ 原样返回，一点不动', () => {
    const before: Rect = { x: 10, y: 20, width: 333, height: 111 }
    expect(applyRatio(before, null, bounds)).toEqual(before)
  })

  it('ratio 非法（0 / 负数 / NaN）→ 原样返回，不产生坏框', () => {
    const before: Rect = { x: 10, y: 20, width: 333, height: 111 }
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(applyRatio(before, bad, bounds)).toEqual(before)
    }
  })

  it('框本身非法（零宽高）→ 原样返回（没东西可调）', () => {
    const before: Rect = { x: 0, y: 0, width: 0, height: 100 }
    expect(applyRatio(before, 1, bounds)).toEqual(before)
  })

  it('结果一定被收敛器夹过：贴近画面边缘换比例也不会越界', () => {
    // 框贴在右下角，切成 16:9 后必须仍完整落在画面内
    const r = applyRatio({ x: 1900, y: 1400, width: 100, height: 100 }, 16 / 9, bounds)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
    expect(r.x + r.width).toBeLessThanOrEqual(2000)
    expect(r.y + r.height).toBeLessThanOrEqual(1500)
  })

  it('结果不小于最小边（切成极端比例也不会塌成一条线）', () => {
    const r = applyRatio({ x: 0, y: 0, width: 30, height: 30 }, 16 / 9, bounds)
    expect(r.width).toBeGreaterThanOrEqual(20)
    expect(r.height).toBeGreaterThanOrEqual(20)
  })
})

describe('比例必须精确（实测踩过的坑）', () => {
  it('框已经贴住画面边界时换 16:9，比例**仍然是 16:9**（不能只夹住宽度而破比例）', () => {
    // 这是真实踩到的缺陷：当时"算好尺寸再交给通用夹取函数"，夹取逐边独立，
    // 宽度被挡、高度不动 → 得到 800×480 = 1.67 而不是 1.778。
    // 画面 1280×720（正好 16:9），框接近满幅。
    const wide = { width: 1280, height: 720, minEdge: 20 }
    const r = applyRatio({ x: 0, y: 0, width: 1200, height: 700 }, 16 / 9, wide)
    expect(r.width / r.height).toBeCloseTo(16 / 9, 3)
    expect(r.width).toBeLessThanOrEqual(1280)
    expect(r.height).toBeLessThanOrEqual(720)
  })

  it('在偏窄的画面里换 16:9 → 等比缩到装得下，比例依旧精确', () => {
    const narrow = { width: 600, height: 1200, minEdge: 20 }
    const r = applyRatio({ x: 100, y: 100, width: 400, height: 400 }, 16 / 9, narrow)
    expect(r.width / r.height).toBeCloseTo(16 / 9, 3)
    expect(r.width).toBeLessThanOrEqual(600)
  })

  it('最小边兜底也是等比的：不会因为抬到最小边而破比例', () => {
    const r = applyRatio({ x: 0, y: 0, width: 10, height: 10 }, 16 / 9, bounds)
    expect(r.width / r.height).toBeCloseTo(16 / 9, 3)
    expect(r.width).toBeGreaterThanOrEqual(20)
  })
})
