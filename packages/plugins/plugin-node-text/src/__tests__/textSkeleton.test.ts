/**
 * textSkeleton —— 文本节点「缩略横条（骨架屏）」的几何契约。
 *
 * 用户口径（原话）：缩略后「改变成图片中的这种形式，使用不同长度的矩形色块」，
 * 后续三条观感规则：
 * - 「如果色块非常短，少于整个宽度的 50%，就不显示」；
 * - 「其他色块保持 20% 的层次感（这是为了效果，太平了也不好）」；
 * - 「但是这个换行你依然保留 —— 就相当于这一行它不显示内容，但保留」。
 *
 * 所以产出是**行的列表**：太短的行宽度记 0（不画条），但行位照留 —— 这一条就是本条最后
 * 那组用例在锁的东西。
 */
import { describe, it, expect } from 'vitest'
import {
  HIDE_BAR_BELOW_PERCENT,
  MIN_BAR_WIDTH_PERCENT,
  buildSkeletonBars,
  canRenderSkeletonBars,
  drawnBarCount,
  resolveSkeletonMetrics,
  wrapTextToLineWidths,
} from '../textSkeleton'

/** 常见卡片内容盒（默认文本节点 300×200 减去 16px×2 内边距） */
const BOX = { width: 268, height: 168 }

/** 纹理起伏的上下界（用户要求 20% 层次感 → 每条缩到自然宽度的 80%~100%） */
const TEXTURE_MIN = 0.8
const TEXTURE_MAX = 1

/** 一整行汉字（19 个 ≈ 99% 宽），用来当"够长的行" */
const FULL_LINE = '一'.repeat(19)

describe('wrapTextToLineWidths：把文本折成"每行多长"', () => {
  it('短行不折，一行一条', () => {
    expect(wrapTextToLineWidths('你好', 268, 14)).toHaveLength(1)
  })

  it('超宽按视觉宽度折行：268px 里 14px 的汉字一行放 19 个', () => {
    // 19 个字 = 266px（放得下），20 个字 = 280px（放不下）→ 折成两行
    expect(wrapTextToLineWidths('一'.repeat(19), 268, 14)).toHaveLength(1)
    expect(wrapTextToLineWidths('一'.repeat(20), 268, 14)).toHaveLength(2)
  })

  it('换行符强制断行（用户敲回车要在缩略里留痕）', () => {
    expect(wrapTextToLineWidths('a\nb\nc', 268, 14)).toHaveLength(3)
  })

  it('空行也算一行（长度 0），不会把空行挤掉', () => {
    const widths = wrapTextToLineWidths('a\n\nb', 268, 14)
    expect(widths).toHaveLength(3)
    expect(widths[1]).toBe(0)
  })

  it('英文按窄字符估宽：同样字符数比中文放得下更多', () => {
    // 268px 里窄字符一行约 34 个、汉字一行 19 个 —— 同样 60 个字符，行数差一倍
    expect(wrapTextToLineWidths('a'.repeat(60), 268, 14)).toHaveLength(2)
    expect(wrapTextToLineWidths('一'.repeat(60), 268, 14)).toHaveLength(4)
  })
})

describe('短行顶到 50% 照画：不在开头留空洞', () => {
  it('下限 50%、隐藏线 10%', () => {
    expect(MIN_BAR_WIDTH_PERCENT).toBe(50)
    expect(HIDE_BAR_BELOW_PERCENT).toBe(10)
  })

  it('短句（约 26%）不再留空，顶到 50% 附近照画', () => {
    const bars = buildSkeletonBars({ text: FULL_LINE + '\n短句', ...BOX })
    expect(bars).toHaveLength(2)
    expect(bars[1].widthPercent).toBeGreaterThanOrEqual(MIN_BAR_WIDTH_PERCENT - 0.5)
    expect(bars[1].widthPercent).toBeLessThan(MIN_BAR_WIDTH_PERCENT * 1.01)
    expect(bars[0].widthPercent).toBeGreaterThan(90)
    expect(drawnBarCount(bars)).toBe(2)
  })

  it('10%~50% 之间的行全部画成"半行宽"（不按真实长短缩，才不会显得参差）', () => {
    // 5 个汉字 ≈ 26%、13 个汉字 ≈ 68%：前者顶到下限，后者照实（前者不可能比后者宽）
    const bars = buildSkeletonBars({ text: '一'.repeat(5) + '\n' + '一'.repeat(13), ...BOX })
    expect(bars[0].widthPercent).toBeGreaterThanOrEqual(MIN_BAR_WIDTH_PERCENT - 0.5)
    expect(bars[0].widthPercent).toBeLessThan(MIN_BAR_WIDTH_PERCENT * 1.01)
    expect(bars[1].widthPercent).toBeGreaterThan(MIN_BAR_WIDTH_PERCENT)
  })

  it('只有一个字的行（<10%）直接隐藏，但行位留着', () => {
    const bars = buildSkeletonBars({ text: FULL_LINE + '\n一\n' + FULL_LINE, ...BOX })
    expect(bars).toHaveLength(3)
    expect(bars[1].widthPercent).toBe(0)
    expect(drawnBarCount(bars)).toBe(2)
  })

  it('空行保留行位（用户口径：换行依然保留，这一行不显示内容但保留）', () => {
    const bars = buildSkeletonBars({ text: FULL_LINE + '\n\n' + FULL_LINE, ...BOX })
    expect(bars).toHaveLength(3)
    expect(bars[1].widthPercent).toBe(0)
    // 第三行没被空行顶上来：它的位置由行下标决定
    expect(bars[2].widthPercent).toBeGreaterThan(90)
  })

  it('行行都短到 10% 以下 → 行位都在、但一条都不画（调用方给一块小色块）', () => {
    const bars = buildSkeletonBars({ text: '一\n二\n三', ...BOX })
    expect(bars.map((b) => b.widthPercent)).toEqual([0, 0, 0])
    expect(canRenderSkeletonBars(bars)).toBe(false)
  })
})

