/**
 * gridLogic —— 宫格切分的全部纯计算（零 Vue / 零 DOM，Node 可单测）。
 *
 * 只做三件事：
 * 1. 行/列 → 每个格的像素边界（严格按宫格缝隙一像素不重叠）；
 * 2. 选格 → 发布到画布的图片列表（保留用户原来的行列位置）；
 * 3. 分镜组的槽位交换（纯数据，不碰 store）。
 *
 * 图片像素尺寸由调用方给（原图 naturalWidth / naturalHeight），这里不猜。
 */

export const GRID_CUSTOM_MAX = 10

export interface GridSize {
  rows: number
  cols: number
}

export interface GridCell {
  /** 行（0 起） */
  row: number
  /** 列（0 起） */
  col: number
  /** 在这一格里的像素矩形（图片原图像素坐标） */
  x: number
  y: number
  width: number
  height: number
}

/** 选区的稳定键：行列从 0 起，供 Set 使用（顺序与勾选顺序无关） */
export function cellKey(row: number, col: number): string {
  return row + ':' + col
}

export function parseCellKey(key: string): { row: number; col: number } | null {
  const m = /^(\d+):(\d+)$/.exec(key)
  if (!m) return null
  return { row: Number(m[1]), col: Number(m[2]) }
}

function positiveInt(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'number' ? Math.round(value) : Number.NaN
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(max, n)
}

/** 归一化行列：1..max，非法值回落到 fallback。 */
export function normalizeGridSize(size: Partial<GridSize> | undefined, fallback: GridSize = { rows: 3, cols: 3 }): GridSize {
  return {
    rows: positiveInt(size?.rows, fallback.rows, GRID_CUSTOM_MAX),
    cols: positiveInt(size?.cols, fallback.cols, GRID_CUSTOM_MAX),
  }
}

/**
 * 切出全部格子的像素矩形。
 *
 * 用整数边界递减（而非 width/cols 的四舍五入）保证：
 * - 所有格子宽高之和严格等于原图宽高；
 * - 相邻格边界相接、不重不漏（用户缩放看时没有 1px 白缝/叠线）。
 */
export function gridCells(rows: number, cols: number, width: number, height: number): GridCell[] {
  const size = normalizeGridSize({ rows, cols })
  const w = Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0
  const h = Number.isFinite(height) ? Math.max(0, Math.round(height)) : 0
  if (w === 0 || h === 0) return []
  const xs: number[] = []
  const ys: number[] = []
  for (let c = 0; c <= size.cols; c += 1) xs.push(Math.round((w * c) / size.cols))
  for (let r = 0; r <= size.rows; r += 1) ys.push(Math.round((h * r) / size.rows))
  const out: GridCell[] = []
  for (let r = 0; r < size.rows; r += 1) {
    for (let c = 0; c < size.cols; c += 1) {
      out.push({
        row: r,
        col: c,
        x: xs[c]!,
        y: ys[r]!,
        width: xs[c + 1]! - xs[c]!,
        height: ys[r + 1]! - ys[r]!,
      })
    }
  }
  return out
}

/** 默认全选 */
export function allCellKeys(rows: number, cols: number): string[] {
  const out: string[] = []
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) out.push(cellKey(r, c))
  return out
}

/** 按行列顺序列出选中格；Set 不保证顺序，发布时必须固定成行列序 */
export function selectedCells(cells: readonly GridCell[], selected: ReadonlySet<string>): GridCell[] {
  return cells.filter((c) => selected.has(cellKey(c.row, c.col)))
}

export type GridPreset = 4 | 9 | 16 | 25

/** 预设宫格数量 → 行列（都是正方形）；不是预设值返回 null */
export function presetGridSize(count: number): GridSize | null {
  const side = Math.sqrt(count)
  if (!Number.isInteger(side) || side < 1) return null
  if (![2, 3, 4, 5].includes(side)) return null
  return { rows: side, cols: side }
}

export const GRID_PRESETS: ReadonlyArray<{ count: GridPreset; label: string }> = [
  { count: 4, label: '4宫格 (2×2)' },
  { count: 9, label: '9宫格 (3×3)' },
  { count: 16, label: '16宫格 (4×4)' },
  { count: 25, label: '25宫格 (5×5)' },
]

/** 发布后图片的横向间距（flow px）；用户看图是按格子拼回去，不合适太大 */
export const PUBLISH_GAP = 16

export interface PublishCellLayout {
  cell: GridCell
  x: number
  y: number
  /** 卡片尺寸（= 切图像素尺寸，1:1 显示） */
  width: number
  height: number
  name: string
}

/**
 * 发布到画布时的落点：保持原图的行列位置，未选中的格子**留空**。
 *
 * 为什么不是紧凑排列：用户发布后仍要能一眼把图拼回原图；空位也是一种信息
 *（他刻意只挑了某几块）。要改成紧凑只改这个函数，UI 不用动。
 */
