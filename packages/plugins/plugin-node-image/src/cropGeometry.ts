/**
 * cropGeometry —— 图片裁剪框的纯几何（零 DOM、零 Vue，node 环境可单测）。
 *
 * 坐标系约定（与 v1 ImageCropper 一致）：
 * - **图片像素坐标**：裁剪框的真身（x/y/width/height 都是原图像素）。确认裁剪时直接拿它去 canvas，
 *   不必再换算一次，避免"显示值 → 像素值"的二次舍入误差。
 * - **显示坐标**：裁剪框画在覆盖层里时的 CSS px。二者只差一个 object-contain 的缩放比 scale + 偏移 ox/oy。
 *
 * 最小边：图片像素下限 MIN_CROP_IMAGE(20)，同时保证屏幕上不小于 MIN_CROP_DISPLAY_EDGE(8)px ——
 * 大图（scale 极小）时若只按 20 图片像素算，裁剪框会缩成看不见的一条线，故取两者较大值。
 */

/** 矩形（图片像素坐标；显示坐标复用同形状） */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** object-contain 的显示几何：绘制尺寸 dw/dh、在容器内的偏移 ox/oy、图片像素→显示 px 的缩放比 scale */
export interface FitGeometry {
  dw: number
  dh: number
  ox: number
  oy: number
  scale: number
}

/** 四个可拖拽的角 */
export type CropCorner = 'nw' | 'ne' | 'sw' | 'se'

/** 操作条落点（left 为**中心** x，调用方配 translateX(-50%) 居中） */
export interface ActionBarPlacement {
  left: number
  top: number
}

/** 裁剪框在图片像素下的最小边（px） */
export const MIN_CROP_IMAGE = 20
/** 裁剪框在屏幕上必须至少这么大（px），防大图缩成一条线 */
export const MIN_CROP_DISPLAY_EDGE = 8
/** 初始裁剪框边长 = min(图宽,图高) 的比例 */
export const DEFAULT_CROP_RATIO = 0.8
/** 裁剪操作条与裁剪框底边的间距（px） */
export const ACTION_BAR_GAP = 10

/** 正数守卫：非有限值/<=0 一律回落 1，避免除零与负尺寸 */
function positive(v: number, fallback = 1): number {
  return Number.isFinite(v) && v > 0 ? v : fallback
}

/**
 * 算 object-contain 下的显示几何：图片保持宽高比、在容器内居中、完整可见。
 * 容器尺寸为 0（未量测）时按 1 处理，不回 NaN。
 */
export function computeFit(containerW: number, containerH: number, imageW: number, imageH: number): FitGeometry {
  const cw = positive(containerW)
  const ch = positive(containerH)
  const iw = positive(imageW)
  const ih = positive(imageH)
  const containerAspect = cw / ch
  const imageAspect = iw / ih
  let dw: number
  let dh: number
  let ox: number
  let oy: number
  if (imageAspect > containerAspect) {
    dw = cw
    dh = cw / imageAspect
    ox = 0
    oy = (ch - dh) / 2
  } else {
    dh = ch
    dw = ch * imageAspect
    ox = (cw - dw) / 2
    oy = 0
  }
  return { dw, dh, ox, oy, scale: dw / iw }
}

/** 当前缩放下的裁剪框最小边（图片像素）：像素下限与"屏幕至少 8px"取较大值 */
export function minCropEdge(scale: number): number {
  return Math.max(MIN_CROP_IMAGE, MIN_CROP_DISPLAY_EDGE / positive(scale))
}

/** 初始裁剪框：居中、边长 = min(图宽,图高) × 0.8，并按边界/最小边收敛 */
export function defaultCropRect(imageWidth: number, imageHeight: number, scale: number): Rect {
  const iw = positive(imageWidth)
  const ih = positive(imageHeight)
  const side = Math.min(iw, ih) * DEFAULT_CROP_RATIO
  return clampRect(
    { x: (iw - side) / 2, y: (ih - side) / 2, width: side, height: side },
    iw,
    ih,
    minCropEdge(scale),
  )
}

/**
 * 把矩形收进 [0,图宽]×[0,图高] 且不小于最小边。
 * 图本身小于最小边时，最小边退化为图尺寸（不强行撑出界外）。
 */