describe('层次感：画出来的条有 20% 以内的长短起伏', () => {
  it('同样长的行也会画出不同长度（不是一叠等长条）', () => {
    const bars = buildSkeletonBars({ text: [FULL_LINE, FULL_LINE, FULL_LINE].join('\n'), ...BOX })
    expect(bars).toHaveLength(3)
    expect(new Set(bars.map((b) => b.widthPercent)).size).toBeGreaterThan(1)
  })

  it('起伏幅度不超过 20%（最短那条 ≥ 自然长度的 80%）', () => {
    const bars = buildSkeletonBars({ text: [FULL_LINE, FULL_LINE].join('\n'), ...BOX })
    const natural = ((19 * 14) / 268) * 100 // ≈ 99.25%
    bars.forEach((bar) => {
      expect(bar.widthPercent).toBeGreaterThanOrEqual(natural * TEXTURE_MIN - 1e-6)
      expect(bar.widthPercent).toBeLessThanOrEqual(natural * TEXTURE_MAX + 1e-6)
    })
  })

  it('起伏不会把画出来的条压到 50% 以下', () => {
    const bars = buildSkeletonBars({ text: '一'.repeat(10) + '\n' + FULL_LINE, ...BOX })
    expect(bars.every((b) => b.widthPercent === 0 || b.widthPercent >= MIN_BAR_WIDTH_PERCENT)).toBe(true)
  })

  it('同样的文本渲染两次结果一致（可复现，不是随机数）', () => {
    const text = [FULL_LINE, '一'.repeat(15), '一'.repeat(12)].join('\n')
    expect(buildSkeletonBars({ text, ...BOX })).toEqual(buildSkeletonBars({ text, ...BOX }))
  })
})

describe('buildSkeletonBars：行数看内容、长短看每行比例', () => {
  it('行数来自真实内容（四行长文字 = 四个行位）', () => {
    const bars = buildSkeletonBars({ text: Array.from({ length: 4 }, () => FULL_LINE).join('\n'), ...BOX })
    expect(bars).toHaveLength(4)
  })

  it('宽度是相对内容盒的百分比，且不超过 100', () => {
    const bars = buildSkeletonBars({ text: '一'.repeat(200), ...BOX })
    expect(bars.every((b) => b.widthPercent > 0 && b.widthPercent <= 100)).toBe(true)
  })

  it('内容超出可用高度 → 只画放得下的行数，且最后一行收短（示意"下面还有"）', () => {
    const text = Array.from({ length: 20 }, () => FULL_LINE).join('\n')
    const bars = buildSkeletonBars({ text, ...BOX })
    expect(bars).toHaveLength(8) // (168 + 9) / 21 = 8 行
    expect(bars[bars.length - 1].widthPercent).toBeLessThan(bars[bars.length - 2].widthPercent)
  })

  it('行数上限兜底：极长内容也不会画出几十行糊成一片', () => {
    const text = Array.from({ length: 100 }, () => FULL_LINE).join('\n')
    const bars = buildSkeletonBars({ text, width: 268, height: 100000 })
    expect(bars.length).toBeLessThanOrEqual(14)
  })

  it('换到 mini 档：条更薄、行距更小，但宽度比例不变', () => {
    const text = FULL_LINE + '\n' + '一'.repeat(12)
    const body = buildSkeletonBars({ text, ...BOX, density: 'body' })
    const mini = buildSkeletonBars({ text, ...BOX, density: 'mini' })
    expect(mini.map((b) => b.widthPercent)).toEqual(body.map((b) => b.widthPercent))
    expect(resolveSkeletonMetrics('mini').barHeight).toBeLessThan(resolveSkeletonMetrics('body').barHeight)
  })

  it('空文本 / 空白文本 → 一个行位都不产出（调用方退化成一块小色块）', () => {
    expect(buildSkeletonBars({ text: '', ...BOX })).toEqual([])
    expect(buildSkeletonBars({ text: '   \n  ', ...BOX })).toEqual([])
    expect(buildSkeletonBars({ text: undefined, ...BOX })).toEqual([])
  })

  it('尺寸坏值 / 太矮 → 一个行位都不产出，不会产出 NaN 宽度', () => {
    expect(buildSkeletonBars({ text: FULL_LINE, width: 0, height: 168 })).toEqual([])
    expect(buildSkeletonBars({ text: FULL_LINE, width: 268, height: 4 })).toEqual([])
    expect(buildSkeletonBars({ text: FULL_LINE, width: Number.NaN, height: 168 })).toEqual([])
  })
})

describe('canRenderSkeletonBars：一条都没画出来才退化', () => {
  it('没有画出来的条（含"行位都在但全是 0"）→ 退化成一块小色块', () => {
    expect(canRenderSkeletonBars([])).toBe(false)
    expect(canRenderSkeletonBars([{ widthPercent: 0 }, { widthPercent: 0 }])).toBe(false)
  })

  it('有一条就画（活下来的条至少占半行宽，单条也是"这里有一行字"）', () => {
    expect(canRenderSkeletonBars([{ widthPercent: 80 }])).toBe(true)
    expect(canRenderSkeletonBars([{ widthPercent: 0 }, { widthPercent: 80 }])).toBe(true)
  })

  it('drawnBarCount 只数真画出来的条', () => {
    expect(drawnBarCount([{ widthPercent: 0 }, { widthPercent: 80 }, { widthPercent: 0 }])).toBe(1)
  })
})

