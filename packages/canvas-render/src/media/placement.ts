/**
 * mediaPlacement —— “从源节点旁新建一个节点”的落点算法（零 Vue / 零 DOM，纯函数可单测）。
 *
 * 背景：建一个下游节点时，调用方各自写 `source.x + width + 40`。源节点宽度量不到、
 * 右侧被别的节点占住、或者源节点已经贴着视口右边缘时，新节点就会叠在别的卡片上，
 * 甚至跑到屏幕外。这里把“优先放右边、右边没位置就往下、再避开已有矩形、最后保证
 * 落在可视区里”收成一条规则，`media.addNode` 和需要自定义节点数据的插件共用。
 *
 * 坐标一律是 flow（画布）绝对坐标；尺寸单位与 nodeLayout 相同。
 */
import type { FlowRect } from '../geometry/visibleArea'
import { rectsOverlap } from '../geometry/visibleArea'

/** 新节点与源节点之间留的间距（flow 像素） */
export const PLACEMENT_GAP = 40
/** 与视口边缘留的安全距离（flow 像素） */
export const PLACEMENT_MARGIN = 24

export type PlacementSide = 'right' | 'left' | 'bottom' | 'top' | 'auto'

export interface PlacementSize {
  w: number
  h: number
}

export interface PlacementRect extends FlowRect {
  id?: string
}

export interface PlacementInput {
  /** 新节点的外框尺寸（取目标节点类型的默认尺寸） */
  size: PlacementSize
  /** 源节点矩形；没有源节点时按视口中心 / 现有内容右侧摆放 */
  source?: PlacementRect | null
  /** 画布上已有节点的矩形（源节点可不在里面） */
  obstacles?: ReadonlyArray<PlacementRect>
  /** 当前可视区（flow 坐标）；拿不到时只避让已有节点 */
  visible?: FlowRect | null
  /** 优先方向；缺省 auto = 右 → 下 → 左 → 上 */
  side?: PlacementSide
  /** 与源节点的间距 */
  gap?: number
  /** 与视口边缘的安全距离 */
  margin?: number
}

export interface PlacementPoint {
  x: number
  y: number
}

const EPS = 0.01

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function normalizeSize(size: PlacementSize): PlacementSize {
  return {
    w: Math.max(1, Math.round(positive(size?.w) ?? 320)),
    h: Math.max(1, Math.round(positive(size?.h) ?? 240)),
  }
}

function rectAt(point: PlacementPoint, size: PlacementSize): FlowRect {
  return { x: point.x, y: point.y, w: size.w, h: size.h }
}

function inside(rect: FlowRect, area: FlowRect): boolean {
  return (
    rect.x >= area.x - EPS &&
    rect.y >= area.y - EPS &&
    rect.x + rect.w <= area.x + area.w + EPS &&
    rect.y + rect.h <= area.y + area.h + EPS
  )
}

function fits(point: PlacementPoint, size: PlacementSize, area: FlowRect | null, obstacles: ReadonlyArray<PlacementRect>): boolean {
  const rect = rectAt(point, size)
  if (area && !inside(rect, area)) return false
  return !obstacles.some((obstacle) => rectsOverlap(rect, obstacle))
}

function roundPoint(point: PlacementPoint): PlacementPoint {
  return { x: Math.round(point.x), y: Math.round(point.y) }
}

function clampPoint(point: PlacementPoint, size: PlacementSize, area: FlowRect): PlacementPoint {
  const maxX = Math.max(area.x, area.x + area.w - size.w)
  const maxY = Math.max(area.y, area.y + area.h - size.h)
  return { x: Math.min(Math.max(point.x, area.x), maxX), y: Math.min(Math.max(point.y, area.y), maxY) }
}

function sideOrder(side: PlacementSide): Array<Exclude<PlacementSide, 'auto'>> {
  const all: Array<Exclude<PlacementSide, 'auto'>> = ['right', 'bottom', 'left', 'top']
  if (side === 'auto') return all
  return [side, ...all.filter((item) => item !== side)]
}

/**
 * 先按方向优先级各试一次“紧贴源节点”（右 → 下 → 左 → 上），四个方向都放不下时再
 * 沿每个方向往外排（偏移正负交替）。这样右边被挡时，会优先落到源节点正下方，
 * 不会先沿右列往下堆出一列。
 */
function nearSourcePoints(
  source: PlacementRect,
  size: PlacementSize,
  gap: number,
  side: PlacementSide,
): PlacementPoint[] {
  const points: PlacementPoint[] = []
  const offsets = [0, 1, -1, 2, -2, 3, -3, 4, -4]
  for (const direction of sideOrder(side)) {
    for (const step of offsets) {
      if (step !== 0) continue
      if (direction === 'right') {
        points.push({ x: source.x + source.w + gap, y: source.y })
      } else if (direction === 'left') {
        points.push({ x: source.x - size.w - gap, y: source.y })
      } else if (direction === 'bottom') {
        points.push({ x: source.x, y: source.y + source.h + gap })
      } else {
        points.push({ x: source.x, y: source.y - size.h - gap })
      }
    }
  }
  for (const direction of sideOrder(side)) {
    for (const step of offsets) {
      if (step === 0) continue
      if (direction === 'right') {
        points.push({ x: source.x + source.w + gap, y: source.y + step * (size.h + gap) })
      } else if (direction === 'left') {
        points.push({ x: source.x - size.w - gap, y: source.y + step * (size.h + gap) })
      } else if (direction === 'bottom') {
        points.push({ x: source.x + step * (size.w + gap), y: source.y + source.h + gap })
      } else {
        points.push({ x: source.x + step * (size.w + gap), y: source.y - size.h - gap })
      }
    }
  }
  return points
}

