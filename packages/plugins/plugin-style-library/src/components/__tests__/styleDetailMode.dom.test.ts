// @vitest-environment happy-dom
/**
 * 两种模式的按钮可见性（真实 DOM）。
 *
 * 用户口径 2026-11-06：项目页没有画布，详情页不该再出现一个点不出结果的「使用」；
 * 画布模式保持原样。详情页用 Teleport 挂到 body，SSR 拿不到这段，必须用 DOM 验证。
 */
import { describe, expect, it } from 'vitest'
import { createApp, h } from 'vue'
import StyleDetailView from '../StyleDetailView.vue'
import type { StyleCard } from '../../data/types'

const item = {
  id: 'demo-1',
  name: '示例素材',
  author: '作者',
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

/** 挂载后等一帧（Teleport 与 onMounted 都在微任务里完成） */
async function mountWith(showCanvasActions?: boolean): Promise<HTMLElement> {
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp({
    render: () =>
      h(StyleDetailView, showCanvasActions === undefined ? { item } : { item, showCanvasActions }),
  })
  app.mount(host)
  await new Promise((r) => setTimeout(r, 0))
  return document.body
}

function actionLabels(root: HTMLElement): string[] {
  return [...root.querySelectorAll('.sd-actions button')].map((b) => (b.textContent ?? '').trim())
}

describe('详情页「使用」按模式显示', () => {
  it('项目模式：只有收藏，没有使用', async () => {
    const root = await mountWith(false)
    expect(actionLabels(root)).toEqual(['收藏'])
  })

  it('画布模式：收藏与使用都在', async () => {
    const root = await mountWith()
    expect(actionLabels(root)).toEqual(['收藏', '使用'])
  })
})
