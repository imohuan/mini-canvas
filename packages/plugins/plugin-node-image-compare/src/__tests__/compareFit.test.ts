/**
 * compareFit —— 「尺寸跟随第一条连线的图片 + 比例存档」的规则契约（纯函数，Node 直接跑）。
 *
 * 用户要求（原话）：
 * - 「优化你的图片对比节点，他的宽度应该跟第一个连接线连接的图片的宽度一致」；
 * - 「图片对比改为根据第一张图片的一个比例进行固定比例缩放」。
 * 这里锁住四层含义：
 * 1. 看**第一条**连线（两张图尺寸不同、连线顺序换过来，尺寸就跟着换）；
 * 2. 宽高等于**上游图片节点显示的宽高**，任一拿不到就不猜（保持原样）；
 * 3. 高度按第一张图的比例回算（固定比例缩放的落点）；
 * 4. 与当前一致就**不写**（幂等 —— 否则写回会触发自己的监听，转成死循环）。
 */
import { describe, it, expect } from 'vitest'
import {
  compareFollowPatch,
  FOLLOW_RATIO_KEY,
  MIN_COMPARE_WIDTH,
  resolveFollowSize,
} from '../compareFit'

/** 上游节点显示尺寸表 */
const sizes: Record<string, { w: unknown; h: unknown }> = {
  a: { w: 420, h: 280 },
  b: { w: 300, h: 200 },
  tiny: { w: 40, h: 30 },
  noH: { w: 420, h: undefined },
  brokenW: { w: Number.NaN, h: 280 },
  none: { w: undefined, h: undefined },
}
const getCardSize = (id: string): { w: unknown; h: unknown } => sizes[id]

describe('resolveFollowSize：跟随第一条连线的图片尺寸', () => {
  it('取第一条连线那个上游节点的显示宽高，高度按比例回算', () => {
    // 420×280 → 宽 420、比例 1.5、高 = 420/1.5 = 280（比例一致时不变形）
    expect(resolveFollowSize([{ sourceId: 'a' }, { sourceId: 'b' }], getCardSize)).toEqual({
      w: 420,
      h: 280,
      ratio: 420 / 280,
    })
  })

  it('只看第一条：调换连线顺序，尺寸跟着换（以「第一个」为准，不是取最大或平均）', () => {
    expect(resolveFollowSize([{ sourceId: 'b' }, { sourceId: 'a' }], getCardSize)).toEqual({
      w: 300,
      h: 200,
      ratio: 300 / 200,
    })
  })

  it('宽度取整 + 过小抬到下限，高度按回算取整（不带小数像素）', () => {
    // 333.6×200 → 宽 334、比例 1.668、高 = 334/1.668 ≈ 200.2 → 200
    const r = resolveFollowSize([{ sourceId: 'a' }], () => ({ w: 333.6, h: 200 }))
    expect(r?.w).toBe(334)
    expect(r?.h).toBe(200)
    expect(r?.ratio).toBeCloseTo(333.6 / 200, 9)
    // 40×30 的极窄图 → 宽抬到 120，高按同比例放大，不产生细条
    const tiny = resolveFollowSize([{ sourceId: 'tiny' }], getCardSize)
    expect(tiny?.w).toBe(MIN_COMPARE_WIDTH)
    expect(tiny?.h).toBe(90) // 120 / (40/30) = 90
  })

  it('上游宽高任一拿不到（没连图 / 没量出 / 被改坏）→ null，保持原尺寸不动', () => {
    expect(resolveFollowSize([], getCardSize)).toBeNull()
    expect(resolveFollowSize([{ sourceId: 'none' }], getCardSize)).toBeNull()
    expect(resolveFollowSize([{ sourceId: 'noH' }], getCardSize)).toBeNull()
    expect(resolveFollowSize([{ sourceId: 'brokenW' }], getCardSize)).toBeNull()
    expect(resolveFollowSize([{ sourceId: 'a' }], () => ({ w: 0, h: 280 }))).toBeNull()
    expect(resolveFollowSize([{ sourceId: 'a' }], () => ({ w: -10, h: 280 }))).toBeNull()
    expect(resolveFollowSize([{ sourceId: 'a' }], () => ({ w: '420', h: 280 }))).toBeNull()
  })
})

describe('compareFollowPatch：size 与比例 data 的幂等写回', () => {
  it('尺寸变了 → size 与比例一起写（比例存 data，供 resizeRatio 读）', () => {
    const patch = compareFollowPatch(
      { w: 420, h: 280, ratio: 420 / 280 },
      { cardWidth: 480, cardHeight: 260 },
    )
    expect(patch).toEqual({
      size: { w: 420, h: 280 },
      data: { [FOLLOW_RATIO_KEY]: 420 / 280 },
    })
  })

  it('尺寸一致但比例字段脏/缺 → 只补比例，不带 size（避免无谓一次写）', () => {
    const patch = compareFollowPatch(
      { w: 420, h: 280, ratio: 1.5 },
      { cardWidth: 420, cardHeight: 280, [FOLLOW_RATIO_KEY]: 'bad' },
    )
    expect(patch).toEqual({ data: { [FOLLOW_RATIO_KEY]: 1.5 } })
  })

  it('尺寸与比例都对 → null（一次都不写，这是幂等的落点）', () => {
    expect(
      compareFollowPatch({ w: 420, h: 280, ratio: 1.5 }, { cardWidth: 420, cardHeight: 280, [FOLLOW_RATIO_KEY]: 1.5 }),
    ).toBeNull()
  })

  it('算不出目标（没连图）→ null，完全不碰节点', () => {
    expect(compareFollowPatch(null, { cardWidth: 480, cardHeight: 260 })).toBeNull()
  })

  it('重复触发（写回后 data 已同步）只产生一次写入 —— 监听不会自转成死循环', () => {
    // 模拟真实回路：连上一张 420×280 的图 → 写回 → data 更新 → 监听再触发
    let data: Record<string, unknown> = { cardWidth: 480, cardHeight: 260 }
    const writes: Array<{ w?: number; h?: number; ratio?: number }> = []
    const trigger = (): void => {
      const patch = compareFollowPatch(resolveFollowSize([{ sourceId: 'a' }], getCardSize), data)
      if (!patch) return
      writes.push({ ...(patch.size ?? {}), ratio: patch.data[FOLLOW_RATIO_KEY] as number })
      if (patch.size) data = { ...data, cardWidth: patch.size.w, cardHeight: patch.size.h }
      data = { ...data, ...patch.data }
    }
    trigger()
    trigger()
    trigger()
    expect(writes).toEqual([{ w: 420, h: 280, ratio: 420 / 280 }])
  })
})
