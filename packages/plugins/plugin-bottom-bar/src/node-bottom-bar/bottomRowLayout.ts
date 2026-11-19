/**
 * 底栏这一行的宽度分配（纯函数，可单测）。用户 2026-11-18 的规则：
 *
 * 1. 两个下拉各有**最大宽度上限**（模型 260 / 参数 220），长名字不会无限吃空间；
 * 2. 右侧（AI 组 + 字数 + 发送）与左侧**同一行放得下就同排**；
 * 3. 只有「连左侧两个下拉的最小宽 + 右侧」都放不下时才换成两行。
 *
 * 为什么不能用 CSS 的 flex-wrap：它判「放不下」用的是已经算好的 min/max-width，
 * 而那些值又是上一帧量出来的 —— 改一次宽度就互相追着变，于是出现
 * 「明明放得下却换行」的抽搐（用户反复报的就是这个）。
 *
 * @param input.rowWidth     整行可用宽（.nb-bottom 的 clientWidth）
 * @param input.actionsWidth 右侧按钮区实际宽（AI 组 + 字数 + 发送）
 * @param input.fixedWidth   行内固定件（@ 按钮 / 预设按钮 / 间距）
 * @param input.modelText    模型下拉上显示的原文
 * @param input.paramText    参数下拉上显示的原文
 */
export interface BottomRowInput {
  rowWidth: number
  actionsWidth: number
  fixedWidth: number
  modelText: string
  paramText: string
}

export interface BottomRowLayout {
  /** 是否换成两行（右侧落到第二行） */
  stacked: boolean
  /** 模型那格的宽（同时是它的 min 与 max） */
  modelWidth: number
  /** 参数那格的宽（同时是它的 min 与 max） */
  paramWidth: number
  /** 左侧整组的下限：低于它 CSS 就会压字 */
  selectsMin: number
}

/** 字号 13px 下的字符宽：中日韩全角 13，拉丁/数字 7.2 */
export function textWidthOf(s: string): number {
  let w = 0
  for (const ch of String(s ?? '')) w += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 13 : 7.2
  return Math.ceil(w)
}

const MODEL_CHROME = 58
const PARAM_CHROME = 50
const MODEL_MIN = 96
const MODEL_MAX = 260
const PARAM_MIN = 96
const PARAM_MAX = 220
const GAP = 8

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.ceil(n)))
const num = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0)

export function resolveBottomRow(input: BottomRowInput): BottomRowLayout {
  const rowWidth = num(input.rowWidth)
  const actionsWidth = num(input.actionsWidth)
  const fixed = num(input.fixedWidth)

  // 两格「不被裁」时需要的宽（各自受上下限约束）
  const wantModel = clamp(textWidthOf(input.modelText) + MODEL_CHROME, MODEL_MIN, MODEL_MAX)
  const wantParam = clamp(textWidthOf(input.paramText) + PARAM_CHROME, PARAM_MIN, PARAM_MAX)

  /*
   * 同排判据只看**最小**需要：两格都用上限去判会过于保守，
   * 明明能放进「最小宽 + 右侧」却硬换行（用户 2026-11-18 截图正是这种）。
   */
  const minNeeded = fixed + MODEL_MIN + PARAM_MIN + GAP + actionsWidth
  const sameLine = rowWidth >= minNeeded

  /*
   * 两格能分的空间 = 整行 − 右侧 − 固定件 − 行内 gap。
   *
   * 关键：两格的宽**加起来绝不超过 avail**，于是
   * `fixed + 两格 + gap + 右侧 ≤ 整行` 恒成立，右侧永远不会被挤出画布
   *（用户 2026-11-18 的 root cause：left min-width 吃满整行 → actions 宽 0）。
   */
  const avail = sameLine
    ? Math.max(MODEL_MIN + PARAM_MIN, rowWidth - actionsWidth - fixed - GAP)
    : Math.max(MODEL_MIN + PARAM_MIN, rowWidth - fixed - GAP * 2)

  /*
   * 参数优先（标题里是「1:2 · 4K」这种短信息），但**不许吃穿模型底线**；
   * 模型拿够之后再回补给参数。
   */
  let paramWidth = Math.min(wantParam, Math.max(PARAM_MIN, avail - MODEL_MIN))
  const modelWidth = Math.min(wantModel, Math.max(MODEL_MIN, avail - paramWidth))
  paramWidth = Math.min(wantParam, Math.max(PARAM_MIN, avail - modelWidth))

  return {
    stacked: !sameLine,
    modelWidth: Math.floor(modelWidth),
    paramWidth: Math.ceil(paramWidth),
    /*
     * 左组下限 = .nb-selects 里**两格真正占用的宽**（不含 @ 按钮等行内固定件，
     * 那些在 .nb-selects 外面，不能算进它的 min-width，否则会重复占用）。
     *
     * 同排时它只描述「左侧要占多少」，剩下的自然留给右侧。
     */
    selectsMin: Math.round(modelWidth + paramWidth + 8),
  }
}

