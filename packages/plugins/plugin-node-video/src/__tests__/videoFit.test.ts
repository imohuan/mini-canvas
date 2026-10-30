/**
 * videoFit —— 视频尺寸 → 卡片尺寸的适配规则契约（纯函数，Node 直接跑）。
 *
 * 规则与图片节点同源：比例正确、最短边不小于下限、最长边不超过上限、
 * 两条冲突时最短边优先、拿不到尺寸返回 null（调用方保持原尺寸，不猜）。
 * 默认值与图片不同（最长边 560），这里单独钉住这个差异。
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_VIDEO_CARD_SIZE,
  DEFAULT_VIDEO_FIT_LIMITS,
  fitVideoCardSize,
  followedVideoCardSizePatch,
  missingVideoCardSizePatch,
  readVideoFitLimits,
  resolveVideoFitLimits,
  videoCardSizePatch,
} from '../videoFit'

describe('fitVideoCardSize：等比 + 最短边 / 最长边', () => {
  it('大视频按比例缩到最长边 560', () => {
    // 1920×1080：最长边压到 560 → 560×315
    expect(fitVideoCardSize(1920, 1080)).toEqual({ width: 560, height: 315 })
    // 1080×1920 竖屏：最长边压到 560 → 315×560
    expect(fitVideoCardSize(1080, 1920)).toEqual({ width: 315, height: 560 })
  })

  it('小视频放大到最短边，不会小到看不清', () => {
    expect(fitVideoCardSize(320, 240)).toEqual({ width: 320, height: 240 })
    expect(fitVideoCardSize(560, 360)).toEqual({ width: 560, height: 360 })
  })

  it('比例保持正确（宽高比与视频一致，误差只在取整）', () => {
    const fit = fitVideoCardSize(3840, 2160)!
    expect(fit.width / fit.height).toBeCloseTo(3840 / 2160, 2)
  })

  it('极端细长视频不塌到 0：按最短边撑开，最长边允许超上限', () => {
    const fit = fitVideoCardSize(8000, 400)!
    expect(fit).toEqual({ width: 2400, height: 120 })
    expect(fitVideoCardSize(400, 8000)).toEqual({ width: 120, height: 2400 })
  })

  it('尺寸非法（0/负数/NaN/缺失/字符串）→ null，调用方保持原尺寸不猜', () => {
    for (const bad of [0, -5, Number.NaN, undefined, null, '100', {}]) {
      expect(fitVideoCardSize(bad, 100)).toBeNull()
      expect(fitVideoCardSize(100, bad)).toBeNull()
    }
  })

  it('默认值是最短边 120 / 最长边 560（与图片的最长边 420 刻意不同）', () => {
    expect(DEFAULT_VIDEO_FIT_LIMITS).toEqual({ minShortSide: 120, maxLongSide: 560 })
  })
})

describe('限制可配', () => {
  it('最长边调小 → 同一段视频缩得更狠', () => {
    expect(fitVideoCardSize(1920, 1080, { minShortSide: 100, maxLongSide: 300 })).toEqual({ width: 300, height: 169 })
  })

  it('最长边调大 → 同一段视频可以更大', () => {
    expect(fitVideoCardSize(1920, 1080, { minShortSide: 100, maxLongSide: 1920 })).toEqual({ width: 1920, height: 1080 })
  })

  it('限制被改坏（0/NaN）→ 该项回落默认值，而不是让整条规则失效', () => {
    expect(fitVideoCardSize(1920, 1080, { maxLongSide: 0, minShortSide: 120 })).toEqual({ width: 560, height: 315 })
    expect(fitVideoCardSize(1920, 1080, { maxLongSide: Number.NaN, minShortSide: Number.NaN })).toEqual({
      width: 560,
      height: 315,
    })
  })
})

describe('resolveVideoFitLimits / readVideoFitLimits：从配置读限制', () => {
  it('读到配置值就用配置值', () => {
    expect(
      resolveVideoFitLimits((k) => (k === 'videoCardMinShortSide' ? 90 : k === 'videoCardMaxLongSide' ? 600 : undefined)),
    ).toEqual({ minShortSide: 90, maxLongSide: 600 })
  })

  it('读不到 / 非法 → 回落默认（最短边 120、最长边 560）', () => {
    expect(resolveVideoFitLimits(() => undefined)).toEqual(DEFAULT_VIDEO_FIT_LIMITS)
    expect(resolveVideoFitLimits((k) => (k === 'videoCardMinShortSide' ? 'x' : -1))).toEqual(DEFAULT_VIDEO_FIT_LIMITS)
  })

  it('没有 settings 服务（极简宿主/单测桩）→ 回落默认，不抛错', () => {
    expect(readVideoFitLimits(undefined)).toEqual(DEFAULT_VIDEO_FIT_LIMITS)
    expect(readVideoFitLimits({ get: (() => undefined) as <T>() => T })).toEqual(DEFAULT_VIDEO_FIT_LIMITS)
  })
})

describe('写回补丁：只给正式字段 size（卡片镜像由 nodeStore 自动补）', () => {
  it('尺寸拿得到 → 只带 size，不再手拼 cardWidth/cardHeight', () => {
    const patch = videoCardSizePatch(1280, 720)!
    expect('cardWidth' in patch).toBe(false)
    expect('cardHeight' in patch).toBe(false)
    expect(patch.size).toEqual({ w: 560, h: 315 })
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

  it('裁过的视频按裁框比例算，不按整幅画面', () => {
    expect(
      missingVideoCardSizePatch({
        videoWidth: 1920,
        videoHeight: 1080,
        cropRect: { x: 0, y: 0, width: 540, height: 960 },
      }),
    ).toEqual(videoCardSizePatch(540, 960))
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
      // nodeStore 写 size 时同步镜像 data.cardWidth/cardHeight（这里手写模拟那一步）
      writes.push({ cardWidth: patch.size.w, cardHeight: patch.size.h })
      data = { ...data, cardWidth: patch.size.w, cardHeight: patch.size.h }
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
