/**
 * mediaFit —— 节点「编辑浮层」（裁剪 / 扩展）共用的纯几何（零 DOM / 零 Vue，Node 可单测）。
 *
 * 为什么收在渲染层而不是各节点插件里：图片节点与视频节点要做的是**同一件事** ——
 * 在媒体画面的坐标系里框一块区域。此前图片插件有 cropGeometry、视频插件有 videoCrop，
 * 两份几乎逐行相同却各自漂移（视频那份少了扩展、控制点样式也不一样）。用户明确要求把它
 * 做成通用件，于是这里成为唯一实现，两个插件都消费它。
 *
 * 两套坐标系（与 v1 一致，别混）：
 * - **媒体像素坐标**：框的真身（x/y/width/height 都是原始画面的像素）。提交给 canvas 时直接用它，
 *   不做二次换算，避免「显示的 → 像素的」二次舍入误差。
 * - **显示坐标**：框画在浮层里时的 CSS px。二者只差一个 object-contain 的缩放比 scale 与偏移 ox/oy。
 *
 * 两种模式的区别只有**约束**：
 * - crop（裁剪）：框必须落在画面之内（框外是要去掉的部分）；
 * - expand（扩展）：框必须**包住**画面（框外是要新加的画布，用于往外扩图）。
 * 手柄也不同：裁剪只给 4 个角（边没有意义 —— 只能缩小），扩展给 8 个（要能往某一侧单独扩）。
 */

/** 矩形（媒体像素坐标；显示坐标复用同形状） */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** object-contain 的显示几何：绘制尺寸 dw/dh、容器内偏移 ox/oy、媒体像素→显示 px 的缩放比 scale */
export interface FitGeometry {
  dw: number
  dh: number
  ox: number
  oy: number
  scale: number
}

/** 手柄方向：4 个角 + 4 条边（裁剪只用角，扩展用全部） */
export type HandleDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** 裁剪用的 4 个角 */
export const CORNER_DIRS: HandleDir[] = ['nw', 'ne', 'sw', 'se']
/** 扩展用的 8 个方向（含边，才能只往一侧扩） */
export const ALL_DIRS: HandleDir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** 框在媒体像素下的最小边 */
export const MIN_FRAME_MEDIA = 20
/** 框在屏幕上至少这么大（px）：大图被缩得很小时，只按像素下限算框会小成看不见的一条线 */
export const MIN_FRAME_DISPLAY_EDGE = 8
/** 裁剪框初始边长 = min(画面宽,高) 的比例（对齐 v1 的 0.8） */
export const DEFAULT_CROP_RATIO = 0.8

/** 正数守卫：非有限值 / <=0 一律回落 fallback，避免除零与负尺寸 */
function positive(v: number, fallback = 1): number {
  return Number.isFinite(v) && v > 0 ? v : fallback
}

/**
 * 算 object-contain 下的显示几何：画面保持宽高比、在容器内居中、完整可见。
 * 容器尺寸为 0（未量测）时按 1 处理，绝不回 NaN（NaN 会让整条 CSS 失效、浮层直接消失）。
 */
export function computeMediaFit(containerW: number, containerH: number, mediaW: number, mediaH: number): FitGeometry {
  const cw = positive(containerW)
  const ch = positive(containerH)
  const mw = positive(mediaW)
  const mh = positive(mediaH)
  const containerAspect = cw / ch
  const mediaAspect = mw / mh
  let dw: number
  let dh: number
  let ox: number
  let oy: number
  if (mediaAspect > containerAspect) {
    // 画面更宽：宽度顶满，上下留黑边
    dw = cw
    dh = cw / mediaAspect
    ox = 0
    oy = (ch - dh) / 2
  } else {
    // 画面更高：高度顶满，左右留黑边
    dh = ch
    dw = ch * mediaAspect
    ox = (cw - dw) / 2
    oy = 0
  }
  return { dw, dh, ox, oy, scale: dw / mw }
}

/** 当前缩放下的框最小边（媒体像素）：像素下限与「屏幕上至少 8px」取较大值 */
export function minFrameEdge(scale: number): number {
  return Math.max(MIN_FRAME_MEDIA, MIN_FRAME_DISPLAY_EDGE / positive(scale))
}

/** 初始裁剪框：居中、边长 = min(画面宽,高) × 0.8，并按边界/最小边收敛 */
export function defaultCropRect(mediaW: number, mediaH: number, scale: number): Rect {
  const mw = positive(mediaW)
  const mh = positive(mediaH)
  const side = Math.min(mw, mh) * DEFAULT_CROP_RATIO
  return clampCropRect({ x: (mw - side) / 2, y: (mh - side) / 2, width: side, height: side }, mw, mh, minFrameEdge(scale))
}

