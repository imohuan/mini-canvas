/**
 * imageFit —— 图片尺寸 → 卡片尺寸的适配规则契约（纯函数，Node 直接跑）。
 *
 * 用户要求："上传图片或者选择图片之后，图片节点的宽高应该和图片的宽高保持一致"。
 * 这里锁的是规则本身：只缩小不放大、比例正确、下限 120×80、上限可配、
 * 拿不到尺寸就返回 null（调用方保持原尺寸，不猜）。
 */
import { describe, it, expect } from 'vitest'
import {
  cardSizePatch,
  DEFAULT_IMAGE_FIT_LIMITS,
  fitCardSize,
  followedCardSizePatch,
  MIN_CARD_HEIGHT,
  MIN_CARD_WIDTH,
  missingCardSizePatch,
  readImageFitLimits,
  resolveImageFitLimits,
} from '../imageFit'

describe('fitCardSize：等比 + 封顶 + 下限', () => {
  it('大图按比例缩到不超过上限（默认 420×300）', () => {
    // 1200×800：宽是瓶颈 → ratio=0.35 → 420×280
    expect(fitCardSize(1200, 800)).toEqual({ width: 420, height: 280 })
    // 600×1200：高是瓶颈 → ratio=0.25 → 150×300
    expect(fitCardSize(600, 1200)).toEqual({ width: 150, height: 300 })
  })

  it('小图不放大（ratio 封在 1）', () => {
    expect(fitCardSize(200, 100)).toEqual({ width: 200, height: 100 })
    expect(fitCardSize(420, 300)).toEqual({ width: 420, height: 300 })
  })

  it('比例保持正确（宽高比与图片一致，误差只在取整）', () => {
    const fit = fitCardSize(1600, 900)!
    expect(fit.width / fit.height).toBeCloseTo(1600 / 900, 2)
  })

  it('极端细长图不塌到 0：走最小尺寸 120×80', () => {
    const fit = fitCardSize(4000, 10)!
    expect(fit.width).toBe(420)
    expect(fit.height).toBe(MIN_CARD_HEIGHT)
    expect(fitCardSize(10, 4000)).toEqual({ width: MIN_CARD_WIDTH, height: 300 })
  })

  it('尺寸非法（0/负数/NaN/缺失/字符串）→ null，调用方保持原尺寸不猜', () => {
    for (const bad of [0, -5, Number.NaN, undefined, null, '100', {}]) {
      expect(fitCardSize(bad, 100)).toBeNull()
      expect(fitCardSize(100, bad)).toBeNull()
    }
  })
})

describe('上限可配', () => {
  it('上限调小 → 同一张图缩得更狠', () => {
    expect(fitCardSize(1200, 800, { maxWidth: 300, maxHeight: 300 })).toEqual({ width: 300, height: 200 })
  })

  it('上限调大 → 同一张图可以更大', () => {
    expect(fitCardSize(1200, 800, { maxWidth: 1200, maxHeight: 900 })).toEqual({ width: 1200, height: 800 })
  })

  it('上限被改坏（0/NaN）→ 该项回落默认值，而不是让整条规则失效', () => {
    expect(fitCardSize(1200, 800, { maxWidth: 0, maxHeight: 300 })).toEqual({ width: 420, height: 280 })
    expect(fitCardSize(1200, 800, { maxWidth: Number.NaN, maxHeight: Number.NaN })).toEqual({ width: 420, height: 280 })
  })
})

describe('resolveImageFitLimits / readImageFitLimits：从配置读封顶', () => {
  it('读到配置值就用配置值', () => {
    expect(resolveImageFitLimits((k) => (k === 'imageFitMaxWidth' ? 800 : k === 'imageFitMaxHeight' ? 600 : undefined))).toEqual({
      maxWidth: 800,
      maxHeight: 600,
    })
  })

  it('读不到 / 非法 → 回落 420×300（v1 同值）', () => {
    expect(resolveImageFitLimits(() => undefined)).toEqual(DEFAULT_IMAGE_FIT_LIMITS)
    expect(resolveImageFitLimits((k) => (k === 'imageFitMaxWidth' ? 'x' : -1))).toEqual(DEFAULT_IMAGE_FIT_LIMITS)
  })

  it('没有 settings 服务（极简宿主/单测桩）→ 回落默认，不抛错', () => {
    expect(readImageFitLimits(undefined)).toEqual(DEFAULT_IMAGE_FIT_LIMITS)
    expect(readImageFitLimits({ get: (() => undefined) as <T>() => T })).toEqual(DEFAULT_IMAGE_FIT_LIMITS)
    expect(
      readImageFitLimits({ get: (() => ({ get: () => 900 })) as <T>() => T }),
    ).toEqual({ maxWidth: 900, maxHeight: 900 })
  })
})

