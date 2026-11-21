/**
 * 底栏一行的宽度分配：**大量宽度组合的自动化回归**（用户 2026-11-18）。
 *
 * 用户反复报的三个现象，这里逐条钉死：
 * A. 「明明放得下却换成两行」；
 * B. 「右侧 AI 按钮一多就把左侧压成 GPT Ima…」；
 * C. 「拉宽生成栏还是两行」。
 *
 * 这批用例是数据驱动的：同一个规则跑几十种宽度，覆盖 280~2000、
 * 0~10 个 AI 按钮、长短模型名 / 参数名。
 */
import { describe, expect, it } from 'vitest'
import { resolveBottomRow, textWidthOf } from '../node-bottom-bar/bottomRowLayout'

/** 行内固定件：@ 26 + 预设 26 + 两个 gap */
const FIXED = 60
/** 每个 AI 图标按钮约 30px + 4px 间距 */
const aiWidth = (n: number): number => (n > 0 ? n * 34 : 0)
/** 右侧尾栏：AI 组 + 字数 52 + 发送（带文字约 90） + 间距 */
const actionsWidthOf = (ai: number, sendText = '0.65积分'): number =>
  aiWidth(ai) + 52 + (sendText ? 92 : 32) + 24

const MODEL_LONG = 'GPT Image 2.6 Sunburst'
const MODEL_SHORT = 'Flux'
const PARAM_SHORT = '1:1 · 1K'
const PARAM_LONG = '21:9 · 4K'

describe('textWidthOf（字符宽估算）', () => {
  it('中文按全角、拉丁按半角算', () => {
    expect(textWidthOf('积分')).toBe(26)
    expect(textWidthOf('ab')).toBe(15)
    expect(textWidthOf('')).toBe(0)
  })

  it('脏输入不炸', () => {
    expect(textWidthOf(undefined as unknown as string)).toBe(0)
    expect(textWidthOf(null as unknown as string)).toBe(0)
  })
})

describe('A. 空间够就必须同排（用户最常报的问题）', () => {
  /**
   * 判据只看「两格最小宽 + 右侧」：以前用「各自理想宽」去判，
   * 于是长模型名在 700px 也硬换行，用户看着就是「明明放得下还换行」。
   */
  it.each([
    // [行宽, AI 数量, 模型名, 参数名]
    [900, 0, MODEL_LONG, PARAM_SHORT],
    [820, 2, MODEL_LONG, PARAM_SHORT],
    [760, 2, MODEL_LONG, PARAM_SHORT],
    [720, 2, MODEL_LONG, PARAM_LONG],
    [700, 2, MODEL_SHORT, PARAM_SHORT],
  ])('行宽 %ipx / %i 个 AI 按钮 → 单行', (rowWidth, ai, model, param) => {
    const r = resolveBottomRow({
      rowWidth,
      actionsWidth: actionsWidthOf(ai),
      fixedWidth: FIXED,
      modelText: model,
      paramText: param,
    })
    expect(r.stacked, '这段时间足够，不该换行').toBe(false)
  })

  it('宽度越大越不该换行（单调性）', () => {
    let last = true
    for (let w = 300; w <= 2000; w += 10) {
      const r = resolveBottomRow({
        rowWidth: w,
        actionsWidth: actionsWidthOf(2),
        fixedWidth: FIXED,
        modelText: MODEL_LONG,
        paramText: PARAM_SHORT,
      })
      if (!last) expect(r.stacked, '宽 ' + w + ' 比更窄时还换行，说明判据不单调').toBe(false)
      last = r.stacked
    }
  })

  it('把生成栏调宽一定会回到单行（用户试过的操作）', () => {
    const narrow = resolveBottomRow({
      // 420 = 两格最小宽 + 2 个 AI 按钮 + 固定件之后的临界值以下
      rowWidth: 420, actionsWidth: actionsWidthOf(2), fixedWidth: FIXED, modelText: MODEL_LONG, paramText: PARAM_LONG,
    })
    const wide = resolveBottomRow({
      rowWidth: 900, actionsWidth: actionsWidthOf(2), fixedWidth: FIXED, modelText: MODEL_LONG, paramText: PARAM_LONG,
    })
    expect(narrow.stacked).toBe(true)
    expect(wide.stacked).toBe(false)
  })
})

