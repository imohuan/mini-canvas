/**
 * 幽灵分支（用户 2026-11-14 截图：同一栏里上下叠着 `2 / 2` 和 `1 / 4`）。
 *
 * 现场数据：旧版「点一下模型就 branchFromEnd」给每个被点过的模型建了一条会话，
 * 转录与父会话一字不差，却占着一个版本位。结果同一个位置挂了两组分页器。
 * 现在的规则：子会话只要没有自己的新回合（回合数 ≤ 分叉点下标）就不算一个版本。
 */
import { describe, expect, it } from 'vitest'
import { contractGhosts, foldGhostId, inlinePagers, type ForkPoint, type SessionRow } from '../model/branchNav'

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
})
