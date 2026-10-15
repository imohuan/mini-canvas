/**
 * 图片节点分档显示：**规则**与**回落**的契约。
 *
 * 分两段测：
 * 1. 纯逻辑（thumbTier / thumbCanvas 的 fitIntoBox）—— 档位边界、坏配置收敛、
 *    以及"第三档必须够得着"这条用户实测踩过的坑；
 * 2. 组件行为（SSR）—— 小图是**异步现画**的，SSR 里画不出来，所以断言的是
 *    **回落**：任何情况下都显示原图地址、不留空 src（"画不出来也不会变空白"）。
 *
 * 为什么不在这里断言"第二档确实换了小图"：那需要真 canvas（浏览器）。SSR 环境没有
 * document/canvas，走了也是回落原图 —— 真机验证由 e2e 脚本负责（见 STATUS 里的实测记录）。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import ImageContent from '../ImageContent.vue'
import { beginCrop, endCrop } from '../cropSession'
import {
  DEFAULT_THUMB_TIERS,
  readThumbTiers,
  resolveThumbTier,
  resolveThumbTiers,
  thumbTargetFor,
  thumbTierFields,
  thumbTierKeys,
} from '../thumbTier'
import { fitIntoBox } from '../thumbCanvas'
import { makeThumbRef, thumbRefParam } from '../thumbKey'

const SRC = '/api/canvases/c1/resources/9f2c1a77b3d45e10.png'

/** 最小渲染上下文（带 flow.viewport：分档显示读当前缩放） */
function renderCtx(zoom: number): CanvasRenderContext {
  const services: Record<string, unknown> = {
    image: {},
    doc: { getNode: () => undefined, updateNode: () => {}, updateNodeData: () => {} },
    settings: { get: () => undefined, onChange: () => ({ dispose: () => {} }) },
  }
  return {
    ctx: { get: (name: string) => services[name] },
    flow: { viewport: { value: { zoom } } },
    // 可视区闸门（生成小图前会问一句"这个节点在不在视野里"）
    visibleNodes: () => [{ id: 'n1', x: 0, y: 0, w: 100, h: 100 }],
  } as unknown as CanvasRenderContext
}

function render(id: string, data: Record<string, unknown>, zoom = 1): Promise<string> {
  const app = createSSRApp({ render: () => h(ImageContent as Component, { id, data }) })
  app.provide(RENDER_CONTEXT_KEY, renderCtx(zoom))
  return renderToString(app)
}

function imgSrc(html: string): string {
  const m = html.match(/<img[^>]*src="([^"]*)"/)
  if (!m) throw new Error('渲染结果里找不到图片元素')
  return m[1].replace(/&#x2F;/g, '/').replace(/&amp;/g, '&')
}

const DATA = { imageUrl: SRC, imageWidth: 1600, imageHeight: 900, cardWidth: 420, cardHeight: 236 }

describe('三档判定：边界', () => {
  it('默认阈值 0.45 / 0.3', () => {
    expect(resolveThumbTier(1)).toBe(1)
    expect(resolveThumbTier(0.45)).toBe(1) // 不小于阈值 = 第一档
    expect(resolveThumbTier(0.44)).toBe(2)
    expect(resolveThumbTier(0.3)).toBe(2)
    expect(resolveThumbTier(0.29)).toBe(3)
  })

  it('非法 zoom 一律按第一档（宁可正常显示，也不要因为坏数值变糊图）', () => {
    for (const bad of [NaN, Infinity, 0, -1, undefined, 'x' as unknown]) {
      expect(resolveThumbTier(bad)).toBe(1)
    }
  })

  it('★ 第三档阈值必须高于画布最小缩放，否则这一档够不着', () => {
    // 用户实测报的"只在第一档和第三档之间跳、没有第二档"就是这个：
    // 阈值曾写成 0.2 而画布 minZoom 也是 0.2 —— 缩不到阈值以下，第三档永远进不去。
    const CANVAS_MIN_ZOOM = 0.2
    expect(DEFAULT_THUMB_TIERS.tier3Zoom).toBeGreaterThan(CANVAS_MIN_ZOOM)
    expect(resolveThumbTier(CANVAS_MIN_ZOOM)).toBe(3)
    // 反例钉住：阈值等于 minZoom 时画布缩到最小仍停在第二档
    const bad = { ...DEFAULT_THUMB_TIERS, tier3Zoom: CANVAS_MIN_ZOOM }
    expect(resolveThumbTier(CANVAS_MIN_ZOOM, bad)).toBe(2)
  })

  it('★ minZoom 兜底：阈值配得再小，缩到最小也能进第三档', () => {
    const weird = { ...DEFAULT_THUMB_TIERS, tier3Zoom: 0.05 }
    expect(resolveThumbTier(0.2, weird)).toBe(2)
    expect(resolveThumbTier(0.2, weird, 0.2)).toBe(3)
    expect(resolveThumbTier(0.5, weird, 0.2)).toBe(1)
    expect(resolveThumbTier(0.2, weird, NaN)).toBe(2) // 非法 minZoom 不参与
  })
})

