/**
 * 视频编辑浮层的渲染契约（SSR 拿真 HTML 断言）。
 *
 * 用户报的缺陷（原话）：「他的这个区域被节点给裁剪了，因为你把他放在节点内部了，
 * 你应该放在和上下操控栏同级位置」。
 *
 * 所以这条测试锁两件事：
 * 1. 浮层只在裁剪态渲染（平时不出现，别常驻挡着播放控件）；
 * 2. 浮层里**没有**确认/取消按钮 —— 用户明确要求那两个按钮放在上下控制栏。
 *    确认按钮若被误加回浮层，这里会立刻拦住（按钮位置漂移正是这次要修的问题）。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import VideoFrameOverlay from '../VideoFrameOverlay.vue'
import { beginOverlay, endOverlay } from '../videoSession'

function renderCtx(): CanvasRenderContext {
  const services: Record<string, unknown> = {
    command: { execute: () => undefined },
    nodeStore: { getNode: () => undefined },
    settings: { get: () => undefined, onChange: () => ({ dispose: () => {} }) },
  }
  return {
    ctx: { get: (name: string) => services[name], on: () => ({ dispose: () => {} }) },
    viewport: { value: { zoom: 1 } },
  } as unknown as CanvasRenderContext
}

function render(id: string, data: Record<string, unknown>): Promise<string> {
  const app = createSSRApp({ render: () => h(VideoFrameOverlay as Component, { id, data }) })
  app.provide(RENDER_CONTEXT_KEY, renderCtx())
  return renderToString(app)
}

describe('裁剪态才渲染浮层', () => {
  it('平时不渲染（别常驻挡着播放控件）', async () => {
    const html = await render('v1', { videoUrl: 'blob:v', videoWidth: 1600, videoHeight: 800 })
    expect(html).not.toContain('mfo-frame')
  })

  it('进入裁剪 → 画出可拖的框', async () => {
    beginOverlay('v1', 'crop')
    const html = await render('v1', { videoUrl: 'blob:v', videoWidth: 1600, videoHeight: 800 })
    expect(html).toContain('mfo-frame')
    // 方形控制点（4 个角）
    expect(html).toContain('mfo-handle')
    endOverlay('v1')
  })

  it('浮层里没有确认/取消按钮 —— 那两个按钮在上下控制栏（用户要求）', async () => {
    beginOverlay('v1', 'crop')
    const html = await render('v1', { videoUrl: 'blob:v', videoWidth: 1600, videoHeight: 800 })
    expect(html).not.toContain('确认')
    expect(html).not.toContain('取消')
    // 浮层里唯一的按钮是四个方形控制点（它们本来就该是可聚焦的按钮，见无障碍要求）。
    // 这里数一下数量：只有 4 个控制点，没有多出来的操作按钮。
    const handleButtons = html.match(/class="mfo-handle"/g) ?? []
    expect(handleButtons).toHaveLength(4)
    endOverlay('v1')
  })

  it('退出裁剪 → 浮层消失', async () => {
    beginOverlay('v1', 'crop')
    endOverlay('v1')
    const html = await render('v1', { videoUrl: 'blob:v', videoWidth: 1600, videoHeight: 800 })
    expect(html).not.toContain('mfo-frame')
  })
})
