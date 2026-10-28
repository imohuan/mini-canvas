/** 视频缩略图服务（用户 2026-10-28）：50px + 跳过纯色片头 */
import { describe, expect, it } from 'vitest'
import {
  VIDEO_THUMB_SIZE,
  SOLID_FRAME_RATIO,
  VIDEO_THUMB_SEEK_POINTS,
  isSolidFrame,
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
  it('尺寸 50px（用户要求）', () => {
    expect(VIDEO_THUMB_SIZE).toBe(50)
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

