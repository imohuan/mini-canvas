/** Markdown 渲染：功能 + XSS 防护（模型的输出不可信） */
import { describe, it, expect } from 'vitest'
import { renderMarkdown, escapeHtml } from '../markdown'

describe('基础渲染', () => {
  it('段落与换行', () => {
    expect(renderMarkdown('第一行\n第二行')).toContain('<p')
    expect(renderMarkdown('第一行\n第二行')).toContain('<br>')
  })
  it('粗体与行内代码', () => {
    expect(renderMarkdown('**重要**')).toContain('<strong>重要</strong>')
    expect(renderMarkdown('用 `npm i` 装')).toContain('<code>npm i</code>')
  })
  it('代码块保留原文（里面的 ** 不被当粗体）', () => {
    const html = renderMarkdown('```ts\nconst a = **b**\n```')
    expect(html).toContain('<pre')
    expect(html).toContain('**b**')
    expect(html).not.toContain('<strong>')
  })
  it('列表与标题', () => {
    expect(renderMarkdown('- 一\n- 二')).toContain('<li>一</li>')
    expect(renderMarkdown('## 标题')).toContain('<h2')
  })
  it('链接只放行 http/https/mailto', () => {
    expect(renderMarkdown('[官网](https://a.com)')).toContain('href="https://a.com"')
    expect(renderMarkdown('[点我](javascript:alert(1))')).not.toContain('javascript:')
  })
})

describe('XSS 防护', () => {
  it('标签被转义（任何注入都出不来真标签）', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
  it('script 标签被转义', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script>')
  })
  it('代码块里的标签也转义', () => {
    const html = renderMarkdown('```\n<script>x</script>\n```')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
  it('引号同样转义', () => {
    expect(escapeHtml('"x"')).toBe('&quot;x&quot;')
    expect(escapeHtml("'")).toBe('&#39;')
  })
})
