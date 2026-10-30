/**
 * videoPreviewFit —— 全屏预览里视频该占多大（纯函数，零 DOM / 零 Vue，Node 可单测）。
 *
 * 用户口径 2026-10-30：「不管横屏还是竖屏，让它们呆在一个宽 80%、高 80% 的容器里，
 * 保持宽高比，然后居中显示，宽度或高度慢慢增大，直到一方 100%」。
 * 翻译成一条规则就是**等比 contain**：先按舞台的宽高比缩到刚好放得下，
 * 结果必然是一方贴满、另一方不超过舞台。
 *
 * 为什么不用 CSS 的 `width:auto + aspect-ratio + max-width/max-height`：
 * `auto` 会让浏览器按视频的**原始像素**定尺寸，1280×720 在更大的舞台里就只剩中间一小块；
 * 再叠一个百分比下限还会把高度撑出容器。量出舞台尺寸、算成具体像素最稳。
 */

export interface PreviewBox {
  width: number
  height: number
}

/** 只认正有限数（0 / NaN / 负数都算“量不到”） */
function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** 保留两位小数：像素差 0.01 看不出来，但能避免长小数写进 style */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 算出视频在舞台里该占的像素宽高（等比、居中由父级负责）。
 *
 * @param videoWidth  视频原始宽（videoWidth）
 * @param videoHeight 视频原始高（videoHeight）
 * @param stageWidth  舞台可用宽（父级 clientWidth）
 * @param stageHeight 舞台可用高（父级 clientHeight）
 * @returns 像素宽高；任一参数量不到时返回 null（调用方保持原样，不猜尺寸）
 */
export function fitPreviewBox(
  videoWidth: unknown,
  videoHeight: unknown,
  stageWidth: unknown,
  stageHeight: unknown,
): PreviewBox | null {
  const vw = positive(videoWidth)
  const vh = positive(videoHeight)
  const sw = positive(stageWidth)
  const sh = positive(stageHeight)
  if (vw === null || vh === null || sw === null || sh === null) return null

  // contain：哪个方向先顶到边，就按哪个方向算比例
  const k = Math.min(sw / vw, sh / vh)
  // 向下取整再算另一边，避免四舍五入把某一边撑出舞台 1px（用户会看到溢出/滚动条）
  let width = Math.min(round2(vw * k), sw)
  let height = Math.min(round2(vh * k), sh)
  // 先削宽度再重算高度，比例不至于跑偏太多
  if (width >= sw) {
    width = sw
    height = Math.min(round2((sw * vh) / vw), sh)
  }
  if (height >= sh) {
    height = sh
    width = Math.min(round2((sh * vw) / vh), sw)
  }
  return { width: round2(width), height: round2(height) }
}
