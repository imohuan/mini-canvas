import { describe, expect, it } from 'vitest'
import { MAX_MENTION_RESULTS, filterMentionItems } from '../mentionFilter.ts'

const items = (names: string[]) => names.map((name) => ({ name }))

describe('@ 菜单候选过滤', () => {
  it('无搜索词 = 浏览全部，不截断', () => {
    const all = items(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    expect(filterMentionItems(all, '')).toHaveLength(7)
  })

  it('搜索词过滤（子串、忽略大小写）', () => {
    const all = items(['角色立绘', 'Script', 'script-2', '背景'])
    expect(filterMentionItems(all, 'scri').map((x) => x.name)).toEqual(['Script', 'script-2'])
    expect(filterMentionItems(all, '立绘').map((x) => x.name)).toEqual(['角色立绘'])
  })

  it('搜索结果**最多前 5 项**', () => {
    const all = items(['节点1', '节点2', '节点3', '节点4', '节点5', '节点6', '节点7'])
    const got = filterMentionItems(all, '节点')
    expect(got).toHaveLength(MAX_MENTION_RESULTS)
    expect(got.map((x) => x.name)).toEqual(['节点1', '节点2', '节点3', '节点4', '节点5'])
  })

  it('无命中 = 空数组', () => {
    expect(filterMentionItems(items(['a', 'b']), 'zzz')).toEqual([])
  })

  it('不修改入参', () => {
    const all = items(['a', 'b'])
    const out = filterMentionItems(all, '')
    expect(out).not.toBe(all)
  })
})
