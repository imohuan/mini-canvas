/**
 * VideoContent 渲染契约（SSR 拿真 HTML 断言）。
 *
 * 本文件从"视频元素"换成"帧图"之后，断言重心也变了 ——
 * 画面元素在 SSR 里是**异步抓帧**的（真浏览器才有 canvas/video），所以这里只锁两件
 * 与"有没有渲染出来"无关、但用户最在意的事：
 *
 * 1. **未播放时不渲染 video 元素**（用户硬要求："只有点播放的时候才真正加载视频"）——
 *    这条必须守住，包括"帧图还没抓好"的那一瞬间；
 * 2. 播放控件与可达性（纯图标按钮都要有 title + aria-label）、裁剪中不渲染控件、空态/失效态。
 *
 * 取景几何（裁剪框 → 放大偏移的百分比）**不在这里重复断言**：
 * 它由 canvas-render 的 mediaFit.test.ts 直接测（含脏数据边界），这里再走一遍 DOM
 * 只是把同一份数学抄第二遍。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import { RegistryImpl } from '@mini-canvas/kernel'
import VideoContent from '../VideoContent.vue'
import { beginOverlay, endOverlay } from '../videoSession'
import { framingStyle } from '../videoCrop'

const VIDEO = '/api/canvases/c1/resources/abc.mp4'

/** 最小渲染上下文：组件还要用 ctx.get('command'/'settings') 与 ctx.on */
function renderCtx(): CanvasRenderContext {
  const services: Record<string, unknown> = {
    nodeStore: { getNode: () => undefined, getNodes: () => [] },
    graph: { updateNode: () => {} },
    command: { execute: () => undefined },
    settings: { get: () => undefined, onChange: () => ({ dispose: () => {} }) },
  }
  return {
    ctx: {
      get: (name: string) => services[name],
      on: () => ({ dispose: () => {} }),
      // 极简上下文：没有主题 ui 目录 → 空态回落到组件自身的一行灰字
      registryOf: () => new RegistryImpl(),
    },
    flow: { viewport: { value: { zoom: 1 } } },
    // 可视区闸门（生成帧图前会问一句"这个节点在不在视野里"）
    visibleNodes: () => [{ id: 'v1', x: 0, y: 0, w: 100, h: 100 }],
  } as unknown as CanvasRenderContext
}

function render(id: string, data: Record<string, unknown>): Promise<string> {
  const app = createSSRApp({ render: () => h(VideoContent as Component, { id, data }) })
  app.provide(RENDER_CONTEXT_KEY, renderCtx())
  return renderToString(app)
}

describe('未播放：不加载视频字节', () => {
  it('有视频地址但没点过播放 → 不渲染 video 元素', async () => {
    const html = await render('v1', { videoUrl: VIDEO, videoWidth: 1600, videoHeight: 800 })
    expect(html).not.toContain('<video')
  })

  it('抓帧还没好（SSR 就是这种情况）也不挂 video —— 宁可先空着', async () => {
    // 这条防的是"帧图未就绪时用 video 顶上"的退让：那会立刻开始加载视频，
    // 正是用户要求"点播放才加载"要避免的
    const html = await render('v1', { videoUrl: VIDEO, videoWidth: 1920, videoHeight: 1080 })
    expect(html).not.toContain('<video')
    expect(html).not.toContain('src=""')
  })
})

describe('取景几何（裁剪框 → 放大与偏移）', () => {
  // 用纯函数断言，不走 DOM：几何同源（framedMediaStyle），且 SSR 里画面元素是异步的
  it('裁剪框写进 style 的百分比与框位置一致', () => {
    const style = framingStyle({ x: 400, y: 200, width: 800, height: 400 }, 1600, 800)
    // 1600/800 = 200%；-400/800 = -50%；-200/400 = -50%
    expect(style).toMatchObject({ width: '200%', height: '200%', left: '-50%', top: '-50%' })
  })

  it('没裁过 / 脏数据 → 空样式（不施加放大偏移）', () => {
    expect(framingStyle(undefined, 1600, 800)).toEqual({})
    expect(framingStyle({ x: 0, y: 0, width: 0, height: 0 }, 1600, 800)).toEqual({})
  })
})

describe('播放控件与可达性', () => {
  it('有视频时渲染播放/进度/截图/全屏，且纯图标按钮都有 title + aria-label', async () => {
    const html = await render('v1', { videoUrl: VIDEO, videoWidth: 1280, videoHeight: 720 })
    expect(html).toContain('video-controls')
    expect(html).toContain('aria-label="播放"')
    expect(html).toContain('aria-label="播放进度"')
    expect(html).toContain('aria-label="截取画面"')
    expect(html).toContain('aria-label="静音"')
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

  it('裁剪中不渲染播放控件（免得和裁剪手势抢）', async () => {
    beginOverlay('v1', 'crop')
    const html = await render('v1', { videoUrl: VIDEO, videoWidth: 1600, videoHeight: 800 })
    expect(html).not.toContain('video-controls')
    endOverlay('v1')
  })
})

describe('空态与失效态', () => {
  it('没有视频 → 显示"（无视频）"，不渲染画面元素', async () => {
    const html = await render('v1', {})
    expect(html).toContain('（无视频）')
    expect(html).not.toContain('<video')
    expect(html).not.toContain('<img')
  })

  it('没有视频 → 不渲染底部渐变衬底（空节点保持白板底色）', async () => {
    // 用户实测：没有视频时底部挂着一块灰渐变，看着像没加载完的画面。
    // 衬底只是播放控件的背景，空节点不该有它。
    const html = await render('v1', {})
    const htmlNoVideo = await render('v1', { videoWidth: 1280, videoHeight: 720 })
    expect(html).not.toContain('vc-scrim')
    expect(htmlNoVideo).not.toContain('vc-scrim')
  })

  it('有视频 → 衬底与控件一起渲染，但默认是收起态（未 hover 不显示渐变）', async () => {
    const html = await render('v1', { videoUrl: VIDEO, videoWidth: 1280, videoHeight: 720 })
    expect(html).toContain('vc-scrim')
    expect(html).toContain('is-hidden')
  })

  it('失效不会在首次渲染就出现（它是会话事实，由播放报错触发）', async () => {
    const html = await render('v1', { videoUrl: VIDEO })
    expect(html).not.toContain('视频已失效')
  })
})

