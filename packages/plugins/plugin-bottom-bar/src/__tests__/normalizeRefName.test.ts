/**
 * 名称规范化（用户 2026-10-29）：对比名称时空格转下划线、去标点。
 *
 * 为什么需要：AI / 用户写的名称可能不规范（带空格、带标点），
 * 「泳装少女 2」「泳装少女2」「泳装少女-2」必须能对上同一个节点。
 */
import { describe, expect, it } from 'vitest'
import { normalizeRefName } from '../refSlots'
import { matchMaterialByName, type TileCardLike } from '../refTiles'
import { bottomBarTagSpecFor, type UpstreamMaterial } from '../panelSource'

describe('normalizeRefName：空格 → 下划线，去标点', () => {
  it('空格（转下划线后）与「无空格」对比结果一致', () => {
    expect(normalizeRefName('泳装少女 2')).toBe(normalizeRefName('泳装少女2'))
    expect(normalizeRefName('a  b')).toBe('ab')
  })

  it('标点去掉，中英文数字横线下划线保留', () => {
    expect(normalizeRefName('场景:天空之城')).toBe('场景天空之城')
    expect(normalizeRefName('角色（主角）!')).toBe('角色主角')
    expect(normalizeRefName('A-2_x')).toBe('A-2x')
  })

  it('显示名不变，只有对比用它', () => {
    // 显示侧（卡片/标签）继续用原始名称 —— 这里只断言规范化本身不改原串
    const raw = '泳装少女 2'
    expect(normalizeRefName(raw)).not.toBe(raw)
  })
})

describe('matchMaterialByName：规范化匹配', () => {
  const cards: TileCardLike[] = [
    { id: 'n1', name: '泳装少女 2', kind: 'image' },
    { id: 'n2', name: '天空之城', kind: 'image' },
  ]

  it('「泳装少女2」（无空格）→ 命中「泳装少女 2」', () => {
    expect(matchMaterialByName('泳装少女2', cards)?.id).toBe('n1')
  })

  it('「泳装少女_2」（下划线）→ 命中', () => {
    expect(matchMaterialByName('泳装少女_2', cards)?.id).toBe('n1')
  })

  it('查询带前后空格 → 命中', () => {
    expect(matchMaterialByName('  天空之城 ', cards)?.id).toBe('n2')
  })

  it('查不到 → null', () => {
    expect(matchMaterialByName('不存在', cards)).toBeNull()
  })
})

describe('bottomBarTagSpecFor：scan 也走规范化', () => {
  const materials: UpstreamMaterial[] = [
    { id: 'n1', name: '泳装少女 2', kind: 'image', refName: '泳装少女 2' },
  ]

  it('正文写「@泳装少女2」（没空格）→ 命中真实节点，替换长度按规范化名算', () => {
    const hits = bottomBarTagSpecFor(() => materials).scan('看 @泳装少女2 的图')
    expect(hits).toHaveLength(1)
    expect(hits[0].item.id).toBe('ref-node:n1')
    expect(hits[0].item.name).toBe('泳装少女 2')
    // @ + 规范化后的名称长度（泳装少女2 = 5 字）
    expect(hits[0].to - hits[0].from).toBe(1 + 5)
  })
})
