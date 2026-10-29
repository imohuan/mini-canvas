/**
 * hover 预览框的尺寸（纯函数，零 DOM —— 好写单测）。
 *
 * 用户 2026-10-29 明确口径：
 *   · 预览要**按原图宽高比**展示（竖图不能变成横框）；
 *   · 最长的一条边封顶 200px —— 横图限宽、竖图限高。
 *
 * 为什么不能只靠 CSS `max-width/max-height + object-fit: contain`：
 * 父容器是固定尺寸的（定位按时算的），`contain` 只保证**不裁切**，
 * 而容器本身仍是横的、竖图两侧留出大片黑边，用户看到的就是「竖图变横屏」。
 * 这里先把盒子算对，CSS 只是把图铺满盒子。
 */

/** 最长边上限（px） */
export const HOVER_PREVIEW_MAX_SIDE = 200
/** 极端比例兜底：再细的图也不至于变成 1px 线 */
const MIN_SIDE = 24

/** 宽高比 → 预览盒子的像素尺寸（最长边 = MAX_SIDE） */
export function fitPreviewBox(
  width: number | null | undefined,
  height: number | null | undefined,
  maxSide: number = HOVER_PREVIEW_MAX_SIDE,
): { width: number; height: number } {
  const w = Number(width)
  const h = Number(height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    // 尺寸未知（还没 decode）：先给一个方盒子，拿到真实尺寸后会被覆盖
    return { width: maxSide, height: maxSide }
  }
  if (w >= h) {
    return { width: Math.round(maxSide), height: Math.round(Math.max(MIN_SIDE, (maxSide * h) / w)) }
  }
  return { width: Math.round(Math.max(MIN_SIDE, (maxSide * w) / h)), height: Math.round(maxSide) }
}