/** 在可视区里做一层稀疏网格搜索，返回距离理想点最近的空位。 */
function gridPoints(area: FlowRect, size: PlacementSize, preferred: PlacementPoint): PlacementPoint[] {
  const stepX = Math.max(24, Math.min(size.w + 40, 160))
  const stepY = Math.max(24, Math.min(size.h + 40, 160))
  const points: PlacementPoint[] = []
  for (let y = area.y; y <= area.y + Math.max(0, area.h - size.h) + EPS; y += stepY) {
    for (let x = area.x; x <= area.x + Math.max(0, area.w - size.w) + EPS; x += stepX) {
      points.push({ x, y })
    }
  }
  return points.sort((a, b) => {
    const da = (a.x - preferred.x) ** 2 + (a.y - preferred.y) ** 2
    const db = (b.x - preferred.x) ** 2 + (b.y - preferred.y) ** 2
    return da - db
  })
}

/**
 * 给新节点选落点。
 *
 * 规则：
 * 1. 有源节点 → 先放源节点右边（同顶边）；右边放不下/被占 → 下方 → 左边 → 上方。
 * 2. 没有源节点 → 可视区中心；中心被占就在可视区里找最近空位。
 * 3. **避开已有节点是硬约束**：宁可稍微出屏，也不压在别人的卡片上。
 * 4. 完整落在可视区是优先项：视口够大时一定选屏内空位；装不下才放宽到屏外。
 * 5. 极端情况（可视区比新节点还小、且四周都被占满）→ 夹在视口内，至少不跑到完全看不见的地方。
 */
export function placeAdjacent(input: PlacementInput): PlacementPoint {
  const size = normalizeSize(input.size)
  const gap = Math.max(0, positive(input.gap) ?? PLACEMENT_GAP)
  const margin = Math.max(0, positive(input.margin) ?? PLACEMENT_MARGIN)
  const obstacles = input.obstacles ?? []
  const rawVisible = input.visible && input.visible.w > 0 && input.visible.h > 0 ? input.visible : null
  const usable = rawVisible
    ? {
        x: rawVisible.x + margin,
        y: rawVisible.y + margin,
        w: Math.max(0, rawVisible.w - margin * 2),
        h: Math.max(0, rawVisible.h - margin * 2),
      }
    : null
  // 安全边距把可视区压得比节点还小时，退回未缩小的视口，保证还能放下一个节点。
  const area = usable && usable.w >= size.w && usable.h >= size.h ? usable : rawVisible
  const source = input.source ?? undefined
  const preferred = (() => {
    if (source) {
      const side = input.side ?? 'auto'
      if (side === 'left') return { x: source.x - size.w - gap, y: source.y }
      if (side === 'top') return { x: source.x, y: source.y - size.h - gap }
      if (side === 'bottom') return { x: source.x, y: source.y + source.h + gap }
      return { x: source.x + source.w + gap, y: source.y }
    }
    if (area) return { x: area.x + (area.w - size.w) / 2, y: area.y + (area.h - size.h) / 2 }
    if (obstacles.length > 0) {
      const right = Math.max(...obstacles.map((rect) => rect.x + rect.w))
      const top = Math.min(...obstacles.map((rect) => rect.y))
      return { x: right + gap, y: top }
    }
    return { x: 0, y: 0 }
  })()

  /** 不压任何已有节点（硬约束） */
  const clear = (point: PlacementPoint): boolean =>
    !obstacles.some((obstacle) => rectsOverlap(rectAt(point, size), obstacle))

  // 第一轮：屏内空位（最理想）
  if (fits(preferred, size, area, obstacles)) return roundPoint(preferred)
  if (source) {
    for (const point of nearSourcePoints(source, size, gap, input.side ?? 'auto')) {
      if (fits(point, size, area, obstacles)) return roundPoint(point)
    }
  }
  if (area) {
    for (const point of gridPoints(area, size, preferred)) {
      if (fits(point, size, area, obstacles)) return roundPoint(point)
    }
  }

  // 第二轮：视口装不下 → 只保证不压节点，允许落到屏外
  if (clear(preferred)) return roundPoint(preferred)
  if (source) {
    for (const point of nearSourcePoints(source, size, gap, input.side ?? 'auto')) {
      if (clear(point)) return roundPoint(point)
    }
  }

  // 第三轮：确实无处可放（可视区被占满且比节点还小）→ 至少留在视口里
  if (area) return roundPoint(clampPoint(preferred, size, area))
  return roundPoint(preferred)
}
