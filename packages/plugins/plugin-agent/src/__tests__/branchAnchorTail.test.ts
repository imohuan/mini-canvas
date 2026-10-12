/**
 * 切模型分支的分页器锚定（code review / 真机实测 2026-10-11）。
 *
 * 切模型的分叉点在**转录末尾**：root 会话只有 1 条用户消息，而分叉点记作 turn:2
 * （userOrdinal=1）—— 旧判据 k >= userIdx.length 直接丢弃，分页器整个消失
 * （用户实测："返回 root 后分页不见了"）。修复后 k === userIdx.length 锚到列表末尾。
 */
import { describe, expect, it } from 'vitest'
import { pagerAnchors, type PagerGroup } from '../branchNav'

const turns = [
  { id: 'u1', kind: 'user' },
  { id: 'a1', kind: 'assistant' },
]

const pager = (ordinal: number): PagerGroup => ({ at: 2, userOrdinal: ordinal, items: [], index: 0, position: 1, total: 3 })

describe('切模型分页器的末尾锚定', () => {
  it('userOrdinal === 用户消息数（分叉点在末尾）⇒ 锚到最后一条 turn，不再消失', () => {
    const map = pagerAnchors(turns, [pager(1)])
    expect(map.get('a1')).toBeDefined()
  })

  it('真越界（ordinal 比用户消息数还大）⇒ 依旧丢弃（数据错位不画错位置）', () => {
    expect(pagerAnchors(turns, [pager(5)]).size).toBe(0)
  })

  it('普通编辑分支（分叉点在中间）行为不变：锚在该用户消息回复块的末尾', () => {
    const turns3 = [...turns, { id: 'u2', kind: 'user' }, { id: 'a2', kind: 'assistant' }]
    const map = pagerAnchors(turns3, [pager(0)])
    expect(map.get('a1')).toBeDefined()
  })
})

