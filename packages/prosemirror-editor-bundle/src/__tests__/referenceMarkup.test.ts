import { describe, expect, it } from 'vitest'
import {
  decodeNodeRef,
  encodeNodeRef,
  formatReferenceMarkup,
  namesOfKind,
  parseReferenceMarkups,
  stripMarkupToPlain,
} from '../referenceMarkup.ts'

describe('referenceMarkup 格式', () => {
  it('技能：带说明书地址', () => {
    expect(formatReferenceMarkup('skill', 'archify', '/abs/skills/archify/SKILL.md')).toBe(
      '@[skill:archify](/abs/skills/archify/SKILL.md)',
    )
  })

  it('MCP：不带地址（不出现空括号）', () => {
    expect(formatReferenceMarkup('mcp', 'smart')).toBe('@[mcp:smart]')
    expect(formatReferenceMarkup('mcp', 'smart', '')).toBe('@[mcp:smart]')
  })

  it('节点：画布 id + 节点 id', () => {
    expect(formatReferenceMarkup('node', '角色立绘', encodeNodeRef('default', 'n_12'))).toBe(
      '@[node:角色立绘](default#n_12)',
    )
  })
})

describe('parseReferenceMarkups', () => {
  it('解析三种标记，按出现顺序', () => {
    const text = '用 @[skill:archify](/a/SKILL.md) 和 @[mcp:smart] 看 @[node:立绘](default#n1) 谢谢'
    expect(parseReferenceMarkups(text)).toEqual([
      { kind: 'skill', name: 'archify', value: '/a/SKILL.md' },
      { kind: 'mcp', name: 'smart', value: '' },
      { kind: 'node', name: '立绘', value: 'default#n1' },
    ])
  })

  it('连续调用不漏匹配（lastIndex 复位）', () => {
    const text = '@[mcp:a] @[mcp:b]'
    expect(parseReferenceMarkups(text)).toHaveLength(2)
    expect(parseReferenceMarkups(text)).toHaveLength(2)
  })

  it('普通文本 / 半截标记不误伤', () => {
    expect(parseReferenceMarkups('就是普通一句话 @ 你好')).toEqual([])
    expect(parseReferenceMarkups('@[mcp:smart')).toEqual([])
  })

  it('名称允许中文与短横线', () => {
    expect(parseReferenceMarkups('@[node:角色-立绘](c#n)')[0]?.name).toBe('角色-立绘')
  })
})

describe('namesOfKind', () => {
  it('取指定种类、去重、保序', () => {
    const text = '@[skill:a](/a) 文字 @[mcp:x] @[skill:b](/b) @[skill:a](/a)'
    expect(namesOfKind(text, 'skill')).toEqual(['a', 'b'])
    expect(namesOfKind(text, 'mcp')).toEqual(['x'])
    expect(namesOfKind(text, 'node')).toEqual([])
  })
})

describe('stripMarkupToPlain', () => {
  it('标记降级成 @名字，其余文字保留', () => {
    expect(stripMarkupToPlain('看 @[node:立绘](default#n1) 和 @[mcp:smart]')).toBe('看 @立绘 和 @smart')
  })
})

describe('节点引用载荷编解码', () => {
  it('往返一致', () => {
    expect(decodeNodeRef(encodeNodeRef('default', 'n_12'))).toEqual({ canvasId: 'default', nodeId: 'n_12' })
  })

  it('缺 # 时全部当节点 id', () => {
    expect(decodeNodeRef('n_12')).toEqual({ canvasId: '', nodeId: 'n_12' })
  })
})
