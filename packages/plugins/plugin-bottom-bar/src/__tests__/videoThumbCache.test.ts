/**
 * 视频缩略图缓存（用户 2026-10-28）：必须跨挂载复用，否则拖拽时反复截帧闪烁。
 * 第三轮口径：只存一张图（宽度上限 1080，保持原比例），卡片/标签/hover 共用。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { peekVideoThumb, ensureVideoThumb, __clearVideoThumbCache, VIDEO_THUMB_MAX_WIDTH } from '../videoThumbCache'

afterEach(() => __clearVideoThumbCache())

describe('videoThumbCache', () => {
  it('同地址只截一次（第二次命中缓存）', async () => {
    const capture = vi.fn().mockResolvedValue('data:image/webp;base64,AAA')
    const a = await ensureVideoThumb('v.mp4', capture)
    const b = await ensureVideoThumb('v.mp4', capture)
    expect(a).toBe('data:image/webp;base64,AAA')
    expect(b).toBe(a)
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('取帧时只请求宽度上限 1080（不再分小图/大图）', async () => {
    const capture = vi.fn().mockResolvedValue('data:x')
    await ensureVideoThumb('v.mp4', capture)
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith('v.mp4', VIDEO_THUMB_MAX_WIDTH)
    expect(VIDEO_THUMB_MAX_WIDTH).toBe(1080)
  })

  it('同一视频的不同写法（绝对地址 / 相对路径）共用一份缓存', async () => {
    // Node 环境没有 location：临时补一个同源地址，模拟浏览器里的实际情况
    vi.stubGlobal('location', { origin: 'http://localhost:8012' })
    const capture = vi.fn().mockResolvedValue('data:one')
    await ensureVideoThumb('/api/a.mp4', capture)
    expect(peekVideoThumb('http://localhost:8012/api/a.mp4')).toBe('data:one')
    expect(capture).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('并发请求同一视频只解一次码', async () => {
    const capture = vi.fn().mockResolvedValue('data:x')
    await Promise.all([
      ensureVideoThumb('v.mp4', capture),
      ensureVideoThumb('v.mp4', capture),
      ensureVideoThumb('v.mp4', capture),
    ])
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('取帧失败不留缓存（下次还能重试）', async () => {
    const capture = vi.fn().mockResolvedValue(null)
    expect(await ensureVideoThumb('v.mp4', capture)).toBeNull()
    expect(peekVideoThumb('v.mp4')).toBeUndefined()
  })

  it('没有取帧能力 → null，不崩', async () => {
    expect(await ensureVideoThumb('v.mp4', undefined)).toBeNull()
  })
})

