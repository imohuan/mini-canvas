/**
 * 底栏两个下拉的宽度预算（纯函数，可单测）。
 *
 * 用户口径（2026-11-16）：
 * 「你的这 2 个下拉菜单宽度存在问题没有做好限制，你需要根据 config 配置的总宽度
 *   还有右侧提供了多少个按钮综合因素来决定你的下拉框宽度」。
 *
 * 也就是：底栏一行里，**先扣掉右侧按钮区**（发送 / 字数 / AI 按钮），
 * 剩下的才是两个下拉能分的空间；两个下拉再按比例分，各自带上下限。
 * 不做成固定 px：右侧按钮随动作增减（有的动作有翻译/优化按钮，有的没有），
 * 写死宽度的结果就是「按钮一多，下拉被挤到只剩省略号」。
 */

export interface SelectsBudgetInput {
  /** 底栏那一行的可用宽度（.nb-bottom 的内容宽，不含 padding） */
  rowWidth: number
  /** 右侧按钮区实际占用的宽度（.nb-actions，含字数、发送按钮） */
  actionsWidth: number
  /**
   * 行内**不由两个下拉分享**的固定宽度：@ 按钮、两条分隔线、它们之间的 gap。
   *
   * 用户 2026-11-17 实测：不扣这一项时，.nb-selects 的内容宽比它拿到的宽多 50px，
   * 参数那格末尾（「1.17积分」）就被裁掉了。
   */
  fixedWidth?: number
  /** 行内 gap（.nb-bottom 的 gap）与两个下拉之间的分隔线等固定消耗 */
  gap?: number
  /**
   * 参数那格分到多少比例（默认 0.42）。
   *
   * provider 可以把花费写进参数标题，那段字比模型名更能帮用户判断，
   * 于是给它多一点（用户 2026-11-17：价格被裁掉一半）。
   */
  paramWeight?: number
}

export interface SelectsBudget {
  /** 模型下拉那一格的上限 */
  modelMax: number
  /** 参数下拉那一格的上限 */
  paramMax: number
}

/**
 * 模型下拉的上下限。
 *
 * 96 是「能认出是哪个模型」的底线；再往下只剩图标，认不出。
 * 用户 2026-11-17 的截图里模型名被压到 107px —— 已经到这个底线附近，
 * 所以再多给参数那格，就只能从「已超出底线」的部分拿。
 */
const MODEL_MIN = 104
const MODEL_MAX = 280
/** 参数下拉的上下限：小于 72 连「MP3」都放不下，大于 240 就太长 */
const PARAM_MIN = 72
const PARAM_MAX = 240

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)))
}

/**
 * 算两个下拉各能占多宽。
 *
 * @param input rowWidth = 整行可用宽，actionsWidth = 右侧按钮区宽
 */
export function selectsBudget(input: SelectsBudgetInput): SelectsBudget {
  const gap = Number.isFinite(input.gap) ? Math.max(0, input.gap as number) : 8
  const row = Number.isFinite(input.rowWidth) ? Math.max(0, input.rowWidth) : 0
  const actions = Number.isFinite(input.actionsWidth) ? Math.max(0, input.actionsWidth) : 0
  const fixed = Number.isFinite(input.fixedWidth) ? Math.max(0, input.fixedWidth as number) : 0

  // 扣掉右侧按钮区、「@ + 分隔线」这些固定件，再给两处 gap 留位置
  const free = Math.max(0, row - actions - fixed - gap * 2)
  if (free <= 0) return { modelMax: MODEL_MIN, paramMax: PARAM_MIN }

  const weight = Number.isFinite(input.paramWeight) ? Math.min(0.7, Math.max(0.25, input.paramWeight as number)) : 0.42
  // 模型名通常比参数摘要长，默认多给它一点；provider 带价格时可调高参数占比
  let modelMax = clamp(free * (1 - weight), MODEL_MIN, MODEL_MAX)
  let paramMax = clamp(free - modelMax - gap, PARAM_MIN, PARAM_MAX)

  // 空间实在不够时，两个一起收，别让某一个吃掉另一个的全部空间
  if (modelMax + paramMax + gap > free) {
    const overflow = modelMax + paramMax + gap - free
    const shrinkModel = Math.min(overflow, Math.max(0, modelMax - MODEL_MIN))
    modelMax -= shrinkModel
    const rest = overflow - shrinkModel
    if (rest > 0) paramMax = Math.max(PARAM_MIN, paramMax - rest)
  }
  return { modelMax, paramMax }
}
