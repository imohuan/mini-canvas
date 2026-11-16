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
  /** 行内 gap（.nb-bottom 的 gap）与两个下拉之间的分隔线等固定消耗 */
  gap?: number
}

export interface SelectsBudget {
  /** 模型下拉那一格的上限 */
  modelMax: number
  /** 参数下拉那一格的上限 */
  paramMax: number
}

/** 模型下拉的上下限：小于 96 只剩图标，大于 280 又挤掉参数 */
const MODEL_MIN = 96
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

  // 扣掉右侧按钮区、两处 gap（分隔线两侧各一个）与最左侧 @ 按钮占的位置
  const free = Math.max(0, row - actions - gap * 2)
  if (free <= 0) return { modelMax: MODEL_MIN, paramMax: PARAM_MIN }

  // 模型名通常比参数摘要长（「seed-audio-1.0 · 音频生成」对「MP3」），给它多一点
  let modelMax = clamp(free * 0.58, MODEL_MIN, MODEL_MAX)
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
