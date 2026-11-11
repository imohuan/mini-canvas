/**
 * 引用标签的缩略图解析（用户 2026-11-06：标签里要能看到内容，不再只有类型图标）。
 *
 * 这里钉住三条容易写坏的规则：
 *   ① 图片地址能直接当图用；视频 mp4 不行，只能走视频插件的统一首帧；
 *   ② 视频服务没装 / 取不到时返回 null，调用方保留类型图标（不能画出裂图）；
 *   ③ 同一段视频只真取一次（重渲染很频繁，重复解码会把面板卡住）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  peekAgentVideoThumb,
  ensureAgentVideoThumb,
  mediaKindOfExt,
  __clearAgentChipThumbs,
} from '../ui/shared/agentChipThumbs'
import type { Context } from '@plume-canvas/canvas-base'

/** 造一个只实现 tryGet 的最小 ctx（本模块只需要它找 video 服务） */
function ctxWith(video: unknown): Context {
  return { tryGet: (name: string) => (name === 'video' ? video : undefined) } as unknown as Context
}

beforeEach(() => __clearAgentChipThumbs())

describe('扩展名 → 标签类型', () => {
  it('图片 / 视频 / 音频各自认得出来', () => {
    expect(mediaKindOfExt('PNG')).toBe('image')
    expect(mediaKindOfExt('jpeg')).toBe('image')
    expect(mediaKindOfExt('webp')).toBe('image')
    expect(mediaKindOfExt('mp4')).toBe('video')
    expect(mediaKindOfExt('mov')).toBe('video')
    expect(mediaKindOfExt('mp3')).toBe('audio')
    expect(mediaKindOfExt('wav')).toBe('audio')
  })

  it('认不出的（文本 / 文件夹 / 没有扩展名）落到 other', () => {
    expect(mediaKindOfExt('txt')).toBe('other')
    expect(mediaKindOfExt('')).toBe('other')
    expect(mediaKindOfExt(undefined)).toBe('other')
  })
})

describe('视频首帧', () => {
  it('取到后能同步读出来（渲染时要用同步值）', async () => {
    const ctx = ctxWith({ thumb: async () => 'data:image/png;base64,AAA' })
    expect(peekAgentVideoThumb('/api/assets/files/v.mp4')).toBeUndefined()
    expect(await ensureAgentVideoThumb(ctx, '/api/assets/files/v.mp4')).toBe('data:image/png;base64,AAA')
    expect(peekAgentVideoThumb('/api/assets/files/v.mp4')).toBe('data:image/png;base64,AAA')
  })

  it('同一段视频只取一次（并发也只发一次请求）', async () => {
    let calls = 0
    const ctx = ctxWith({
      thumb: async () => {
        calls++
        return 'data:image/png;base64,BBB'
      },
    })
    const [a, b] = await Promise.all([
      ensureAgentVideoThumb(ctx, '/v.mp4'),
      ensureAgentVideoThumb(ctx, '/v.mp4'),
    ])
    await ensureAgentVideoThumb(ctx, '/v.mp4')
    expect(a).toBe('data:image/png;base64,BBB')
    expect(b).toBe(a)
    expect(calls).toBe(1)
  })

  it('同源绝对地址与相对地址共用一份缓存（底栏 / 抽屉 / 面板给的不是同一个写法）', async () => {
    let calls = 0
    const ctx = ctxWith({
      thumb: async () => {
        calls++
        return 'data:image/png;base64,CCC'
      },
    })
    // 浏览器里同源地址会被折成 path+search；node 环境没有 location，这里补一个
    vi.stubGlobal('location', { origin: 'http://localhost:5289' })
    await ensureAgentVideoThumb(ctx, '/v.mp4')
    await ensureAgentVideoThumb(ctx, 'http://localhost:5289/v.mp4')
    vi.unstubAllGlobals()
    expect(calls).toBe(1)
  })

  it('视频插件没装 / 取图失败：返回 null，不缓存裂图，标签保留类型图标', async () => {
    expect(await ensureAgentVideoThumb(ctxWith(undefined), '/v.mp4')).toBeNull()
    const boom = ctxWith({
      thumb: async () => {
        throw new Error('decode failed')
      },
    })
    expect(await ensureAgentVideoThumb(boom, '/v2.mp4')).toBeNull()
    expect(peekAgentVideoThumb('/v2.mp4')).toBeUndefined()
  })

  it('没有地址时不调用服务', async () => {
    let calls = 0
    const ctx = ctxWith({ thumb: async () => (calls++, 'x') })
    expect(await ensureAgentVideoThumb(ctx, '')).toBeNull()
    expect(await ensureAgentVideoThumb(ctx, undefined)).toBeNull()
    expect(calls).toBe(0)
  })
})
