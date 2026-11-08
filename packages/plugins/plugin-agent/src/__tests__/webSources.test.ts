/**
 * 搜索类工具的输出 → 来源列表（AI Elements Sources 的数据层）。
 *
 * 用户口径 2026-11-07：搜索结果显示「使用了 N 个来源」，展开是逐条链接；
 * 普通命令的输出（哪怕里面有 URL）不该被当成来源。
 */
import { describe, it, expect } from 'vitest'
import { isSourceTool, sourceLabel, toolSources } from '../model/webSources'

describe('isSourceTool', () => {
  it('只认搜索 / 抓取类工具（含 MCP 前缀）', () => {
    expect(isSourceTool('web_search')).toBe(true)
    expect(isSourceTool('mcp__smart__fetch')).toBe(true)
    expect(isSourceTool('exec_command')).toBe(false)
    expect(isSourceTool('read_file')).toBe(false)
  })
})

describe('toolSources', () => {
  it('从 JSON 结果里收 url + title，保持原顺序', () => {
    const out = JSON.stringify({
      results: [
        { title: '甲', url: 'https://a.com/1' },
        { title: '乙', url: 'https://b.com/2' },
      ],
    })
    expect(toolSources('web_search', out)).toEqual([
      { url: 'https://a.com/1', title: '甲' },
      { url: 'https://b.com/2', title: '乙' },
    ])
  })

  it('同一链接只留一次', () => {
    const out = JSON.stringify([{ url: 'https://a.com' }, { url: 'https://a.com' }])
    expect(toolSources('web_search', out)).toHaveLength(1)
  })

  it('输出是纯文本时兜底抓裸链接', () => {
    expect(toolSources('web_search', '见 https://c.com/x 和 https://d.com/y')).toHaveLength(2)
  })

  it('非搜索工具 / 空输出 ⇒ 不产生来源（不把命令输出里的地址当引用）', () => {
    expect(toolSources('exec_command', JSON.stringify({ url: 'https://a.com' }))).toEqual([])
    expect(toolSources('web_search', undefined)).toEqual([])
  })

  it('危险协议被挡掉', () => {
    expect(toolSources('web_search', 'javascript:alert(1) http://ok.com')).toEqual([{ url: 'http://ok.com/' }])
  })

  it('没有标题时用主机名', () => {
    expect(sourceLabel({ url: 'https://example.com/a' })).toBe('example.com')
    expect(sourceLabel({ url: 'https://example.com/a', title: '标题' })).toBe('标题')
  })
})
