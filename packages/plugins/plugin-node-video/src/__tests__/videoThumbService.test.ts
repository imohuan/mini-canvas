/** 视频缩略图服务（用户 2026-10-28）：保持原比例、宽度上限 1080 + 跳过纯色片头 */
import { describe, expect, it } from 'vitest'
import {
  VIDEO_THUMB_MAX_WIDTH,
  VIDEO_THUMB_MIN_SHORT_SIDE,
  SOLID_FRAME_RATIO,
  VIDEO_THUMB_SEEK_POINTS,
  isSolidFrame,
  thumbSizeFor,
} from '../videoThumbService'

/** 造一张纯色/混合的像素缓冲 */
const makePixels = (size: number, color: [number, number, number], mixedRatio = 0) => {
  const data = new Uint8ClampedArray(size * size * 4)
  const mixedCount = Math.floor(size * size * mixedRatio)
  for (let i = 0; i < size * size; i++) {
    const o = i * 4
    const c = i < mixedCount ? [255, 0, 0] : color
    data[o] = c[0]
    data[o + 1] = c[1]
    data[o + 2] = c[2]
    data[o + 3] = 255
  }
  return data
}

describe('视频缩略图参数', () => {
  it('宽度上限 1080、短边下限 50（用户要求）', () => {
    expect(VIDEO_THUMB_MAX_WIDTH).toBe(1080)
    expect(VIDEO_THUMB_MIN_SHORT_SIDE).toBe(50)
  })

  it('1920×1080 → 1080×608（保持原比例，不是 1:1）', () => {
    expect(thumbSizeFor(1920, 1080)).toEqual({ width: 1080, height: 608 })
  })

  it('1080×1920 竖屏 → 保持不变（宽已在上限内，不放大也不裁）', () => {
    expect(thumbSizeFor(1080, 1920)).toEqual({ width: 1080, height: 1920 })
  })

  it('原视频比 1080 窄 → 用原宽，不放大', () => {
    expect(thumbSizeFor(640, 360)).toEqual({ width: 640, height: 360 })
  })

  it('极细长的片子 → 短边补到 50（唯一允许放大的情况）', () => {
    // 4000×100：按 1080 宽缩放后高只有 27，短边不足 50 → 放大到 50
    expect(thumbSizeFor(4000, 100)).toEqual({ width: 2000, height: 50 })
  })

  it('纯色判定阈值 50%', () => {
    expect(SOLID_FRAME_RATIO).toBe(0.5)
  })

  it('seek 点从 0 开始、依次靠后（避开片头黑场）', () => {
    expect(VIDEO_THUMB_SEEK_POINTS[0]).toBe(0)
    const sorted = [...VIDEO_THUMB_SEEK_POINTS].sort((a, b) => a - b)
    expect(VIDEO_THUMB_SEEK_POINTS).toEqual(sorted)
    expect(VIDEO_THUMB_SEEK_POINTS.length).toBeGreaterThan(1)
  })
})

describe('isSolidFrame：纯色帧检测', () => {
  it('全黑 → 判为纯色（要跳帧）', () => {
    expect(isSolidFrame(makePixels(20, [0, 0, 0]), 20, 20)).toBe(true)
  })

  it('全白 → 判为纯色', () => {
    expect(isSolidFrame(makePixels(20, [255, 255, 255]), 20, 20)).toBe(true)
  })

  it('同色 30% → 不算纯色（正常画面）', () => {
    expect(isSolidFrame(makePixels(20, [10, 120, 200], 0.3), 20, 20)).toBe(false)
  })

  it('同色超过 50% → 判为纯色', () => {
    // 60% 是红色、40% 是蓝色 → 基准色是红色，红占 60% > 50%
    expect(isSolidFrame(makePixels(20, [0, 0, 255], 0.6), 20, 20)).toBe(true)
  })

  it('空数据 → 当作纯色（安全回退，继续找下一帧）', () => {
    expect(isSolidFrame(new Uint8ClampedArray(0), 0, 0)).toBe(true)
  })
})

