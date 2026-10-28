import { describe, expect, it } from 'vitest'
import { mergeRefTiles } from '../refTiles'
import { applySlotHints, collectUpstreamMaterials, type RefSlotHints } from '../panelSource'

describe('hint 决定格子位置（用户 2026-10-28 报错位）', () => {
  const hints: RefSlotHints = { src: { kind: 'image', index: 2 } }

  it('applySlotHints：hint=2 的素材编号成 图片2', () => {
    const mats = applySlotHints([{ id: 'src', kind: 'image', name: '图片 54', refName: '', url: 'a.png' }], hints)
    expect(mats[0].refName).toBe('图片2')
  })

  /**
   * 格数 = max(连线数, 声明数)，所以「1 张连线 + 0 个声明」只会有 1 格。
   * 要防的错位是「节点标题带空格（图片 54）导致解析失败 → 素材被当成无序号的尾巴」。
   */
  it('mergeRefTiles：节点标题「图片 54」不影响识别', () => {
    const tiles = mergeRefTiles(
      [],
      [{ id: 'src', name: '图片 54', refName: '图片2', url: 'a.png', isText: false }] as never,
    )
    // 格数 = max(最大卡片序号 2, 声明数 0) = 2：
    // 第 1 格空壳、第 2 格是那张有图的卡（序号取自 refName，不受标题「图片 54」影响）。
    expect(tiles).toHaveLength(2)
    const filled = tiles.filter((t) => !t.pending)
    expect(filled).toHaveLength(1)
    expect(filled[0]).toMatchObject({ card: { id: 'src' }, slotIndex: 2, url: 'a.png' })
  })

  it('声明 2 个 + 1 张连线 → 2 格：有图的卡 + 1 个空壳（序号各归其位）', () => {
    const tiles = mergeRefTiles(
      [{ kind: 'image', index: 1 }, { kind: 'image', index: 2 }],
      [{ id: 'src', name: '图片 54', refName: '图片2', url: 'a.png', isText: false }] as never,
    )
    expect(tiles).toHaveLength(2)
    const filled = tiles.filter((t) => !t.pending)
    const empty = tiles.filter((t) => t.pending)
    expect(filled).toHaveLength(1)
    expect(filled[0]).toMatchObject({ slotIndex: 2, url: 'a.png' })
    expect(empty).toHaveLength(1)
    expect(empty[0].slotIndex).toBe(1)
  })

  /**
   * 用户 2026-10-28 截图的核心错位：hint 让某张图占第 2 格，
   * 但界面把这张卡显示在第 1 位、正文「图片1」反而是空的。
   * 没拖拽过时必须按 slotIndex 排，不能让卡片一律顶到最前。
   */
  it('没拖拽过：第 2 格的有图卡不会被顶到第 1 位', () => {
    const tiles = mergeRefTiles(
      [{ kind: 'image', index: 1 }, { kind: 'image', index: 2 }],
      [{ id: 'src', name: '图片 54', refName: '图片2', url: 'a.png', isText: false }] as never,
    )
    // 显示顺序 = 序号顺序
    expect(tiles.map((t) => t.index)).toEqual([1, 2])
    // 第 1 格是空壳（对应正文 图片1），第 2 格才是有图的那张
    expect(tiles[0]).toMatchObject({ pending: true, slotIndex: 1 })
    expect(tiles[1]).toMatchObject({ pending: false, slotIndex: 2, url: 'a.png' })
  })

  it('collectUpstreamMaterials + hint 全链路：图片2 有 url，图片1 没有', () => {
    const mats = collectUpstreamMaterials(
      [{ source: 'src', target: 'me' }],
      'me',
      (id) => (id === 'src' ? { type: 'image', data: { label: '图片 54', imageUrl: 'a.png' } } : undefined),
      [],
      hints,
    )
    expect(mats).toHaveLength(1)
    expect(mats[0].refName).toBe('图片2')
    expect(mats[0].url).toBe('a.png')
  })
})

