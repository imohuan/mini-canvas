/**
 * 主题工作台的色块 → 画布目标「指示线」。
 *
 * 为什么单独写：锚点必须量**渲染后的真实 DOM**，不能用布局公式猜。
 * 所以这里只做三件事：量目标矩形、选离它最近的色块边沿、画三次贝塞尔。
 * 目标不存在 / 被别的元素盖住 → 直接不画（宁可没有线，也不能画一条错的线）。
 */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface GuideLine {
  /** 从色块出发的哪个边（left / right / top / bottom） */
  side: 'left' | 'right' | 'top' | 'bottom'
  /** 色块上的起点 */
  start: { x: number; y: number }
  /** 目标上的终点 */
  end: { x: number; y: number }
  /** 三次贝塞尔控制点 */
  c1: { x: number; y: number }
  c2: { x: number; y: number }
  /** SVG path d */
  d: string
  /** 离目标最近的边沿点所属方向（用于目标端的圆点位置） */
  targetSide: 'left' | 'right' | 'top' | 'bottom'
}

const MIN_CURVE = 26

/**
 * 判断元素是不是 SVG path。
 *
 * 不用 `element instanceof SVGPathElement`：切割 overlay 的 path 来自页面自己的
 * DOM realm，instanceof 会返回 false，带 pathAt 的锚点于是被当成普通矩形。
 * 命名空间 + 标签名跨 realm 都可靠。
 */
export function isSvgPath(element: Element): element is SVGPathElement {
  return element.namespaceURI === 'http://www.w3.org/2000/svg' && element.tagName.toLowerCase() === 'path'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 四个边沿中心点，选离目标中心最近的那一个 */
export function nearestEdgePoint(
  rect: Box,
  target: { x: number; y: number },
): { point: { x: number; y: number }; side: GuideLine['side'] } {
  const candidates: Array<{ point: { x: number; y: number }; side: GuideLine['side'] }> = [
    { point: { x: rect.x, y: rect.y + rect.h / 2 }, side: 'left' },
    { point: { x: rect.x + rect.w, y: rect.y + rect.h / 2 }, side: 'right' },
    { point: { x: rect.x + rect.w / 2, y: rect.y }, side: 'top' },
    { point: { x: rect.x + rect.w / 2, y: rect.y + rect.h }, side: 'bottom' },
  ]
  let best = candidates[0]
  let bestDistance = Infinity
  for (const candidate of candidates) {
    const dx = candidate.point.x - target.x
    const dy = candidate.point.y - target.y
    const distance = dx * dx + dy * dy
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return best
}

/**
 * 生成一条指示线。
 *
 * 起点的选取原则：优先走“色块朝向画布的那一边”（左栏向右、右栏向左、下栏向上），
 * 这样线从色块出来时不会先往回折进卡片。终点取目标矩形离起点最近的那条边，
 * 线不会压在图标上。
 */
export function buildGuideLine(chip: Box, target: Box, targetPoint?: { x: number; y: number }): GuideLine {
  const boxCenter = { x: chip.x + chip.w / 2, y: chip.y + chip.h / 2 }
  const targetCenter = targetPoint ?? { x: target.x + target.w / 2, y: target.y + target.h / 2 }
  const end = {
    x: clamp(targetCenter.x, target.x, target.x + target.w),
    y: clamp(targetCenter.y, target.y, target.y + target.h),
  }
  const targetSide: GuideLine['side'] =
    Math.abs(end.x - boxCenter.x) >= Math.abs(end.y - boxCenter.y)
      ? end.x >= boxCenter.x
        ? 'left'
        : 'right'
      : end.y >= boxCenter.y
        ? 'top'
        : 'bottom'

  const dx = end.x - boxCenter.x
  const dy = end.y - boxCenter.y
  let side: GuideLine['side'] = 'right'
  if (Math.abs(dx) >= Math.abs(dy)) side = dx >= 0 ? 'right' : 'left'
  else side = dy >= 0 ? 'bottom' : 'top'

  const start = {
    right: { x: chip.x + chip.w, y: boxCenter.y },
    left: { x: chip.x, y: boxCenter.y },
    top: { x: boxCenter.x, y: chip.y },
    bottom: { x: boxCenter.x, y: chip.y + chip.h },
  }[side]

  const horizontal = side === 'left' || side === 'right'
  const bend = Math.max(MIN_CURVE, Math.min(140, Math.abs(horizontal ? dx : dy) * 0.42))
  const c1 = horizontal
    ? { x: start.x + (side === 'right' ? bend : -bend), y: start.y }
    : { x: start.x, y: start.y + (side === 'bottom' ? bend : -bend) }
  const c2 = horizontal
    ? { x: end.x - (side === 'right' ? bend : -bend), y: end.y }
    : { x: end.x, y: end.y - (side === 'bottom' ? bend : -bend) }
  const d =
    'M ' + start.x.toFixed(1) + ' ' + start.y.toFixed(1) +
    ' C ' + c1.x.toFixed(1) + ' ' + c1.y.toFixed(1) +
    ', ' + c2.x.toFixed(1) + ' ' + c2.y.toFixed(1) +
    ', ' + end.x.toFixed(1) + ' ' + end.y.toFixed(1)
  return { side, start, end, c1, c2, d, targetSide }
}

/**
 * 判断目标是否真的可见。
 *
 * 这里**故意不做 elementFromPoint 遮挡判定**：SVG path 的包围盒中心通常没有实体，
 * 连线的透明点击热区也会盖住它 —— 上一版正是因此把真实连线全判成“不存在”。
 * 只按“元素有尺寸、自身与祖先都可见”判断；坐标是否真的在屏幕内，交给调用方裁剪。
 */
export function isVisibleTarget(element: Element | null): element is Element {
  if (!element || !element.isConnected) return false
  // aria-hidden 的装饰元素（多选标记、画布浮层）不是“不存在”，
  // 它们仍然真实显示颜色；只有 hidden 属性/display:none 才是不可见。
  if (element.closest('[hidden]')) return false
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 && rect.height <= 0) return false
  const style = getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  if (Number(style.opacity) === 0) return false
  return true
}

/** 目标是否至少有一部分落在容器矩形里（完全在画布外就不画） */
export function intersectsViewport(rect: Box, viewport: Box): boolean {
  return (
    rect.x + rect.w >= viewport.x &&
    rect.x <= viewport.x + viewport.w &&
    rect.y + rect.h >= viewport.y &&
    rect.y <= viewport.y + viewport.h
  )
}

/**
 * 从 SVG path 上取一个真实落在路径上的点（屏幕坐标）。
 * 直接用 getPointAtLength，曲线的包围盒中心往往在曲线外面。
 */
export function pointOnPath(path: SVGPathElement, ratio: number): { x: number; y: number } | null {
  let length = 0
  try {
    length = path.getTotalLength()
  } catch {
    return null
  }
  if (!Number.isFinite(length) || length <= 0) return null
  const point = path.getPointAtLength(length * clamp(ratio, 0, 1))
  const ctm = path.getScreenCTM()
  if (!ctm) return null
  return {
    x: ctm.a * point.x + ctm.c * point.y + ctm.e,
    y: ctm.b * point.x + ctm.d * point.y + ctm.f,
  }
}
