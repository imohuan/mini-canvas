/**
 * 标签菜单（图 4）的纯逻辑单测：分组 / 搜索 / 自然序 / 已引用优先。
 */
import { describe, expect, it } from 'vitest'
import { buildTagMenuGroups, naturalCompare, type TagMenuEntry } from '../tagMenu'

const entry = (id: string, name: string, kind: TagMenuEntry['kind'], referenced = false): TagMenuEntry => ({
  id, name, kind, referenced,
})

describe('标签菜单分组', () => {
  it('已引用排最前，其余按 图片/视频/音频/文本 分组', () => {
    const groups = buildTagMenuGroups([
      entry('1', '人物肖像保护', 'image', true),
      entry('2', '图片', 'image'),
      entry('3', '视频', 'video'),
      entry('4', '音频', 'audio'),
      entry('5', '文本', 'text'),
    ], '')
    expect(groups.map((g) => g.label)).toEqual(['已引用', '图片', '视频', '音频', '文本'])
  })

  it('没有已引用时不出现空组（图 4 里「已引用」只在有内容时出现）', () => {
    const groups = buildTagMenuGroups([entry('2', '图片', 'image')], '')
    expect(groups.map((g) => g.kind)).toEqual(['image'])
  })

  it('搜索同时匹配名称与 id，命中后仍保留分组结构', () => {
    const groups = buildTagMenuGroups([
      entry('img-1', '角色设定图', 'image'),
      entry('img-2', '720°全景图', 'image'),
      entry('vid-1', '画面推演', 'video'),
    ], '推演')
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('视频')
    expect(groups[0].items.map((i) => i.name)).toEqual(['画面推演'])
  })

  it('搜索匹配 id（用户按 id 找节点也能筛出来）', () => {
    const groups = buildTagMenuGroups([entry('img-77', '甲', 'image'), entry('img-88', '乙', 'image')], 'img-88')
    expect(groups[0].items.map((i) => i.id)).toEqual(['img-88'])
  })

  it('组内按自然序（图片2 在 图片10 前面，不是字典序）', () => {
    const groups = buildTagMenuGroups([
      entry('a', '图片10', 'image'),
      entry('b', '图片2', 'image'),
    ], '')
    expect(groups[0].items.map((i) => i.name)).toEqual(['图片2', '图片10'])
  })

  it('空查询不丢任何素材', () => {
    const all = [entry('1', 'A', 'image'), entry('2', 'B', 'video'), entry('3', 'C', 'audio')]
    const total = buildTagMenuGroups(all, '').reduce((n, g) => n + g.items.length, 0)
    expect(total).toBe(3)
  })
})

describe('naturalCompare', () => {
  it('数字按大小比，不按字符比', () => {
    expect(['图片10', '图片2'].sort(naturalCompare)).toEqual(['图片2', '图片10'])
  })
})

