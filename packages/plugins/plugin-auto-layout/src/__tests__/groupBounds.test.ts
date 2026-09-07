import { describe, expect, it } from 'vitest'
import { calculateGroupFrameFromAbsoluteChildren, getNodeSize } from '../groupBounds'

describe('getNodeSize', () => {
  it('取 size；缺省回退默认', () => {
    expect(getNodeSize({ id: 'a', position: { x: 0, y: 0 }, size: { w: 220, h: 120 } })).toEqual({ width: 220, height: 120 })
    expect(getNodeSize({ id: 'b', position: { x: 0, y: 0 } })).toEqual({ width: 200, height: 100 })
  })
})

describe('calculateGroupFrameFromAbsoluteChildren', () => {
  it('空子节点 → null', () => {
    expect(calculateGroupFrameFromAbsoluteChildren([])).toBeNull()
  })

  it('按子节点绝对包围盒 + padding 计算 frame', () => {
    const frame = calculateGroupFrameFromAbsoluteChildren([
      { id: 'c1', position: { x: 100, y: 100 }, size: { w: 100, h: 80 } },
      { id: 'c2', position: { x: 250, y: 220 }, size: { w: 120, h: 60 } },
    ])
    // 子包围盒：x 100..370, y 100..280 → padding 30/40(top) → frame
    expect(frame!.x).toBe(70)          // 100-30
    expect(frame!.y).toBe(60)          // 100-30-10
    expect(frame!.w).toBeGreaterThanOrEqual(270) // 370-100+60
    expect(frame!.h).toBeGreaterThanOrEqual(180) // 280-100+60+10
  })

  it('尺寸不足最小宽高时按最小兜底', () => {
    const frame = calculateGroupFrameFromAbsoluteChildren([
      { id: 'c1', position: { x: 0, y: 0 }, size: { w: 10, h: 10 } },
    ])
    expect(frame!.w).toBeGreaterThanOrEqual(200)
    expect(frame!.h).toBeGreaterThanOrEqual(150)
  })
})
