/**
 * imageFit —— 图片尺寸 → 卡片尺寸的适配规则契约（纯函数，Node 直接跑）。
 *
 * 用户要求："上传图片或者选择图片之后，图片节点的宽高应该和图片的宽高保持一致"。
 * 这里锁的是规则本身：比例正确、最短边不小于下限、最长边不超过上限、
 * 两条冲突时最短边优先、拿不到尺寸就返回 null（调用方保持原尺寸，不猜）。
 */
import { describe, it, expect } from 'vitest'
import {
  cardSizePatch,
  DEFAULT_IMAGE_FIT_LIMITS,
  fitCardSize,
  followedCardSizePatch,
  missingCardSizePatch,
  readImageFitLimits,
  resolveImageFitLimits,
  measuredCardSizePatch,
} from '../imageFit'

describe('fitCardSize：等比 + 最短边 / 最长边', () => {
  it('大图按比例缩到不超过上限（默认 420×300）', () => {
    // 1200×800：最长边压到 420 → 420×280
    expect(fitCardSize(1200, 800)).toEqual({ width: 420, height: 280 })
    // 600×1200：最长边是 1200 → 210×420
    expect(fitCardSize(600, 1200)).toEqual({ width: 210, height: 420 })
  })

  it('小图放大到最短边，不会小到看不清', () => {
    expect(fitCardSize(200, 100)).toEqual({ width: 240, height: 120 })
    expect(fitCardSize(420, 300)).toEqual({ width: 420, height: 300 })
  })

  it('比例保持正确（宽高比与图片一致，误差只在取整）', () => {
    const fit = fitCardSize(1600, 900)!
    expect(fit.width / fit.height).toBeCloseTo(1600 / 900, 2)
  })

  it('极端细长图不塌到 0：按最短边 120 撑开，最长边允许超上限', () => {
    const fit = fitCardSize(4000, 200)!
    // 20:1 → 最短边撑到 120，最长边允许超上限
    expect(fit).toEqual({ width: 2400, height: 120 })
    expect(fitCardSize(200, 4000)).toEqual({ width: 120, height: 2400 })
  })

  it('尺寸非法（0/负数/NaN/缺失/字符串）→ null，调用方保持原尺寸不猜', () => {
    for (const bad of [0, -5, Number.NaN, undefined, null, '100', {}]) {
      expect(fitCardSize(bad, 100)).toBeNull()
      expect(fitCardSize(100, bad)).toBeNull()
    }
  })
})

describe('限制可配', () => {
  it('最长边调小 → 同一张图缩得更狠', () => {
    expect(fitCardSize(1200, 800, { minShortSide: 100, maxLongSide: 300 })).toEqual({ width: 300, height: 200 })
  })

  it('最长边调大 → 同一张图可以更大', () => {
    expect(fitCardSize(1200, 800, { minShortSide: 100, maxLongSide: 1200 })).toEqual({ width: 1200, height: 800 })
  })

  it('限制被改坏（0/NaN）→ 该项回落默认值，而不是让整条规则失效', () => {
    expect(fitCardSize(1200, 800, { maxLongSide: 0, minShortSide: 120 })).toEqual({ width: 420, height: 280 })
    expect(fitCardSize(1200, 800, { maxLongSide: Number.NaN, minShortSide: Number.NaN })).toEqual({ width: 420, height: 280 })
  })
})

describe('resolveImageFitLimits / readImageFitLimits：从配置读限制', () => {
  it('读到配置值就用配置值', () => {
    expect(resolveImageFitLimits((k) => (k === 'imageCardMinShortSide' ? 90 : k === 'imageCardMaxLongSide' ? 800 : undefined))).toEqual({ minShortSide: 90, maxLongSide: 800 })
  })

  it('读不到 / 非法 → 回落默认（最短边 120、最长边 420）', () => {
    expect(resolveImageFitLimits(() => undefined)).toEqual(DEFAULT_IMAGE_FIT_LIMITS)
    expect(resolveImageFitLimits((k) => (k === 'imageCardMinShortSide' ? 'x' : -1))).toEqual(DEFAULT_IMAGE_FIT_LIMITS)
  })

  it('没有 settings 服务（极简宿主/单测桩）→ 回落默认，不抛错', () => {
    expect(readImageFitLimits(undefined)).toEqual(DEFAULT_IMAGE_FIT_LIMITS)
    expect(readImageFitLimits({ get: (() => undefined) as <T>() => T })).toEqual(DEFAULT_IMAGE_FIT_LIMITS)
    expect(readImageFitLimits({ get: (() => ({ get: () => 900 })) as <T>() => T })).toEqual({ minShortSide: 900, maxLongSide: 900 })
  })
})

