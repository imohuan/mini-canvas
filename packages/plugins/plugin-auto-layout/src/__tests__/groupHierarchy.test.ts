/**
 * groupHierarchy —— 组层级递归布局（纯函数，Node 可测）。
 *
 * 用户拍板的语义：主节点（组）识别为一个节点参与布局；组内部的节点又识别成一张"子画布"。
 * 流程：平铺数组转树（支持组嵌套组）→ 从嵌套最深的组开始布局 → 布局完重算该组 rect →
 * 组作为占位节点参与上层布局 → 逐层向上直到完成。
 */
import { describe, expect, it } from 'vitest'
import {
  buildGroupTree,
  layoutHierarchy,
} from '../groupHierarchy'
import type { AutoLayoutConfig } from '../types'

const CFG: AutoLayoutConfig = {
  direction: 'LR',
  intraSpacing: { x: 60, y: 60 },
  interSpacing: { x: 120, y: 120 },
  focusHeightRatio: 0.5,
  minZoom: 0.1,
  maxZoom: 4,
  debug: false,
}

/** 快捷建 LayoutNode（绝对坐标语义）；type 可选（组节点传 'group'） */
function n(id: string, x: number, y: number, w = 100, h = 80, parentId?: string, type = 'text') {
  return { id, type, position: { x, y }, size: { w, h }, parentId }
}

describe('buildGroupTree 平铺 → 树（支持组嵌套组）', () => {
  it('顶层自由节点 + 顶层组', () => {
    const nodes = [
      n('free', 0, 0),
      n('g1', 500, 500, 400, 300, undefined, 'group'),
      { ...n('a', 530, 540), parentId: 'g1' },
      { ...n('b', 700, 540), parentId: 'g1' },
    ]
    const tree = buildGroupTree(nodes)
    expect(tree.roots.map((r) => r.id).sort()).toEqual(['free', 'g1'])
    const g1 = tree.roots.find((r) => r.id === 'g1')!
    expect(g1.isGroup).toBe(true)
    expect(g1.children.map((c) => c.id).sort()).toEqual(['a', 'b'])
  })

  it('组嵌套组：内层组是外层组的孩子，深度正确', () => {
    const nodes = [
      n('outer', 0, 0, 800, 600, undefined, 'group'),
      { ...n('inner', 100, 100, 300, 200, undefined, 'group'), parentId: 'outer' },
      { ...n('x', 120, 140), parentId: 'inner' },
      { ...n('y', 250, 140), parentId: 'inner' },
      { ...n('solo', 500, 200), parentId: 'outer' },
    ]
    const tree = buildGroupTree(nodes)
    expect(tree.roots).toHaveLength(1)
    const outer = tree.roots[0]
    expect(outer.isGroup).toBe(true)
    const inner = outer.children.find((c) => c.id === 'inner')!
    expect(inner.isGroup).toBe(true)
    expect(inner.depth).toBe(1)
    expect(inner.children.map((c) => c.id).sort()).toEqual(['x', 'y'])
    expect(outer.children.some((c) => c.id === 'solo')).toBe(true)
  })

  it('组嵌套组：布局从最深层开始（内层先有 frame，外层布局把内层当占位）', () => {
    const nodes = [
      n('outer', 0, 0, 800, 600, undefined, 'group'),
      { ...n('inner', 100, 100, 300, 200, undefined, 'group'), parentId: 'outer' },
      { ...n('x', 120, 140), parentId: 'inner' },
      { ...n('y', 250, 140), parentId: 'inner' },
      { ...n('solo', 500, 200), parentId: 'outer' },
    ]
    const result = layoutHierarchy(nodes, [], CFG)
    // 内层组 frame 被重算（不再是输入的 300x200 固定值——由子节点包围盒+padding 决定）
    const inner = result.groupFrames.get('inner')!
    expect(inner).toBeDefined()
    expect(inner.w).toBeGreaterThan(0)
    // 内层子节点 x,y 相对内层组 frame 左上
    const rx = result.positions.get('x')
    const ry = result.positions.get('y')
    expect([...result.positions.keys()].sort()).toEqual(['solo', 'x', 'y'])
    expect(rx!.x).toBeGreaterThanOrEqual(0)
    expect(ry!.y).toBeGreaterThanOrEqual(0)
    // 外层组 frame 也被重算且包住内层组与 solo
    const outer = result.groupFrames.get('outer')!
    expect(outer.w).toBeGreaterThanOrEqual(inner.w)
    // 所有写回位置有限（无 NaN）
    for (const p of result.positions.values()) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
    }
  })

  it('无组画布：行为退化为整体 dagre（所有节点都在顶层输出）', () => {
    const nodes = [n('a', 0, 0), n('b', 300, 0)]
    const result = layoutHierarchy(nodes, [{ id: 'e1', source: 'a', target: 'b' }], CFG)
    expect(result.groupFrames.size).toBe(0)
    expect(result.positions.size).toBe(2)
    // LR：b 在 a 右侧
    expect(result.positions.get('b')!.x).toBeGreaterThan(result.positions.get('a')!.x)
  })
})
