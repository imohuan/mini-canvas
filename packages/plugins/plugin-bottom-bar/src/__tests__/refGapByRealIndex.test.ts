import { describe, expect, it } from 'vitest'
import { findRefGap } from '../refTiles'

describe('缺号按真实序号判断（用户 2026-10-27 修复）', () => {
  /**
   * 旧实现用 seq += 1 按**出现顺序**数序号，于是「图片2 + 图片4」被当成第 1、2 格，
   * 缺号结果整体错位。这里钉住：必须读 refName 里的真实序号。
   *
   * 注意：findRefGap 命中就返回第一个缺口集合（不是全量列举）。
   */
  it('图片2 + 图片4：第 1 格确实缺（按真实序号，而不是把 2、4 当成 1、2）', () => {
    const gap = findRefGap(
      [
        { kind: 'image', index: 1 },
        { kind: 'image', index: 2 },
        { kind: 'image', index: 3 },
        { kind: 'image', index: 4 },
      ],
      [
        { id: 'b', name: '图片2', url: 'b.png', isText: false },
        { id: 'd', name: '图片4', url: 'd.png', isText: false },
      ],
    )
    expect(gap).toEqual({ kind: 'image', missing: [1] })
  })

  it('只有 图片2（旧实现会误判为不缺）→ 仍然报缺 1', () => {
    const gap = findRefGap(
      [{ kind: 'image', index: 1 }, { kind: 'image', index: 2 }],
      [{ id: 'b', name: '图片2', url: 'b.png', isText: false }],
    )
    expect(gap).toEqual({ kind: 'image', missing: [1] })
  })

  it('1、2 都有图 → 不缺', () => {
    expect(
      findRefGap(
        [{ kind: 'image', index: 1 }, { kind: 'image', index: 2 }],
        [
          { id: 'a', name: '图片1', url: 'a.png', isText: false },
          { id: 'b', name: '图片2', url: 'b.png', isText: false },
        ],
      ),
    ).toBe(null)
  })
})

