import { describe, it, expect } from 'vitest'
import {
  hitTestRects,
  computeUnionBounds,
  paddedBounds,
  draggableMembers,
  rectsOverlap,
  hasSelectedAncestor,
  DEFAULT_SELECTION_FRAME_PADDING,
  type MultiSelectRect,
} from '../multiSelectEngine'

function r(id: string, x: number, y: number, w = 100, h = 80): MultiSelectRect {
  return { id, x, y, w, h }
}

describe('rectsOverlap', () => {
  it('局部相交（重叠 > 0）为真', () => {
    expect(rectsOverlap(r('a', 0, 0, 100, 100), { x: 50, y: 50, w: 10, h: 10 })).toBe(true)
  })
  it('边缘恰好相接不算相交（老版语义）', () => {
    expect(rectsOverlap(r('a', 0, 0, 100, 100), { x: 100, y: 0, w: 10, h: 10 })).toBe(false)
    expect(rectsOverlap(r('a', 0, 0, 100, 100), { x: 0, y: 100, w: 10, h: 10 })).toBe(false)
  })
  it('完全包含（框大包节点/节点大包框）为真', () => {
    expect(rectsOverlap(r('a', 0, 0, 100, 100), { x: -10, y: -10, w: 200, h: 200 })).toBe(true)
    expect(rectsOverlap(r('a', 0, 0, 100, 100), { x: 20, y: 20, w: 10, h: 10 })).toBe(true)
  })
  it('完全分离为假', () => {
    expect(rectsOverlap(r('a', 0, 0, 100, 100), { x: 200, y: 200, w: 10, h: 10 })).toBe(false)
  })
})

describe('hitTestRects', () => {
  const rects = [r('a', 0, 0), r('b', 200, 0), r('c', 400, 0)]
  it('命中与框相交的全部节点；未相交不命中', () => {
    expect(hitTestRects(rects, { x: 50, y: 0, w: 250, h: 80 })).toEqual(['a', 'b'])
  })
  it('空框（w/h 为 0）不命中任何节点（面积 0）', () => {
    expect(hitTestRects(rects, { x: 50, y: 0, w: 0, h: 0 })).toEqual([])
  })
  it('框覆盖全部节点返回全部 id（顺序同输入）', () => {
    expect(hitTestRects(rects, { x: -10, y: -10, w: 1000, h: 1000 })).toEqual(['a', 'b', 'c'])
  })
})

describe('computeUnionBounds / paddedBounds', () => {
  it('多选节点并集包围盒 = min 左上 + max 右下', () => {
    const b = computeUnionBounds([r('a', 0, 0, 100, 80), r('b', 200, 50, 100, 80), r('c', 300, 200, 60, 40)])
    expect(b).toEqual({ id: '', x: 0, y: 0, w: 360, h: 240 })
  })
  it('padding 向外扩（X 左右各扩，Top 向上扩，Bottom 向下扩）', () => {
    const b = computeUnionBounds([r('a', 0, 0, 100, 80)])!
    const p = paddedBounds(b, DEFAULT_SELECTION_FRAME_PADDING)
    expect(p).toEqual({ id: '', x: -16, y: -36, w: 100 + 32, h: 80 + 36 + 16 })
  })
  it('空输入返回 null', () => {
    expect(computeUnionBounds([])).toBeNull()
  })
  it('无效尺寸（w/h<=0）被跳过', () => {
    expect(computeUnionBounds([{ id: 'x', x: 0, y: 0, w: 0, h: 0 }])).toBeNull()
  })
})

describe('draggableMembers / hasSelectedAncestor', () => {
  const nodes = [
    { id: 'a' },
    { id: 'b' },
    { id: 'child', parentId: 'g' },
    { id: 'g' },
    { id: 'grand', parentId: 'child2' },
    { id: 'child2', parentId: 'g2' },
    { id: 'g2' },
  ]
  it('选中顶层 + 组 + 组内子：只返回无父的顶层与组本身（组内子不重复位移）', () => {
    const sel = new Set(['a', 'g', 'child'])
    const out = draggableMembers(sel, nodes)
    expect(out.sort()).toEqual(['a', 'g'])
  })
  it('选中孤立子节点（父未选）：本轮简版跳过带父节点', () => {
    const sel = new Set(['child'])
    expect(draggableMembers(sel, nodes)).toEqual([])
  })
  it('hasSelectedAncestor：父链上任意祖先被选即为真', () => {
    expect(hasSelectedAncestor('grand', new Set(['g2']), nodes)).toBe(true)
    expect(hasSelectedAncestor('grand', new Set(['child2']), nodes)).toBe(true)
    expect(hasSelectedAncestor('grand', new Set(['g']), nodes)).toBe(false)
    expect(hasSelectedAncestor('a', new Set(['g']), nodes)).toBe(false)
  })
  it('环保护：父链成环不死循环；选中环上直系祖先仍正确判定为 true', () => {
    const cyc = [
      { id: 'x', parentId: 'y' },
      { id: 'y', parentId: 'x' },
    ]
    // x 的父链是 y → x → y(seen) … 第一层 y 即被选 → true（且不死循环）
    expect(hasSelectedAncestor('x', new Set(['y']), cyc)).toBe(true)
    // 环上无被选祖先（只有自身被选不算祖先）→ false，不死循环
    expect(hasSelectedAncestor('x', new Set(['x']), cyc)).toBe(false)
  })
})
