/**
 * arrangeEngine —— 对齐/等距纯算法（无任何框架/服务依赖，可独立单测）。
 *
 * 输入输出都是"平面矩形"：节点用 { id, x, y, w, h }（x/y 为要写入的坐标基准——对无父节点即 position，
 * 父节点场景由调用方决定用绝对坐标换算）。返回 Map<id, {x,y}>，只含被移动的节点。
 *
 * 语义（对齐老版 align-arrange 的视觉目标）：
 * - alignLeft/Right/Top/Bottom：让选中节点沿包围盒边缘对齐（另一轴保持不变）。
 * - distributeH/V：让选中节点在包围盒跨度内等距分布（外沿两端对齐包围盒边缘）。
 */

export type AlignDirection = 'left' | 'right' | 'top' | 'bottom'
export type DistributeAxis = 'h' | 'v'

export interface ArrangeRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export type ArrangeResult = Map<string, { x: number; y: number }>

function bounds(rects: ArrangeRect[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  return { minX, minY, maxX, maxY }
}

/** 沿指定方向边缘对齐：左=minX / 右=maxX / 上=minY / 下=maxY（另一轴不变）。 */
export function alignNodes(rects: ArrangeRect[], dir: AlignDirection): ArrangeResult {
  const result: ArrangeResult = new Map()
  if (rects.length < 2) return result
  const b = bounds(rects)
  for (const r of rects) {
    let nx = r.x
    let ny = r.y
    if (dir === 'left') nx = b.minX
    else if (dir === 'right') nx = b.maxX - r.w
    else if (dir === 'top') ny = b.minY
    else ny = b.maxY - r.h
    if (nx !== r.x || ny !== r.y) result.set(r.id, { x: nx, y: ny })
  }
  return result
}

/**
 * 等距分布：水平/垂直方向把节点在包围盒跨度内平均摊开。
 * 做法：排序后让相邻中心距相等，最外两节点中心对齐包围盒两端中心。
 */
export function distributeNodes(rects: ArrangeRect[], axis: DistributeAxis): ArrangeResult {
  const result: ArrangeResult = new Map()
  if (rects.length < 3) return result

  const sorted = [...rects].sort((a, b) => {
    if (axis === 'h') return a.x + a.w / 2 - (b.x + b.w / 2)
    return a.y + a.h / 2 - (b.y + b.h / 2)
  })

  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const gap = axis === 'h'
    ? (last.x + last.w / 2) - (first.x + first.w / 2)
    : (last.y + last.h / 2) - (first.y + first.h / 2)
  const step = sorted.length > 1 ? gap / (sorted.length - 1) : 0

  let i = 0
  for (const r of sorted) {
    let nx = r.x
    let ny = r.y
    if (axis === 'h') {
      const targetCenter = (first.x + first.w / 2) + step * i
      nx = targetCenter - r.w / 2
    } else {
      const targetCenter = (first.y + first.h / 2) + step * i
      ny = targetCenter - r.h / 2
    }
    if (nx !== r.x || ny !== r.y) result.set(r.id, { x: nx, y: ny })
    i++
  }
  return result
}
