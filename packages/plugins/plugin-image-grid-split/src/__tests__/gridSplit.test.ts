import { describe, it, expect } from 'vitest'
import {
  unitCells, toPixelRect, publishPositions, validRowsCols, cellIndexAt, pickerRowsColsAt,
  uniformGridPositions,
} from '../gridSplit'

describe('gridSplit 纯计算', () => {
  it('validRowsCols：合法范围 1~8，小数/0/9 都拒', () => {
    expect(validRowsCols(3, 3)).toBe(true)
    expect(validRowsCols(1, 1)).toBe(true)
    expect(validRowsCols(8, 8)).toBe(true)
    expect(validRowsCols(0, 3)).toBe(false)
    expect(validRowsCols(3, 0)).toBe(false)
    expect(validRowsCols(9, 3)).toBe(false)
    expect(validRowsCols(3.5, 3)).toBe(false)
  })

  it('unitCells：3×3 生成 9 格，行优先，每格等分', () => {
    const cells = unitCells(3, 3)
    expect(cells).toHaveLength(9)
    // 第 0 格
    expect(cells[0]).toEqual({ x: 0, y: 0, width: 1 / 3, height: 1 / 3 })
    // 第 4 格（中）
    expect(cells[4]!.x).toBeCloseTo(1 / 3)
    expect(cells[4]!.y).toBeCloseTo(1 / 3)
    // 最后一格
    expect(cells[8]!.x).toBeCloseTo(2 / 3)
    expect(cells[8]!.y).toBeCloseTo(2 / 3)
  })

  it('unitCells：非法行列返回空表（不抛）', () => {
    expect(unitCells(0, 3)).toEqual([])
    expect(unitCells(9, 1)).toEqual([])
  })

  it('toPixelRect：归一化乘像素并取整；尺寸非法返回 null', () => {
    const cell = { x: 0, y: 0, width: 0.5, height: 0.5 }
    expect(toPixelRect(cell, 640, 480)).toEqual({ x: 0, y: 0, width: 320, height: 240 })
    expect(toPixelRect(cell, 0, 100)).toBeNull()
    expect(toPixelRect(cell, -1, 100)).toBeNull()
  })

  it('publishPositions：按原行列位置布点（gap 计入步长）', () => {
    const pos = publishPositions(2, 2, [0, 3], 120, 80, 12)
    // 0 → (0,0)；3 → 右下
    expect(pos).toEqual([
      { index: 0, x: 0, y: 0 },
      { index: 3, x: 132, y: 132 },
    ])
  })

  it('publishPositions：越界/未勾选索引跳过；非法行列返回空表', () => {
    expect(publishPositions(2, 2, [0, 4], 100, 100, 12)).toHaveLength(1)
    expect(publishPositions(0, 2, [0], 100, 100, 12)).toEqual([])
  })

  it('cellIndexAt：各象限命中正确格子（行优先）', () => {
    expect(cellIndexAt(3, 3, 0.1, 0.1)).toBe(0)
    expect(cellIndexAt(3, 3, 0.5, 0.1)).toBe(1)
    expect(cellIndexAt(3, 3, 0.9, 0.1)).toBe(2)
    expect(cellIndexAt(3, 3, 0.1, 0.9)).toBe(6)
    expect(cellIndexAt(3, 3, 0.9, 0.9)).toBe(8)
  })

  it('cellIndexAt：非方阵（2 行 3 列）命中正确', () => {
    expect(cellIndexAt(2, 3, 0.9, 0.1)).toBe(2)
    expect(cellIndexAt(2, 3, 0.1, 0.9)).toBe(3)
  })

  it('cellIndexAt：图外/非法输入给 -1（不抛）', () => {
    expect(cellIndexAt(3, 3, -0.1, 0.5)).toBe(-1)
    expect(cellIndexAt(3, 3, 1.1, 0.5)).toBe(-1)
    expect(cellIndexAt(3, 3, 0.5, -0.1)).toBe(-1)
    expect(cellIndexAt(3, 3, 0.5, 1.1)).toBe(-1)
    expect(cellIndexAt(0, 3, 0.5, 0.5)).toBe(-1)
    expect(cellIndexAt(3, 99, 0.5, 0.5)).toBe(-1)
  })

  it('pickerRowsColsAt：8×8 预览按格子给出行列（1 起）', () => {
    expect(pickerRowsColsAt(0.01, 0.01)).toEqual({ rows: 1, cols: 1 })
    expect(pickerRowsColsAt(0.5, 0.01)).toEqual({ rows: 1, cols: 5 })
    expect(pickerRowsColsAt(0.26, 0.39)).toEqual({ rows: 4, cols: 3 })
    expect(pickerRowsColsAt(0.99, 0.99)).toEqual({ rows: 8, cols: 8 })
  })

  it('pickerRowsColsAt：越界返回 null（调用方保持上次行列、不提交）', () => {
    expect(pickerRowsColsAt(-0.01, 0.5)).toBeNull()
    expect(pickerRowsColsAt(0.5, 1.01)).toBeNull()
    expect(pickerRowsColsAt(0.5, 0.5, 0)).toBeNull()
    expect(pickerRowsColsAt(Number.NaN, 0.5)).toBeNull()
  })

  it('uniformGridPositions：列宽/行高各取最大，行列对齐不重叠', () => {
    const sizes = new Map<number, { w: number; h: number }>([
      [0, { w: 120, h: 210 }], // 竖图
      [1, { w: 200, h: 120 }], // 横图
      [2, { w: 180, h: 180 }], // 方图
    ])
    const pos = uniformGridPositions(1, 3, [0, 1, 2], sizes, 10)
    // 行内 y 相同；x = 前面各列列宽 + gap
    expect(pos.map((p) => p.y)).toEqual([0, 0, 0])
    expect(pos.map((p) => p.x)).toEqual([0, 130, 340])
  })

  it('uniformGridPositions：两行时行高互不影响，竖直方向也均匀', () => {
    const sizes = new Map<number, { w: number; h: number }>([
      [0, { w: 100, h: 60 }],
      [3, { w: 80, h: 150 }],
    ])
    const pos = uniformGridPositions(2, 2, [0, 3], sizes, 8)
    expect(pos).toEqual([
      { index: 0, x: 0, y: 0 },
      { index: 3, x: 108, y: 68 },
    ])
  })

  it('uniformGridPositions：缺尺寸的格子跳过；空勾选/非法行列给空表', () => {
    const sizes = new Map<number, { w: number; h: number }>([[1, { w: 50, h: 50 }]])
    // 缺尺寸的列宽兜底 1px（实现口径）：index 1 的 x = 1 + gap = 11
    expect(uniformGridPositions(2, 2, [0, 1], sizes, 10)).toEqual([{ index: 1, x: 11, y: 0 }])
    expect(uniformGridPositions(2, 2, [], sizes, 10)).toEqual([])
    expect(uniformGridPositions(0, 2, [0], sizes, 10)).toEqual([])
  })
})
