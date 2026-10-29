/**
 * gridSplit —— 宫格切分的纯计算层（零 Vue / 零 DOM，node 可单测）。
 *
 * 会话状态（哪个节点正在切、行列、勾选）放 splitSession；这里只做「算得对不对」：
 * - 行列 → 格子矩形（归一化 0~1 + 像素矩形两种形态）；
 * - 发布布局 → 每格图片节点在画布上的绝对坐标。
 *
 * 为什么单独一层：组件只管「画 + 收鼠标」，写图写库前所有几何判断先在这里过一遍，
 * 拼错行列、越界、空勾选这类问题在 node 测试里就能抓住，不必起浏览器。
 */

/** 归一化矩形（0~1，相对原图；发布/切片时乘上真实像素） */
export interface UnitRect {
  x: number
  y: number
  width: number
  height: number
}

/** 像素矩形（整数；切片 canvas 直接用） */
export interface PixelRect {
  x: number
  y: number
  width: number
  height: number
}

/** 行列严格合法（≥1、整数、总格数给画布留上限防卡死） */
export const MAX_ROWS = 8
export const MAX_COLS = 8

export function validRowsCols(rows: number, cols: number): boolean {
  return (
    Number.isInteger(rows) && Number.isInteger(cols) &&
    rows >= 1 && cols >= 1 && rows <= MAX_ROWS && cols <= MAX_COLS
  )
}

/** 行列 → 每格的归一化矩形（行优先，索引 = r * cols + c） */
export function unitCells(rows: number, cols: number): UnitRect[] {
  if (!validRowsCols(rows, cols)) return []
  const out: UnitRect[] = []
  const w = 1 / cols
  const h = 1 / rows
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({ x: c * w, y: r * h, width: w, height: h })
    }
  }
  return out
}

/** 归一化 → 像素（四舍五入到整数；发布/切片的落点） */
export function toPixelRect(cell: UnitRect, imageWidth: number, imageHeight: number): PixelRect | null {
  if (
    !Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) ||
    imageWidth <= 0 || imageHeight <= 0
  ) return null
  return {
    x: Math.round(cell.x * imageWidth),
    y: Math.round(cell.y * imageHeight),
    width: Math.max(1, Math.round(cell.width * imageWidth)),
    height: Math.max(1, Math.round(cell.height * imageHeight)),
  }
}

/**
 * 归一化坐标 → 格子索引（鼠标悬停/点击格子时用）。
 * 坐标在图外（<0 或 >1）返回 -1；空行列/越界同样给 -1。
 */
export function cellIndexAt(rows: number, cols: number, nx: number, ny: number): number {
  if (!validRowsCols(rows, cols)) return -1
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return -1
  if (nx < 0 || nx >= 1 || ny < 0 || ny >= 1) return -1
  const c = Math.min(cols - 1, Math.floor(nx * cols))
  const r = Math.min(rows - 1, Math.floor(ny * rows))
  return r * cols + c
}

/**
 * 选择器网格（固定 8×8 预览）的悬停 → 行列。
 * 返回值 = 0 表示**越界**（鼠标在网格外），调用方应保持上一次行列不变。
 * 抽出来单测，是因为「点网格只预选、不提交」这条交互规则最容易在组件里悄悄改回去。
 */
export const PICKER_PREVIEW = 8

export function pickerRowsColsAt(
  nx: number,
  ny: number,
  preview = PICKER_PREVIEW,
): { rows: number; cols: number } | null {
  if (!Number.isInteger(preview) || preview < 1) return null
  const idx = cellIndexAt(preview, preview, nx, ny)
  if (idx < 0) return null
  return { rows: Math.floor(idx / preview) + 1, cols: (idx % preview) + 1 }
}

/** 发布布局：选中格子在画布上的绝对坐标（保持原行列位置，空格留空；同图等比）。
 *  @param cellW 每格节点宽（px）；@param gap 格子之间的画布间距（px） */
export function publishPositions(
  rows: number,
  cols: number,
  selected: number[],
  cellW: number,
  cellH: number,
  gap = 12,
): Array<{ index: number; x: number; y: number }> {
  if (!validRowsCols(rows, cols)) return []
  const sel = new Set(selected)
  const out: Array<{ index: number; x: number; y: number }> = []
  const step = Math.max(1, Math.max(cellW, cellH) + gap)
  for (const index of selected) {
    if (index < 0 || index >= rows * cols) continue
    if (!sel.has(index)) continue
    const r = Math.floor(index / cols)
    const c = index % cols
    out.push({ index, x: c * step, y: r * step })
  }
  return out.sort((a, b) => a.index - b.index)
}