export function publishLayout(
  cells: readonly GridCell[],
  selected: ReadonlySet<string>,
  origin: { x: number; y: number },
  opts: { gap?: number; namePrefix?: string } = {},
): PublishCellLayout[] {
  const gap = opts.gap ?? PUBLISH_GAP
  const prefix = opts.namePrefix ?? '宫格图片'
  const chosen = selectedCells(cells, selected)
  if (chosen.length === 0) return []
  // 列偏移以**选中集的列号**为准：原图第 2 列即使没选，第 3 列也仍留在第 3 列的位置。
  const colWidths = new Map<number, number>()
  const rowHeights = new Map<number, number>()
  for (const c of cells) {
    colWidths.set(c.col, Math.max(colWidths.get(c.col) ?? 0, c.width))
    rowHeights.set(c.row, Math.max(rowHeights.get(c.row) ?? 0, c.height))
  }
  const colX = new Map<number, number>()
  let x = origin.x
  const cols = [...new Set(cells.map((c) => c.col))].sort((a, b) => a - b)
  for (const col of cols) {
    colX.set(col, x)
    x += (colWidths.get(col) ?? 0) + gap
  }
  const rowY = new Map<number, number>()
  let y = origin.y
  const rows = [...new Set(cells.map((c) => c.row))].sort((a, b) => a - b)
  for (const row of rows) {
    rowY.set(row, y)
    y += (rowHeights.get(row) ?? 0) + gap
  }
  return chosen.map((cell) => ({
    cell,
    x: colX.get(cell.col) ?? origin.x,
    y: rowY.get(cell.row) ?? origin.y,
    width: cell.width,
    height: cell.height,
    name: `${prefix} ${cell.row + 1}-${cell.col + 1}`,
  }))
}

/** 分镜组一个槽位：null = 空槽 */
export interface StoryboardSlot {
  resourceId: string
  name?: string
  width?: number
  height?: number
}

export const STORYBOARD_NODE_TYPE = 'storyboard'

/**
 * 分镜组槽位交换（纯数据）。
 * - 两个下标都有效且不相同 → 对调；
 * - 下标越界 / 同一个格 → 原样返回同一份数组（调用方据此不写 store）；
 * - 不修改入参（节点 data 是共享引用，原地改会绕过 store 订阅与历史）。
 */
export function swapSlots(slots: readonly (StoryboardSlot | null)[], a: number, b: number): (StoryboardSlot | null)[] {
  const next = [...slots]
  if (a === b || a < 0 || b < 0 || a >= next.length || b >= next.length) return next
  const tmp = next[a] ?? null
  next[a] = next[b] ?? null
  next[b] = tmp
  return next
}

/** 读出分镜组槽位（容错旧数据 / 非法项；不抛错） */
export function readStoryboardSlots(value: unknown, length = 0): (StoryboardSlot | null)[] {
  const list = Array.isArray(value) ? value : []
  const out: (StoryboardSlot | null)[] = list.map((it) => {
    if (!it || typeof it !== 'object') return null
    const r = it as Record<string, unknown>
    const resourceId = typeof r.resourceId === 'string' ? r.resourceId : ''
    if (!resourceId) return null
    const slot: StoryboardSlot = { resourceId }
    if (typeof r.name === 'string' && r.name) slot.name = r.name
    if (typeof r.width === 'number' && r.width > 0) slot.width = r.width
    if (typeof r.height === 'number' && r.height > 0) slot.height = r.height
    return slot
  })
  while (out.length < length) out.push(null)
  return out.slice(0, Math.max(length, out.length))
}

/** 槽位里已放图的引用清单：交给节点 data 的隐藏字段，供资源回收扫描 */
export function slotResourceIds(slots: readonly (StoryboardSlot | null)[]): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const slot of slots) {
    if (!slot?.resourceId || seen.has(slot.resourceId)) continue
    seen.add(slot.resourceId)
    ids.push(slot.resourceId)
  }
  return ids
}

export interface StoryboardLayout {
  gap: number
  padding: number
  width: number
  height: number
  cellWidth: number
  cellHeight: number
}

/** 分镜组的卡片尺寸：固定槽位按格子最大宽高拼成一张网格（含间隙与内边距） */
export function storyboardLayout(
  rows: number,
  cols: number,
  cellW: number,
  cellH: number,
  opts: { gap?: number; padding?: number } = {},
): StoryboardLayout {
  const r = Math.max(1, Math.round(rows))
  const c = Math.max(1, Math.round(cols))
  const cw = Math.max(1, Math.round(cellW))
  const ch = Math.max(1, Math.round(cellH))
  const gap = Math.max(0, Math.round(opts.gap ?? 8))
  const padding = Math.max(0, Math.round(opts.padding ?? 12))
  return {
    rows: r,
    cols: c,
    gap,
    padding,
    cellWidth: cw,
    cellHeight: ch,
    width: padding * 2 + c * cw + Math.max(0, c - 1) * gap,
    height: padding * 2 + r * ch + Math.max(0, r - 1) * gap,
  } as StoryboardLayout
}

/** 槽位序号 → 第几行第几列（0 起） */
export function slotPosition(index: number, cols: number): { row: number; col: number } {
  const c = Math.max(1, Math.round(cols))
  const i = Math.max(0, Math.floor(index))
  return { row: Math.floor(i / c), col: i % c }
}
