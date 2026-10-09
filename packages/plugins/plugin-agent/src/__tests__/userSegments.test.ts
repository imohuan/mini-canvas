/**
 * 用户消息里的引用标签解析 —— 决定「点标签会发生什么」（用户口径 2026-10-08）。
 *
 * 关键区分：**有 ext = 单个文件**（点开预览）、**只有 folderId = 文件夹**（点开资产管理）。
 * 判反了的表现是「点了没反应」或「点文件夹弹出图片预览」，浏览器里很难查，钉在单测里。
 */
import { describe, expect, it } from 'vitest'
import { parseUserSegments, segClickable, segTitle, assetRefInputOf } from '../userSegments'

const tags = (text: string) => parseUserSegments(text).filter((s) => s.type === 'tag')

describe('parseUserSegments', () => {
  it('没有引用标记时就是单个文字片段', () => {
    expect(parseUserSegments('随便说一句话')).toEqual([
      { type: 'text', value: '随便说一句话', name: '', category: '', icon: '' },
    ])
  })

  it('资产**文件**：带 path 与 ext', () => {
    const [t] = tags('<ref type="asset" name="图.png" path="D:/a/ab.png" ext="png" />')
    expect(t).toMatchObject({ refType: 'asset', name: '图.png', path: 'D:/a/ab.png', ext: 'png' })
    expect(t.folderId).toBeUndefined()
  })

  it('资产**文件夹**：带 folderId、没有 ext', () => {
    const [t] = tags('<ref type="asset" name="待分类资产" folderId="f1" />')
    expect(t).toMatchObject({ refType: 'asset', name: '待分类资产', folderId: 'f1' })
    expect(t.ext).toBeUndefined()
    expect(t.path).toBeUndefined()
  })

  it('节点 / 技能 / MCP 照旧（节点仍带 nodeId）', () => {
    const [n] = tags('<ref type="node" name="花海" canvasId="c1" nodeId="35" />')
    expect(n.nodeId).toBe('35')
    expect(n.refType).toBe('node')
    expect(tags('<ref type="skill" name="archify" path="/s/SKILL.md" />')[0].name).toBe('archify')
    expect(tags('<ref type="mcp" name="canvas" />')[0].category).toBe('MCP')
  })

  it('文字与标签混排：顺序与文字都保住', () => {
    const segs = parseUserSegments('看看<ref type="asset" name="a.png" path="/a.png" ext="png" />然后呢')
    expect(segs.map((s) => s.type)).toEqual(['text', 'tag', 'text'])
    expect(segs[0].value).toBe('看看')
    expect(segs[2].value).toBe('然后呢')
  })

  /**
   * 老转录里资产引用只有 path、没有 ext（那时只想让本机 Agent 按路径读文件）。
   * 不补一次的话，一个 .png 会被当成文件夹 —— 表现是「点图片标签打开了资产管理」。
   */
  it('老数据没有 ext 时从 path 末尾补（否则图片会被当文件夹）', () => {
    const [t] = tags('<ref type="asset" name="videoframe_10047.png" path="D:\\d\\assets\\files\\ab.png" />')
    expect(t.ext).toBe('png')
    expect(segClickable(t)).toBe(true)
    expect(segTitle(t)).toContain('点击预览')
  })

  it('目录（path 无扩展名）仍然不带 ext —— 照旧当文件夹', () => {
    const [t] = tags('<ref type="asset" name="待分类资产" path="D:/d/assets/files" folderId="f1" />')
    expect(t.ext).toBeUndefined()
    expect(segTitle(t)).toContain('打开所在文件夹')
  })

  /**
   * 文件夹的 path 是「里面资产的公共目录」，目录名可能带点号（「素材 v1.2」）。
   * 只看 path 推 ext 的话会把目录误判成文件 → 点一下弹出图片预览（用户报过的形态）。
   * 判据：有 folderId 就是目录，不再从 path 推。
   */
  it('目录名带点号（素材 v1.2）不会被当成文件', () => {
    const [t] = tags('<ref type="asset" name="素材 v1.2" path="D:/d/assets/files/素材 v1.2" folderId="f9" />')
    expect(t.ext).toBeUndefined()
    expect(segTitle(t)).toContain('打开所在文件夹')
  })
})

describe('点标签的判定', () => {
  it('节点与资产点得动；技能 / MCP 点不动', () => {
    expect(segClickable(tags('<ref type="node" name="n" canvasId="c" nodeId="1" />')[0])).toBe(true)
    expect(segClickable(tags('<ref type="asset" name="a.png" path="/a.png" ext="png" />')[0])).toBe(true)
    expect(segClickable(tags('<ref type="asset" name="F" folderId="f1" />')[0])).toBe(true)
    expect(segClickable(tags('<ref type="skill" name="s" />')[0])).toBe(false)
    expect(segClickable(tags('<ref type="mcp" name="m" />')[0])).toBe(false)
  })

  it('悬浮提示说清「点开会发生什么」', () => {
    expect(segTitle(tags('<ref type="asset" name="a.png" path="/a.png" ext="png" />')[0])).toContain('点击预览')
    expect(segTitle(tags('<ref type="asset" name="F" folderId="f1" />')[0])).toContain('打开所在文件夹')
  })

  it('交给事件载荷的入参：文件带 path+ext，文件夹只带 folderId', () => {
    expect(assetRefInputOf(tags('<ref type="asset" name="a.png" path="/a.png" ext="png" />')[0]))
      .toEqual({ name: 'a.png', path: '/a.png', ext: 'png' })
    expect(assetRefInputOf(tags('<ref type="asset" name="F" folderId="f1" />')[0]))
      .toEqual({ name: 'F', folderId: 'f1' })
  })
})
