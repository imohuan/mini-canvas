/**
 * baseTitleIcon.test —— 标题条图标位的渲染契约（用户可见行为）。
 *
 * 用户的原始要求："没声明图标就不写不显示"；声明了就要在标题左侧出现，
 * 且 SVG 字符串与 Vue 组件两种形态都要能渲染。
 * 用 SSR 渲染拿真实 HTML 断言，避免只测内部 computed 而漏掉模板分支写错。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import BaseTitle from '../BaseTitle.vue'

/** 渲染 BaseTitle；withIcon=false 时不传 titleIcon（模拟"类型根本没声明图标"） */
function render(titleIcon?: unknown, withIcon = true): Promise<string> {
  const props: Record<string, unknown> = { label: '文本' }
  if (withIcon) props.titleIcon = titleIcon
  const app = createSSRApp({ render: () => h(BaseTitle, props) })
  return renderToString(app)
}

describe('BaseTitle 图标位', () => {
  it('未声明图标（undefined）→ 标题左侧不渲染任何图标', async () => {
    const html = await render(undefined, false)
    expect(html).not.toContain('base-title__icon')
  })

  it('icon 为空串 / false / null → 同样不渲染图标', async () => {
    for (const empty of ['', false, null]) {
      const html = await render(empty)
      expect(html).not.toContain('base-title__icon')
    }
  })

  it('SVG 字符串图标 → 内联渲染到标题左侧', async () => {
    const html = await render('<svg viewBox="0 0 24 24" data-probe="hit"></svg>')
    expect(html).toContain('base-title__icon')
    expect(html).toContain('data-probe="hit"')
  })

  it('Vue 组件图标 → 渲染组件内容到标题左侧', async () => {
    const CompIcon = { name: 'CompIcon', render: () => h('svg', { 'data-comp': 'hit' }) }
    const html = await render(CompIcon)
    expect(html).toContain('data-comp="hit"')
  })

  it('无图标时标签照常渲染（只是没有图标位）', async () => {
    const html = await render(undefined, false)
    expect(html).toContain('文本')
  })
})
