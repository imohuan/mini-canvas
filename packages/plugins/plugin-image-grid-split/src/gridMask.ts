/**
 * gridMask —— 切分模式的「抠除」遮罩（纯字符串生成，零 DOM，Node 可单测）。
 *
 * 用户口径 2026-10-30（参考 deepseek_html 示例）：格子之间的缝隙必须是**透明**的，
 * 直接露出画布背景，而不是拿一种颜色盖住。示例里 gap 是透明的，每个格子
 * 只有四个外角带圆角（radius-tl / tr / bl / br），中间全是直角。
 *
 * 实现：生成一张 SVG 遮罩（黑底 + 白色格子），作为 CSS mask-image 贴到卡片上。
 * 白色 = 保留（格子里的图可见），黑色 = 抠掉（缝隙透出下面的画布）。
 * 为什么不用 clip-path：clip-path 只能一条路径，圆角要自己算弧线；
 * 而 mask 里每个格子可以是独立的 path，四角圆角各写各的，清楚得多。
 */

/** 一个格子的遮罩形状（坐标 = 卡片内 px） */
export interface MaskCell {
  x: number
  y: number
  w: number
  h: number
  /** 四个角各自的圆角半径（只有最外圈的格子才非 0） */
  tl: number
  tr: number
  br: number
  bl: number
}

/** 数字格式化：保留两位、去掉多余的 .00（SVG 字符串更短） */
function n(v: number): string {
  const r = Math.round(v * 100) / 100
  return Number.isFinite(r) ? String(r) : '0'
}

/**
 * 带**逐角圆角**的矩形路径（SVG 的 rect rx 只能四角同值，这里必须手画）。
 * 半径会被夹到不超过半宽/半高，避免画出自交的怪形状。
 */
export function roundedRectPath(c: MaskCell): string {
  const maxR = Math.min(c.w, c.h) / 2
  const tl = Math.min(Math.max(c.tl, 0), maxR)
  const tr = Math.min(Math.max(c.tr, 0), maxR)
  const br = Math.min(Math.max(c.br, 0), maxR)
  const bl = Math.min(Math.max(c.bl, 0), maxR)
  const x = c.x
  const y = c.y
  const w = c.w
  const h = c.h
  const parts: string[] = ['M' + n(x + tl) + ',' + n(y)]
  parts.push('H' + n(x + w - tr))
  if (tr > 0) parts.push('A' + n(tr) + ',' + n(tr) + ' 0 0 1 ' + n(x + w) + ',' + n(y + tr))
  parts.push('V' + n(y + h - br))
  if (br > 0) parts.push('A' + n(br) + ',' + n(br) + ' 0 0 1 ' + n(x + w - br) + ',' + n(y + h))
  parts.push('H' + n(x + bl))
  if (bl > 0) parts.push('A' + n(bl) + ',' + n(bl) + ' 0 0 1 ' + n(x) + ',' + n(y + h - bl))
  parts.push('V' + n(y + tl))
  if (tl > 0) parts.push('A' + n(tl) + ',' + n(tl) + ' 0 0 1 ' + n(x + tl) + ',' + n(y))
  parts.push('Z')
  return parts.join(' ')
}

/**
 * 生成可直接塞进 CSS mask-image 的 data URI。
 *
 * @param cells 每个格子的矩形与四角圆角（通常由 slotRects 算出）
 * @param boardW 卡片宽（遮罩必须与卡片同尺寸，否则会错位）
 * @param boardH 卡片高
 * @returns data URI 字符串；没有格子时返回空串（调用方据此不加遮罩）
 */
export function gridMaskUri(cells: MaskCell[], boardW: number, boardH: number): string {
  if (cells.length === 0) return ''
  if (!Number.isFinite(boardW) || !Number.isFinite(boardH) || boardW <= 0 || boardH <= 0) return ''
  const shapes = cells.map((c) => '<path d="' + roundedRectPath(c) + '" fill="#fff"/>').join('')
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + n(boardW) + '" height="' + n(boardH) +
    '" viewBox="0 0 ' + n(boardW) + ' ' + n(boardH) + '" preserveAspectRatio="none">' +
    '<rect width="' + n(boardW) + '" height="' + n(boardH) + '" fill="#000"/>' +
    shapes +
    '</svg>'
  // encodeURIComponent 处理 # 和引号；外层用双引号包住 data URI（CSS 要求）
  return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")'
}
