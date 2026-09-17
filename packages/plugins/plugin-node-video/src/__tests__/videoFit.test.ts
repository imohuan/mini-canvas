/**
 * videoFit —— 视频尺寸 → 卡片尺寸的适配规则契约（纯函数，Node 直接跑）。
 *
 * 规则与图片节点同源（v1 fitVideoCardSize 的语义）：只缩小不放大、比例正确、下限 120×80、
 * 上限可配、拿不到尺寸返回 null（调用方保持原尺寸，不猜）。
 * 默认封顶与图片不同（560×360，v1 视频的默认值），这里单独钉住这个差异。
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_VIDEO_CARD_SIZE,
  DEFAULT_VIDEO_FIT_LIMITS,
  fitVideoCardSize,
  followedVideoCardSizePatch,
  MIN_CARD_HEIGHT,
  MIN_CARD_WIDTH,
  missingVideoCardSizePatch,
  readVideoFitLimits,
  resolveVideoFitLimits,
  videoCardSizePatch,
} from '../videoFit'

describe('fitVideoCardSize：等比 + 封顶 + 下限', () => {
  it('大视频按比例缩到不超过上限（默认 560×360）', () => {
    // 1920×1080：高是瓶颈（360/1080≈0.333 小于 560/1920≈0.292？不，宽更紧）
    // 560/1920 = 0.2917，360/1080 = 0.3333 → 取小的 0.2917 → 560×315
    expect(fitVideoCardSize(1920, 1080)).toEqual({ width: 560, height: 315 })
    // 1080×1920 竖屏：宽是瓶颈 560/1080=0.5185，360/1920=0.1875 → 取 0.1875 → 203×360
    expect(fitVideoCardSize(1080, 1920)).toEqual({ width: 203, height: 360 })
  })

  it('小视频不放大（ratio 封在 1）', () => {
    expect(fitVideoCardSize(320, 240)).toEqual({ width: 320, height: 240 })
    expect(fitVideoCardSize(560, 360)).toEqual({ width: 560, height: 360 })
  })

  it('比例保持正确（宽高比与视频一致，误差只在取整）', () => {
    const fit = fitVideoCardSize(3840, 2160)!
    expect(fit.width / fit.height).toBeCloseTo(3840 / 2160, 2)
  })

  it('极端细长视频不塌到 0：走最小尺寸 120×80', () => {
    const fit = fitVideoCardSize(8000, 20)!
    expect(fit.width).toBe(560)
    expect(fit.height).toBe(MIN_CARD_HEIGHT)
    expect(fitVideoCardSize(20, 8000)).toEqual({ width: MIN_CARD_WIDTH, height: 360 })
  })

  it('尺寸非法（0/负数/NaN/缺失/字符串）→ null，调用方保持原尺寸不猜', () => {
    for (const bad of [0, -5, Number.NaN, undefined, null, '100', {}]) {
      expect(fitVideoCardSize(bad, 100)).toBeNull()
      expect(fitVideoCardSize(100, bad)).toBeNull()
    }
  })

  it('默认封顶是 v1 视频的 560×360（与图片节点的 420×300 刻意不同）', () => {
    expect(DEFAULT_VIDEO_FIT_LIMITS).toEqual({ maxWidth: 560, maxHeight: 360 })
  })
})

describe('上限可配', () => {
  it('上限调小 → 同一段视频缩得更狠', () => {
    expect(fitVideoCardSize(1920, 1080, { maxWidth: 300, maxHeight: 300 })).toEqual({ width: 300, height: 169 })
  })

  it('上限调大 → 同一段视频可以更大', () => {
    expect(fitVideoCardSize(1920, 1080, { maxWidth: 1920, maxHeight: 1080 })).toEqual({ width: 1920, height: 1080 })
  })

  it('上限被改坏（0/NaN）→ 该项回落默认值，而不是让整条规则失效', () => {
    expect(fitVideoCardSize(1920, 1080, { maxWidth: 0, maxHeight: 360 })).toEqual({ width: 560, height: 315 })
    expect(fitVideoCardSize(1920, 1080, { maxWidth: Number.NaN, maxHeight: Number.NaN })).toEqual({
      width: 560,
      height: 315,
    })
  })
})

describe('resolveVideoFitLimits / readVideoFitLimits：从配置读封顶', () => {
  it('读到配置值就用配置值', () => {
    expect(
      resolveVideoFitLimits((k) => (k === 'videoFitMaxWidth' ? 800 : k === 'videoFitMaxHeight' ? 600 : undefined)),
    ).toEqual({ maxWidth: 800, maxHeight: 600 })
  })

  it('读不到 / 非法 → 回落 560×360', () => {
    expect(resolveVideoFitLimits(() => undefined)).toEqual(DEFAULT_VIDEO_FIT_LIMITS)
    expect(resolveVideoFitLimits((k) => (k === 'videoFitMaxWidth' ? 'x' : -1))).toEqual(DEFAULT_VIDEO_FIT_LIMITS)
  })

  it('没有 settings 服务（极简宿主/单测桩）→ 回落默认，不抛错', () => {
    expect(readVideoFitLimits(undefined)).toEqual(DEFAULT_VIDEO_FIT_LIMITS)
    expect(readVideoFitLimits({ get: (() => undefined) as <T>() => T })).toEqual(DEFAULT_VIDEO_FIT_LIMITS)
  })
})

describe('写回补丁：cardWidth/cardHeight/size 三件套一次带齐', () => {
  it('尺寸拿得到 → 三个字段都有，且两份尺寸一致', () => {
    const patch = videoCardSizePatch(1280, 720)!
    expect(patch.cardWidth).toBe(patch.size.w)
    expect(patch.cardHeight).toBe(patch.size.h)
    expect(patch.cardWidth).toBe(560)
    expect(patch.cardHeight).toBe(315)
  })

  it('尺寸拿不到 → null（调用方只写 data，不动尺寸）', () => {
    expect(videoCardSizePatch(0, 0)).toBeNull()
    expect(videoCardSizePatch(undefined, 100)).toBeNull()
  })
})

describe('missingVideoCardSizePatch：挂载时补算缺失的尺寸', () => {
  it('尺寸缺失 → 按视频补算', () => {
    expect(missingVideoCardSizePatch({ videoWidth: 1280, videoHeight: 720 })).toEqual(videoCardSizePatch(1280, 720))
  })

  it('尺寸已在（含用户手动拖过的）→ null，挂载不覆盖用户的选择', () => {
    expect(missingVideoCardSizePatch({ videoWidth: 1280, videoHeight: 720, cardWidth: 700, cardHeight: 500 })).toBeNull()
  })

  it('连视频尺寸都没有 → null（无中生有不了一个尺寸）', () => {
    expect(missingVideoCardSizePatch({})).toBeNull()
    expect(missingVideoCardSizePatch(undefined)).toBeNull()
  })
})

describe('followedVideoCardSizePatch：换视频时跟随 + 幂等', () => {
  it('视频尺寸与当前卡片尺寸不一致 → 给出新补丁', () => {
    expect(followedVideoCardSizePatch({ videoWidth: 1280, videoHeight: 720, cardWidth: 320, cardHeight: 240 })).toEqual(
      videoCardSizePatch(1280, 720),
    )
  })

  it('幂等：算出来的尺寸与当前一致 → null（否则自己触发自己成死循环）', () => {
    expect(followedVideoCardSizePatch({ videoWidth: 1280, videoHeight: 720, cardWidth: 560, cardHeight: 315 })).toBeNull()
    expect(followedVideoCardSizePatch({ videoWidth: 320, videoHeight: 240, cardWidth: 320, cardHeight: 240 })).toBeNull()
  })

  it('重复触发（写回后 data 已同步）只产生**一次**写入 —— 兜底监听不会自转成死循环', () => {
    let data: Record<string, unknown> = { videoWidth: 1280, videoHeight: 720 }
    const writes: Array<{ cardWidth: number; cardHeight: number }> = []
    const trigger = (): void => {
      const patch = followedVideoCardSizePatch(data)
      if (!patch) return
      writes.push({ cardWidth: patch.cardWidth, cardHeight: patch.cardHeight })
      data = { ...data, cardWidth: patch.cardWidth, cardHeight: patch.cardHeight }
    }
    trigger()
    trigger()
    trigger()
    expect(writes).toEqual([{ cardWidth: 560, cardHeight: 315 }])
  })
})

describe('默认卡片尺寸', () => {
  it('一点元数据都读不到时的兜底 = v1 的 NODE_SIZES.video', () => {
    expect(DEFAULT_VIDEO_CARD_SIZE).toEqual({ width: 480, height: 320 })
  })
})
