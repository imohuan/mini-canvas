/**
 * 项目页看素材：卡片能打开，但「加入画布」禁用并给出原因。
 *
 * 验收对应 18 号文档：项目页能浏览素材；缺画布 / media 时按钮禁用、有可见提示，
 * 不抛错也不创建半成品节点。这里真实渲染卡片，扫的是产出的按钮与 title。
 */
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import StyleCardView from '../StyleCardView.vue'
import type { StyleCard } from '../../data/types'

const item = {
  id: 'demo-1',
  name: '示例素材',
  author: '',
  category: '',
  tags: ['示例'],
  commercial: true,
  exclusive: false,
  runCount: 0,
  likeCount: 0,
  imageCount: 1,
  cover: '/demo.png',
  images: ['/demo.png'],
  videos: [],
} satisfies StyleCard

async function render(props: Record<string, unknown>): Promise<string> {
  const app = createSSRApp({ render: () => h(StyleCardView, { item, ...props }) })
  return renderToString(app)
}

describe('素材卡片在项目页的降级', () => {
  it('没有画布：加入按钮禁用，并写出为什么', async () => {
    const html = await render({
      useDisabled: true,
      useDisabledReason: '打开一张画布后可使用素材',
    })
    const addButton = html.match(/<button[^>]*aria-label="加入画布[^"]*"[^>]*>/)?.[0] ?? ''
    expect(addButton, '没有渲染加入按钮').not.toBe('')
    expect(addButton).toContain('disabled')
    expect(addButton).toContain('打开一张画布后可使用素材')
    // 浏览入口不受影响：卡片本身（封面 + 分类标签）还渲染得出来。
    expect(html).toContain('src="/demo.png"')
    expect(html).toContain('示例')
  })

  it('有画布：按钮可用，不写禁用原因', async () => {
    const html = await render({ useDisabled: false })
    const addButton = html.match(/<button[^>]*aria-label="加入画布[^"]*"[^>]*>/)?.[0] ?? ''
    expect(addButton).not.toBe('')
    expect(addButton).not.toContain('disabled')
  })
})
