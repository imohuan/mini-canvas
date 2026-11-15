/**
 * mediaFill —— 视频画面到底该「铺满」还是「完整可见」（纯函数，Node 可单测）。
 *
 * 用户 2026-11-14 截图：视频节点四周有一条约 1px 的黑线，看着像卡片边框被裁掉了。
 * 查下来边框本身没问题（BaseNode 的 `.v2-card` 是 1px 浅灰、圆角正常），
 * 黑线是**画面层**露出来的：
 *
 * - 卡片尺寸是 `fitMediaCard` 取整算出来的（420×576 的裁框 → 408×560），
 *   去掉 1px 边框后内框 406×558，与画面比例差不到 1px；
 * - 画面用 `object-fit: contain` 等比缩放，多出来的那不足 1px 就露出
 *   `.video-stage` 的近黑底 —— 在屏幕上就是一条黑缝。
 *
 * 所以这里只回答一个问题：**卡片内框的比例是否已经和画面一致（只差取整的亚像素）**。
 * 一致时铺满（cover 在这种比例下与 contain 结果相同，一个像素都不会多裁）；
 * 不一致（卡片被手动拖过 / 画面还没量到 / 4:3 卡片装 16:9）才回到 contain ——
 * 那时宁可留窄黑边，也不能丢掉画面内容。
 */

export interface MediaFillInput {
  /** 画面像素宽高（视频/图片真实尺寸）；0 / 非法视为「还不知道」 */
  mediaWidth: number
  mediaHeight: number
  /** 卡片外尺寸（含边框，与 node.size 同口径） */
  cardWidth: number
  cardHeight: number
  /**
   * 盒子自身的 border 宽度（CSS px）。
   * 卡片边框现在是画在盒子外面的 ring，所以这个值在生产路径恒为 0；
   * 留着是为了兼容「真有内描边」的宿主主题。
   */
  borderWidth: number
}

/**
 * 允许的缝隙（CSS px）。
 *
 * `fitMediaCard` 对宽高分别取整，最坏会差 0.5×2 = 1px；再留一点给 0.4× 缩放下的
 * 亚像素舍入。超过这个量就不是「取整误差」而是真的比例不符了。
 */
export const MEDIA_FILL_TOLERANCE_PX = 2

function positive(v: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

/**
 * 画面该用哪种填充方式。
 *
 * @returns `'cover'` = 铺满（比例一致，不留缝）；`'contain'` = 完整可见（比例不符时的保守选择）
 */
export function resolveMediaFillMode(input: MediaFillInput, zoom = 1): 'cover' | 'contain' {
  const mediaW = positive(input.mediaWidth)
  const mediaH = positive(input.mediaHeight)
  const cardW = positive(input.cardWidth)
  const cardH = positive(input.cardHeight)
  if (mediaW === null || mediaH === null || cardW === null || cardH === null) return 'contain'

  const border = Number.isFinite(input.borderWidth) && input.borderWidth > 0 ? input.borderWidth : 0
  const boxW = cardW - border * 2
  const boxH = cardH - border * 2
  if (boxW <= 0 || boxH <= 0) return 'contain'

  const aspect = mediaW / mediaH
  // 缝有多大：哪一种方向顶满之后，另一边还差多少 CSS px
  const slack = boxW / boxH > aspect ? boxW - boxH * aspect : boxH - boxW / aspect

  // 画布缩小时，1 CSS px 只剩零点几个屏幕像素；阈值跟着缩放走，免得把「看不见的缝」判成铺满
  const z = typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return Math.abs(slack) <= MEDIA_FILL_TOLERANCE_PX / z ? 'cover' : 'contain'
}
