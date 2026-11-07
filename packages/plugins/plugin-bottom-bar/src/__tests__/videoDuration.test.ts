/**
 * 视频时长 / 上限的纯函数（用户 2026-11-06 改成 `10s` 这种写法）。
 *
 * 卡片左下角显示总时长，超过 60 秒要醒目提醒（这边的视频限制在 60 秒以内）。
 */
import { describe, expect, it } from 'vitest'
import { formatVideoDuration, mergeRefTiles, videoOverLimit, VIDEO_DURATION_LIMIT_SEC } from '../refTiles'

describe('formatVideoDuration：卡片角标上的秒数', () => {
  it('不足一分钟直接写秒（10 → 10s）', () => {
    expect(formatVideoDuration(10)).toBe('10s')
    expect(formatVideoDuration(7)).toBe('7s')
    expect(formatVideoDuration(59.4)).toBe('59s')
  })

  it('一分钟以上用 m / s 组合', () => {
    expect(formatVideoDuration(83)).toBe('1m23s')
    expect(formatVideoDuration(600)).toBe('10m')
    expect(formatVideoDuration(60)).toBe('1m')
  })

  it('缺失 / 非法 → 空串（不画角标）', () => {
    expect(formatVideoDuration(undefined)).toBe('')
    expect(formatVideoDuration(0)).toBe('')
    expect(formatVideoDuration(Number.NaN)).toBe('')
  })
})

describe('videoOverLimit：60 秒上限', () => {
  it('60 秒整不算超（含边界）', () => {
    expect(VIDEO_DURATION_LIMIT_SEC).toBe(60)
    expect(videoOverLimit(60)).toBe(false)
  })

  it('超过 60 秒要提醒', () => {
    expect(videoOverLimit(60.5)).toBe(true)
    expect(videoOverLimit(120)).toBe(true)
  })

  it('没有时长不算超', () => {
    expect(videoOverLimit(undefined)).toBe(false)
  })
})

describe('卡片带上视频时长（数据链路）', () => {
  const chip = { id: 'ref-node:v1', name: '短片', nodeId: 'v1', pendingName: null, legacy: false }

  it('视频素材的 duration 落到卡片上', () => {
    const tiles = mergeRefTiles([chip], [{ id: 'v1', name: '短片', kind: 'video', url: 'v.mp4', duration: 12 }])
    expect(tiles[0].duration).toBe(12)
  })

  it('没有时长的卡不带这个字段', () => {
    const tiles = mergeRefTiles([chip], [{ id: 'v1', name: '短片', kind: 'video', url: 'v.mp4' }])
    expect(tiles[0].duration).toBeUndefined()
  })
})
