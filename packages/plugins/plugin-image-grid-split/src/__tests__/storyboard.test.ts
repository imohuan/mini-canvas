import { describe, it, expect } from 'vitest'
import {
  readStoryboard, swapSlots, placeStoryboardAt, slotRects, slotIndexAt, decideSnap, removeFromSlots,
} from '../storyboard'
import { fitInsideSlot, centerInsideSlot } from '../storyboardDrag'

describe('storyboard 纯逻辑', () => {
  it('readStoryboard：合法 data 收窄（非 string 槽当空）', () => {
    const b = readStoryboard({ rows: 2, cols: 2, slots: ['res-a', 42, null, 'res-b'] })
    expect(b).toEqual({ rows: 2, cols: 2, slots: ['res-a', null, null, 'res-b'] })
  })

  it('readStoryboard：字段缺失/槽位数不匹配/行列越界返回 null', () => {
    expect(readStoryboard(undefined)).toBeNull()
    expect(readStoryboard({ rows: 2, cols: 2, slots: ['a'] })).toBeNull()
    expect(readStoryboard({ rows: 0, cols: 2, slots: [] })).toBeNull()
    expect(readStoryboard({ rows: 9, cols: 9, slots: new Array(81).fill(null) })).toBeNull()
  })

  it('swapSlots：交换两格（含空格）；同格/越界返回原表', () => {
    const b = { rows: 2, cols: 2, slots: ['a', null, 'c', 'd'] }
    expect(swapSlots(b, 0, 1)).toEqual([null, 'a', 'c', 'd'])
    expect(swapSlots(b, 1, 2)).toEqual(['a', 'c', null, 'd'])
    expect(swapSlots(b, 0, 0)).toBe(b.slots)
    expect(swapSlots(b, 0, 99)).toBe(b.slots)
    expect(swapSlots(b, -1, 1)).toBe(b.slots)
  })
})

describe('storyboard 落点', () => {
  const source = { id: 'src', type: 'image', position: { x: 1000, y: 500 }, size: { w: 320, h: 240 } }
  /** 测试桩 ctx：真实 ctx 有 tryGet；这里直接给 nodes 数组走降级分支 */
  const stubCtx = (nodes: unknown[]) => ({ nodes }) as unknown as import('../storyboard').StoryboardPlacementCtx

  it('有源节点：摆到源节点右侧（同顶边），不压在别的节点上', () => {
    const nodes = [source, { id: 'far', position: { x: 5000, y: 5000 }, size: { w: 320, h: 240 } }]
    const at = placeStoryboardAt({ ctx: stubCtx(nodes), sourceId: 'src' })
    expect(at.x).toBeGreaterThanOrEqual(1320)
    expect(at.y).toBe(500)
  })

  it('右侧被占：避开已有节点（不与任何节点矩形重叠）', () => {
    const blocker = { id: 'blocker', type: 'image', position: { x: 1320, y: 480 }, size: { w: 480, h: 360 } }
    const nodes = [source, blocker]
    const at = placeStoryboardAt({ ctx: stubCtx(nodes), sourceId: 'src' })
    const overlaps = (n: { position: { x: number; y: number }; size: { w: number; h: number } }) =>
      at.x < n.position.x + n.size.w && n.position.x < at.x + 480 && at.y < n.position.y + n.size.h && n.position.y < at.y + 360
    expect(overlaps(blocker)).toBe(false)
    expect(overlaps(source)).toBe(false)
  })

  it('没有源节点：不抛，返回画布内容右侧的空位', () => {
    const nodes = [source]
    const at = placeStoryboardAt({ ctx: stubCtx(nodes), sourceId: 'gone' })
    expect(Number.isFinite(at.x)).toBe(true)
    expect(Number.isFinite(at.y)).toBe(true)
  })
})

describe('storyboard 槽位几何', () => {
  it('slotRects：3×3 等分，留内边距与间隙，行列不重叠', () => {
    const rects = slotRects(480, 360, 3, 3, 10, 6)
    expect(rects).toHaveLength(9)
    const w = (480 - 20 - 12) / 3
    const h = (360 - 20 - 12) / 3
    expect(rects[0]).toEqual({ index: 0, x: 10, y: 10, w, h })
    expect(rects[4]!.x).toBeCloseTo(10 + w + 6)
    expect(rects[4]!.y).toBeCloseTo(10 + h + 6)
    // 相邻两格之间正好是 gap
    expect(rects[1]!.x - (rects[0]!.x + rects[0]!.w)).toBeCloseTo(6)
  })

  it('slotRects：尺寸不足以放下网格时返回空表（不产负尺寸）', () => {
    expect(slotRects(10, 10, 3, 3, 10, 6)).toEqual([])
    expect(slotRects(0, 360, 3, 3)).toEqual([])
    expect(slotRects(480, 360, 0, 3)).toEqual([])
    expect(slotRects(Number.NaN, 360, 3, 3)).toEqual([])
  })

  it('slotIndexAt：命中各格 / 间隙与外部返回 -1', () => {
    const rects = slotRects(480, 360, 3, 3, 10, 6)
    expect(slotIndexAt(rects, 15, 15)).toBe(0)
    expect(slotIndexAt(rects, 470, 350)).toBe(8)
    expect(slotIndexAt(rects, -5, 15)).toBe(-1)
    expect(slotIndexAt(rects, 15, 999)).toBe(-1)
  })
})

