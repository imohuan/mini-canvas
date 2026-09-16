/**
 * 群组框几何（用户报的缺陷："框选之后你的 UI 存在异常，2 个框竟然有重合"）。
 *
 * 用户描述里明确了两框的含义：
 * - 小框 = 根据选中节点计算的**最小 rect 框**（不包含标题）；
 * - 大框 = 根据一个**固定 padding** 得到的框。
 *
 * 旧实现把"小框的宽高"错写成了大框的宽高（只有位置用了 padding），于是小框被推到右下、
 * 且比大框还大 —— 两个框交叉错位。这两条断言锁的就是"小框尺寸 = 节点并集，不掺 padding"。
 */
import { describe, it, expect } from 'vitest'
import {
  computeSelectionFrameGeometry,
  computeUnionBounds,
  paddedBounds,
  DEFAULT_SELECTION_FRAME_PADDING,
  DEFAULT_SELECTION_FRAME_INNER_PADDING,
  type MultiSelectRect,
} from '../multiSelectEngine'

function r(id: string, x: number, y: number, w = 100, h = 80): MultiSelectRect {
  return { id, x, y, w, h }
}

const PAD = { paddingX: 16, paddingTop: 34, paddingBottom: 16 }

describe('computeSelectionFrameGeometry（内外双框）', () => {
  it('小框 = 选中节点的最小并集（尺寸不掺 padding）', () => {
    const rects = [r('a', 100, 200, 300, 120), r('b', 500, 260, 200, 200)]
    const g = computeSelectionFrameGeometry(rects, PAD)!
    // 并集：x 100..700, y 200..460
    expect(g.inner).toEqual({ id: '', x: 100, y: 200, w: 600, h: 260 })
  })

  it('大框 = 小框外扩固定 padding（左右各 paddingX、上 paddingTop、下 paddingBottom）', () => {
    const union = computeUnionBounds([r('a', 100, 200, 300, 120)])!
    const g = computeSelectionFrameGeometry([r('a', 100, 200, 300, 120)], PAD)!
    expect(g.outer).toEqual(paddedBounds(union, PAD))
    expect(g.outer).toEqual({ id: '', x: 84, y: 166, w: 332, h: 170 })
  })

  it('小框落在大框内 = 左/上各内缩 padding（小框完整套在大框里，绝不交叉）', () => {
    const rects = [r('a', 0, 0, 100, 80), r('b', 200, 50, 100, 80)]
    const g = computeSelectionFrameGeometry(rects, PAD)!
    // 小框 = 大框左上角 + padding（这也正是"小框落在大框里"的定义式）
    expect(g.inner.x - g.outer.x).toBe(PAD.paddingX)
    expect(g.inner.y - g.outer.y).toBe(PAD.paddingTop)
    // 下方也要对得上：外框底 − 小框底 = paddingBottom
    expect(g.outer.y + g.outer.h - (g.inner.y + g.inner.h)).toBe(PAD.paddingBottom)
    // 几何包含关系：小框在大框内部（外框左/上 ≤ 小框，右/下 ≥ 小框）
    expect(g.outer.x).toBeLessThanOrEqual(g.inner.x)
    expect(g.outer.y).toBeLessThanOrEqual(g.inner.y)
    expect(g.outer.x + g.outer.w).toBeGreaterThanOrEqual(g.inner.x + g.inner.w)
    expect(g.outer.y + g.outer.h).toBeGreaterThanOrEqual(g.inner.y + g.inner.h)
  })

  it('默认 padding 与老版 v1 一致（左右 16 / 上 34 / 下 16）', () => {
    expect(DEFAULT_SELECTION_FRAME_PADDING).toEqual(PAD)
  })

  it('padding 变化只影响大框与内缩位置，小框尺寸恒等于节点并集', () => {
    const rects = [r('a', 0, 0, 100, 80)]
    const wide = computeSelectionFrameGeometry(rects, { paddingX: 80, paddingTop: 200, paddingBottom: 5 })!
    expect(wide.inner).toEqual({ id: '', x: 0, y: 0, w: 100, h: 80 })
    expect(wide.outer).toEqual({ id: '', x: -80, y: -200, w: 260, h: 285 })
    expect(wide.inner.x - wide.outer.x).toBe(80)
    expect(wide.inner.y - wide.outer.y).toBe(200)
  })

  it('空集 / 尺寸非法返回 null（不画框）', () => {
    expect(computeSelectionFrameGeometry([], PAD)).toBeNull()
    expect(computeSelectionFrameGeometry([r('x', 0, 0, 0, 0)], PAD)).toBeNull()
  })
})

describe('小框也能外扩（用户要求：内框的 padding 可设）', () => {
  const rects = [r('a', 100, 200, 300, 120)]

  it('小框 padding 缺省 = 全 0 → 小框就是节点并集（默认观感不变）', () => {
    const g = computeSelectionFrameGeometry(rects, PAD)!
    expect(g.inner).toEqual({ id: '', x: 100, y: 200, w: 300, h: 120 })
    expect(DEFAULT_SELECTION_FRAME_INNER_PADDING).toEqual({ paddingX: 0, paddingTop: 0, paddingBottom: 0 })
  })

  it('给小框 padding → 小框比节点并集向外胖一圈（各边各扩自己的量）', () => {
    const g = computeSelectionFrameGeometry(rects, PAD, { paddingX: 8, paddingTop: 12, paddingBottom: 4 })!
    expect(g.inner).toEqual({ id: '', x: 92, y: 188, w: 300 + 16, h: 120 + 12 + 4 })
  })

  it('小框外扩后，大框仍在小框外侧留"两框间距"（间距是相对小框算的，不是相对节点）', () => {
    const g = computeSelectionFrameGeometry(rects, PAD, { paddingX: 8, paddingTop: 12, paddingBottom: 4 })!
    expect(g.outer.x).toBe(g.inner.x - PAD.paddingX)
    expect(g.outer.y).toBe(g.inner.y - PAD.paddingTop)
    expect(g.outer.x + g.outer.w).toBe(g.inner.x + g.inner.w + PAD.paddingX)
    expect(g.outer.y + g.outer.h).toBe(g.inner.y + g.inner.h + PAD.paddingBottom)
  })

  it('大框永远包住小框（不管小框扩多少，两框都不会交叉）', () => {
    for (const innerPad of [0, 5, 30, 200]) {
      const g = computeSelectionFrameGeometry(rects, PAD, {
        paddingX: innerPad,
        paddingTop: innerPad,
        paddingBottom: innerPad,
      })!
      expect(g.outer.x).toBeLessThanOrEqual(g.inner.x)
      expect(g.outer.y).toBeLessThanOrEqual(g.inner.y)
      expect(g.outer.x + g.outer.w).toBeGreaterThanOrEqual(g.inner.x + g.inner.w)
      expect(g.outer.y + g.outer.h).toBeGreaterThanOrEqual(g.inner.y + g.inner.h)
    }
  })
})
