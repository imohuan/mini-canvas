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

  it('拖拽后的顺序（refOrder）决定序号，引用名跟着位置走', () => {
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
    expect(materials.map((m) => m.refName)).toEqual(['图片1', '图片2'])
    expect(materials.map((m) => m.index)).toEqual([1, 2])
  })
})

describe('编辑器标签拿到序号，引用名 = 类型+位置', () => {
  it('chipIndex 跟素材顺序一致，name 是引用名，节点名仍在 name 字段之外', () => {
    const items = toEditorResources(nameRefNames([material('n2', '狗'), material('n1', '猫')]))
    expect(items.map((i) => i.name)).toEqual(['图片1', '图片2'])
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
    expect(nameNode[2]).toBe('图片2')
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

/**
 * 序号**不许**写进标签节点属性（用户 2026-11-08 第二次反馈的老毛病）。
 *
 * 踩过两次：
 *   ① 2026-10-27：底栏刷新时无条件 setNodeMarkup 重建标签 → 用户点中的标签丢选中、
 *      光标先弹到标签前面再落回后面（闪两下）；
 *   ② 2026-11-08：为了「拖拽后序号能刷新」把序号塞进节点属性 → 同样的重建、同样的闪。
 *
 * 结论：序号是纯显示，只许原位改 DOM（resourceCommands.syncChipIndexDom）。
 * 如果哪天有人为了省事把它变成节点属性，chipAttrsNeedUpdate 也要跟着变 ——
 * 这条测试就是在那一步踩刹车。
 */
describe('序号只影响显示，不算「需要重写文档」', () => {
  it('名字格里只有 data-chip-index（样式用），节点属性里没有序号', () => {
    const items = toEditorResources(nameRefNames([material('n1', '猫')]))
    const spec = items[0].renderEditor!(items[0]) as unknown[]
    const chipProps = spec[1] as Record<string, unknown>
    expect(Object.keys(chipProps).some((k) => /chip-?index/i.test(k))).toBe(false)
    const nameNode = (spec.slice(2) as unknown[][]).find(
      (child) => (child[1] as Record<string, string>).class === 'resource-chip-name',
    )!
    expect((nameNode[1] as Record<string, string>)['data-chip-index']).toBe('1')
  })
})
