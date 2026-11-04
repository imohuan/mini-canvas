/**
 * stickToBottomCore —— 「是否该吸附到底部」的**纯判定**（零 DOM、零 Vue，可单测）。
 *
 * 把判定从 DOM 里拆出来单独放：这是整个吸附功能里唯一有'业务口径'的部分
 * （离底多少算贴底），值得被测试钉住；其余（监听、滚动）都是机械动作。
 */
export interface ScrollMetrics {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/** 距底部还有多少像素（内容不足以滚动时为 0，不返回负数） */
export function distanceToBottom(m: ScrollMetrics): number {
  return Math.max(0, m.scrollHeight - m.scrollTop - m.clientHeight)
}

/**
 * 是否算「贴着底部」。
 *
 * 用「距离 ≤ 阈值」而不是「距离 === 0」：浏览器滚动是小数、且惯性滚动很难精确停在
 * 最后一个像素上；要求严格为 0 会让吸附动不动就失效（用户以为坏了）。
 */
export function isNearBottom(m: ScrollMetrics, threshold: number): boolean {
  return distanceToBottom(m) <= Math.max(0, threshold)
}

/**
 * 是否存在滚动条（内容高于视口）。
 *
 * 「回到底部」悬浮按钮的显示条件之一（用户口径 2026-10-07：
 * 检测到滚动条存在、且没有滚动到底部时才显示）。
 * 1px 容差：亚像素高度差不值得给按钮；真要能滚起来必然差得多。
 */
export function hasScrollbar(m: ScrollMetrics): boolean {
  return m.scrollHeight > m.clientHeight + 1
}
