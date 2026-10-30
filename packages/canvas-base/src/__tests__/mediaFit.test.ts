/**
 * 图片 / 视频节点的卡片尺寸规则（纯函数，Node 直接跑）。
 *
 * 用户口径（2026-10-30）：只要最短边和最长边两个限制，
 * - 最短边不能小于设定值；
 * - 最长边不能大于设定值；
 * - 两者冲突时（例如 20:1 的细长图），按最短边计算，最长边允许超出。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IMAGE_CARD_LIMITS,
  DEFAULT_VIDEO_CARD_LIMITS,
  IMAGE_CARD_LIMIT_KEYS,
  VIDEO_CARD_LIMIT_KEYS,
  fitMediaCard,
  isMediaCardLimitKey,
  readMediaCardLimits,
  resolveMediaCardLimits,
} from '../mediaFit'

describe('fitMediaCard：先守最长边，冲突时让最短边优先', () => {
  it('普通横图按最长边缩到 420，高度保持比例', () => {
    expect(fitMediaCard(1920, 1080, DEFAULT_IMAGE_CARD_LIMITS)).toEqual({ width: 420, height: 236 })
  })

  it('普通竖图同样按最长边缩，短边不会被压到 120 以下', () => {
    expect(fitMediaCard(1080, 1920, DEFAULT_IMAGE_CARD_LIMITS)).toEqual({ width: 236, height: 420 })
  })

  it('小图不会小到看不清：短边不足 120 时等比放大', () => {
    expect(fitMediaCard(50, 50, DEFAULT_IMAGE_CARD_LIMITS)).toEqual({ width: 120, height: 120 })
  })

  it('20:1 细长图：按最短边算，最长边允许超过上限', () => {
    expect(fitMediaCard(4000, 200, DEFAULT_IMAGE_CARD_LIMITS)).toEqual({ width: 2400, height: 120 })
  })

  it('最长边上限比最短边还小时，仍然保证最短边', () => {
    expect(fitMediaCard(1200, 400, { minShortSide: 400, maxLongSide: 420 })).toEqual({
      width: 1200,
      height: 400,
    })
  })

  it('尺寸非法 → null，调用方保持原尺寸不猜', () => {
    for (const bad of [0, -5, Number.NaN, undefined, null, '100', {}]) {
      expect(fitMediaCard(bad, 100, DEFAULT_IMAGE_CARD_LIMITS)).toBeNull()
      expect(fitMediaCard(100, bad, DEFAULT_IMAGE_CARD_LIMITS)).toBeNull()
    }
  })
})

describe('限制读取：两项各自回落默认值', () => {
  it('按前缀读设置键', () => {
    expect(
      resolveMediaCardLimits(
        (key) =>
          key === IMAGE_CARD_LIMIT_KEYS.minShortSide
            ? 200
            : key === IMAGE_CARD_LIMIT_KEYS.maxLongSide
              ? 800
              : undefined,
        IMAGE_CARD_LIMIT_KEYS,
        DEFAULT_IMAGE_CARD_LIMITS,
      ),
    ).toEqual({ minShortSide: 200, maxLongSide: 800 })
  })

  it('读坏值 / 缺项 → 回落默认，不把整条规则弄失效', () => {
    expect(
      resolveMediaCardLimits(
        (key) => (key === IMAGE_CARD_LIMIT_KEYS.minShortSide ? 'x' : -1),
        IMAGE_CARD_LIMIT_KEYS,
        DEFAULT_IMAGE_CARD_LIMITS,
      ),
    ).toEqual(DEFAULT_IMAGE_CARD_LIMITS)
  })

  it('没有 settings 服务（极简宿主 / 单测桩）→ 回落默认，不抛错', () => {
    expect(readMediaCardLimits(undefined, VIDEO_CARD_LIMIT_KEYS, DEFAULT_VIDEO_CARD_LIMITS)).toEqual(
      DEFAULT_VIDEO_CARD_LIMITS,
    )
    expect(
      readMediaCardLimits({ get: (() => undefined) as <T>() => T }, VIDEO_CARD_LIMIT_KEYS, DEFAULT_VIDEO_CARD_LIMITS),
    ).toEqual(DEFAULT_VIDEO_CARD_LIMITS)
  })

  it('只认图片 / 视频各自的键，不误触缩略图等其它设置', () => {
    expect(isMediaCardLimitKey(IMAGE_CARD_LIMIT_KEYS.minShortSide, IMAGE_CARD_LIMIT_KEYS)).toBe(true)
    expect(isMediaCardLimitKey(IMAGE_CARD_LIMIT_KEYS.maxLongSide, IMAGE_CARD_LIMIT_KEYS)).toBe(true)
    expect(isMediaCardLimitKey(VIDEO_CARD_LIMIT_KEYS.maxLongSide, IMAGE_CARD_LIMIT_KEYS)).toBe(false)
    expect(isMediaCardLimitKey('imageTier2Width', IMAGE_CARD_LIMIT_KEYS)).toBe(false)
  })
})
