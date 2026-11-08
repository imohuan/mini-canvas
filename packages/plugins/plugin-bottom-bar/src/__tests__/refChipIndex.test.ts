/**
 * 标签序号（用户 2026-11-08）：「1 · 图片 11」里的数字是**参考区的显示位**。
 *
 * 为什么单独钉：这个数字只活在界面上 —— 一旦有人把它拼进 name，
 * 导出文本、@ 匹配、后端引用都会带上无关数字。所以两边都要守住：
 *   ① 序号按素材/卡片的显示顺序给出，拖拽后变化；
 *   ② 名字本身一个字不改（序号走单独的字段 / 属性）。
 */
import { describe, expect, it } from 'vitest'
import {
  collectUpstreamMaterials,
  nameRefNames,
  toEditorResources,
  type UpstreamMaterial,
} from '../panelSource'
import { mergeRefTiles } from '../refTiles'
import { refNodeChipId } from '../refSlots'

const material = (id: string, name: string): UpstreamMaterial => ({
  id,
  kind: 'image',
  name,
  refName: name,
})

describe('素材序号 = 参考区显示位', () => {
  it('按连线顺序从 1 开始编号', () => {
    const list = nameRefNames([material('n1', '猫'), material('n2', '狗')])
    expect(list.map((m) => m.index)).toEqual([1, 2])
  })

  it('拖拽后的顺序（refOrder）决定序号，名字不动', () => {
    const materials = collectUpstreamMaterials(
      [
        { source: 'n1', target: 'me' },
        { source: 'n2', target: 'me' },
      ],
      'me',
      (id) => ({ type: 'image', data: { imageUrl: id + '.png', label: id === 'n1' ? '猫' : '狗' } }),
      ['n2', 'n1'],
    )
    expect(materials.map((m) => m.name)).toEqual(['狗', '猫'])
    expect(materials.map((m) => m.refName)).toEqual(['狗', '猫'])
    expect(materials.map((m) => m.index)).toEqual([1, 2])
  })
})

describe('编辑器标签拿到序号，但引用名不被改写', () => {
  it('chipIndex 跟素材顺序一致，name 保持节点名', () => {
    const items = toEditorResources(nameRefNames([material('n2', '狗'), material('n1', '猫')]))
    expect(items.map((i) => i.name)).toEqual(['狗', '猫'])
    expect(items.map((i) => i.chipIndex)).toEqual([1, 2])
    expect(items[0].id).toBe(refNodeChipId('n2'))
  })

  it('标签 DOM 把序号放在 data-chip-index 上（名字仍是纯名字）', () => {
    const items = toEditorResources(nameRefNames([material('n1', '猫'), material('n2', '狗')]))
    const spec = items[1].renderEditor!(items[1]) as unknown[]
    const nameNode = (spec.slice(2) as unknown[][]).find(
      (child) => (child[1] as Record<string, string>).class === 'resource-chip-name',
    )!
    const props = nameNode[1] as Record<string, string>
    expect(props['data-chip-index']).toBe('2')
    expect(nameNode[2]).toBe('狗')
  })
})

describe('参考卡与标签同号', () => {
  it('卡片 index 与素材 index 一致（同一个显示位）', () => {
    const materials = nameRefNames([material('n1', '猫'), material('n2', '狗')])
    const tiles = mergeRefTiles(
      [],
      materials.map((m) => ({ id: m.id, name: m.name, kind: 'image' as const })),
      [refNodeChipId('n2'), refNodeChipId('n1')],
    )
    expect(tiles.map((t) => [t.label, t.index])).toEqual([
      ['狗', 1],
      ['猫', 2],
    ])
  })
})
