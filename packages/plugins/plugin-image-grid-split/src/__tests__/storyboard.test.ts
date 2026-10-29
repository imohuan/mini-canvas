import { describe, it, expect } from 'vitest'
import { readStoryboard, swapSlots } from '../storyboard'

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
