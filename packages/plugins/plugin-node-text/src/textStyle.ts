/**
 * textStyle —— text 节点的**文本统计**纯逻辑（零 Vue / 零 DOM，Node 可单测）。
 *
 * 历史说明：本文件原先是"文字样式"逻辑（字号档位 / 加粗 / 颜色 / 对齐 / resolveTextStyle），
 * 供顶部操作条消费。用户明确表示"文字大小/加粗/颜色这些样式概念对他没有意义"，顶部操作条与
 * 整套样式字段（fontWeight/fontSize/textColor/textAlign）已一并移除，本文件只留状态栏要用的统计，
 * 免得"删功能却留下没人用的导出"。
 *
 * 口径固定（单一来源，不许各处再写一遍）：
 * - 字数：字符数，不含空白字符；
 * - 行数：按换行符切分；空文本算 0 行。
 */

/** 字数统计：字符数（不含空白字符） */
export function countChars(text: unknown): number {
  if (typeof text !== 'string' || !text) return 0
  return text.replace(/\s/g, '').length
}

/** 行数统计：空文本算 0 行；否则按换行符切分计数 */
export function countLines(text: unknown): number {
  if (typeof text !== 'string' || !text) return 0
  return text.split('\n').length
}

/** 状态栏用的文本摘要 */
export interface TextSummary {
  /** 字符数（不含空白） */
  chars: number
  /** 行数 */
  lines: number
}

/** 一次算出状态栏要显示的两个数（避免两处各写一遍口径） */
export function summarizeText(text: unknown): TextSummary {
  return { chars: countChars(text), lines: countLines(text) }
}
