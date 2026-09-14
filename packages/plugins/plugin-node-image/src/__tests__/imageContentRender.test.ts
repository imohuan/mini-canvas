/**
 * ImageContent 渲染契约（SSR 拿真 HTML 断言）。
 *
 * 用户报的缺陷（原话）："你的图片节点显示有些问题，横屏图片 宽度大了几像素， 竖屏高度大了几像素"。
 *
 * 用内置浏览器实测复现了：横屏图卡片外框 420×236 而图片只画到 416×234（左右各留 2px）；
 * 竖屏图卡片外框 169×300 而图片只画到 167×296.9（上下各留约 1.6px）。
 *
 * 根因：卡片是 `border-box` 且带 1px 边框 —— 边框会从声明尺寸里扣掉，于是**内容区**比
 * "按图片比例算出来的卡片尺寸"矮胖了一点（差 2px），`object-fit: contain` 在比例不吻合的框里
 * 必然留白（谁是被约束的那一边就在另一边留白）。所以只要用 contain，"节点比图片大几像素"就消不掉。
 *
 * 修法：平时让图片**铺满**（`cover`，与老版 ImageNode 的 `object-cover` 一致）—— 图片填满节点，
 * 外框即图片边界，不留空隙；因为卡片尺寸本来就是按图片比例算的，被裁掉的只是那 1px 边框的量。
 *
 * 但**裁剪时必须切回 `contain`**：裁剪覆盖层的遮罩与裁剪框是按 object-contain 几何算出来的
 * （ImageCropper 的 computeFit），它底下就是这张图片。若裁剪时图片仍铺满，两者就对不上 ——
 * 遮罩会把有画面的地方涂黑、裁剪框也会指向错误的像素区域，裁出来的内容将不是用户框选的那块。
 *
 * 本文件锁住这两态：平时铺满（无空隙）、裁剪时完整可见（几何一致）。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import ImageContent from '../ImageContent.vue'
import { beginCrop, endCrop } from '../cropSession'

const IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"/>')

/** 最小渲染上下文：ImageContent 还要用 ctx.get('image')/('nodeStore')/('graph') 与 settings */
function renderCtx(): CanvasRenderContext {
  const services: Record<string, unknown> = {
    image: {},
    nodeStore: { getNode: () => undefined },
    graph: { updateNode: () => {} },
    settings: { get: () => undefined, onChange: () => ({ dispose: () => {} }) },
  }
  return {
    ctx: { get: (name: string) => services[name] },
    viewport: { value: { zoom: 1 } },
  } as unknown as CanvasRenderContext
}

function render(id: string, data: Record<string, unknown>): Promise<string> {
  const app = createSSRApp({ render: () => h(ImageContent as Component, { id, data }) })
  app.provide(RENDER_CONTEXT_KEY, renderCtx())
  return renderToString(app)
}

/** 取出页面里那张图片的标签 */
function imgTag(html: string): string {
  const m = html.match(/<img[^>]*>/)
  if (!m) throw new Error('渲染结果里找不到图片元素')
  return m[0]
}

describe('平时：图片铺满节点（不留空隙）', () => {
  it('横屏图：图片以"铺满"方式渲染，不再用 contain 留白', async () => {
    const html = await render('n1', { imageUrl: IMG, imageWidth: 1600, imageHeight: 900, cardWidth: 420, cardHeight: 236 })
    const tag = imgTag(html)
    expect(tag).toContain('is-fill-cover')
    expect(tag).not.toContain('is-fill-contain')
  })

  it('竖屏图：同样是铺满（用户报的就是竖屏上下各留了几像素）', async () => {
    const html = await render('n1', { imageUrl: IMG, imageWidth: 900, imageHeight: 1600, cardWidth: 169, cardHeight: 300 })
    expect(imgTag(html)).toContain('is-fill-cover')
  })

  it('图片元素仍然只有一个、且带节点图片的可达性标识（改填充方式不该动结构）', async () => {
    const html = await render('n1', { imageUrl: IMG })
    expect(html.match(/<img/g)?.length).toBe(1)
    expect(imgTag(html)).toContain('alt="节点图片"')
  })
})

describe('裁剪中：图片切回完整可见（与裁剪框几何一致）', () => {
  it('进入裁剪 → 图片用 contain（遮罩/裁剪框按 contain 几何算，必须对齐）', async () => {
    beginCrop('n1')
    const html = await render('n1', { imageUrl: IMG, imageWidth: 1600, imageHeight: 900, cardWidth: 420, cardHeight: 236 })
    const tag = imgTag(html)
    expect(tag).toContain('is-fill-contain')
    expect(tag).not.toContain('is-fill-cover')
    endCrop('n1')
  })

  it('退出裁剪 → 回到铺满', async () => {
    beginCrop('n1')
    endCrop('n1')
    const html = await render('n1', { imageUrl: IMG, imageWidth: 1600, imageHeight: 900 })
    expect(imgTag(html)).toContain('is-fill-cover')
  })
})

describe('空态与失效态不受影响', () => {
  it('没有图片 → 显示"（无图片）"，不渲染 img', async () => {
    const html = await render('n1', {})
    expect(html).toContain('（无图片）')
    expect(html).not.toContain('<img')
  })
})
