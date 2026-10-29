import { describe, it, expect } from 'vitest'
import { readStoryboard, swapSlots, placeStoryboardAt } from '../storyboard'

describe('storyboard 纯逻辑', () => {
  it('readStoryboard：合法 data 收窄（非 string 槽当空）', () => {
    const b = readStoryboard({ rows: 2, cols: 2, slots: ['res-a', 42, null, 'res-b'] })
    expect(b).toEqual({ rows: 2, cols: 2, slots: ['res-a', null, null, 'res-b'] })
  })

  it('readStoryboard：字段缺失/槽位数不匹配/行列越界返回 null', () => {
    expect(readStoryboard(undefined)).toBeNull()
    expect(readStoryboard({ rows: 2, cols: 2, slots: ['a'] })).toBeNull()
    expect(readStoryboard({ rows: 0, cols: 2, slots: [] })).toBeNull()
    expect(readStoryboard({ rows: 9, cols: 9, slots: new Array(81).fill(null) })).toBeNull()
  })

  it('swapSlots：交换两格（含空格）；同格/越界返回原表', () => {
    const b = { rows: 2, cols: 2, slots: ['a', null, 'c', 'd'] }
    expect(swapSlots(b, 0, 1)).toEqual([null, 'a', 'c', 'd'])
    expect(swapSlots(b, 1, 2)).toEqual(['a', 'c', null, 'd'])
    expect(swapSlots(b, 0, 0)).toBe(b.slots)
    expect(swapSlots(b, 0, 99)).toBe(b.slots)
    expect(swapSlots(b, -1, 1)).toBe(b.slots)
  })
})

describe('storyboard 落点', () => {
  const source = { id: 'src', type: 'image', position: { x: 1000, y: 500 }, size: { w: 320, h: 240 } }
  /** 测试桩 ctx：真实 ctx 有 tryGet；这里直接给 nodes 数组走降级分支 */
  const stubCtx = (nodes: unknown[]) => ({ nodes }) as unknown as import('../storyboard').StoryboardPlacementCtx

  it('有源节点：摆到源节点右侧（同顶边），不压在别的节点上', () => {
    const nodes = [source, { id: 'far', position: { x: 5000, y: 5000 }, size: { w: 320, h: 240 } }]
    const at = placeStoryboardAt({ ctx: stubCtx(nodes), sourceId: 'src' })
    expect(at.x).toBeGreaterThanOrEqual(1320)
    expect(at.y).toBe(500)
  })

  it('右侧被占：避开已有节点（不与任何节点矩形重叠）', () => {
    const blocker = { id: 'blocker', type: 'image', position: { x: 1320, y: 480 }, size: { w: 480, h: 360 } }
    const nodes = [source, blocker]
    const at = placeStoryboardAt({ ctx: stubCtx(nodes), sourceId: 'src' })
    const overlaps = (n: { position: { x: number; y: number }; size: { w: number; h: number } }) =>
      at.x < n.position.x + n.size.w && n.position.x < at.x + 480 && at.y < n.position.y + n.size.h && n.position.y < at.y + 360
    expect(overlaps(blocker)).toBe(false)
    expect(overlaps(source)).toBe(false)
  })

  it('没有源节点：不抛，返回画布内容右侧的空位', () => {
    const nodes = [source]
    const at = placeStoryboardAt({ ctx: stubCtx(nodes), sourceId: 'gone' })
    expect(Number.isFinite(at.x)).toBe(true)
    expect(Number.isFinite(at.y)).toBe(true)
  })
})
