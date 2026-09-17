/**
 * VideoContent / VideoCropper 的渲染契约（SSR 拿真 HTML 断言）。
 *
 * 为什么必须测模板层（而不是只测纯函数）：几何算对、模板接错字段，画面照样错位 ——
 * 这是图片节点那轮实测踩过的坑（几何正确但模板写错字段）。这里锁住三件"看得见"的事：
 *
 * 1. **裁过的节点按框取景**：视频元素必须带上 croppedVideoStyle 给的放大与偏移 ——
 *    这是"裁剪到底有没有生效"在 DOM 上的唯一证据；
 * 2. **裁剪中显示完整画面**：裁剪时那个 style 必须消失（否则用户看不到框外内容、没法调框）；
 * 3. **失效态与空态**：链接失效（会话级 objectURL 刷新）与"无视频"要如实显示，而不是白屏。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, RenderEvents, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import VideoContent from '../VideoContent.vue'
import { beginOverlay, endOverlay } from '../videoSession'

const VIDEO = 'blob:mock-video'

/** 最小渲染上下文：组件还要用 ctx.get('nodeStore'/'graph'/'command'/'settings') 与 ctx.on */
function renderCtx(): CanvasRenderContext {
  const services: Record<string, unknown> = {
    nodeStore: { getNode: () => undefined, getNodes: () => [] },
    graph: { updateNode: () => {} },
    command: { execute: () => undefined },
    settings: { get: () => undefined, onChange: () => ({ dispose: () => {} }) },
  }
  return {
    ctx: { get: (name: string) => services[name], on: () => ({ dispose: () => {} }) },
    viewport: { value: { zoom: 1 } },
  } as unknown as CanvasRenderContext
}

function render(id: string, data: Record<string, unknown>): Promise<string> {
  const app = createSSRApp({ render: () => h(VideoContent as Component, { id, data }) })
  app.provide(RENDER_CONTEXT_KEY, renderCtx())
  return renderToString(app)
}

/** 取出页面里那个 video 标签 */
function videoTag(html: string): string {
  const m = html.match(/<video[^>]*>/)
  if (!m) throw new Error('渲染结果里找不到 video 元素')
  return m[0]
}

describe('裁过的节点：视频按框取景（放大 + 偏移）', () => {
  it('裁剪框写进视频元素的 style —— 这是裁剪生效在 DOM 上的唯一证据', async () => {
    const html = await render('v1', {
      videoUrl: VIDEO,
      videoWidth: 1600,
      videoHeight: 800,
      cropRect: { x: 400, y: 200, width: 800, height: 400 },
    })
    const tag = videoTag(html)
    // 1600/800 = 200%；-400/800 = -50%；-200/400 = -50%
    expect(tag).toContain('width:200%')
    expect(tag).toContain('height:200%')
    expect(tag).toContain('left:-50%')
    expect(tag).toContain('top:-50%')
  })

  it('没裁过 → 视频元素不带放大/偏移（就是铺满卡片的那块）', async () => {
    const html = await render('v1', { videoUrl: VIDEO, videoWidth: 1600, videoHeight: 800 })
    const tag = videoTag(html)
    expect(tag).not.toContain('width:200%')
    expect(tag).not.toContain('left:-50%')
  })

  it('裁剪框脏数据（零尺寸）→ 视为没裁，不输出会算出 NaN 的样式', async () => {
    const html = await render('v1', {
      videoUrl: VIDEO,
      videoWidth: 1600,
      videoHeight: 800,
      cropRect: { x: 0, y: 0, width: 0, height: 0 },
    })
    expect(videoTag(html)).not.toContain('width:0%')
  })
})

describe('裁剪中：显示完整画面（否则没法调框）', () => {
  it('进入裁剪 → 取景样式消失（画面必须完整可见）', async () => {
    beginOverlay('v1', 'crop')
    const html = await render('v1', {
      videoUrl: VIDEO,
      videoWidth: 1600,
      videoHeight: 800,
      cropRect: { x: 400, y: 200, width: 800, height: 400 },
    })
    const tag = videoTag(html)
    // 裁剪中必须看到整幅画面：不能带放大/偏移
    expect(tag).not.toContain('width:200%')
    expect(tag).not.toContain('left:-50%')
    endOverlay('v1')
  })

  it('退出裁剪 → 取景样式回来', async () => {
    beginOverlay('v1', 'crop')
    endOverlay('v1')
    const html = await render('v1', {
      videoUrl: VIDEO,
      videoWidth: 1600,
      videoHeight: 800,
      cropRect: { x: 400, y: 200, width: 800, height: 400 },
    })
    expect(videoTag(html)).toContain('width:200%')
  })

  it('裁剪中不渲染播放控件（免得和裁剪手势抢）', async () => {
    beginOverlay('v1', 'crop')
    const html = await render('v1', { videoUrl: VIDEO, videoWidth: 1600, videoHeight: 800 })
    expect(html).not.toContain('video-controls')
    endOverlay('v1')
  })
})

describe('播放控件与可达性', () => {
  it('有视频时渲染播放/进度/截图/全屏，且纯图标按钮都有 title + aria-label', async () => {
    const html = await render('v1', { videoUrl: VIDEO, videoWidth: 1280, videoHeight: 720 })
    expect(html).toContain('video-controls')
    expect(html).toContain('aria-label="播放"')
    expect(html).toContain('aria-label="播放进度"')
    expect(html).toContain('aria-label="截取当前帧"')
    expect(html).toContain('aria-label="全屏播放"')
  })

  it('进度按"剪辑段内"显示（用户看到的该是自己剪出来的那段时间轴）', async () => {
    const html = await render('v1', {
      videoUrl: VIDEO,
      videoWidth: 1280,
      videoHeight: 720,
      videoDuration: 60,
      clipStart: 10,
      clipEnd: 40,
    })
    // 保留时长 = 30s = 0:30（不是总时长 1:00）
    expect(html).toContain('0:30')
  })

  it('元信息标签显示尺寸（裁过显示裁框尺寸 —— 那就是用户看到的画面）', async () => {
    const html = await render('v1', {
      videoUrl: VIDEO,
      videoWidth: 1280,
      videoHeight: 720,
      cropRect: { x: 0, y: 0, width: 640, height: 480 },
    })
    expect(html).toContain('640×480')
  })
})

describe('空态与失效态', () => {
  it('没有视频 → 显示"（无视频）"，不渲染 video 元素', async () => {
    const html = await render('v1', {})
    expect(html).toContain('（无视频）')
    expect(html).not.toContain('<video')
  })

  it('失效不会在首次渲染就出现（它是会话事实，由播放报错触发）', async () => {
    const html = await render('v1', { videoUrl: VIDEO })
    expect(html).not.toContain('视频已失效')
  })
})