export function clampRect(rect: Rect, imageWidth: number, imageHeight: number, minEdge: number): Rect {
  const iw = positive(imageWidth)
  const ih = positive(imageHeight)
  const minW = Math.min(Math.max(minEdge, 1), iw)
  const minH = Math.min(Math.max(minEdge, 1), ih)
  const width = Math.min(Math.max(rect.width, minW), iw)
  const height = Math.min(Math.max(rect.height, minH), ih)
  const x = Math.min(Math.max(rect.x, 0), iw - width)
  const y = Math.min(Math.max(rect.y, 0), ih - height)
  return { x, y, width, height }
}

/** 整体平移（dx/dy 为图片像素增量），越界即贴边、尺寸不变 */
export function moveRect(
  rect: Rect,
  dx: number,
  dy: number,
  imageWidth: number,
  imageHeight: number,
  minEdge: number,
): Rect {
  return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, imageWidth, imageHeight, minEdge)
}

/**
 * 拖某个角缩放（dx/dy 为图片像素增量；固定对角、只动本角的两条边）。
 * 先按最小边夹取本边，再按图像边界夹取；顺序保证"贴边不越界、翻不过对角"。
 */
export function resizeRect(
  rect: Rect,
  corner: CropCorner,
  dx: number,
  dy: number,
  imageWidth: number,
  imageHeight: number,
  minEdge: number,
): Rect {
  const iw = positive(imageWidth)
  const ih = positive(imageHeight)
  const minW = Math.min(Math.max(minEdge, 1), iw)
  const minH = Math.min(Math.max(minEdge, 1), ih)
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  let x = rect.x
  let y = rect.y
  let width = rect.width
  let height = rect.height

  if (corner === 'nw' || corner === 'sw') {
    const nx = Math.min(Math.max(rect.x + dx, 0), right - minW)
    x = nx
    width = right - nx
  } else {
    width = Math.min(Math.max(rect.width + dx, minW), iw - rect.x)
  }

  if (corner === 'nw' || corner === 'ne') {
    const ny = Math.min(Math.max(rect.y + dy, 0), bottom - minH)
    y = ny
    height = bottom - ny
  } else {
    height = Math.min(Math.max(rect.height + dy, minH), ih - rect.y)
  }

  return { x, y, width, height }
}

/** 图片像素矩形 → 覆盖层内的显示矩形（相对 fit 的容器原点） */
export function rectToDisplay(rect: Rect, fit: FitGeometry): Rect {
  return {
    x: fit.ox + rect.x * fit.scale,
    y: fit.oy + rect.y * fit.scale,
    width: rect.width * fit.scale,
    height: rect.height * fit.scale,
  }
}

/** 屏幕指针位移 → 图片像素位移（除零守卫） */
export function screenDeltaToImage(dx: number, dy: number, scale: number): { dx: number; dy: number } {
  const s = positive(scale)
  return { dx: dx / s, dy: dy / s }
}

/** 提交给 canvas 的整像素矩形：四舍五入、宽高至少 1px */
export function toCropPixels(rect: Rect): Rect {
  const x = Math.round(rect.x)
  const y = Math.round(rect.y)
  return {
    x,
    y,
    width: Math.max(1, Math.round(rect.x + rect.width) - x),
    height: Math.max(1, Math.round(rect.y + rect.height) - y),
  }
}

/**
 * 操作条落点：默认贴在裁剪框下方居中；下方不够就上移到框内底部。
 * left 是中心坐标（调用方 translateX(-50%)），并把中心收进容器内免得贴边溢出。
 */
export function placeActionBar(
  frame: Rect,
  boxW: number,
  boxH: number,
  barW: number,
  barH: number,
  gap: number = ACTION_BAR_GAP,
): ActionBarPlacement {
  const w = positive(boxW)
  const h = positive(boxH)
  const bw = positive(barW)
  const bh = positive(barH)
  const center = frame.x + frame.width / 2
  const half = bw / 2
  const left = Math.min(Math.max(center, half + 2), Math.max(w - half - 2, half + 2))
  const below = frame.y + frame.height + gap
  const top = below + bh <= h ? below : Math.min(Math.max(frame.y + frame.height - bh - gap, 0), Math.max(h - bh, 0))
  return { left, top }
}
