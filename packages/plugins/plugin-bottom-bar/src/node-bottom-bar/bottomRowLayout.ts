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

/**
 * 模型触发器里「不是文字」的部分（用户 2026-11-21：「本地多图」只有四个字也被截成「本地…」）。
 *
 * 实际占位：左右内边距 16 + 两处 gap 12 + 图标 20 + 箭头 14 = 62。
 * 之前写 58，正好把四个汉字（52px）挤到省略号的临界点 —— 少算 4px 就会吃掉半个字。
 * 这里给 66，留一点取整误差。
 */
const MODEL_CHROME = 66
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
  const rawModel = textWidthOf(input.modelText) + MODEL_CHROME
  const rawParam = textWidthOf(input.paramText) + PARAM_CHROME
  const wantModel = clamp(rawModel, MODEL_MIN, MODEL_MAX)
  const wantParam = clamp(rawParam, PARAM_MIN, PARAM_MAX)

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
   * 分配顺序（用户 2026-11-21）：
   * 「折叠之后宽度小一点，四个字就被挤压了」—— 根因是这里先把参数那格塞满
   * 它自己的 96px 下限，再拿剩下的给模型，于是模型刚好差几个像素就开始省略。
   *
   * 现在的规则：
   * 1. 两格各自「能完整显示」需要多少（wantModel / wantParam）；
   * 2. 空间够 → 都按需要给；
   * 3. 不够 → **先保证模型名完整**（参数只是「16:9」这种短摘要，先让它收）；
   * 4. 两格都到自己的真实下限还放不下时，才允许缩到最小可读宽。
   *
   * 「真实下限」不是写死的 96：参数只有「参数」两个字时它本来就只需要 76，
   * 让它保持 96 会白白吃掉模型名那 20px。
   */
  const paramFloor = Math.min(PARAM_MIN, rawParam)
  const modelFloor = Math.min(MODEL_MIN, wantModel)
  let modelWidth: number
  let paramWidth: number
  if (avail >= wantModel + paramFloor) {
    modelWidth = wantModel
    /*
     * 参数不够 96 时按它**自己真正需要**的宽给（例如只有「参数」两个字 = 76），
     * 不必凑到 96 把模型名的空间白占着。
     */
    paramWidth = Math.min(wantParam, Math.max(paramFloor, rawParam), avail - wantModel)
  } else if (avail >= modelFloor + paramFloor) {
    modelWidth = Math.max(modelFloor, avail - paramFloor)
    paramWidth = Math.max(paramFloor, avail - modelWidth)
  } else {
    modelWidth = modelFloor
    paramWidth = paramFloor
  }

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

