/**
 * nodeSelection 单测 —— "本节点是否被单独选中"的判定。
 *
 * 用户报的 bug：多选时上下控制栏仍然弹出（截图里两个节点都被选中、都浮出面板）。
 * 根因是判定写成了"我在选中集里"，正确语义对齐 v1 NodeToolbar —— "**恰好**选中一个节点且就是我"。
 * 这条测试把该语义锁死，避免以后又退回"含我就算"。
 */
import { describe, it, expect } from 'vitest'
import { isSoleSelected } from '../nodeSelection'

/** 造一个最小 selection 桩 */
function sel(ids: string[]) {
  const set = new Set(ids)
  return { ids: set, has: (id: string) => set.has(id) }
}

describe('isSoleSelected', () => {
  it('恰好选中我一个 → true（操作栏/面板该出现）', () => {
    expect(isSoleSelected(sel(['a']), 'a')).toBe(true)
  })

  it('多选 → false（本轮修的 bug：多选时每个节点都弹面板）', () => {
    expect(isSoleSelected(sel(['a', 'b']), 'a')).toBe(false)
    expect(isSoleSelected(sel(['a', 'b']), 'b')).toBe(false)
    expect(isSoleSelected(sel(['a', 'b', 'c']), 'b')).toBe(false)
  })

  it('一个都没选 → false', () => {
    expect(isSoleSelected(sel([]), 'a')).toBe(false)
  })

  it('只选中了别人（单选但不是我）→ false', () => {
    expect(isSoleSelected(sel(['b']), 'a')).toBe(false)
  })

  it('缺 selection 服务 → false，不抛错（极简宿主/单测桩）', () => {
    expect(isSoleSelected(undefined, 'a')).toBe(false)
  })

  it('判定看"数量为 1 且是我"，不是"含我就行"', () => {
    expect(isSoleSelected(sel(['a']), 'a')).toBe(true)
    expect(isSoleSelected(sel(['a', 'b']), 'a')).toBe(false)
  })
})
