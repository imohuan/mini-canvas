/**
 * 链式分叉（A→B→C）下，**每个版本都要能看到完整的那一组**（用户 2026-11-14 截图）。
 *
 * 现场现象：在 2/2 点「上一个版本」，**消息已经换成了上一版**，但页码还停在 2/2；
 * 必须再点一次才跳到 1/2。也就是说：消息与页码来自两处数据，**页码漏掉了当前版本所在的那一组**。
 *
 * 真实数据形态（plume 画布 5934…）：
 *   root(turn:2) → v2 ；v2(turn:0) → v3
 * 三个版本的转录都只有 1 条用户消息，分叉点都在它之前/之后。
 * 旧实现按「父会话里 userOrdinal 对应的组」收集，从 v3 看时只认到 v2|turn:0 这一组，
 * root 那一组被漏掉 → 页码少一格。
 */
import { describe, expect, it } from 'vitest'
import { PAGER_TOP_KEY, inlinePagers, pagerAnchors, type ForkPoint, type SessionRow } from '../model/branchNav'

const rows: SessionRow[] = [
  { id: 'root', title: '原版', updatedAt: 1 },
  { id: 'v2', title: '第二版', updatedAt: 2 },
  { id: 'v3', title: '第三版', updatedAt: 3 },
]

/** 真实数据：root 在 turn:2 分出 v2；v2 在 turn:0 分出 v3（都只有 1 条用户消息） */
const chain: ForkPoint[] = [
  { parentId: 'root', point: 'turn:2', children: ['v2'], userOrdinal: 1 },
  { parentId: 'v2', point: 'turn:0', children: ['v3'], userOrdinal: 0 },
]

describe('链式分叉：每个版本都能看到完整分组', () => {
  it('root 版本：看得到自己所在的那一组（2 个版本）', () => {
    const pagers = inlinePagers('root', rows, chain)
    expect(pagers.length).toBeGreaterThan(0)
    const group = pagers.find((p) => p.items.some((i) => i.id === 'root'))
    expect(group, 'root 自己那一组必须出现').toBeTruthy()
    expect(group!.total).toBe(2)
    expect(group!.position).toBe(1)
  })

  it('v2 版本：两处分叉都看得到（原版那组 + 第三版那组）', () => {
    const pagers = inlinePagers('v2', rows, chain)
    // v2 同时是两组的成员（它被 root 分出、又分出了 v3），所以能力上必须看到两组。
    // 顺序按「挂在第几条用户消息之后」（userOrdinal）排。
    const groups = pagers.map((p) => p.items.map((i) => i.id).join(',')).sort()
    expect(groups).toEqual(['root,v2', 'v2,v3'])
    expect(pagers.map((p) => p.userOrdinal)).toEqual([0, 1])
  })

  /**
   * v3 只能看到它自己所在的那一组。
   *
   * 独立复查指出：如果放宽到「沿祖先链」，v3 会画出 root→v2 那组，而 v3 并不在其中 ——
   * 页码只能钳成 1/2，点箭头会跳到另一条分支，正是「页码和内容对不上」的来源。
   */
  it('v3 版本：只画自己所在的那一组（不越权画上游那组）', () => {
    const pagers = inlinePagers('v3', rows, chain)
    expect(pagers.map((p) => p.items.map((i) => i.id).join(','))).toEqual(['v2,v3'])
    expect(pagers[0].position).toBe(2)
    expect(pagers[0].total).toBe(2)
  })

  /**
   * v2 的两组分别落在**不同位置**：turn:0 那组在第一句之前（列表最上面），
   * turn:2 那组在第一轮回复之后（列表末尾）。两组都必须画出来，谁也不许吃掉谁。
   *
   * 旧实现把 ordinal 当消息下标，两组都被顶到同一个锚点、后写的覆盖前一组 ——
   * 界面于是只剩一行，页码跟内容对不上。
   */
  it('v2 的两组分页器分别落在各自的位置，都要画出来', () => {
    const pagers = inlinePagers('v2', rows, chain)
    expect(pagers).toHaveLength(2)
    const turns = [{ id: 'u0', kind: 'user' }, { id: 'a0', kind: 'assistant' }]
    const anchors = pagerAnchors(turns, pagers)
    const all = [...anchors.values()].flat()
    expect(all).toHaveLength(2)
    // 第二组（分叉点在末尾）挂在最后一条回复下面；第一组（分叉点在第一句之前）挂在顶部键
    expect(anchors.get('a0')).toHaveLength(1)
    expect(anchors.get(PAGER_TOP_KEY)).toHaveLength(1)
  })
})