/** 初始扩展框 = 整幅画面（用户从「原样」开始往外拉） */
export function defaultExpandRect(mediaW: number, mediaH: number): Rect {
  return { x: 0, y: 0, width: positive(mediaW), height: positive(mediaH) }
}

/**
 * 把裁剪框收进 [0,画面宽]×[0,画面高] 且不小于最小边。
 * 画面本身比最小边还小时，最小边退化为画面尺寸（不强行撑出界外）。
 */
export function clampCropRect(rect: Rect, mediaW: number, mediaH: number, minEdge: number): Rect {
  const mw = positive(mediaW)
  const mh = positive(mediaH)
  const minW = Math.min(Math.max(minEdge, 1), mw)
  const minH = Math.min(Math.max(minEdge, 1), mh)
  const width = Math.min(Math.max(rect.width, minW), mw)
  const height = Math.min(Math.max(rect.height, minH), mh)
  const x = Math.min(Math.max(rect.x, 0), mw - width)
  const y = Math.min(Math.max(rect.y, 0), mh - height)
  return { x, y, width, height }
}

/**
 * 把扩展框收敛成「至少包住整幅画面」：
 * x/y 不得为正（否则左边/上边会切掉原图）、右/下不得缩进画面之内。
 * 往外（x/y 更负、宽高更大）不设上限 —— 用户想扩多远就多远。
 */
export function clampExpandRect(rect: Rect, mediaW: number, mediaH: number): Rect {
  const mw = positive(mediaW)
  const mh = positive(mediaH)
  const x = Math.min(rect.x, 0)
  const y = Math.min(rect.y, 0)
  const right = Math.max(rect.x + rect.width, mw)
  const bottom = Math.max(rect.y + rect.height, mh)
  return { x, y, width: right - x, height: bottom - y }
}

/** 裁剪框整体平移（越界即贴边、尺寸不变） */
export function moveCropRect(rect: Rect, dx: number, dy: number, mediaW: number, mediaH: number, minEdge: number): Rect {
  return clampCropRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, mediaW, mediaH, minEdge)
}

/** 扩展框整体平移（不能移动到切掉原图；往外移不设限） */
export function moveExpandRect(rect: Rect, dx: number, dy: number, mediaW: number, mediaH: number): Rect {
  return clampExpandRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, mediaW, mediaH)
}

/** 该方向是否影响左/右/上/下边 */
function affectsLeft(dir: HandleDir): boolean {
  return dir === 'nw' || dir === 'w' || dir === 'sw'
}
function affectsRight(dir: HandleDir): boolean {
  return dir === 'ne' || dir === 'e' || dir === 'se'
}
function affectsTop(dir: HandleDir): boolean {
  return dir === 'nw' || dir === 'n' || dir === 'ne'
}
function affectsBottom(dir: HandleDir): boolean {
  return dir === 'sw' || dir === 's' || dir === 'se'
}

/**
 * 拖某个手柄缩放**裁剪框**（固定对角/对边，只动本方向影响的那几条边）。
 * 先按最小边夹取本边、再按画面边界夹取 —— 顺序保证「贴边不越界、翻不过对角」。
 */
export function resizeCropRect(
  rect: Rect,
  dir: HandleDir,
  dx: number,
  dy: number,
  mediaW: number,
  mediaH: number,
  minEdge: number,
): Rect {
  const mw = positive(mediaW)
  const mh = positive(mediaH)
  const minW = Math.min(Math.max(minEdge, 1), mw)
  const minH = Math.min(Math.max(minEdge, 1), mh)
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  let x = rect.x
  let y = rect.y
  let width = rect.width
  let height = rect.height

  if (affectsLeft(dir)) {
    const nx = Math.min(Math.max(rect.x + dx, 0), right - minW)
    x = nx
    width = right - nx
  } else if (affectsRight(dir)) {
    width = Math.min(Math.max(rect.width + dx, minW), mw - rect.x)
  }

  if (affectsTop(dir)) {
    const ny = Math.min(Math.max(rect.y + dy, 0), bottom - minH)
    y = ny
    height = bottom - ny
  } else if (affectsBottom(dir)) {
    height = Math.min(Math.max(rect.height + dy, minH), mh - rect.y)
  }

  return { x, y, width, height }
}

/**
 * 拖某个手柄缩放**扩展框**。
 *
 * 与裁剪的区别：往左/上拉时框会自然长大（x 变负 = 新画布加在左边），
 * 但**永远不能拉进画面之内**（那会把原图切掉）—— 所以左/上边被压到 0 就不再往里收，
 * 右/下边被压到画面的右/下缘就不再往里收。
 */
