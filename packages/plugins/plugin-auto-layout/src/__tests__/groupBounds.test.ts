import { describe, expect, it } from 'vitest'
import {
  calculateGroupFrameFromAbsoluteChildren,
  getNodeSize,
  resolveGroupPadding,
  DEFAULT_GROUP_PADDING,
  GROUP_PADDING_KEYS,
} from '../groupBounds'

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

  it('非对称 padding：与 plugin-group 设置面板同 key 同默认值', () => {
    // 内容包围盒 (100,100)-(420,260)：left10/top5 → (90,95)；宽 320+10+20=350；高 160+5+15=180
    const frame = calculateGroupFrameFromAbsoluteChildren(
      [
        { id: 'c1', position: { x: 100, y: 100 }, size: { w: 100, h: 80 } },
        { id: 'c2', position: { x: 300, y: 200 }, size: { w: 120, h: 60 } },
      ],
      { left: 10, right: 20, top: 5, bottom: 15 },
    )
    expect(frame).toEqual({ x: 90, y: 95, w: 350, h: 180 })
  })
})

describe('resolveGroupPadding（布局收拢读同一份分组留白设置）', () => {
  it('全部读不到 → 默认值（top=40 给标题条留位）', () => {
    expect(resolveGroupPadding(() => undefined)).toEqual(DEFAULT_GROUP_PADDING)
    expect(DEFAULT_GROUP_PADDING).toEqual({ left: 30, right: 30, top: 40, bottom: 30 })
  })
  it('读到合法值逐项生效；非法值回落默认', () => {
    const values: Record<string, unknown> = {
      [GROUP_PADDING_KEYS.left]: 10,
      [GROUP_PADDING_KEYS.right]: -1,
      [GROUP_PADDING_KEYS.top]: 5,
      [GROUP_PADDING_KEYS.bottom]: 'x',
    }
    expect(resolveGroupPadding((k) => values[k])).toEqual({ left: 10, right: 30, top: 5, bottom: 30 })
  })
})
