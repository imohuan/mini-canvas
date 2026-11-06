// @vitest-environment happy-dom
/**
 * 素材卡片的「加入画布」加号：项目模式整颗不渲染，画布模式才出现。
 */
import { describe, expect, it } from 'vitest'
import { createApp, h } from 'vue'
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

async function mountWith(showCanvasActions?: boolean): Promise<HTMLElement> {
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp({
    render: () =>
      h(StyleCardView, showCanvasActions === undefined ? { item } : { item, showCanvasActions }),
  })
  app.mount(host)
  await new Promise((r) => setTimeout(r, 0))
  return host
}

describe('素材卡片按模式显示加号', () => {
  it('项目模式：没有加入画布按钮', async () => {
    const root = await mountWith(false)
    expect(root.querySelector('.sc-add')).toBeNull()
    // 浏览入口还在：封面渲染，卡片本体可见。
    expect(root.querySelector('.sc-card')).not.toBeNull()
  })

  it('画布模式：加号在', async () => {
    const root = await mountWith()
    expect(root.querySelector('.sc-add')).not.toBeNull()
  })
})
