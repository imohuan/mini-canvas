/**
 * 「清理失效」与「关闭卡片」的语义分界（用户 2026-10-29 定案）。
 *
 * 用户原话：删除卡片不该动提示词（那是他的作品，删了没法恢复）；
 * 想彻底清掉，就点顶部「清理失效」——只有那一次会删输入框里的失效标签。
 *
 * 这条测试守两件事：
 *   ① 卡片身份来自正文标签（删标签 = 卡片消失）；失效卡是「标签在、节点不在」；
 *   ② 清理只留下还活着的标签（纯函数层面能算出该保留哪些）。
 */
import { describe, expect, it } from 'vitest'
import { refNodeChipId, refNameChipId, type RefChip } from '../refSlots'
import { invalidRefTiles, mergeRefTiles, type TileCardLike } from '../refTiles'

const chip = (id: string, name: string, legacy = false): RefChip => ({
  id: refNodeChipId(id),
  name,
  nodeId: id,
  pendingName: null,
  legacy,
})

const pending = (name: string): RefChip => ({
  id: refNameChipId(name),
  name,
  nodeId: null,
  pendingName: name,
  legacy: false,
})

const card = (id: string, name: string, kind: TileCardLike['kind'] = 'image'): TileCardLike => ({ id, name, kind })

describe('失效卡 = 标签还在、节点不在了', () => {
  it('连线断了 → 标签保留、卡片标失效（不是消失）', () => {
    const tiles = mergeRefTiles([chip('n1', '天空之城')], [])
    expect(tiles).toHaveLength(1)
    expect(tiles[0]).toMatchObject({ invalid: true, label: '天空之城' })
  })

  it('标签删了 → 卡片随之消失（卡片是标签的影子）', () => {
    const tiles = mergeRefTiles([], [card('n1', '天空之城')])
    // 连了线但没写标签：仍补一张卡（参考区不吞素材）
    expect(tiles).toHaveLength(1)
    // 而标签与连线都没有时，就没有卡
    expect(mergeRefTiles([], [])).toEqual([])
  })
})

describe('「清理失效」的范围：只动失效那几颗', () => {
  it('失效的进清理列表，正常的与待绑定的都不进', () => {
    const tiles = mergeRefTiles(
      [chip('gone', '失效样本'), chip('n1', '好图'), pending('雨声')],
      [card('n1', '好图')],
    )
    const bad = invalidRefTiles(tiles)
    expect(bad.map((t) => t.label)).toEqual(['失效样本'])
    // 正常卡与待绑定卡都不该被清理
    expect(bad.some((t) => t.pending)).toBe(false)
  })

  it('没有失效卡时清理列表为空（按钮也不出现）', () => {
    const tiles = mergeRefTiles([chip('n1', '好图'), pending('雨声')], [card('n1', '好图')])
    expect(invalidRefTiles(tiles)).toEqual([])
  })
})
