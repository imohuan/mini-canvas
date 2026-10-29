import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import SplitPane from '../SplitPane.vue'

function render(props: Record<string, unknown> = {}): Promise<string> {
  return renderToString(
    createSSRApp({
      render: () =>
        h(SplitPane, props, {
          left: () => '左边内容',
          right: () => '右边内容',
        }),
    }),
  )
}

describe('SplitPane：迁移后的对外契约', () => {
  it('保留原组件的两个插槽', async () => {
    const html = await render()
    expect(html).toContain('左边内容')
    expect(html).toContain('右边内容')
    expect(html).toContain('mck-split__pane')
  })

  it('默认左右分栏，分隔条可聚焦且报告方向', async () => {
    const html = await render()
    expect(html).toContain('is-horizontal')
    expect(html).toContain('role="separator"')
    expect(html).toContain('aria-orientation="vertical"')
    expect(html).toContain('tabindex="0"')
  })

  it('纵向模式改成分隔条横向，供预览与文档上下拆分', async () => {
    const html = await render({ direction: 'vertical' })
    expect(html).toContain('is-vertical')
    expect(html).toContain('aria-orientation="horizontal"')
  })

  it('可访问性：报告当前比例范围，分隔条不是普通按钮', async () => {
    const html = await render({ initial: 0.6 })
    expect(html).toContain('aria-valuenow="60"')
    expect(html).toContain('aria-valuemin="0"')
    expect(html).toContain('aria-valuemax="100"')
    expect(html).not.toContain('<button')
  })
})
