/**
 * 框内按下的归属（用户 2026-11-14 口径）：
 * 「多选时节点内部所有地方都只用来拖，按钮/进度条/缩放角/端口都不允许点；只保留加选、减选。」
 *
 * 这条测试锁三件事：
 * 1. 框内（含节点里的控件、标题条）一律整组拖动，不再区分控件；
 * 2. 框内 + Shift = 加选/减选这一下点到的节点；
 * 3. 框外完全不接管（画布/节点照常工作）。
 */
import { describe, it, expect } from 'vitest'
import { resolveFramePress, nodeIdAtPoint, type MultiSelectRect } from '../multiSelectEngine'

describe('resolveFramePress', () => {
  it('框内普通按下 → 整组拖动（节点里的按钮/滑杆也走这条）', () => {
    expect(resolveFramePress({ insideFrame: true, shiftKey: false })).toBe('group')
  })

  it('框内 + Shift → 只做加选/减选', () => {
    expect(resolveFramePress({ insideFrame: true, shiftKey: true })).toBe('toggle')
  })

  it('框外 → 不接管，画布与节点保持原有交互', () => {
    expect(resolveFramePress({ insideFrame: false, shiftKey: false })).toBe('native')
    expect(resolveFramePress({ insideFrame: false, shiftKey: true })).toBe('native')
  })
})

describe('nodeIdAtPoint', () => {
  const rects: MultiSelectRect[] = [
    { id: 'a', x: 0, y: 0, w: 100, h: 80 },
    { id: 'b', x: 200, y: 0, w: 100, h: 80 },
  ]

  it('命中矩形内部返回该节点 id', () => {
    expect(nodeIdAtPoint(rects, { x: 50, y: 40 })).toBe('a')
    expect(nodeIdAtPoint(rects, { x: 250, y: 40 })).toBe('b')
  })

  it('边界点算命中（与框选"局部相交"不同：这里要点到卡片本身）', () => {
    expect(nodeIdAtPoint(rects, { x: 100, y: 40 })).toBe('a')
  })

  it('落在空白处返回 null（Shift 点空白不改选中）', () => {
    expect(nodeIdAtPoint(rects, { x: 150, y: 40 })).toBeNull()
  })

  it('重叠时取更靠上（store 靠后）的那个', () => {
    const overlapping: MultiSelectRect[] = [
      { id: 'under', x: 0, y: 0, w: 100, h: 80 },
      { id: 'over', x: 50, y: 0, w: 100, h: 80 },
    ]
    expect(nodeIdAtPoint(overlapping, { x: 60, y: 40 })).toBe('over')
  })

  it('空集返回 null', () => {
    expect(nodeIdAtPoint([], { x: 0, y: 0 })).toBeNull()
  })
})
