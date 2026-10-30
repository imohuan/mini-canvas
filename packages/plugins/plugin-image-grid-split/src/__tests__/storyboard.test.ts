import { describe, it, expect } from 'vitest'
import {
  readStoryboard, swapSlots, placeStoryboardAt, slotRects, slotIndexAt, decideSnap, removeFromSlots,
  resolveStoryboardLayout, readStoryboardLayout, DEFAULT_STORYBOARD_LAYOUT,
  storyboardContentSize, normalizeSlots,
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

describe('storyboardContentSize：外框由内容反推', () => {
  it('行列取各自行高/列宽最大，加 padding/topPadding/间距', () => {
    const contents = new Map<number, { w: number; h: number }>([
      [0, { w: 120, h: 210 }], // 竖图
      [1, { w: 200, h: 120 }], // 横图
    ])
    // 1×2：列宽 [120, 200] 各归各列（CSS grid 语义），行高 = max(210, 120) = 210
    // 默认布局：padding 8、topPadding 0（标题画在卡片外，内部不留位）、colGap 10
    const s = storyboardContentSize(1, 2, contents)
    expect(s.w).toBe(120 + 200 + 10 + 16)
    expect(s.h).toBe(210 + 16)
  })

  it('两行两列：行高列宽独立计算，间距计 (n-1) 次', () => {
    const contents = new Map<number, { w: number; h: number }>([
      [0, { w: 100, h: 60 }],
      [3, { w: 80, h: 150 }],
    ])
    const s = storyboardContentSize(2, 2, contents)
    // 列宽 [100, 80]，行高 [60, 150]
    expect(s.w).toBe(100 + 80 + 10 + 16)
    expect(s.h).toBe(60 + 150 + 10 + 16)
  })

  it('全空内容回落最小可用尺寸；非法行列同样回落', () => {
    expect(storyboardContentSize(2, 2, new Map())).toEqual({ w: 120, h: 120 })
    expect(storyboardContentSize(0, 2, new Map([[0, { w: 100, h: 100 }]]))).toEqual({ w: 120, h: 120 })
  })

  it('自定义布局生效（自定义内边距；topPadding 默认 0）', () => {
    const contents = new Map<number, { w: number; h: number }>([[0, { w: 320, h: 240 }]])
    const s = storyboardContentSize(1, 1, contents, { padding: 4, topPadding: 0 })
    expect(s).toEqual({ w: 328, h: 248 })
  })

  it('顶部留白默认 0：标题画在卡片外，卡片内部不再空一块', () => {
    const contents = new Map<number, { w: number; h: number }>([[0, { w: 200, h: 200 }]])
    // padding 8 ×2 = 16，无标题留白 → 高 = 200 + 16（不会被 120 的最小值兜底截断）
    expect(storyboardContentSize(1, 1, contents).h).toBe(216)
    // 显式调大仍生效（特殊排版）
    expect(storyboardContentSize(1, 1, contents, { topPadding: 20 }).h).toBe(236)
  })

  it('placeStoryboardAt 接受目标尺寸参与避让', () => {
    const source = { id: 'src', type: 'image', position: { x: 1000, y: 500 }, size: { w: 320, h: 240 } }
    const stubCtx = (nodes: unknown[]) => ({ nodes }) as unknown as import('../storyboard').StoryboardPlacementCtx
    const at = placeStoryboardAt({ ctx: stubCtx([source]), sourceId: 'src', size: { w: 640, h: 480 } })
    expect(at.x).toBeGreaterThanOrEqual(1320)
    expect(at.y).toBe(500)
  })
})

describe('storyboard 槽位几何', () => {
  it('slotRects：3×3 等分，留内边距与间隙，行列不重叠', () => {
    const rects = slotRects(480, 360, 3, 3, { padding: 10, topPadding: 0, colGap: 6, rowGap: 6 })
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
    expect(slotRects(10, 10, 3, 3, { padding: 10, topPadding: 0, colGap: 6, rowGap: 6 })).toEqual([])
    expect(slotRects(0, 360, 3, 3)).toEqual([])
    expect(slotRects(480, 360, 0, 3)).toEqual([])
    expect(slotRects(Number.NaN, 360, 3, 3)).toEqual([])
  })

  it('slotIndexAt：命中各格 / 间隙与外部返回 -1', () => {
    const rects = slotRects(480, 360, 3, 3, { padding: 10, topPadding: 0, colGap: 6, rowGap: 6 })
    expect(slotIndexAt(rects, 15, 15)).toBe(0)
    expect(slotIndexAt(rects, 470, 350)).toBe(8)
    expect(slotIndexAt(rects, -5, 15)).toBe(-1)
    expect(slotIndexAt(rects, 15, 999)).toBe(-1)
  })

  it('slotRects：标题留白 → 顶行下移（topPadding 生效）', () => {
    const withTop = slotRects(480, 360, 2, 2, { padding: 8, topPadding: 30, rowGap: 8, colGap: 8 })
    const noTop = slotRects(480, 360, 2, 2, { padding: 8, topPadding: 0, rowGap: 8, colGap: 8 })
    expect(withTop[0]!.y).toBe(38)
    expect(noTop[0]!.y).toBe(8)
    // 两行一行距 gap=8：noTop 高 = (360-16-8)/2=168，withTop 高 = (360-16-30-8)/2=153
    expect(withTop[0]!.h).toBeCloseTo(153)
    expect(noTop[0]!.h).toBeCloseTo(168)
  })
})

describe('storyboard 吸附决策', () => {
  const board = {
    id: 'board', x: 1000, y: 500, w: 480, h: 360, rows: 3, cols: 3,
    slots: ['a', null, null, null, 'b', null, null, null, null] as Array<string | null>,
  }
  /** 第 index 格的中心（画布绝对坐标） */
  const centerOf = (index: number) => {
    const r = slotRects(board.w, board.h, board.rows, board.cols, { padding: 8, topPadding: 34, rowGap: 10, colGap: 10 })[index]!
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

  it('拖回自己的格：仍然重新吸附（松手必须归位，否则会叠在别的槽上）', () => {
    const d = decideSnap({ nodeId: 'a', center: centerOf(0), currentBoardId: 'board', boards: [board] })
    expect(d.kind).toBe('snap')
    if (d.kind !== 'snap') return
    expect(d.slotIndex).toBe(0)
    expect(d.displacedNodeId).toBeNull()
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

  it('只有角交叉（中心在卡片外）也算命中：与悬停高亮同一套判定', () => {
    // 拖动矩形右下角搭进卡片左上角，中心点远在卡片外
    const dragRect = { x: board.x - 400, y: board.y - 300, w: 480, h: 360 }
    const d = decideSnap({
      nodeId: 'img',
      center: { x: dragRect.x + 240, y: dragRect.y + 180 },
      currentBoardId: null,
      boards: [board],
      dragRect,
    })
    expect(d.kind).toBe('snap')
  })

  it('组外节点顶掉已占用槽：被顶节点标 displaceDetach（调用方负责解父）', () => {
    const d = decideSnap({ nodeId: 'new', center: centerOf(0), currentBoardId: null, boards: [board] })
    expect(d.kind).toBe('snap')
    if (d.kind !== 'snap') return
    expect(d.slotIndex).toBe(0)
    expect(d.slots[0]).toBe('new')
    expect(d.slots).not.toContain('a')
    expect(d.displacedNodeId).toBe('a')
    expect(d.displaceDetach).toBe(true)
  })

  it('同组内换位不标 displaceDetach（两个节点各有各的格）', () => {
    const d = decideSnap({ nodeId: 'a', center: centerOf(4), currentBoardId: 'board', boards: [board] })
    expect(d.kind).toBe('snap')
    if (d.kind !== 'snap') return
    expect(d.displaceDetach).toBeFalsy()
    expect(d.slots[0]).toBe('b')
  })

  it('removeFromSlots：清掉指定节点，其它原样；不存在时返回原表', () => {
    expect(removeFromSlots(['a', 'b', null], 'a')).toEqual([null, 'b', null])
    const same = ['a', 'b']
    expect(removeFromSlots(same, 'zzz')).toBe(same)
  })

  it('normalizeSlots：同一节点重复占格只留第一处（一槽一图）', () => {
    expect(normalizeSlots(['a', 'b', 'a', 'a'])).toEqual(['a', 'b', null, null])
  })

  it('normalizeSlots：指向已删节点的槽清空；空槽/非字符串归一为 null', () => {
    const alive = new Set(['a', 'c'])
    expect(normalizeSlots(['a', 'gone', 'c', null], (id) => alive.has(id))).toEqual(['a', null, 'c', null])
    expect(normalizeSlots([null, 'a'])).toEqual([null, 'a'])
  })

  it('normalizeSlots：已经是干净表时返回原引用（避免无意义写库）', () => {
    const clean = ['a', null, 'b']
    expect(normalizeSlots(clean)).toBe(clean)
  })
})

describe('storyboard 布局配置', () => {
  it('resolveStoryboardLayout：从配置读取；非法值单项回落默认', () => {
    const l = resolveStoryboardLayout((k) => (k === 'storyboardRowGap' ? 24 : k === 'storyboardPadding' ? -3 : undefined))
    expect(l.rowGap).toBe(24)
    expect(l.colGap).toBe(DEFAULT_STORYBOARD_LAYOUT.colGap)
    expect(l.padding).toBe(DEFAULT_STORYBOARD_LAYOUT.padding)
    expect(l.topPadding).toBe(DEFAULT_STORYBOARD_LAYOUT.topPadding)
  })

  it('readStoryboardLayout：无 settings 服务时回落默认（不抛）', () => {
    expect(readStoryboardLayout(undefined)).toEqual(DEFAULT_STORYBOARD_LAYOUT)
    expect(readStoryboardLayout({ get: ((n: string) => undefined) as unknown as <T = unknown>(name: string) => T })).toEqual(DEFAULT_STORYBOARD_LAYOUT)
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
