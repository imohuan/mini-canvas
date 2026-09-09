/**
 * edge-cutting 核心逻辑（浏览器 DOM 相关，自 v1 EdgeCuttingPlugin.ts 移植；纯判定部分已抽可单测函数）。
 *
 * 与老版差异（v2 铁律）：
 * - 不读 context.store.toRef / context.dom.getPane / context.actions.getEdges：
 *   画布区域判定用 VueFlow 渲染约定 `.vue-flow`（与 plugin-clipboard 同源）；边数据经 edgeStore。
 * - 删除经 ctx.edgeStore.removeEdge(id)，可撤销由插件层 history.withRecord 包一次。
 * - 本文件只做"取边路径 DOM → 采样屏幕点 → 命中判定"；事件装配/回收在 edgeCuttingPlugin.ts。
 */
import { isPolylineHitByCut, type ScreenPoint } from './geometry'

export type { ScreenPoint } from './geometry'

export const DEFAULT_TOLERANCE_PX = 8
export const DEFAULT_SAMPLE_STEP_PX = 6
export const TRAIL_POINTS = 12
export const BLADE_POINTS = 7

/** 参与命中判定的边条目（id = 内核边 id；points = 边路径在屏幕坐标系的采样点） */
export interface EdgeSampleEntry {
  id: string
  points: ScreenPoint[]
}

/** CSS.escape 兜底 */
export function cssEscape(value: string): string {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}

/** 屏幕点数组 → SVG path d */
export function toPathData(points: ScreenPoint[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ')
}

/**
 * 屏幕点数组 → 平滑 SVG path d（Catmull-Rom 转 Bezier：张力 0.5，曲线穿过所有采样点，
 * 相邻段切线连续，消除折线感——用手指划过画布时轨迹就是圆润的"刀光"）。
 * 与 toPathData 不同：段间是 cubic Bezier 拼接而非直线，视觉上是真平滑曲线。
 * - 0 点 → ''
 * - 1 点 → 'M x y'
 * - 2 点 → 平滑 Bez 近似直线（首尾 handle 各自取 1/3 / 2/3 处，几何上等同 L）
 * - ≥3 点 → 均匀 Catmull-Rom（端点 P[-1]=P[0]、P[n+1]=P[n]，曲线闭合在两端）
 */
export function toSmoothPathData(points: ScreenPoint[]): string {
  const n = points.length
  if (n === 0) return ''
  if (n === 1) return `M ${points[0].x} ${points[0].y}`
  if (n === 2) {
    const a = points[0]
    const b = points[1]
    const c1x = a.x + (b.x - a.x) / 3
    const c1y = a.y + (b.y - a.y) / 3
    const c2x = a.x + ((b.x - a.x) * 2) / 3
    const c2y = a.y + ((b.y - a.y) * 2) / 3
    return `M ${a.x} ${a.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${b.x} ${b.y}`
  }
  const segments: string[] = [`M ${points[0].x} ${points[0].y}`]
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2 < n ? i + 2 : i + 1]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    segments.push(`C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`)
  }
  return segments.join(' ')
}

/** 两个 DOMRect 是否重叠 */
export function rectsOverlap(a: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>, b: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
}

/** 仅取刀锋（尾部短轨迹）——与老版 bladeOnlyCut 选项的"仅刀锋裁剪"对齐；由调用方决定用全长轨迹还是刀锋 */
export function bladeOnly(points: ScreenPoint[]): ScreenPoint[] {
  return points.slice(-BLADE_POINTS)
}

/**
 * 从全部命中候选里筛出被切割轨迹命中的边 id（纯函数；hit 判定几何见 geometry.isPolylineHitByCut）。
 * @param cutPoints 参与裁剪的轨迹（调用方已决定全长 or bladeOnly；默认整条拖拽轨迹参与）
 */
export function filterHitEdges(entries: EdgeSampleEntry[], cutPoints: ScreenPoint[], tolerancePx: number): string[] {
  if (cutPoints.length < 2) return []
  return entries
    .filter(({ points }) => isPolylineHitByCut(points, cutPoints, tolerancePx))
    .map(({ id }) => id)
}

/** 创建命名空间 SVG 元素 */
export function createSvgElement<K extends keyof SVGElementTagNameMap>(tagName: K): SVGElementTagNameMap[K] {
  return document.createElementNS('http://www.w3.org/2000/svg', tagName)
}

/** 按边 id 解析真实 SVG path 的候选选择器（对齐老版 resolveEdgePath；v2 CustomEdge 命中第一条） */
export function edgePathSelectors(edgeId: string): string[] {
  const escapedId = cssEscape(edgeId)
  return [
    `.edge-hit-area[data-edge-id="${escapedId}"]`,
    `.vue-flow__edge[data-id="${escapedId}"] .edge-hit-area`,
    `.vue-flow__edge-${escapedId} .edge-hit-area`,
    `[data-id="${escapedId}"] .custom-edge .edge-hit-area`,
    `.vue-flow__edge[data-id="${escapedId}"] .custom-edge path`,
    `.vue-flow__edge-${escapedId} .custom-edge path`,
  ]
}

/** 解析某条边当前渲染出的 SVGPathElement（找不到返回 null）。
 *  scopeRoot 传实例根（viewport.getRootEl()）时在该实例内查——多宿主页面不串线；
 *  不传则退回 document 全局查询（兼容单宿主/测试）。 */
export function resolveEdgePath(edgeId: string, scopeRoot?: ParentNode | null): SVGPathElement | null {
  for (const selector of edgePathSelectors(edgeId)) {
    const el = scopeRoot ? scopeRoot.querySelector(selector) : document.querySelector(selector)
    if (el instanceof SVGPathElement) return el
  }
  return null
}

/** 将 SVG path 均匀采样成屏幕坐标点数组（getScreenCTM 换算 client 坐标） */
export function samplePathInClientSpace(path: SVGPathElement, stepPx: number): ScreenPoint[] {
  const total = path.getTotalLength()
  const matrix = path.getScreenCTM()
  if (!matrix || total <= 0) return []

  const count = Math.max(24, Math.ceil(total / stepPx))
  return Array.from({ length: count + 1 }, (_, index) => {
    const point = path.getPointAtLength((total * index) / count)
    const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(matrix)
    return { x: screenPoint.x, y: screenPoint.y }
  })
}


