/**
 * 悬浮预览的定位（纯函数，零 DOM —— 好写单测）。
 *
 * 用户口径（2026-10-29，带两张截图）：
 *   · 预览图必须在卡片的**上方**（放下面会盖住输入框，也会和卡片气泡叠在一起）；
 *   · 卡片气泡（主题 Tooltip）在卡片**下方** —— 一上一下，两个浮层互不遮挡；
 *   · 预览框用 translateY(-100%) 从「卡片顶 - 10px」往上长，**不预先猜高度**；
 *   · 上方真的放不下（卡片已经很靠上）才翻到下方；
 *   · 水平居中于卡片，左右夹进视口留 8px。
 */

/** 预览框宽度（与 CSS .nb-hover-preview 的 width 保持一致） */
export const HOVER_PREVIEW_WIDTH = 220
/** 与卡片之间的间距 */
const GAP = 10
/** 视口内留白 */
const MARGIN = 8
/** 估算高度：只用来判断"上方还有没有地方"，真实高度由 translateY(-100%) 兜住 */
const ESTIMATE_HEIGHT = 170

export interface PreviewPlacement {
  left: number
  top: number
  /** true = 预览在卡片上方（配 translateY(-100%)）；false = 翻到了下方 */
  above: boolean
}

/** 把卡片的屏幕矩形 + 视口尺寸 → 预览框的 left/top */
export function placeHoverPreview(
  card: { left: number; right: number; top: number; bottom: number; width: number },
  viewport: { width: number; height: number },
): PreviewPlacement {
  const maxLeft = Math.max(MARGIN, viewport.width - HOVER_PREVIEW_WIDTH - MARGIN)
  const left = Math.round(
    Math.min(Math.max(MARGIN, card.left + card.width / 2 - HOVER_PREVIEW_WIDTH / 2), maxLeft),
  )
  const above = card.top - ESTIMATE_HEIGHT - GAP >= MARGIN
  return above
    ? { left, top: Math.round(card.top - GAP), above: true }
    : { left, top: Math.round(card.bottom + GAP), above: false }
}