describe('写回补丁：只给正式字段 size（卡片镜像由 nodeStore 自动补）', () => {
  it('尺寸拿得到 → 只带 size，不再手拼 cardWidth/cardHeight', () => {
    const patch = cardSizePatch(800, 600)!
    expect('cardWidth' in patch).toBe(false)
    expect('cardHeight' in patch).toBe(false)
    // 800×600：最长边压到 420 → 420×315
    expect(patch.size).toEqual({ w: 420, h: 315 })
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

  it('尺寸已在（node.size 有值）→ null，挂载不覆盖用户的选择', () => {
    expect(missingCardSizePatch({ imageWidth: 800, imageHeight: 600 }, null, { w: 700, h: 500 })).toBeNull()
  })

  it('node.size 缺失 → 按图片补算', () => {
    expect(missingCardSizePatch({ imageWidth: 800, imageHeight: 600 }, null, null)).toEqual(cardSizePatch(800, 600))
  })

  it('连图片尺寸都没有 → null（无中生有不了一个尺寸）', () => {
    expect(missingCardSizePatch({})).toBeNull()
    expect(missingCardSizePatch(undefined)).toBeNull()
  })
})

describe('followedCardSizePatch：换图时跟随新图 + 幂等', () => {
  it('图片尺寸与当前卡片尺寸不一致 → 给出新补丁（跟随新图）', () => {
    expect(followedCardSizePatch({ imageWidth: 1200, imageHeight: 800 }, null, { w: 320, h: 240 })).toEqual(
      cardSizePatch(1200, 800),
    )
  })

  it('幂等：算出来的尺寸与当前一致 → null，一次都不写（否则自己触发自己成死循环）', () => {
    expect(followedCardSizePatch({ imageWidth: 1200, imageHeight: 800 }, null, { w: 420, h: 280 })).toBeNull()
    expect(followedCardSizePatch({ imageWidth: 200, imageHeight: 100 }, null, { w: 240, h: 120 })).toBeNull()
  })

  it('用户手动改过尺寸后又换图 → 照样跟随新图（不做"手动调过就锁定"）', () => {
    // 用户把卡片拖成 900×500，随后换成 800×600 的图 → 仍按上限算出 420×315
    expect(followedCardSizePatch({ imageWidth: 800, imageHeight: 600 }, null, { w: 900, h: 500 })).toEqual(
      cardSizePatch(800, 600),
    )
  })

  it('尺寸拿不到 → null（不猜尺寸，也不把已有尺寸改坏）', () => {
    expect(followedCardSizePatch({}, null, { w: 320, h: 240 })).toBeNull()
  })

  it('重复触发（写回后 size 已同步）只产生**一次**写入 —— 兜底监听不会自转成死循环', () => {
    // 模拟真实回路：watch 触发 → 算补丁 → 写回 node.size → watch 再触发
    const data: Record<string, unknown> = { imageWidth: 1200, imageHeight: 800 }
    let size: { w: number; h: number } | null = null
    const writes: Array<{ w: number; h: number }> = []
    const trigger = (): void => {
      const patch = followedCardSizePatch(data, null, size)
      if (!patch) return
      writes.push({ w: patch.size.w, h: patch.size.h })
      size = { w: patch.size.w, h: patch.size.h }
    }
    trigger()
    trigger()
    trigger()
    expect(writes).toEqual([{ w: 420, h: 280 }])
  })
})

describe('measuredCardSizePatch：量到宽高就按尺寸显示（已有错误比例也纠正）', () => {
  it('卡片是默认 4:3、图是 16:9 → 给出新补丁（拖入后黑边的那个场景）', () => {
    expect(
      measuredCardSizePatch({ imageWidth: 1600, imageHeight: 900 }, 1600, 900, null, { w: 320, h: 240 }),
    ).toEqual(cardSizePatch(1600, 900))
  })

  it('尺寸已经是规则算出来的那一组 → null（比例对、大小也对，一次都不写）', () => {
    // 防止"加载完就无条件写回"：4:3 的 960×720 按最长边 420 算出来就是 420×315，
    // 卡片已经是 420×315 时不该再写一次（否则每次加载都多一条落盘）。
    expect(measuredCardSizePatch({ imageWidth: 960, imageHeight: 720 }, 960, 720, null, { w: 420, h: 315 })).toBeNull()
  })

  it('960×720 配默认 320×240 → 420×315（小图按规则放大，比例相同但尺寸要补齐）', () => {
    expect(measuredCardSizePatch({ imageWidth: 960, imageHeight: 720 }, 960, 720, null, { w: 320, h: 240 })).toEqual({
      size: { w: 420, h: 315 },
    })
  })

  it('宽高与尺寸都已一致 → null（幂等，一次都不写）', () => {
    const fit = cardSizePatch(1600, 900)!.size
    expect(
      measuredCardSizePatch(
        { imageWidth: 1600, imageHeight: 900 },
        1600,
        900,
        null,
        { w: fit.w, h: fit.h },
      ),
    ).toBeNull()
  })

  it('宽高没有、尺寸也没写 → 给出补丁（旧数据 / 后台建的节点）', () => {
    expect(measuredCardSizePatch({}, 1600, 900)).toEqual(cardSizePatch(1600, 900))
  })

  it('量到的尺寸非法 → null（不猜数字，也不把已有尺寸改坏）', () => {
    expect(measuredCardSizePatch({ cardWidth: 320, cardHeight: 240 }, 0, 900)).toBeNull()
    expect(measuredCardSizePatch(undefined, 1600, 900)).toBeNull()
  })
})
