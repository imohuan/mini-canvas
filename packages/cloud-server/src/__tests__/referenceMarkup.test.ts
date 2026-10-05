/**
 * 服务端引用标记解析 —— 与前端 prosemirror-editor-bundle/src/referenceMarkup.ts 同一套格式。
 *
 * 这条链是「引用只给钥匙不给内容」的落点：技能给路径（懒读）、节点给画布id+节点id（引导查）。
 */
import { describe, expect, it } from 'vitest'
import {
  buildReferenceGuidance,
  decodeNodeRef,
  namesOfKind,
  parseReferenceMarkups,
  stripMarkupToPlain,
} from '../agent/referenceMarkup'

describe('后端 parseReferenceMarkups', () => {
  it('解析三种标记', () => {
    const text = '用 @[skill:archify](/a/SKILL.md) 和 @[mcp:smart] 看 @[node:立绘](default#n1)'
    expect(parseReferenceMarkups(text)).toEqual([
      { kind: 'skill', name: 'archify', value: '/a/SKILL.md' },
      { kind: 'mcp', name: 'smart', value: '' },
      { kind: 'node', name: '立绘', value: 'default#n1' },
    ])
  })

  it('普通文本不误伤', () => {
    expect(parseReferenceMarkups('普通一句话 @ 你好')).toEqual([])
  })
})

describe('后端 namesOfKind', () => {
  it('取指定种类、去重保序', () => {
    const text = '@[mcp:b] @[mcp:a] @[mcp:b]'
    expect(namesOfKind(text, 'mcp')).toEqual(['b', 'a'])
  })
})

describe('buildReferenceGuidance（只给钥匙，不给内容）', () => {
  it('技能只给路径，不贴正文', () => {
    const out = buildReferenceGuidance('帮我做 @[skill:archify](/abs/skills/archify/SKILL.md)')
    expect(out).toContain('[references]')
    expect(out).toContain('说明书在 `/abs/skills/archify/SKILL.md`')
    expect(out).toContain('read_file')
    // 正文里不再残留机器串
    expect(out).not.toContain('@[skill:')
    expect(out).toContain('@archify')
  })

  it('节点给出画布 id + 节点 id，并引导用画布 MCP 查', () => {
    const out = buildReferenceGuidance('看看 @[node:角色立绘](default#n_12)')
    expect(out).toContain('`default`')
    expect(out).toContain('`n_12`')
    expect(out).toContain('画布 MCP')
  })

  it('没有标记时原样返回', () => {
    expect(buildReferenceGuidance('就是一句普通的话')).toBe('就是一句普通的话')
  })

  it('MCP 标记不在引导块里留话（它靠 prefs 决定连哪几个）', () => {
    const out = buildReferenceGuidance('用 @[mcp:smart] 一下')
    expect(out).not.toContain('[references]')
    expect(out).toContain('@smart')
  })
})

describe('stripMarkupToPlain / decodeNodeRef', () => {
  it('标记降级成 @名字', () => {
    expect(stripMarkupToPlain('看 @[node:立绘](c#n1) 和 @[mcp:smart]')).toBe('看 @立绘 和 @smart')
  })
  it('节点载荷往返', () => {
    expect(decodeNodeRef('default#n_12')).toEqual({ canvasId: 'default', nodeId: 'n_12' })
  })
})
