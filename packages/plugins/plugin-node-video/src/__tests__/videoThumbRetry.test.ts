/**
 * 视频缩略图失败重试与缓存纪律（用户 2026-11-07：视频节点偶发纯白/空白）。
 *
 * 根因链：一次截帧失败 → null 被写进 done 缓存 → 本会话内永远拿不到重试
 * → 节点永远空着（或被近白帧占住）。这里钉住三条纪律：
 *  1. 失败结果**不进**缓存，下次调用会真的重新生成；
 *  2. 近白帧（白底片头）按"无意义帧"跳过，继续找后面的帧；
 *  3. 取帧时刻覆盖到 8 秒，白底片头后面正常有画面时能截到。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __clearUnifiedThumbs, unifiedThumbOf } from '../videoThumbUnified'
import { isNearWhiteFrame, VIDEO_THUMB_SEEK_POINTS } from '../videoThumbService'

const capture = vi.hoisted(() => vi.fn())

vi.mock('../videoThumbService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../videoThumbService')>()
  return { ...actual, captureVideoThumb: capture }
})

beforeEach(() => {
  __clearUnifiedThumbs()
  capture.mockReset()
})

describe('videoThumbUnified：失败不进缓存', () => {
  it('第一次生成失败 → 第二次调用会重新生成并成功', async () => {
    capture.mockResolvedValueOnce(null).mockResolvedValueOnce('data:image/webp;base64,frame')
    const first = await unifiedThumbOf('/api/canvases/c1/resources/r1.mp4', undefined, { tier: 1 })
    expect(first).toBeNull()
    expect(capture).toHaveBeenCalledTimes(1)
    const second = await unifiedThumbOf('/api/canvases/c1/resources/r1.mp4', undefined, { tier: 1 })
    expect(second).toBe('data:image/webp;base64,frame')
    // 第二次真的重新生成了（不是命中缓存的 null）
    expect(capture).toHaveBeenCalledTimes(2)
  })

  it('成功结果仍然进缓存（同会话第二次不解码）', async () => {
    capture.mockResolvedValue('data:image/webp;base64,hit')
    await unifiedThumbOf('/api/canvases/c1/resources/r2.mp4', undefined, { tier: 1 })
    await unifiedThumbOf('/api/canvases/c1/resources/r2.mp4', undefined, { tier: 1 })
    expect(capture).toHaveBeenCalledTimes(1)
  })
})

describe('videoThumbService：近白帧跳过 + 取帧点覆盖', () => {
  it('isNearWhiteFrame：全白像素判为近白', () => {
    const px = new Uint8ClampedArray(4 * 20 * 20).fill(255)
    expect(isNearWhiteFrame(px, 20, 20)).toBe(true)
  })

  it('isNearWhiteFrame：有内容（大块深色）不算近白', () => {
    const px = new Uint8ClampedArray(4 * 20 * 20)
    for (let i = 0; i < px.length; i += 4) { px[i] = 30; px[i + 1] = 40; px[i + 2] = 50; px[i + 3] = 255 }
    expect(isNearWhiteFrame(px, 20, 20)).toBe(false)
  })

  it('取帧时刻覆盖到 8s（白底片头之后有画面可截）', () => {
    expect(VIDEO_THUMB_SEEK_POINTS).toContain(8)
  })
})
