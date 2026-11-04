/**
 * NodeEmptyState 的 layout / size / 默认插槽契约。
 *
 * 用户口径（2026-10-27）：图片 / 视频 / 音频 / 3D 用了统一空态后，可视化、文本、
 * 图片对比这些节点长得各不相同 —— 它们要么给默认插槽完全接管正文，要么用
 * `layout="row"` + `size="sm"` 变成窄卡片的行内空态。这里锁住这两组形态真的存在。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import NodeEmptyState from '../NodeEmptyState.vue'

function render(props: Record<string, unknown>): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(NodeEmptyState, props) }))
}

describe('NodeEmptyState 布局与尺寸', () => {
  it('缺省是 column + md（图标在上、32px 图标、12px 间距）', async () => {
    const html = await render({ text: 'x' })
    expect(html).toContain('is-column')
    expect(html).toContain('is-md')
  })

  it('layout="row"：图标在左、文案在右（窄卡片用）', async () => {
    const html = await render({ text: '（空）', layout: 'row', size: 'sm' })
    expect(html).toContain('is-row')
    expect(html).toContain('is-sm')
  })

  it('默认插槽完全接管正文（可视化节点那种「标题 + 提示」两行）', async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(NodeEmptyState, { text: 'x' }, { default: () => [h('div', { class: 'my-title' }, '可视化'), h('div', '让 Agent 帮你画')] }),
      }),
    )
    expect(html).toContain('my-title')
    expect(html).toContain('可视化')
    // 接管后默认正文不再出现
    expect(html).not.toContain('nes-text')
  })
})
