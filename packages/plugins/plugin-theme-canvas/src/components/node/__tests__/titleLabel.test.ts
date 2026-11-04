/**
 * titleLabel.test —— 标题文案的编辑态契约（用户可见行为）。
 *
 * 用户原话："进入文本编辑状态的时候，我希望你这边可以使用 contenteditable 属性来进行编辑，
 * 而不是创建一个 input，这样子做会破坏高度，导致 UI 变形。"
 * 所以这里锁死：编辑态**不能**出现 <input>，而是同一个元素切换 contenteditable。
 * 用 SSR 渲染真实 HTML 断言，避免只测内部状态而漏掉模板写错。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import TitleLabel from '../TitleLabel.vue'

function render(props: Record<string, unknown>): Promise<string> {
  const app = createSSRApp({ render: () => h(TitleLabel, props) })
  return renderToString(app)
}

describe('TitleLabel 编辑态', () => {
  it('非编辑态：显示文案，contenteditable=false，且没有 input', async () => {
    const html = await render({ label: '文本', editing: false })
    expect(html).toContain('contenteditable="false"')
    expect(html).not.toContain('<input')
  })

  it('编辑态：同一个元素切到 contenteditable=true，仍然没有 input（不破坏高度）', async () => {
    const html = await render({ label: '文本', editing: true })
    expect(html).toContain('contenteditable="true"')
    expect(html).not.toContain('<input')
  })

  it('编辑态带 is-editing 类（下边框的样式钩子）', async () => {
    const html = await render({ label: '文本', editing: true })
    expect(html).toContain('is-editing')
  })

  it('非编辑态不带 is-editing（平时不显示编辑外观）', async () => {
    const html = await render({ label: '文本', editing: false })
    expect(html).not.toContain('is-editing')
  })

  it('模板不带文本节点：文本由组件命令式写入，避免重渲染覆盖用户输入', async () => {
    const html = await render({ label: '文本', editing: false })
    // 元素内容为空（文本靠 mounted 后 syncText 写入）→ 不会被 Vue 的文本 patch 覆盖
    expect(html).toMatch(/class="title-label[^"]*"[^>]*><\/div>/)
  })
})
