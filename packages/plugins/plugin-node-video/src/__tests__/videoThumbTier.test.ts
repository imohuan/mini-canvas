/**
 * 视频帧图：**规则**与**关键行为**的契约。
 *
 * 分两段：
 * 1. 纯逻辑（videoThumbTier / videoThumbCanvas.fitFrameIntoBox）—— 档位边界、
 *    "第三档必须够得着"、目标框（第 1 档 = 原生尺寸）、等比装框只缩不放；
 * 2. 组件行为（SSR）—— 帧图是**浏览器里异步抓**的，SSR 抓不出来，所以断言的是
 *    用户那条硬要求：**未播放时不挂 video 元素**（"只有点播放才真正加载视频"），
 *    且不留空 src。
 *
 * 真实抓帧、点播放后挂 video、鼠标离开回帧图 —— 都要真浏览器，由 e2e 覆盖
 * （见 STATUS 里的实测记录）。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import VideoContent from '../VideoContent.vue'
import {
  DEFAULT_VIDEO_THUMB_TIERS,
  readVideoThumbTiers,
  resolveVideoThumbTier,
  resolveVideoThumbTiers,
  videoThumbTargetFor,
  videoThumbTierFields,
  videoThumbTierKeys,
} from '../videoThumbTier'
import { fitFrameIntoBox, resolveFrameView } from '../videoThumbCanvas'
import { frameRefParamFor, makeFrameRef } from '../videoThumbKey'

const VIDEO = '/api/canvases/c1/resources/c798226d6387af67.mp4'

function renderCtx(zoom: number): CanvasRenderContext {
  const services: Record<string, unknown> = {
    nodeStore: { getNode: () => undefined, getNodes: () => [] },
    graph: { updateNode: () => {} },
    command: { execute: () => undefined },
    settings: { get: () => undefined, onChange: () => ({ dispose: () => {} }) },
  }
  return {
    ctx: { get: (name: string) => services[name], on: () => ({ dispose: () => {} }) },
    flow: { viewport: { value: { zoom } } },
    // 可视区闸门（生成帧图前会问一句"这个节点在不在视野里"）
    visibleNodes: () => [{ id: 'v1', x: 0, y: 0, w: 100, h: 100 }],
  } as unknown as CanvasRenderContext
}

function render(id: string, data: Record<string, unknown>, zoom = 1): Promise<string> {
  const app = createSSRApp({ render: () => h(VideoContent as Component, { id, data }) })
  app.provide(RENDER_CONTEXT_KEY, renderCtx(zoom))
  return renderToString(app)
}

const DATA = { videoUrl: VIDEO, videoWidth: 1600, videoHeight: 800 }

describe('三档判定：边界', () => {
  it('默认阈值 0.45 / 0.3', () => {
    expect(resolveVideoThumbTier(1)).toBe(1)
    expect(resolveVideoThumbTier(0.45)).toBe(1)
    expect(resolveVideoThumbTier(0.44)).toBe(2)
    expect(resolveVideoThumbTier(0.3)).toBe(2)
    expect(resolveVideoThumbTier(0.29)).toBe(3)
  })

  it('非法 zoom 按第 1 档', () => {
    for (const bad of [NaN, Infinity, 0, -1, undefined]) expect(resolveVideoThumbTier(bad)).toBe(1)
  })

  it('★ 第三档阈值必须高于画布最小缩放（否则这一档够不着）', () => {
    const CANVAS_MIN_ZOOM = 0.2
    expect(DEFAULT_VIDEO_THUMB_TIERS.tier3Zoom).toBeGreaterThan(CANVAS_MIN_ZOOM)
    expect(resolveVideoThumbTier(CANVAS_MIN_ZOOM)).toBe(3)
    const bad = { ...DEFAULT_VIDEO_THUMB_TIERS, tier3Zoom: CANVAS_MIN_ZOOM }
    expect(resolveVideoThumbTier(CANVAS_MIN_ZOOM, bad)).toBe(2)
  })

  it('★ minZoom 兜底：阈值配得再小，缩到最小也能进第三档', () => {
    const weird = { ...DEFAULT_VIDEO_THUMB_TIERS, tier3Zoom: 0.05 }
    expect(resolveVideoThumbTier(0.2, weird)).toBe(2)
    expect(resolveVideoThumbTier(0.2, weird, 0.2)).toBe(3)
  })
})

describe('目标框：视频与图片的差别（第 1 档也要框）', () => {
  it('第 1 档 = 原生尺寸（不是 null）—— 因为第 1 档也要真生成一张帧图', () => {
    expect(videoThumbTargetFor(1, DEFAULT_VIDEO_THUMB_TIERS, { width: 1600, height: 800 })).toEqual({
      width: 1600,
      height: 800,
    })
  })

  it('第二三档给配置的框', () => {
    expect(videoThumbTargetFor(2)).toEqual({ width: 512, height: 512 })
    expect(videoThumbTargetFor(3)).toEqual({ width: 160, height: 160 })
  })

  it('fitFrameIntoBox：等比、只缩不放', () => {
    expect(fitFrameIntoBox(1920, 1080, { width: 512, height: 512 })).toEqual({ width: 512, height: 288 })
    expect(fitFrameIntoBox(1600, 800, { width: 1600, height: 800 })).toEqual({ width: 1600, height: 800 })
    expect(fitFrameIntoBox(100, 50, { width: 512, height: 512 })).toEqual({ width: 100, height: 50 })
    expect(fitFrameIntoBox(0, 0, { width: 512, height: 512 })).toBeNull()
    expect(fitFrameIntoBox(undefined, 100, { width: 512, height: 512 })).toBeNull()
  })

  // ★ 回归：帧图曾经变成"裁剪放大图"（用户实测报的「它已经变成了裁剪，而不是整个图片缩小」）
  describe('取景（裁剪）与缩放必须分开', () => {
    it('没裁过 → 抓帧不传 crop（null = 整幅），缩放按整幅算', () => {
      const { crop, view } = resolveFrameView(null, 1280, 720)
      expect(crop).toBeNull() // ← 关键：绝不能把"目标尺寸"当 crop 传下去
      expect(view).toEqual({ width: 1280, height: 720 })
    })

    it('裁过 → 抓帧用裁框，缩放按裁框算（取景生效但仍整体缩，不是再裁一刀）', () => {
      const rect = { x: 300, y: 100, width: 600, height: 400 }
      const { crop, view } = resolveFrameView(rect, 1280, 720)
      expect(crop).toEqual(rect)
      expect(view).toEqual({ width: 600, height: 400 })
      // 缩放比例按裁框（600 宽）算，不是按整幅（1280）
      expect(fitFrameIntoBox(view.width, view.height, { width: 512, height: 512 })).toEqual({ width: 512, height: 341 })
    })

    it('脏裁框（零尺寸 / undefined）→ 视为没裁（不裁出空画面）', () => {
      for (const bad of [undefined, { x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: -5, height: 10 }]) {
        expect(resolveFrameView(bad, 1280, 720).crop).toBeNull()
      }
    })

    it('★ 目标框只影响缩放比例，绝不出现在 crop 里', () => {
      // 这条是本 bug 的核心：crop 只该来自用户的裁剪框；
      // 目标尺寸（512×512）一旦被当成 crop，画面就被挖掉一块。
      const { crop } = resolveFrameView(null, 1280, 720)
      expect(crop).toBeNull()
      // 缩放目标不同 → 只影响 dest 尺寸，crop 始终是 null
      expect(fitFrameIntoBox(1280, 720, { width: 512, height: 512 })!.width).toBe(512)
      expect(fitFrameIntoBox(1280, 720, { width: 160, height: 160 })!.width).toBe(160)
    })
  })
})

describe('配置：视频与图片两套独立', () => {
  it('键名带前缀且互不影响', () => {
    const store: Record<string, unknown> = { videoTier2Width: 1024, imageTier2Width: 512 }
    expect(resolveVideoThumbTiers('video', (k) => store[k]).tier2Width).toBe(1024)
    expect(resolveVideoThumbTiers('image', (k) => store[k]).tier2Width).toBe(DEFAULT_VIDEO_THUMB_TIERS.tier2Width)
  })

  // ★ 回归（2026-10-15 用户实测）：「我这边在配置中重新设置了最大宽高……
  //   它依然使用的是之前的图片」—— 名字没带尺寸，改了宽高仍命中旧缓存。
  describe('引用名必须把所有影响内容的参数都编进去', () => {
    it('改了目标宽高 → 名字不同（否则会一直用旧图）', () => {
      const a = frameRefParamFor(2, 1, 512, 512, 0.8)
      const b = frameRefParamFor(2, 1, 1024, 1024, 0.8)
      expect(a).not.toBe(b)
    })

    it('改了质量 → 名字不同', () => {
      expect(frameRefParamFor(2, 1, 512, 512, 0.8)).not.toBe(frameRefParamFor(2, 1, 512, 512, 0.5))
    })

    it('档位 / 时刻不同 → 名字不同（各自命中、互不覆盖）', () => {
      expect(frameRefParamFor(1, 1, 512, 512, 0.8)).not.toBe(frameRefParamFor(2, 1, 512, 512, 0.8))
      expect(frameRefParamFor(1, 1, 512, 512, 0.8)).not.toBe(frameRefParamFor(1, 5, 512, 512, 0.8))
    })

    it('参数完全一样 → 名字一样（命中才可能发生）', () => {
      expect(frameRefParamFor(2, 1.5, 512, 512, 0.8)).toBe(frameRefParamFor(2, 1.5, 512, 512, 0.8))
    })

    it('名字仍在服务端允许的字符集内（只含字母数字与 _ -）', () => {
      const ref = makeFrameRef('vid', '/api/canvases/c1/resources/abcd1234.mp4', frameRefParamFor(2, 1.25, 512, 512, 0.8))!
      expect(ref).toMatch(/^[A-Za-z0-9_-]+$/)
    })
  })

  it('读不到 → 全默认', () => {
    expect(readVideoThumbTiers('video', undefined)).toEqual(DEFAULT_VIDEO_THUMB_TIERS)
  })

  it('字段与键名一一对应', () => {
    const fields = videoThumbTierFields('video', '节点/缩略图', '视频')
    expect(Object.keys(fields).sort()).toEqual(videoThumbTierKeys('video').sort())
    expect(Object.keys(fields)).toHaveLength(7)
  })
})

describe('组件行为：未播放时绝不挂 video 元素', () => {
  it('SSR（抓不出帧图）→ 不渲染 video（"只有点播放才真正加载视频"）', async () => {
    const html = await render('v1', DATA, 0.1)
    expect(html).not.toContain('<video')
  })

  it('不留空 src（不渲染 img 也好过渲染一个空地址）', async () => {
    const html = await render('v1', DATA, 0.2)
    expect(html).not.toContain('src=""')
  })

  it('没有视频 → 空态，且不渲染任何画面元素', async () => {
    const html = await render('v1', {})
    expect(html).toContain('（无视频）')
    expect(html).not.toContain('<video')
    expect(html).not.toContain('<img')
  })

  it('外链 / 本地引用都能正常渲染（不崩、不空 src）', async () => {
    for (const url of ['https://cdn.example.com/a.mp4', 'res-1-uuid']) {
      const html = await render('v1', { ...DATA, videoUrl: url })
      expect(html).not.toContain('<video')
      expect(html).not.toContain('src=""')
    }
  })
})