export function resizeExpandRect(
  rect: Rect,
  dir: HandleDir,
  dx: number,
  dy: number,
  mediaW: number,
  mediaH: number,
): Rect {
  const mw = positive(mediaW)
  const mh = positive(mediaH)
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  let x = rect.x
  let y = rect.y
  let width = rect.width
  let height = rect.height

  if (affectsLeft(dir)) {
    // 左边界最右只能到 0（再往右就切到原图了）
    x = Math.min(0, rect.x + dx)
    width = right - x
  } else if (affectsRight(dir)) {
    width = Math.max(mw, rect.width + dx)
  }

  if (affectsTop(dir)) {
    y = Math.min(0, rect.y + dy)
    height = bottom - y
  } else if (affectsBottom(dir)) {
    height = Math.max(mh, rect.height + dy)
  }

  return { x, y, width, height }
}

/** 媒体像素矩形 → 浮层内的显示矩形（相对 fit 的容器原点） */
export function rectToDisplay(rect: Rect, fit: FitGeometry): Rect {
  return {
    x: fit.ox + rect.x * fit.scale,
    y: fit.oy + rect.y * fit.scale,
    width: rect.width * fit.scale,
    height: rect.height * fit.scale,
  }
}

/**
 * 屏幕指针位移 → 媒体像素位移。
 *
 * 为什么需要 screenPerCss 这个参数（实测缺陷：画布缩放后框"跟不上鼠标"）：
 * 浮层住在节点里，而节点被 VueFlow 的视口按 zoom 缩放过 —— 所以浮层里的 1 CSS px
 * 在屏幕上只有 zoom 个像素。而指针位移（clientX/clientY 差值）是**屏幕像素**。
 * 少乘这个系数，zoom=0.5 时同样的鼠标位移会让框跑两倍远（用户看到的就是"不跟手"）；
 * zoom=1 时系数为 1，所以只有缩放后才看得出来。
 *
 * @param scale        媒体像素 → 浮层 CSS px 的缩放比（computeMediaFit 的 scale）
 * @param screenPerCss 屏幕上 1 CSS px 等于几个屏幕像素（= 视口 zoom + 任何祖先变换的总效果）
 */
export function screenDeltaToMedia(
  dx: number,
  dy: number,
  scale: number,
  screenPerCss = 1,
): { dx: number; dy: number } {
  const factor = positive(scale) * positive(screenPerCss)
  return { dx: dx / factor, dy: dy / factor }
}

/**
 * 由实测尺寸推算"屏幕上 1 CSS px = 几个屏幕像素"。
 *
 * 用实测而不是直接读 viewport.zoom：这样连祖先的任何变换（视口缩放、卡片自身的变换）
 * 一起算进去，不必假设"缩放的唯一来源是 VueFlow"。两者都拿不到时回落 1（不缩放）。
 *
 * @param screenWidth 元素在屏幕上的宽度（getBoundingClientRect().width）
 * @param cssWidth    元素的布局宽度（clientWidth，未受变换影响）
 */
export function resolveScreenPerCss(screenWidth: number, cssWidth: number): number {
  const css = positive(cssWidth, 0)
  const screen = positive(screenWidth, 0)
  if (css <= 0 || screen <= 0) return 1
  return screen / css
}

/** 提交给 canvas 的整像素矩形：四舍五入、宽高至少 1px */
export function toPixelRect(rect: Rect): Rect {
  const x = Math.round(rect.x)
  const y = Math.round(rect.y)
  return {
    x,
    y,
    width: Math.max(1, Math.round(rect.x + rect.width) - x),
    height: Math.max(1, Math.round(rect.y + rect.height) - y),
  }
}

/** 矩形是否可用（正的宽高、有限坐标）—— 脏数据不该写进库 */
export function isUsableRect(rect: Rect | undefined | null): rect is Rect {
  if (!rect) return false
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  )
}

/**
 * 裁剪后画面在**卡片内**该多大、偏移多少（CSS 百分比）。
 *
 * 推理：卡片尺寸已按裁框比例设好（cropW × cropH 等比缩放后），所以卡片里要显示的就是
 * 原画面的一个取景框。把画面放大到「原宽 ÷ 裁框宽」倍，再往左上推「裁框起点 ÷ 裁框宽」倍，
 * 于是裁框那块正好填满卡片，其余被卡片 overflow:hidden 裁掉。
 *
 * @returns 空对象表示「整幅画面，不需要放大与偏移」（rect 缺失/非法时）
 */
export function framedMediaStyle(rect: Rect | undefined, sourceW: number, sourceH: number): Record<string, string> {
  if (!isUsableRect(rect)) return {}
  const sw = positive(sourceW, 0)
  const sh = positive(sourceH, 0)
  if (sw <= 0 || sh <= 0) return {}
  const pct = (n: number): string => String(n * 100) + '%'
  return {
    width: pct(sw / rect.width),
    height: pct(sh / rect.height),
    left: pct(-rect.x / rect.width),
    top: pct(-rect.y / rect.height),
  }
}
