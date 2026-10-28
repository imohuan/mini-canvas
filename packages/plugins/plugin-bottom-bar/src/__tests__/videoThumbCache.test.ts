/** 视频缩略图缓存（用户 2026-10-28）：必须跨挂载复用，否则拖拽时反复截帧闪烁 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { peekVideoThumb, ensureVideoThumb, __clearVideoThumbCache } from '../videoThumbCache'

afterEach(() => __clearVideoThumbCache())

describe('videoThumbCache', () => {
  it('同地址同尺寸只截一次（第二次命中缓存）', async () => {
    const capture = vi.fn().mockResolvedValue('data:image/webp;base64,AAA')
    const a = await ensureVideoThumb('v.mp4', 'small', capture)
    const b = await ensureVideoThumb('v.mp4', 'small', capture)
    expect(a).toBe('data:image/webp;base64,AAA')
    expect(b).toBe(a)
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('small 传 50，full 不传 size（要原始帧）', async () => {
    const capture = vi.fn().mockResolvedValue('data:x')
    await ensureVideoThumb('v.mp4', 'small', capture)
    await ensureVideoThumb('v.mp4', 'full', capture)
    expect(capture).toHaveBeenNthCalledWith(1, 'v.mp4', 50)
    expect(capture).toHaveBeenNthCalledWith(2, 'v.mp4')
  })

  it('两档尺寸分开缓存（不会互相覆盖）', async () => {
    const capture = vi.fn()
      .mockResolvedValueOnce('data:small')
      .mockResolvedValueOnce('data:full')
    await ensureVideoThumb('v.mp4', 'small', capture)
    await ensureVideoThumb('v.mp4', 'full', capture)
    expect(peekVideoThumb('v.mp4', 'small')).toBe('data:small')
    expect(peekVideoThumb('v.mp4', 'full')).toBe('data:full')
  })

  it('并发请求同一视频只解一次码', async () => {
    const capture = vi.fn().mockResolvedValue('data:x')
    await Promise.all([
      ensureVideoThumb('v.mp4', 'small', capture),
      ensureVideoThumb('v.mp4', 'small', capture),
      ensureVideoThumb('v.mp4', 'small', capture),
    ])
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('取帧失败不留缓存（下次还能重试）', async () => {
    const capture = vi.fn().mockResolvedValue(null)
    expect(await ensureVideoThumb('v.mp4', 'small', capture)).toBeNull()
    expect(peekVideoThumb('v.mp4', 'small')).toBeUndefined()
  })

  it('没有取帧能力 → null，不崩', async () => {
    expect(await ensureVideoThumb('v.mp4', 'small', undefined)).toBeNull()
  })
})