describe('storyboard 吸附决策', () => {
  const board = {
    id: 'board', x: 1000, y: 500, w: 480, h: 360, rows: 3, cols: 3,
    slots: ['a', null, null, null, 'b', null, null, null, null] as Array<string | null>,
  }
  /** 第 index 格的中心（画布绝对坐标） */
  const centerOf = (index: number) => {
    const r = slotRects(board.w, board.h, board.rows, board.cols)[index]!
    return { x: board.x + r.x + r.w / 2, y: board.y + r.y + r.h / 2 }
  }

  it('拖进空槽：占该格', () => {
    const d = decideSnap({ nodeId: 'img', center: centerOf(4), currentBoardId: null, boards: [board] })
    expect(d.kind).toBe('snap')
    if (d.kind !== 'snap') return
    expect(d.boardId).toBe('board')
    expect(d.slotIndex).toBe(4)
    expect(d.slots[4]).toBe('img')
  })

  it('拖到已有节点的格：两者换位（同组内）', () => {
    const d = decideSnap({ nodeId: 'a', center: centerOf(4), currentBoardId: 'board', boards: [board] })
    expect(d.kind).toBe('snap')
    if (d.kind !== 'snap') return
    expect(d.slots[4]).toBe('a')
    expect(d.slots[0]).toBe('b')
    expect(d.displacedNodeId).toBe('b')
  })

  it('拖回自己的格：不动（避免无意义历史）', () => {
    const d = decideSnap({ nodeId: 'a', center: centerOf(0), currentBoardId: 'board', boards: [board] })
    expect(d.kind).toBe('none')
  })

  it('原本在组里、拖出卡片：脱离', () => {
    const d = decideSnap({ nodeId: 'a', center: { x: 10, y: 10 }, currentBoardId: 'board', boards: [board] })
    expect(d.kind).toBe('detach')
  })

  it('本来就不在组里、拖到卡片外：不处理', () => {
    const d = decideSnap({ nodeId: 'free', center: { x: 10, y: 10 }, currentBoardId: null, boards: [board] })
    expect(d.kind).toBe('none')
  })

  it('落在内边距（卡片内但不在格上）：吸到最近的槽', () => {
    const d = decideSnap({ nodeId: 'img', center: { x: board.x + 2, y: board.y + 2 }, currentBoardId: null, boards: [board] })
    expect(d.kind).toBe('snap')
    if (d.kind !== 'snap') return
    expect(d.slotIndex).toBe(0)
  })

  it('removeFromSlots：清掉指定节点，其它原样；不存在时返回原表', () => {
    expect(removeFromSlots(['a', 'b', null], 'a')).toEqual([null, 'b', null])
    const same = ['a', 'b']
    expect(removeFromSlots(same, 'zzz')).toBe(same)
  })
})

describe('槽位内容尺寸（容器式预览）', () => {
  // 用户口径 2026-10-30 参考图：槽位 1:1、图片 9:16 → 高度铺满、左右居中
  const slot = { w: 200, h: 200 }
  it('竖图（9:16）：高度铺满，宽度按比例收窄', () => {
    const fit = fitInsideSlot(slot, 9 / 16)
    expect(fit.h).toBe(200)
    expect(fit.w).toBe(113) // 200 * 9/16 = 112.5 → 取整 113
  })
  it('横图（16:9）：高度铺满会溢出宽度 → 改为宽度铺满（不超出槽位）', () => {
    const fit = fitInsideSlot(slot, 16 / 9)
    expect(fit.w).toBe(200)
    expect(fit.h).toBe(113)
  })
  it('正方形：正好铺满', () => {
    expect(fitInsideSlot(slot, 1)).toEqual({ w: 200, h: 200 })
  })
  it('居中：剩余空间对半分（左右居中）', () => {
    const fit = fitInsideSlot(slot, 9 / 16)
    const c = centerInsideSlot(slot, fit)
    expect(c.dx).toBe(Math.round((200 - 113) / 2))
    expect(c.dy).toBe(0)
  })
  it('非法宽高比：回落到铺满槽位（不抛）', () => {
    expect(fitInsideSlot(slot, 0)).toEqual({ w: 200, h: 200 })
    expect(fitInsideSlot(slot, Number.NaN)).toEqual({ w: 200, h: 200 })
  })
})
