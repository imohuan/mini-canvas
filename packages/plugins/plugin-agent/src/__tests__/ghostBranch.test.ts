/**
 * 幽灵分支（用户 2026-11-14 截图：同一栏里上下叠着 `2 / 2` 和 `1 / 4`）。
 *
 * 现场数据：旧版「点一下模型就 branchFromEnd」给每个被点过的模型建了一条会话，
 * 转录与父会话一字不差，却占着一个版本位。结果同一个位置挂了两组分页器。
 * 现在的规则：子会话只要没有自己的新回合（回合数 ≤ 分叉点下标）就不算一个版本。
 */
import { describe, expect, it } from 'vitest'
import { contractGhosts, foldGhostId, inlinePagers, pagerAnchors, type ForkPoint, type SessionRow } from '../model/branchNav'

const rows: SessionRow[] = [
  { id: 'root', title: '原版', updatedAt: 1 },
  { id: 'ghost', title: '点了模型没说话', updatedAt: 2 },
  { id: 'real', title: '真的聊过', updatedAt: 3 },
]

const points: ForkPoint[] = [
  { parentId: 'root', point: 'turn:0', children: ['ghost'], userOrdinal: 1, ghosts: ['ghost'] },
  { parentId: 'ghost', point: 'turn:0', children: ['real'], userOrdinal: 0 },
]

describe('幽灵分支折叠', () => {
  it('把幽灵的分叉点搬回父会话，并把幽灵从版本组里摘掉', () => {
    const folded = contractGhosts(points)
    expect(folded).toHaveLength(1)
    expect(folded[0].parentId).toBe('root')
    expect(folded[0].children).toEqual(['real'])
  })

  it('真正的分支照样可达：页面上只剩一行、两个版本', () => {
    const pagers = inlinePagers('real', rows, points)
    expect(pagers).toHaveLength(1)
    expect(pagers[0].items.map((i) => i.id)).toEqual(['root', 'real'])
    expect(pagers[0].position).toBe(2)
    expect(pagers[0].total).toBe(2)
  })

  it('没有幽灵时一个字节都不动', () => {
    const clean: ForkPoint[] = [{ parentId: 'root', point: 'turn:2', children: ['real'], userOrdinal: 1 }]
    expect(contractGhosts(clean)).toEqual(clean)
  })

  it('只剩自己一个版本时不画分页器（两枚箭头全灰等于没有分支）', () => {
    const only: ForkPoint[] = [{ parentId: 'root', point: 'turn:0', children: ['ghost'], userOrdinal: 1, ghosts: ['ghost'] }]
    expect(inlinePagers('root', rows, only)).toHaveLength(0)
  })

  /**
   * 用户可能直接停在幽灵会话上（历史列表 / 旧链接）。
   * 那时分页器不能消失：内容与它折叠到的那个实体版本一字不差，页码要指出"你在哪一版"。
   */
  it('当前就停在幽灵会话上：分页器照常出现，并且认得出它在哪一版', () => {
    expect(foldGhostId('ghost', points)).toBe('root')
    const pagers = inlinePagers('ghost', rows, points)
    expect(pagers).toHaveLength(1)
    expect(pagers[0].items.map((i) => i.id)).toEqual(['root', 'real'])
    expect(pagers[0].position).toBe(1)
    expect(pagers[0].total).toBe(2)
  })

  /**
   * 用户 2026-11-14 截图：一栏里上下叠着 `2/2` 和 `1/2`。
   *
   * 现场数据：一条对话先「编辑重发」分出两版（分叉点在某条用户消息之前），
   * 之后又在这条对话上切了模型 —— 切模型在转录**末尾**登记了第二个分叉点，
   * 于是两组版本各自画一行，看起来像两个不相干的分支挤在一起。
   * 规则：末尾那种分叉（tail）是切模型，直接覆盖当前分支，不参与版本组。
   */
  it('编辑分支 + 切模型末尾分叉：只能剩一组分页器', () => {
    const rows2: SessionRow[] = [
      { id: 'root', title: '原版', updatedAt: 1 },
      { id: 'v2', title: '编辑版', updatedAt: 2 },
      { id: 'm2', title: '换过模型', updatedAt: 3 },
    ]
    const pts: ForkPoint[] = [
      { parentId: 'root', point: 'turn:0', children: ['v2'], userOrdinal: 1 },
      { parentId: 'v2', point: 'turn:4', children: ['m2'], userOrdinal: 1, tail: true },
    ]
    // 版本组里只剩编辑出来的那一组
    for (const id of ['root', 'v2', 'm2']) {
      const pagers = inlinePagers(id, rows2, pts)
      expect(pagers.map((p) => p.items.map((i) => i.id).join(','))).toEqual(['root,v2'])
    }
    // 同一条消息下面也只画一行（不再出现两个区域）
    const turns = [
      { id: 'u0', kind: 'user' }, { id: 'a0', kind: 'assistant' },
      { id: 'u1', kind: 'user' }, { id: 'a1', kind: 'assistant' },
    ]
    const anchors = pagerAnchors(turns, inlinePagers('v2', rows2, pts))
    expect([...anchors.values()].flat()).toHaveLength(1)
  })
})
