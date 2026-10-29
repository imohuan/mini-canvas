import { describe, expect, it } from 'vitest'
import { codeLangLabel, parseMarkdown } from './markdown'

describe('Markdown 文档解析', () => {
  it('保留 vue 示例块，交给组件预览', () => {
    const blocks = parseMarkdown('# 标题\n\n@@VUE@@\n<template><Button>保存</Button></template>\n@@ENDVUE@@\n')
    expect(blocks[0]).toMatchObject({ type: 'html' })
    expect(blocks[1]).toMatchObject({ type: 'code', lang: 'vue', exampleIndex: 0, codeIndex: 0 })
    expect(blocks[1].type === 'code' ? blocks[1].source : '').toContain('<Button>保存</Button>')
  })

  it('普通 fenced code block 也会保留语言，供代码高亮使用', () => {
    const blocks = parseMarkdown('```ts\nconst answer = 42\n```\n')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ type: 'code', lang: 'ts', exampleIndex: -1, codeIndex: 0 })
    expect(blocks[0].type === 'code' ? blocks[0].source : '').toContain('const answer = 42')
  })

  it('普通 Markdown 渲染成标题、列表、行内代码与链接', () => {
    const blocks = parseMarkdown('## 用法\n\n- 用 \x60variant\x60\n- 看 [文档](https://example.com)\n')
    expect(blocks).toHaveLength(1)
    const html = blocks[0].type === 'html' ? blocks[0].html : ''
    expect(html).toContain('<h2>用法</h2>')
    expect(html).toContain('<li>用 <code>variant</code></li>')
    expect(html).toContain('href="https://example.com"')
  })

  it('HTML 与伪协议会先转义，不会变成可执行标签', () => {
    const blocks = parseMarkdown('<img src=x onerror=alert(1)>\n\n[点我](javascript:alert(1))')
    const html = blocks.map((block) => block.type === 'html' ? block.html : '').join('')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('javascript:')
  })

  it('示例之外的正文不会因为尖括号而丢内容', () => {
    const blocks = parseMarkdown('普通文字 < 10 也算正文')
    expect(blocks[0].type === 'html' ? blocks[0].html : '').toContain('普通文字')
  })

  it('Markdown 表格渲染成真正的表格', () => {
    const blocks = parseMarkdown('| 属性 | 说明 |\n| --- | --- |\n| variant | 外观 |')
    const html = blocks[0].type === 'html' ? blocks[0].html : ''
    expect(html).toContain('<table>')
    expect(html).toContain('<th>属性</th>')
    expect(html).toContain('<td>variant</td>')
  })

  it('代码语言标签首字母大写，并补上常见语言的规范写法', () => {
    expect(codeLangLabel('vue')).toBe('Vue')
    expect(codeLangLabel('ts')).toBe('TypeScript')
    expect(codeLangLabel('json')).toBe('JSON')
    expect(codeLangLabel('ruby')).toBe('Ruby')
    expect(codeLangLabel('')).toBe('Text')
  })
})
