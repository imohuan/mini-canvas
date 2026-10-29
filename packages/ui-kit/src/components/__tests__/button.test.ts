import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import Button from '../Button.vue'

function render(props: Record<string, unknown> = {}, slots: Record<string, () => unknown> = {}): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(Button, props, slots) }))
}

describe('Button：用户可见的默认行为', () => {
  it('默认是按钮而不是表单提交键，并保留文字内容', async () => {
    const html = await render({}, { default: () => '开始创作' })
    expect(html).toContain('type="button"')
    expect(html).toContain('开始创作')
    expect(html).toContain('mck-button--secondary')
    expect(html).toContain('mck-button--md')
  })

  it('外观和尺寸可以组合，整行开关会落到块级按钮', async () => {
    const html = await render({ variant: 'primary', size: 'lg', block: true }, { default: () => '发布' })
    expect(html).toContain('mck-button--primary')
    expect(html).toContain('mck-button--lg')
    expect(html).toContain('is-block')
  })

  it('禁用时真的禁用，而不是只把颜色变淡', async () => {
    const html = await render({ disabled: true }, { default: () => '不可用' })
    expect(html).toMatch(/<button[^>]*disabled/)
  })

  it('加载中会禁用按钮、报告忙碌状态并显示等待指示', async () => {
    const html = await render({ loading: true }, { default: () => '保存中' })
    expect(html).toMatch(/<button[^>]*disabled/)
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('mck-button__spinner')
  })

  it('只有图标时自动变成图标按钮，并保留无障碍名称', async () => {
    const html = await render(
      { ariaLabel: '删除图层' },
      { icon: () => h('svg', { 'data-icon': 'trash' }) },
    )
    expect(html).toContain('is-icon-only')
    expect(html).toContain('aria-label="删除图层"')
    expect(html).toContain('data-icon="trash"')
  })

  it('图标加文字是普通按钮，不会误收成图标按钮', async () => {
    const html = await render(
      { ariaLabel: '保存' },
      {
        icon: () => h('svg', { 'data-icon': 'save' }),
        default: () => '保存',
      },
    )
    expect(html).not.toContain('is-icon-only')
    expect(html).toContain('mck-button__label')
  })

  it('显式 iconOnly 优先于插槽判断，方便调用方强制方形按钮', async () => {
    const html = await render(
      { iconOnly: true, ariaLabel: '更多操作' },
      { icon: () => h('svg', { 'data-icon': 'more' }), default: () => '更多' },
    )
    expect(html).toContain('is-icon-only')
    expect(html).toContain('更多')
  })
})
