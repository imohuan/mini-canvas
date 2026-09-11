/**
 * compactArrange —— 老版 align-arrange 核心算法原样搬迁。
 *
 * 来源：packages/canvas-core/src/plugins/align-arrange/arrangeEngine.ts
 * 行为（老版核心，非边缘对齐/等距）：把选中节点沿指定方向"紧凑推挤排列"——
 * 节点沿方向贴到已排节点/画布边缘，遇纵向/横向重叠时避让并保持 gap 间距。
 * 视觉上即 Ctrl+方向键把一叠节点沿该方向收紧排开。
 *
 * 坐标系与老版一致：x/y 为要写入的 position（相对坐标），由调用方决定用何种坐标。
 */

/** 老版方向键（直接对应 KeyboardEvent.key 值） */
export type CompactDirection = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

export interface CompactRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/**
 * 紧凑排列间距（按轴给值）。
 *
 * 为什么要分轴：排列是**沿一个方向推挤**的 —— 左右排列沿 X 轴推开节点，上下排列沿 Y 轴推开。
 * 两个方向需要的间隙不是一回事，故拆成两个值，由本引擎按 direction 取用：
 * - 左右排列（ArrowLeft / ArrowRight）→ 用 {@link CompactSpacing.x}；
 * - 上下排列（ArrowUp / ArrowDown）→ 用 {@link CompactSpacing.y}。
 *
 * 与自动布局插件的「组内水平/垂直间距」是同一套心智模型（水平只管左右、垂直只管上下）。
 */
export interface CompactSpacing {
  /** 水平间隔：左右排列时，节点之间沿 X 轴的间隙（px） */
  x: number
  /** 垂直间隔：上下排列时，节点之间沿 Y 轴的间隙（px） */
  y: number
}

export function computeCompactArrange(
  nodes: CompactRect[],
  direction: CompactDirection,
  spacing: CompactSpacing,
): Map<string, { x: number; y: number }> {
  if (nodes.length <= 1) return new Map()
  // 按排列方向选轴：左右推挤用水平间隔，上下推挤用垂直间隔。
  const horizontal = direction === 'ArrowLeft' || direction === 'ArrowRight'
  const gap = horizontal ? spacing.x : spacing.y
  const result = new Map<string, { x: number; y: number }>()

  const minX = Math.min(...nodes.map(n => n.x))
  const minY = Math.min(...nodes.map(n => n.y))
  const maxX = Math.max(...nodes.map(n => n.x + n.w))
  const maxY = Math.max(...nodes.map(n => n.y + n.h))

  const sorted = [...nodes].sort((a, b) => {
    switch (direction) {
      case 'ArrowLeft': return a.x - b.x
      case 'ArrowRight': return (b.x + b.w) - (a.x + a.w)
      case 'ArrowUp': return a.y - b.y
      case 'ArrowDown': return (b.y + b.h) - (a.y + a.h)
      default: return 0
    }
  })

  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i]
    if (i === 0) { result.set(curr.id, { x: curr.x, y: curr.y }); continue }

    const obstacles = sorted.slice(0, i).filter(prev => {
      if (direction === 'ArrowLeft' || direction === 'ArrowRight')
        return !(curr.y + curr.h <= prev.y || curr.y >= prev.y + prev.h)
      else
        return !(curr.x + curr.w <= prev.x || curr.x >= prev.x + prev.w)
    })

    let newX = curr.x, newY = curr.y
    if (obstacles.length > 0) {
      switch (direction) {
        case 'ArrowLeft': newX = Math.max(...obstacles.map(o => result.get(o.id)!.x + o.w)) + gap; break
        case 'ArrowRight': newX = Math.min(...obstacles.map(o => result.get(o.id)!.x)) - curr.w - gap; break
        case 'ArrowUp': newY = Math.max(...obstacles.map(o => result.get(o.id)!.y + o.h)) + gap; break
        case 'ArrowDown': newY = Math.min(...obstacles.map(o => result.get(o.id)!.y)) - curr.h - gap; break
      }
    } else {
      switch (direction) {
        case 'ArrowLeft': newX = minX; break
        case 'ArrowRight': newX = maxX - curr.w; break
        case 'ArrowUp': newY = minY; break
        case 'ArrowDown': newY = maxY - curr.h; break
      }
    }
    result.set(curr.id, { x: newX, y: newY })
  }
  return result
}