describe('目标框：第一档不生成', () => {
  it('第一档 null（原图，不该画一张同尺寸的图）', () => {
    expect(thumbTargetFor(1)).toBeNull()
  })

  it('第二三档给配置的框', () => {
    expect(thumbTargetFor(2)).toEqual({ width: 512, height: 512 })
    expect(thumbTargetFor(3)).toEqual({ width: 160, height: 160 })
  })

  it('fitIntoBox：等比装进去、只缩不放', () => {
    // 4000×3000 装进 512 框 → 512×384
    expect(fitIntoBox(4000, 3000, { width: 512, height: 512 })).toEqual({ width: 512, height: 384, scaled: true })
    // 本来就更小 → 原样（不放大会更糊、还更占内存）
    expect(fitIntoBox(100, 80, { width: 512, height: 512 })).toEqual({ width: 100, height: 80, scaled: false })
    // 竖图按高受限
    expect(fitIntoBox(900, 1600, { width: 512, height: 512 })).toEqual({ width: 288, height: 512, scaled: true })
  })

  it('fitIntoBox：源尺寸拿不到 → null（调用方据此跳过生成、继续用原图）', () => {
    expect(fitIntoBox(0, 0, { width: 512, height: 512 })).toBeNull()
    expect(fitIntoBox(NaN, 100, { width: 512, height: 512 })).toBeNull()
    expect(fitIntoBox(undefined, 100, { width: 512, height: 512 })).toBeNull()
  })
})

describe('配置：按前缀读、坏值各自回落', () => {
  it('图片与视频两套互不影响（键名带前缀，settings 是全局同一张表）', () => {
    const store: Record<string, unknown> = { imageTier2Width: 640, videoTier2Width: 1024 }
    expect(resolveThumbTiers('image', (k) => store[k]).tier2Width).toBe(640)
    expect(resolveThumbTiers('video', (k) => store[k]).tier2Width).toBe(1024)
  })

  it('读不到 → 全默认', () => {
    expect(readThumbTiers('image', undefined)).toEqual(DEFAULT_THUMB_TIERS)
    expect(resolveThumbTiers('image', () => undefined)).toEqual(DEFAULT_THUMB_TIERS)
  })

  it('第三档阈值配得比第二档大 → 夹到第二档（永远进不了第二档的配置被收敛掉）', () => {
    const cfg = resolveThumbTiers('image', (k) => ({ imageTier2Zoom: 0.3, imageTier3Zoom: 0.9 } as never)[k as never])
    expect(cfg.tier3Zoom).toBe(0.3)
  })

  it('字段与键名一一对应（写错键名 = 用户改了设置没反应）', () => {
    const fields = thumbTierFields('image', '节点/缩略图', '图片')
    expect(Object.keys(fields).sort()).toEqual(thumbTierKeys('image').sort())
    expect(Object.keys(fields)).toHaveLength(7)
    // 默认值就是判定实际用的默认
    expect(fields.imageTier3Zoom.default).toBe(DEFAULT_THUMB_TIERS.tier3Zoom)
  })
})

describe('组件回落：任何环境都不留空 src', () => {
  it('SSR（没有 canvas）→ 显示原图地址', async () => {
    expect(await imgSrc(await render('n1', DATA, 0.1))).toBe(SRC)
  })

  it('裁剪中 → 显示原图（浮层按原图像素算框）', async () => {
    beginCrop('n-crop')
    try {
      expect(await imgSrc(await render('n-crop', DATA, 0.1))).toBe(SRC)
    } finally {
      endCrop('n-crop')
    }
  })

  it('外链 / data: / 本地引用都能正常渲染（不因分档逻辑而崩）', async () => {
    for (const url of ['https://example.com/a.png', 'data:image/png;base64,AA', 'res-1-uuid']) {
      expect(await imgSrc(await render('n1', { ...DATA, imageUrl: url }, 0.2))).toBe(url)
    }
  })

  it('没有图片 → 空态，不渲染 img', async () => {
    const html = await render('n1', {}, 0.2)
    expect(html).toContain('（无图片）')
    expect(html).not.toContain('<img')
  })
})

// ★ 回归（2026-10-15 用户实测）：「我这边在配置中重新设置了最大宽高……
//   它依然使用的是之前的图片，宽高没有进行重新处理」—— 名字没带尺寸，改了宽高仍命中旧缓存。
describe('引用名必须把所有影响内容的参数都编进去', () => {
  it('改了目标宽高 → 名字不同（否则会一直用旧图）', () => {
    expect(thumbRefParam(2, 512, 512, 0.8)).not.toBe(thumbRefParam(2, 1024, 1024, 0.8))
  })

  it('只改高 / 只改宽也要变', () => {
    expect(thumbRefParam(2, 512, 512, 0.8)).not.toBe(thumbRefParam(2, 512, 300, 0.8))
    expect(thumbRefParam(2, 512, 512, 0.8)).not.toBe(thumbRefParam(2, 300, 512, 0.8))
  })

  it('改了质量 → 名字不同', () => {
    expect(thumbRefParam(2, 512, 512, 0.8)).not.toBe(thumbRefParam(2, 512, 512, 0.5))
  })

  it('档位不同 → 名字不同（各自命中、互不覆盖）', () => {
    expect(thumbRefParam(2, 512, 512, 0.8)).not.toBe(thumbRefParam(3, 512, 512, 0.8))
  })

  it('参数完全一样 → 名字一样（命中才可能发生）', () => {
    expect(thumbRefParam(2, 512, 512, 0.8)).toBe(thumbRefParam(2, 512, 512, 0.8))
  })

  it('名字仍在服务端允许的字符集内（只含字母数字与 _ -）', () => {
    const ref = makeThumbRef('img', '/api/canvases/c1/resources/abcd1234.png', thumbRefParam(2, 512, 512, 0.8))!
    expect(ref).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

