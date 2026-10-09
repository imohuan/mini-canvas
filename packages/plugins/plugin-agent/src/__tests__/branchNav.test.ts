import { describe, it, expect } from 'vitest'
import { groupConversations, inlinePagers, pagerAnchors, type ForkPoint } from '../branchNav.js'

const rows = [
  { id: 'A', title: '根会话', updatedAt: 100, createdAt: 10 },
  { id: 'B', title: '你会干啥？？', updatedAt: 200, createdAt: 20 },
  { id: 'C', title: '开什么玩笑', updatedAt: 300, createdAt: 30 },
  { id: 'D', title: '图片 是什么', updatedAt: 400, createdAt: 40 },
  { id: 'E', title: '开心就好', updatedAt: 500, createdAt: 50 },
]

// 用户真实数据形态：连续在同一位置（turn:3）编辑，形成 A←B←C←D 链
const chainPoints: ForkPoint[] = [
  { parentId: 'A', point: 'turn:3', children: ['B'], userOrdinal: 1 },
  { parentId: 'B', point: 'turn:3', children: ['C'], userOrdinal: 1 },
  { parentId: 'C', point: 'turn:3', children: ['D'], userOrdinal: 1 },
]

describe('groupConversations（历史列表聚合，保持不变）', () => {
  it('一个对话一行：整棵树聚成一条', () => {
    const g = groupConversations(rows, { B: 'A', C: 'B', D: 'C', E: 'D' })
    expect(g).toHaveLength(1)
    expect([...g[0].memberIds].sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(g[0].meta.title).toBe('根会话')
  })
})

describe('inlinePagers（跟随消息的分页器）', () => {
  it('同一位置的连续编辑合成一个组：4 个版本、位置停在当前', () => {
    const pagers = inlinePagers('D', rows, chainPoints)
    expect(pagers).toHaveLength(1)
    const p = pagers[0]
    expect(p.userOrdinal).toBe(1)
    expect(p.items.map((x) => x.id)).toEqual(['A', 'B', 'C', 'D'])
    expect(p.position).toBe(4)
    expect(p.total).toBe(4)
    expect(p.items[3].label).toBe('当前')
  })

  it('任一版本里都能看到同一组分页器（位置相同）', () => {
    for (const id of ['A', 'B', 'C', 'D']) {
      const pagers = inlinePagers(id, rows, chainPoints)
      expect(pagers).toHaveLength(1)
      expect(pagers[0].userOrdinal).toBe(1)
      expect(pagers[0].total).toBe(4)
      expect(pagers[0].items[pagers[0].index].id).toBe(id)
    }
  })

  it('无关会话不出分页器', () => {
    const pagers = inlinePagers('E', rows, chainPoints)
    expect(pagers).toHaveLength(0)
  })

  it('已删的中间版本过滤掉，但组不被截断', () => {
    const withoutC = rows.filter((r) => r.id !== 'C')
    const pagers = inlinePagers('D', withoutC, chainPoints)
    expect(pagers).toHaveLength(1)
    expect(pagers[0].items.map((x) => x.id)).toEqual(['A', 'B', 'D'])
  })

  it('两个位置各出一个分页器（被编辑过、又编辑过别人）', () => {
    const two: ForkPoint[] = [
      { parentId: 'A', point: 'turn:3', children: ['B'], userOrdinal: 1 },
      { parentId: 'B', point: 'turn:7', children: ['E'], userOrdinal: 3 },
    ]
    const pagers = inlinePagers('B', rows, two)
    expect(pagers.map((p) => p.userOrdinal)).toEqual([1, 3])
  })

  it('userOrdinal 缺失（服务端没算出）：不渲染，不画错位置', () => {
    const noOrdinal: ForkPoint[] = [{ parentId: 'A', point: 'turn:3', children: ['B'] }]
    expect(inlinePagers('B', rows, noOrdinal)).toHaveLength(0)
  })
})

describe('pagerAnchors（渲染定位）', () => {
  const turns = [
    { id: 'u0', kind: 'user' },
    { id: 'a0', kind: 'assistant' },
    { id: 'u1', kind: 'user' },
    { id: 't1', kind: 'thinking' },
    { id: 'a1', kind: 'assistant' },
    { id: 'u2', kind: 'user' },
    { id: 'a2', kind: 'assistant' },
  ]
  const pager = (userOrdinal: number): import('../branchNav.js').PagerGroup => ({
    at: 3, userOrdinal, items: [{ id: 'x', label: 'x' }], index: 0, position: 1, total: 2,
  })

  it('锚在「该用户消息的回复块末尾」：u1 的分页器挂在 a1 之后（u2 之前）', () => {
    const map = pagerAnchors(turns, [pager(1)])
    expect([...map.keys()]).toEqual(['a1'])
  })

  it('最后一条用户消息的分页器挂到列表末尾（该版本最后回复的下面）', () => {
    const map = pagerAnchors(turns, [pager(2)])
    expect([...map.keys()]).toEqual(['a2'])
  })

  it('越界的 userOrdinal 跳过（不画错位置）', () => {
    expect(pagerAnchors(turns, [pager(9)]).size).toBe(0)
  })
})
