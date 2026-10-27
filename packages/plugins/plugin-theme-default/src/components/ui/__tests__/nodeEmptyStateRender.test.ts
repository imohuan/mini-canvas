/**
 * NodeEmptyState 渲染契约：图片 / 视频 / 音频 / 3D 等节点共用同一个空态。
 *
 * 断言的是用户看得到的结果：图标、主文案、可选说明、可选动作。
 * 组件必须能在 SSR（无 DOM）下渲染 —— 节点内容区在服务端预览/单测里也要长得对。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import NodeEmptyState from '../NodeEmptyState.vue'

function render(props: Record<string, unknown>): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(NodeEmptyState, props) }))
}

describe('NodeEmptyState 默认空状态', () => {
  it('只给文案时也能渲染：图标 + 主文案，不带多余的说明/动作', async () => {
    const html = await render({ text: '（无图片）' })
    expect(html).toContain('nes-root')
    expect(html).toContain('（无图片）')
    expect(html).toContain('nes-icon')
    expect(html).not.toContain('nes-description')
    expect(html).not.toContain('nes-action')
  })

  it('description 与 text 是两行：说明可以更小、更淡', async () => {
    const html = await render({ text: '还没有全景图', description: '把图片节点连进来' })
    expect(html).toContain('还没有全景图')
    expect(html).toContain('nes-description')
    expect(html).toContain('把图片节点连进来')
  })

  it('给了行动文案就渲染成真正的 button（可点、可聚焦；不是一整块假按钮）', async () => {
    const html = await render({ text: '还没有音频', actionText: '上传音频' })
    expect(html).toContain('<button')
    expect(html).toContain('type="button"')
    expect(html).toContain('上传音频')
  })

  it('图标可换：默认是通用占位，传了 tone 走语义色', async () => {
    expect(await render({ text: 'x', tone: 'danger' })).toContain('is-danger')
    expect(await render({ text: 'x', tone: 'warning' })).toContain('is-warning')
  })

  it('自定义图标（插槽）优先于内置图标：节点可以放自己的语义图形', async () => {
    const html = await renderToString(
      createSSRApp({ render: () => h(NodeEmptyState, { text: 'x' }, { icon: () => h('svg', { class: 'my-icon' }) }) }),
    )
    expect(html).toContain('my-icon')
    expect(html).not.toContain('nes-icon-default')
  })
})
