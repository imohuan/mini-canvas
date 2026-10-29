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

/** 预览框默认宽度（尺寸未知时的方盒子边长；见 previewBoxSize.ts） */
export const HOVER_PREVIEW_WIDTH = 220
/** 与卡片之间的间距 */
const GAP = 10
/** 视口内留白 */
const MARGIN = 8
/** 估算高度：盒子尺寸未知时才用它判断"上方还有没有地方" */
const ESTIMATE_HEIGHT = 170

export interface PreviewPlacement {
  left: number
  top: number
  /** true = 预览在卡片上方（配 translateY(-100%)）；false = 翻到了下方 */
  above: boolean
}

/**
 * 把卡片的屏幕矩形 + 视口尺寸 → 预览框的 left/top
 *
 * `box` 是预览框的**真实**尺寸（按素材宽高比算出来的，见 previewBoxSize.fitPreviewBox）。
 * 给了它，左右夹取与"上方放不放得下"都按真实尺寸判，竖图/横图各占各的地方。
 */
export function placeHoverPreview(
  card: { left: number; right: number; top: number; bottom: number; width: number },
  viewport: { width: number; height: number },
  box?: { width: number; height: number },
): PreviewPlacement {
  const boxWidth = box?.width ?? HOVER_PREVIEW_WIDTH
  const boxHeight = box?.height ?? ESTIMATE_HEIGHT
  const maxLeft = Math.max(MARGIN, viewport.width - boxWidth - MARGIN)
  const left = Math.round(
    Math.min(Math.max(MARGIN, card.left + card.width / 2 - boxWidth / 2), maxLeft),
  )
  const above = card.top - boxHeight - GAP >= MARGIN
  return above
    ? { left, top: Math.round(card.top - GAP), above: true }
    : { left, top: Math.round(card.bottom + GAP), above: false }
}
