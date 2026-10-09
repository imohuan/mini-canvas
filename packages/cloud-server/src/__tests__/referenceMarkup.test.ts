/**
 * 服务端引用标记解析 —— 与前端 prosemirror-editor-bundle/src/referenceMarkup.ts 同一套格式（XML）。
 *
 * 用户口径（2026-10-08）：**后端不翻译、原样转发** —— 用户会把输入框内容复制到本机 Agent
 * （Codex 等）接着用。标记本身字段化携带完整信息（含本机绝对路径），复制出去对方直接可用。
 */
import { describe, expect, it } from 'vitest'
import {
  buildReferenceGuidance,
  namesOfKind,
  parseReferenceMarkups,
  stripMarkupToPlain,
  REFERENCE_MARKUP_GUIDE,
} from '../agent/referenceMarkup'

describe('XML 标记解析（后端）', () => {
  it('四种标记，字段还原', () => {
    const text = [
      '<ref type="skill" name="archify" path="/a/SKILL.md" />',
      '<ref type="mcp" name="smart" />',
      '<ref type="node" name="花海" canvasId="c1" nodeId="35" />',
      '<ref type="asset" name="图.png" path="D:/x.png" ext="png" />',
      '<ref type="asset" name="待分类资产" folderId="f1" />',
    ].join(' ')
    expect(parseReferenceMarkups(text)).toEqual([
      { type: 'skill', name: 'archify', path: '/a/SKILL.md' },
      { type: 'mcp', name: 'smart' },
      { type: 'node', name: '花海', canvasId: 'c1', nodeId: '35' },
      { type: 'asset', name: '图.png', path: 'D:/x.png', ext: 'png' },
      { type: 'asset', name: '待分类资产', folderId: 'f1' },
    ])
  })

  it('普通文本 / 未知 type 不误伤', () => {
    expect(parseReferenceMarkups('普通一句话 @ 你好')).toEqual([])
    expect(parseReferenceMarkups('<ref type="foo" name="x" />')).toEqual([])
  })
})

describe('namesOfKind（后端）', () => {
  it('MCP 名单合并用', () => {
    const text = '<ref type="mcp" name="b" /> <ref type="mcp" name="a" /> <ref type="mcp" name="b" />'
    expect(namesOfKind(text, 'mcp')).toEqual(['b', 'a'])
  })
})

describe('buildReferenceGuidance —— 原样透传（后端不翻译）', () => {
  it('XML 标记原样保留', () => {
    const text = '帮我做 <ref type="skill" name="archify" path="D:/s/SKILL.md" />'
    expect(buildReferenceGuidance(text)).toBe(text)
  })

  it('资产引用原样保留（载荷是本机绝对路径）', () => {
    const text = '看看 <ref type="asset" name="图.png" path="D:/data/x.png" />'
    const out = buildReferenceGuidance(text)
    expect(out).toBe(text)
  })
})

describe('REFERENCE_MARKUP_GUIDE（标记含义 → 系统提示词）', () => {
  it('四种标记的含义都写全了', () => {
    for (const k of ['type="asset"', 'type="node"', 'type="skill"', 'type="mcp"']) {
      expect(REFERENCE_MARKUP_GUIDE).toContain(k)
    }
  })
  it('明确写了「path 是本机绝对路径、可直接读取」', () => {
    expect(REFERENCE_MARKUP_GUIDE).toContain('绝对路径')
  })
  /** 资产有两种形态（文件 / 文件夹），提示词必须讲清怎么区分 —— 否则模型会把目录当文件读 */
  it('资产分「文件」与「文件夹」两种，且写明「没有 ext 就是目录」', () => {
    expect(REFERENCE_MARKUP_GUIDE).toContain('资产**文件**')
    expect(REFERENCE_MARKUP_GUIDE).toContain('资产**文件夹**')
    expect(REFERENCE_MARKUP_GUIDE).toContain('没有 ext 就是目录')
  })
})

describe('stripMarkupToPlain（标题等纯展示）', () => {
  it('XML 标记剥成 @名字', () => {
    expect(stripMarkupToPlain('看 <ref type="node" name="立绘" canvasId="c" nodeId="n" />')).toBe('看 @立绘')
  })
})
