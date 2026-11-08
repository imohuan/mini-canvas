/**
 * 取景的数学契约：内容必须真正居中，四边留白相等。
 *
 * 这轮 bug 的教训：只靠"看起来差不多"不行，必须用数字验证。
 * 之前纵向用了单独的顶部留白，导致内容偏上、右下空一大片。
 */
import { describe, expect, it } from 'vitest'
import { fitRectInView, frameMargins } from './framing'

const PAD = 40

function marginsFor(content: { x: number; y: number; w: number; h: number }, view: { w: number; h: number }) {
  const result = fitRectInView(content, view, PAD, 1)
  return frameMargins(content, view, result)
}

describe('预览取景', () => {
  it('内容在视野正中：左右留白相等、上下留白相等', () => {
    const m = marginsFor({ x: 0, y: 0, w: 600, h: 400 }, { w: 1000, h: 700 })
    expect(m.left).toBeCloseTo(m.right, 6)
    expect(m.top).toBeCloseTo(m.bottom, 6)
    expect(m.left).toBeGreaterThan(0)
  })

  it('内容不在原点时也居中（偏左的包围盒不会把画面推偏）', () => {
    const m = marginsFor({ x: 120, y: 80, w: 500, h: 300 }, { w: 900, h: 620 })
    expect(m.left).toBeCloseTo(m.right, 6)
    expect(m.top).toBeCloseTo(m.bottom, 6)
  })

  it('各种容器尺寸下都保持居中（窄屏 / 宽屏 / 竖屏）', () => {
    const content = { x: 56, y: 92, w: 692, h: 340 }
    for (const view of [
      { w: 640, h: 420 },
      { w: 900, h: 300 },
      { w: 380, h: 520 },
    ]) {
      const m = marginsFor(content, view)
      expect(m.left, JSON.stringify(view)).toBeCloseTo(m.right, 6)
      expect(m.top, JSON.stringify(view)).toBeCloseTo(m.bottom, 6)
    }
  })

  it('留白不会被裁成负数：内容始终完整可见', () => {
    const m = marginsFor({ x: 0, y: 0, w: 760, h: 500 }, { w: 500, h: 400 })
    expect(m.left).toBeGreaterThanOrEqual(0)
    expect(m.right).toBeGreaterThanOrEqual(0)
    expect(m.top).toBeGreaterThanOrEqual(0)
    expect(m.bottom).toBeGreaterThanOrEqual(0)
  })

  it('缩放不超过 1（不放大小样张）', () => {
    const result = fitRectInView({ x: 0, y: 0, w: 100, h: 100 }, { w: 4000, h: 4000 }, PAD, 1)
    expect(result.scale).toBeLessThanOrEqual(1)
  })
})
