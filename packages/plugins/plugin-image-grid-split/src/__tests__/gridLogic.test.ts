import { describe, expect, it } from 'vitest'
import {
  GRID_PRESETS,
  allCellKeys,
  cellKey,
  gridCells,
  normalizeGridSize,
  parseCellKey,
  presetGridSize,
  publishLayout,
  readStoryboardSlots,
  selectedCells,
  slotPosition,
  slotResourceIds,
  storyboardLayout,
  swapSlots,
} from '../gridLogic'

describe('宫格纯逻辑', () => {
  it('预设宫格：4/9/16/25 都是正方形，其它值不是预设', () => {
    expect(GRID_PRESETS.map((p) => p.count)).toEqual([4, 9, 16, 25])
    for (const p of GRID_PRESETS) {
      const size = presetGridSize(p.count)
      expect(size).not.toBeNull()
      expect(size!.rows).toBe(size!.cols)
    }
    expect(presetGridSize(8)).toBeNull()
  })

  it('行列归一化：越界/小数/非法值都夹进 1..10', () => {
    expect(normalizeGridSize({ rows: 0, cols: -1 })).toEqual({ rows: 3, cols: 3 })
    expect(normalizeGridSize({ rows: 99, cols: 2 })).toEqual({ rows: 10, cols: 2 })
    expect(normalizeGridSize({ rows: 2.6, cols: 3.1 })).toEqual({ rows: 3, cols: 3 })
  })

  it('格子边界严格铺满原图：不重不漏、宽高和等于原图', () => {
    const cells = gridCells(3, 3, 1001, 701)
    expect(cells).toHaveLength(9)
    expect(cells.reduce((sum, c) => sum + c.width, 0)).toBe(1001 * 3)
    expect(cells.reduce((sum, c) => sum + c.height, 0)).toBe(701 * 3)
    for (let r = 0; r < 3; r += 1) {
      const row = cells.filter((c) => c.row === r)
      expect(row[0]!.x).toBe(0)
      for (let i = 1; i < row.length; i += 1) expect(row[i]!.x).toBe(row[i - 1]!.x + row[i - 1]!.width)
      expect(row.at(-1)!.x + row.at(-1)!.width).toBe(1001)
    }
  })

  it('尺寸为 0 时返回空表（不造 0 宽图片）', () => {
    expect(gridCells(3, 3, 0, 100)).toEqual([])
  })

  it('选格按行列顺序输出，与勾选顺序无关', () => {
    const cells = gridCells(2, 2, 100, 100)
    const selected = new Set([cellKey(1, 1), cellKey(0, 1)])
    expect(selectedCells(cells, selected).map((c) => cellKey(c.row, c.col))).toEqual(['0:1', '1:1'])
    expect(parseCellKey('2:3')).toEqual({ row: 2, col: 3 })
    expect(parseCellKey('x')).toBeNull()
    expect(allCellKeys(2, 2)).toEqual(['0:0', '0:1', '1:0', '1:1'])
  })

  it('发布布局保留原行列位置；未选格留空，不紧凑挤在一起', () => {
    const cells = gridCells(2, 2, 2048, 2048)
    const selected = new Set([cellKey(0, 0), cellKey(1, 1)])
    const out = publishLayout(cells, selected, { x: 100, y: 200 })
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ x: 100, y: 200, width: 1024, height: 1024, name: '宫格图片 1-1' })
    // 第二列 / 第二行要各让出一格 + gap，未被选中的格子不占节点但保留空位
    expect(out[1]!.x).toBe(100 + 1024 + 16)
    expect(out[1]!.y).toBe(200 + 1024 + 16)
  })

  it('分镜槽位交换不修改入参；越界/同格原样复制', () => {
    const a = { resourceId: 'r-a' }
    const b = { resourceId: 'r-b' }
    const slots = [a, null, b]
    const swapped = swapSlots(slots, 0, 2)
    expect(swapped).toEqual([b, null, a])
    expect(slots).toEqual([a, null, b])
    expect(swapSlots(slots, 0, 0)).toEqual(slots)
    expect(swapSlots(slots, -1, 2)).toEqual(slots)
    expect(swapSlots(slots, 0, 9)).toEqual(slots)
  })

  it('槽位读出容错：坏项变空槽，引用清单去重', () => {
    const slots = readStoryboardSlots([
      { resourceId: 'r-a', name: 'A', width: 10, height: 20 },
      null,
      { resourceId: '' },
      { resourceId: 'r-b' },
    ], 5)
    expect(slots).toHaveLength(5)
    expect(slots[0]).toMatchObject({ resourceId: 'r-a', name: 'A', width: 10, height: 20 })
    expect(slots[1]).toBeNull()
    expect(slotResourceIds(slots)).toEqual(['r-a', 'r-b'])
  })

  it('分镜组尺寸按固定槽位算（含间隙与内边距）', () => {
    const l = storyboardLayout(3, 3, 200, 100)
    expect(l.width).toBe(12 * 2 + 3 * 200 + 2 * 8)
    expect(l.height).toBe(12 * 2 + 3 * 100 + 2 * 8)
    expect(slotPosition(4, 3)).toEqual({ row: 1, col: 1 })
  })
})
