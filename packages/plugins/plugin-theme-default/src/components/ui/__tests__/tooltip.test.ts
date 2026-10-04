/**
 * Tooltip 渲染契约（用户可见行为）。
 *
 * 用户要求："你使用 SVG 把这个小圆球画出来，hover 上去的时候有个提示"。
 * 提示气泡此前只有成品应用内部一个 AxTooltip（packages/ui），插件够不到 ——
 * 收进主题目录后任何插件都能按名取用，所以这些契约必须钉住：
 *   ① 默认不渲染气泡（只挂触发器，不能凭空多一个常驻浮层）；
 *   ② 触发区只包一层，不改插槽内容的布局；
 *   ③ content 为空且无 #content 插槽 → 气泡显示条件永远为假。
 * （气泡出现后的 position / role / 小三角由浏览器自动化在主应用里验收——
 *   SSR 渲染不到 hover 之后的状态。）
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import Tooltip from '../Tooltip.vue'

function render(props: Record<string, unknown>, slots: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp({
    render: () => h(Tooltip, props, { default: slots.default as never, content: slots.content as never }),
  })
  return renderToString(app)
}

describe('Tooltip：默认形态', () => {
  it('初始隐藏 → 不渲染气泡（不会凭空多一个常驻浮层）', async () => {
    const html = await render({ content: '上下文剩余 96%' }, { default: () => '环' })
    expect(html).not.toContain('tlt-bubble')
    // 触发器与内容照常渲染
    expect(html).toContain('tlt-trigger')
    expect(html).toContain('环')
  })

  it('触发区是 inline-flex 的包一层，不改插槽内容的布局', async () => {
    const html = await render({ content: 'x' }, { default: () => h('span', { class: 'probe' }, 'a') })
    expect(html).toContain('tlt-root')
    expect(html).toContain('class="probe"')
  })

  it('content 为空且没给 #content 插槽 → 气泡条件判空（默认不会显示）', async () => {
    const html = await render({}, { default: () => 'a' })
    expect(html).not.toContain('tlt-bubble')
  })
})
