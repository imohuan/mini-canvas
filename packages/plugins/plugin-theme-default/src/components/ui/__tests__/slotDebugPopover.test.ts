/**
 * SlotDebugPopover —— 插槽调试提示面板的契约。
 *
 * 用户口径（2026-10-28）：
 * 1. 面板要复用**主题自己的 Dropdown**（不是另造浮层）；
 * 2. 悬停触发，内容按 key/value 展示。
 */
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import SlotDebugPopover from '../SlotDebugPopover.vue'

describe('SlotDebugPopover', () => {
  it('复用主题 Dropdown（hover 触发），触发器里放传入内容', async () => {
    const app = createSSRApp({
      render: () =>
        h(SlotDebugPopover, { content: 'id: host/agent\norder: 800' }, () =>
          h('span', { 'data-dot': '1' }),
        ),
    })
    const html = await renderToString(app)
    expect(html).toContain('class="dd"')
    expect(html).toContain('class="dd-trigger"')
    expect(html).toContain('data-dot="1"')
  })

  it('未展开时不渲染菜单内容（悬停才出）', async () => {
    const app = createSSRApp({
      render: () =>
        h(SlotDebugPopover, { content: 'id: host/agent' }, () => h('span', 'dot')),
    })
    const html = await renderToString(app)
    expect(html).not.toContain('dd-menu')
  })
})
