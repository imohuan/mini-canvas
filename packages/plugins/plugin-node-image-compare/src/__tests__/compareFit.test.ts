/**
 * compareFit —— 「宽度跟随第一条连线的图片」的规则契约（纯函数，Node 直接跑）。
 *
 * 用户要求（原话）：「优化你的图片对比节点，他的宽度应该跟第一个连接线连接的图片的宽度一致」。
 * 这里锁的就是这句话的三层含义：
 * 1. 看**第一条**连线（两张图宽度不同、连线顺序换过来，宽度就跟着换）；
 * 2. 宽度等于**上游图片节点显示的宽度**，拿不到就不猜（保持原样）；
 * 3. 与当前一致就**不写**（幂等 —— 否则写回会触发自己的监听，转成死循环）。
 */
import { describe, it, expect } from 'vitest'
import {
  compareWidthPatch,
  DEFAULT_COMPARE_HEIGHT,
  followedWidthPatch,
  MIN_COMPARE_WIDTH,
  resolveFollowWidth,
} from '../compareFit'

/** 上游节点显示宽度表 */
const widths: Record<string, unknown> = { a: 420, b: 300, tiny: 40, broken: Number.NaN, none: undefined }
const getCardWidth = (id: string): unknown => widths[id]

describe('resolveFollowWidth：跟随第一条连线的图片宽度', () => {
  it('取第一条连线那个上游节点的显示宽度', () => {
    expect(resolveFollowWidth([{ sourceId: 'a' }, { sourceId: 'b' }], getCardWidth)).toBe(420)
  })

  it('只看第一条：调换连线顺序，宽度跟着换（以「第一个」为准，不是取最大或平均）', () => {
    expect(resolveFollowWidth([{ sourceId: 'b' }, { sourceId: 'a' }], getCardWidth)).toBe(300)
  })

  it('宽度取整（上游可能是小数，卡片宽度不该带小数）', () => {
    expect(resolveFollowWidth([{ sourceId: 'a' }], () => 333.6)).toBe(334)
  })

  it('上游宽度过小 → 抬到卡片下限，不产生一条细得看不见的对比条', () => {
    expect(resolveFollowWidth([{ sourceId: 'tiny' }], getCardWidth)).toBe(MIN_COMPARE_WIDTH)
  })

  it('上游宽度拿不到（没连图 / 上游还没量出宽度 / 数值被改坏）→ null，保持原宽度不动', () => {
    expect(resolveFollowWidth([], getCardWidth)).toBeNull()
    expect(resolveFollowWidth([{ sourceId: 'none' }], getCardWidth)).toBeNull()
    expect(resolveFollowWidth([{ sourceId: 'broken' }], getCardWidth)).toBeNull()
    expect(resolveFollowWidth([{ sourceId: 'a' }], () => 0)).toBeNull()
    expect(resolveFollowWidth([{ sourceId: 'a' }], () => -10)).toBeNull()
    expect(resolveFollowWidth([{ sourceId: 'a' }], () => '420')).toBeNull()
  })
})

describe('followedWidthPatch：该不该写回', () => {
  it('与当前不一致 → 写', () => {
    expect(followedWidthPatch(420, 480)).toBe(420)
  })

  it('与当前一致 → 不写（幂等：写回会触发自己的监听，不挡住就是死循环）', () => {
    expect(followedWidthPatch(420, 420)).toBeNull()
  })

  it('算不出目标宽度 → 不写（不猜尺寸，也不把已有尺寸改坏）', () => {
    expect(followedWidthPatch(null, 480)).toBeNull()
  })

  it('当前宽度脏（缺失/字符串）但目标算得出 → 仍然写（顺手把脏值修正）', () => {
    expect(followedWidthPatch(420, undefined)).toBe(420)
    expect(followedWidthPatch(420, '480')).toBe(420)
  })
})

describe('compareWidthPatch：一次写回卡片的宽 + 内核尺寸', () => {
  it('两个宽度字段一致，且高度原样保留（用户拖过的高度不该被跟随动作改掉）', () => {
    const patch = compareWidthPatch(420, { cardWidth: 480, cardHeight: 260 })
    expect(patch).toEqual({ cardWidth: 420, size: { w: 420, h: 260 } })
  })

  it('高度拿不到 → 回落类型默认高度，不把高度写成 0', () => {
    expect(compareWidthPatch(420, { cardWidth: 480 })).toEqual({
      cardWidth: 420,
      size: { w: 420, h: DEFAULT_COMPARE_HEIGHT },
    })
  })

  it('宽度没变 → null（一次都不写，这是幂等的落点）', () => {
    expect(compareWidthPatch(420, { cardWidth: 420, cardHeight: 260 })).toBeNull()
  })

  it('算不出宽度（没连图）→ null，完全不碰节点', () => {
    expect(compareWidthPatch(null, { cardWidth: 480, cardHeight: 260 })).toBeNull()
  })

  it('重复触发（写回后 data 已同步）只产生**一次**写入 —— 监听不会自转成死循环', () => {
    // 模拟真实回路：连上一张 420 宽的图 → 写回 → data 更新 → 监听再触发
    let data: Record<string, unknown> = { cardWidth: 480, cardHeight: 260 }
    const writes: number[] = []
    const trigger = (): void => {
      const patch = compareWidthPatch(resolveFollowWidth([{ sourceId: 'a' }], getCardWidth), data)
      if (!patch) return
      writes.push(patch.cardWidth)
      data = { ...data, cardWidth: patch.cardWidth, cardHeight: patch.size.h }
    }
    trigger()
    trigger()
    trigger()
    expect(writes).toEqual([420])
  })
})
