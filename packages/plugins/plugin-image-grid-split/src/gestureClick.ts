/**
 * 判断一次画布手势是不是真正的点击，而不是平移画布。
 *
 * 用户口径 2026-10-31：拖画布 / 缩放画布不该退出宫格切分。
 * 但 VueFlow 在平移手势结束后仍会发出 pane-click —— 插件把它当成“点了空白”，
 * 模式就被踢出去了。这里按按下点到抬起点的位移区分：
 * 超过阈值 = 拖动（平移），不触发退出。
 *
 * 纯函数（零 DOM），便于单测。
 */
export interface GesturePoint {
  x: number
  y: number
}

/** 抬手前最大“算点击”的位移（CSS px）。手指/触控板抖动留一点余量。 */
export const CLICK_SLOP = 4

/** @returns true = 位移在阈值内，应当视为点击 */
export function isTapGesture(
  down: GesturePoint | null | undefined,
  up: GesturePoint | null | undefined,
  slop: number = CLICK_SLOP,
): boolean {
  if (!down || !up) return true
  const dx = up.x - down.x
  const dy = up.y - down.y
  return Math.hypot(dx, dy) <= Math.max(0, slop)
}