describe('B. 两个下拉有上限，不互相压没', () => {
  it.each([300, 360, 420, 520, 640, 760, 900, 1200, 1600, 2000])('行宽 %ipx：两格都 ≥ 最小值', (rowWidth) => {
    const r = resolveBottomRow({
      rowWidth,
      actionsWidth: actionsWidthOf(2),
      fixedWidth: FIXED,
      modelText: MODEL_LONG,
      paramText: PARAM_LONG,
    })
    expect(r.modelWidth).toBeGreaterThanOrEqual(96)
    expect(r.paramWidth).toBeGreaterThanOrEqual(96)
  })

  it('宽屏时两格不超过各自上限（模型 260 / 参数 220）', () => {
    const r = resolveBottomRow({
      rowWidth: 3000,
      actionsWidth: actionsWidthOf(0),
      fixedWidth: FIXED,
      modelText: 'A'.repeat(200),
      paramText: 'B'.repeat(200),
    })
    expect(r.modelWidth).toBeLessThanOrEqual(260)
    expect(r.paramWidth).toBeLessThanOrEqual(220)
  })

  it('两格加起来不超出可用宽（不会互相重叠）', () => {
    for (let w = 340; w <= 1600; w += 20) {
      const ai = 2
      const r = resolveBottomRow({
        rowWidth: w,
        actionsWidth: actionsWidthOf(ai),
        fixedWidth: FIXED,
        modelText: MODEL_LONG,
        paramText: PARAM_LONG,
      })
      if (r.stacked) continue // 两行时左侧独占整行，另有约束
      const available = w - actionsWidthOf(ai) - FIXED - 8
      expect(r.modelWidth + r.paramWidth, '行宽 ' + w + ' 时两格超宽').toBeLessThanOrEqual(available + 1)
    }
  })
})

describe('C. AI 按钮数量越多，越早折叠到自己那一行', () => {
  it.each([0, 1, 2, 3, 5, 8, 12])('%i 个 AI 按钮：结果稳定且不越界', (ai) => {
    const r = resolveBottomRow({
      rowWidth: 760,
      actionsWidth: actionsWidthOf(ai),
      fixedWidth: FIXED,
      modelText: MODEL_LONG,
      paramText: PARAM_SHORT,
    })
    expect(Number.isFinite(r.modelWidth)).toBe(true)
    expect(Number.isFinite(r.paramWidth)).toBe(true)
    expect(r.selectsMin).toBeGreaterThan(0)
  })

  it('按钮多到放不下时，右侧换行 —— 但左侧两格仍拿到可读宽', () => {
    const r = resolveBottomRow({
      rowWidth: 640,
      actionsWidth: actionsWidthOf(12),
      fixedWidth: FIXED,
      modelText: MODEL_LONG,
      paramText: PARAM_LONG,
    })
    expect(r.stacked).toBe(true)
    /*
     * 独占一行时两格都拿到可读宽：模型 ≥160（能认出是哪个模型），
     * 参数 ≥110（「21:9 · 4K」这类短标题放得下）。
     */
    expect(r.modelWidth).toBeGreaterThanOrEqual(160)
    expect(r.paramWidth).toBeGreaterThanOrEqual(110)
  })
})

describe('D. 极端输入不崩', () => {
  it.each([0, -100, Number.NaN, Number.POSITIVE_INFINITY])('行宽 %s：返回可用数字', (bad) => {
    const r = resolveBottomRow({
      rowWidth: bad as number,
      actionsWidth: 200,
      fixedWidth: FIXED,
      modelText: MODEL_LONG,
      paramText: PARAM_SHORT,
    })
    expect(Number.isFinite(r.modelWidth)).toBe(true)
    expect(Number.isFinite(r.paramWidth)).toBe(true)
    expect(r.modelWidth).toBeGreaterThan(0)
    expect(r.paramWidth).toBeGreaterThan(0)
  })

  it('空标题不影响判断', () => {
    const r = resolveBottomRow({
      rowWidth: 800,
      actionsWidth: actionsWidthOf(2),
      fixedWidth: FIXED,
      modelText: '',
      paramText: '',
    })
    expect(r.stacked).toBe(false)
  })
})

describe('E. 短标签必须完整显示（用户 2026-11-21 截图：本地多图被截成「本地…」）', () => {
  it('四个汉字 + 图标 + 箭头：宽度要给够，不能触发省略号', () => {
    const r = resolveBottomRow({
      rowWidth: 900,
      actionsWidth: 300,
      fixedWidth: FIXED,
      modelText: '本地多图',
      paramText: '参数',
    })
    // 文字 52px + 图标 / 箭头 / 内边距约 62px，至少 114px；少 1px 就会出现省略号
    expect(r.modelWidth).toBeGreaterThanOrEqual(116)
  })

  /**
   * 「折叠之后宽度小一点，文本后面就被挤压了」（用户 2026-11-21 补充）。
   *
   * 这里是按真实现场取的数：整行 694、右侧 196、固定件 34。
   * 以前会把参数格先塞到 96，模型只剩 110，四个汉字被吃掉最后一笔。
   */
  it.each([
    [694, 196, 34],
    [660, 196, 34],
    [700, 220, 34],
  ])('行宽 %ipx / 右侧 %ipx：模型名仍能完整显示', (rowWidth, actionsWidth, fixedWidth) => {
    const r = resolveBottomRow({
      rowWidth,
      actionsWidth,
      fixedWidth,
      modelText: '本地多图',
      paramText: '参数',
    })
    expect(r.modelWidth).toBeGreaterThanOrEqual(118)
  })

  it('空间不够时先收参数那格，不先动模型名', () => {
    const r = resolveBottomRow({
      rowWidth: 694,
      actionsWidth: 196,
      fixedWidth: 34,
      modelText: '本地多图',
      paramText: '参数',
    })
    // 参数只有两个字，需要的宽比旧的 96 下限还小；它该先让位
    expect(r.paramWidth).toBeLessThan(96)
  })
})