describe('写回补丁：cardWidth/cardHeight/size 三件套一次带齐', () => {
  it('尺寸拿得到 → 三个字段都有，且两份尺寸一致', () => {
    const patch = cardSizePatch(800, 600)!
    expect(patch.cardWidth).toBe(patch.size.w)
    expect(patch.cardHeight).toBe(patch.size.h)
    // 800×600：高是瓶颈（300/600=0.5，小于 420/800）→ 400×300
    expect(patch.cardWidth).toBe(400)
    expect(patch.cardHeight).toBe(300)
  })

  it('尺寸拿不到 → null（调用方只写 data，不动尺寸）', () => {
    expect(cardSizePatch(0, 0)).toBeNull()
    expect(cardSizePatch(undefined, 100)).toBeNull()
  })
})

describe('missingCardSizePatch：挂载时补算缺失的尺寸', () => {
  it('尺寸缺失 → 按图片补算', () => {
    expect(missingCardSizePatch({ imageWidth: 800, imageHeight: 600 })).toEqual(cardSizePatch(800, 600))
  })

  it('尺寸已在（含用户手动拖过的）→ null，挂载不覆盖用户的选择', () => {
    expect(missingCardSizePatch({ imageWidth: 800, imageHeight: 600, cardWidth: 700, cardHeight: 500 })).toBeNull()
  })

  it('只有一半尺寸（脏数据）→ 视为缺失，重新补算', () => {
    expect(missingCardSizePatch({ imageWidth: 800, imageHeight: 600, cardWidth: 700 })).toEqual(cardSizePatch(800, 600))
  })

  it('连图片尺寸都没有 → null（无中生有不了一个尺寸）', () => {
    expect(missingCardSizePatch({})).toBeNull()
    expect(missingCardSizePatch(undefined)).toBeNull()
  })
})

describe('followedCardSizePatch：换图时跟随新图 + 幂等', () => {
  it('图片尺寸与当前卡片尺寸不一致 → 给出新补丁（跟随新图）', () => {
    expect(followedCardSizePatch({ imageWidth: 1200, imageHeight: 800, cardWidth: 320, cardHeight: 240 })).toEqual(
      cardSizePatch(1200, 800),
    )
  })

  it('幂等：算出来的尺寸与当前一致 → null，一次都不写（否则自己触发自己成死循环）', () => {
    expect(followedCardSizePatch({ imageWidth: 1200, imageHeight: 800, cardWidth: 420, cardHeight: 280 })).toBeNull()
    expect(followedCardSizePatch({ imageWidth: 200, imageHeight: 100, cardWidth: 200, cardHeight: 100 })).toBeNull()
  })

  it('用户手动改过尺寸后又换图 → 照样跟随新图（不做"手动调过就锁定"）', () => {
    // 用户把卡片拖成 900×500，随后换成 800×600 的图 → 仍按上限算出 420×315
    expect(followedCardSizePatch({ imageWidth: 800, imageHeight: 600, cardWidth: 900, cardHeight: 500 })).toEqual(
      cardSizePatch(800, 600),
    )
  })

  it('尺寸拿不到 → null（不猜尺寸，也不把已有尺寸改坏）', () => {
    expect(followedCardSizePatch({ cardWidth: 320, cardHeight: 240 })).toBeNull()
  })

  it('重复触发（写回后 data 已同步）只产生**一次**写入 —— 兜底监听不会自转成死循环', () => {
    // 模拟真实回路：watch 触发 → 算补丁 → 写回 → data 更新 → watch 再触发
    let data: Record<string, unknown> = { imageWidth: 1200, imageHeight: 800 }
    const writes: Array<{ cardWidth: number; cardHeight: number }> = []
    const trigger = (): void => {
      const patch = followedCardSizePatch(data)
      if (!patch) return
      writes.push({ cardWidth: patch.cardWidth, cardHeight: patch.cardHeight })
      data = { ...data, cardWidth: patch.cardWidth, cardHeight: patch.cardHeight }
    }
    trigger()
    trigger()
    trigger()
    expect(writes).toEqual([{ cardWidth: 420, cardHeight: 280 }])
  })
})
