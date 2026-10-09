import { describe, expect, it } from 'vitest'
import {
  decodeNodeRef,
  encodeNodeRef,
  formatReferenceMarkup,
  formatRefAsset,
  namesOfKind,
  parseReferenceMarkups,
  stripMarkupToPlain,
} from '../referenceMarkup.ts'

describe('XML 标记序列化', () => {
  it('技能：path 字段（本机绝对路径）', () => {
    expect(formatReferenceMarkup('skill', 'archify', 'D:/s/archify/SKILL.md')).toBe(
      '<ref type="skill" name="archify" path="D:/s/archify/SKILL.md" />',
    )
  })

  it('MCP：无 path（不出现空属性）', () => {
    expect(formatReferenceMarkup('mcp', 'smart')).toBe('<ref type="mcp" name="smart" />')
    expect(formatReferenceMarkup('mcp', 'smart', '')).toBe('<ref type="mcp" name="smart" />')
  })

  it('节点：canvasId + nodeId 两段定位', () => {
    expect(formatReferenceMarkup('node', '花海', encodeNodeRef('430c8f1f', '35'))).toBe(
      '<ref type="node" name="花海" canvasId="430c8f1f" nodeId="35" />',
    )
  })

  /**
   * 资产：载荷是**本机绝对路径**（不是 HTTP 地址）。用户口径（2026-10-06）：
   * 引用要能复制到本机 Agent（Codex 等）直接用 —— 相对 URL 对方取不到。
   */
  it('资产：带本机绝对路径', () => {
    expect(formatReferenceMarkup('asset', '图片 18.png', 'D:/data/assets/files/ab12.png')).toBe(
      '<ref type="asset" name="图片 18.png" path="D:/data/assets/files/ab12.png" />',
    )
  })

  /**
   * 资产引用还要带两个**给前端自己用**的字段（用户口径 2026-10-08：标签要能点开看东西）：
   *   ext      点标签时挑预览器（png→图片 / mp4→视频 / mp3→音频）
   *   folderId 所属资产库文件夹（点文件夹标签时定位到资产管理那一层）
   */
  it('资产文件：ext 与 folderId 都带上', () => {
    expect(formatReferenceMarkup('asset', '图.png', 'D:/d/ab.png', { ext: 'png', folderId: 'f1' })).toBe(
      '<ref type="asset" name="图.png" path="D:/d/ab.png" ext="png" folderId="f1" />',
    )
    expect(formatRefAsset('图.png', 'D:/d/ab.png', 'png')).toBe(
      '<ref type="asset" name="图.png" path="D:/d/ab.png" ext="png" />',
    )
  })

  it('资产文件夹：只有 folderId、**没有 ext**（读的人靠这一点认出是目录）', () => {
    expect(formatReferenceMarkup('asset', '待分类资产', undefined, { folderId: 'f1' })).toBe(
      '<ref type="asset" name="待分类资产" folderId="f1" />',
    )
  })
})

describe('XML 标记解析', () => {
  it('解析四种标记，字段还原', () => {
    const text = [
      '<ref type="skill" name="archify" path="/a/SKILL.md" />',
      '<ref type="mcp" name="smart" />',
      '<ref type="node" name="花海" canvasId="c1" nodeId="35" />',
      '<ref type="asset" name="图.png" path="D:/x.png" ext="png" />',
    ].join(' ')
    expect(parseReferenceMarkups(text)).toEqual([
      { type: 'skill', name: 'archify', path: '/a/SKILL.md' },
      { type: 'mcp', name: 'smart' },
      { type: 'node', name: '花海', canvasId: 'c1', nodeId: '35' },
      { type: 'asset', name: '图.png', path: 'D:/x.png', ext: 'png' },
    ])
  })

  it('属性值里的引号 / 尖括号已转义（往返一致）', () => {
    const text = '<ref type="asset" name="a&quot;b&quot;c" path="D:/x.png" /> <ref type="asset" name="c&lt;d" path="D:/y.png" />'
    const parsed = parseReferenceMarkups(text)
    expect(parsed[0].name).toBe('a"b"c')
    expect(parsed[1].name).toBe('c<d')
  })

  it('未知 type 跳过（不产生条目）', () => {
    expect(parseReferenceMarkups('<ref type="foo" name="x" />')).toEqual([])
  })

  it('资产文件夹：解析出 folderId（没有 ext）', () => {
    expect(parseReferenceMarkups('<ref type="asset" name="F" folderId="f1" />')).toEqual([
      { type: 'asset', name: 'F', folderId: 'f1' },
    ])
  })

  it('普通文本不误伤', () => {
    expect(parseReferenceMarkups('普通一句话 @ 你好 <div>不是标记</div>')).toEqual([])
  })
})

describe('namesOfKind', () => {
  it('取指定种类、去重、保序', () => {
    const text = '<ref type="skill" name="a" path="/a" /> 文字 <ref type="mcp" name="x" /> <ref type="skill" name="b" path="/b" /> <ref type="skill" name="a" path="/a" />'
    expect(namesOfKind(text, 'skill')).toEqual(['a', 'b'])
    expect(namesOfKind(text, 'mcp')).toEqual(['x'])
    expect(namesOfKind(text, 'node')).toEqual([])
  })
})

describe('stripMarkupToPlain（纯展示场景：标题）', () => {
  it('XML 标记剥成 @名字', () => {
    expect(stripMarkupToPlain('看 <ref type="node" name="立绘" canvasId="c" nodeId="n" /> 和 <ref type="mcp" name="smart" />')).toBe('看 @立绘 和 @smart')
  })
})

describe('节点引用载荷编解码', () => {
  it('往返一致', () => {
    expect(decodeNodeRef(encodeNodeRef('default', 'n_12'))).toEqual({ canvasId: 'default', nodeId: 'n_12' })
  })
})
