import { describe, it, expect } from 'vitest'
import { unitCells, toPixelRect, publishPositions, validRowsCols } from '../gridSplit'

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
})
