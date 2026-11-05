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

  /**
   * 用户实测 2026-11-05（截图：分镜组里的图片被排到画布右侧、容器留在原地成了空框）：
   * 宫格切分「创建分镜组」建出来的是 storyboard 容器，与 group 一样是**容器型节点**
   * （子节点 parentId 指向它、position 相对它）。自动布局只认 type==='group'，
   * 于是把它的子图当成自由节点、和容器各排各的 —— 父子级关系在布局结果里就丢了。
   *
   * 分镜组的槽位是固定宫格：布局只整体移动它，不动内部相对坐标（重排会让图文错位）。
   */
  it('storyboard 容器整体当占位：不把子图拆到顶层，也不重排槽位', () => {
    const nodes = [
      n('board', 0, 0, 600, 400, undefined, 'storyboard'),
      { ...n('p1', 10, 10, 200, 120), parentId: 'board' },
      { ...n('p2', 10, 150, 200, 120), parentId: 'board' },
      n('free', 900, 0, 200, 120),
    ]
    const result = layoutHierarchy(nodes, [], CFG)
    const board = result.groupFrames.get('board')
    expect(board).toBeDefined()
    // 子图不改写（存着的相对坐标原样保留 → 仍然对着槽位）
    expect(result.positions.has('p1')).toBe(false)
    expect(result.positions.has('p2')).toBe(false)
    // 容器尺寸保留（不按子图重算成一个新框）
    expect(board!.w).toBe(600)
    expect(board!.h).toBe(400)
    // 容器与组外自由节点各自占一个位置，互不重叠（容器是整体移动的）
    const free = result.positions.get('free')!
    const overlapX = free.x < board!.x + board!.w && free.x + 200 > board!.x
    const overlapY = free.y < board!.y + board!.h && free.y + 120 > board!.y
    expect(overlapX && overlapY).toBe(false)
  })

  /**
   * 判断容器不看 type，看数据：任何被写成 parentId 的节点都是容器。
   * 这样「以后再加一类容器节点」不需要回来改自动布局（这次的根因就是写死了 group）。
   */
  it('未知类型的容器（只要它有孩子）也按容器处理，不打散子图', () => {
    const nodes = [
      n('box', 0, 0, 500, 400, undefined, 'some-future-container'),
      { ...n('c1', 20, 20, 200, 120), parentId: 'box' },
      { ...n('c2', 20, 160, 200, 120), parentId: 'box' },
      n('free', 900, 0, 200, 120),
    ]
    const result = layoutHierarchy(nodes, [], CFG)
    expect(result.groupFrames.get('box')).toBeDefined()
    // 未知容器按原子处理：内部坐标不动（不猜它的排布规则）
    expect(result.positions.has('c1')).toBe(false)
    expect(result.positions.has('c2')).toBe(false)
  })

  it('空分镜组（还没放图）也算占位，不会和自由节点叠在一起', () => {
    const nodes = [n('empty', 0, 0, 480, 360, undefined, 'storyboard'), n('free', 900, 0, 200, 120)]
    const result = layoutHierarchy(nodes, [], CFG)
    const board = result.groupFrames.get('empty')!
    const free = result.positions.get('free')!
    expect(board).toBeDefined()
    const overlapX = free.x < board.x + board.w && free.x + 200 > board.x
    const overlapY = free.y < board.y + board.h && free.y + 120 > board.y
    expect(overlapX && overlapY).toBe(false)
  })

  /** 宫格「发送到画布」：分组里 9 张图，每张都连回组外的源图。 */
  it('group 里多张图片且都连到组外源图：分组仍然包住全部图片', () => {
    const nodes = [
      n('src', 0, 0, 320, 240, undefined, 'image'),
      n('g', 800, 0, 1000, 800, undefined, 'group'),
    ]
    for (let i = 0; i < 9; i++) {
      nodes.push({ ...n(`p${i}`, 30 + (i % 3) * 330, 40 + Math.floor(i / 3) * 250, 320, 240), parentId: 'g' })
    }
    const edges = Array.from({ length: 9 }, (_, i) => ({ id: `e${i}`, source: 'src', target: `p${i}` }))
    const result = layoutHierarchy(nodes, edges, CFG)
    const g = result.groupFrames.get('g')!
    expect(g).toBeDefined()
    for (let i = 0; i < 9; i++) {
      const p = result.positions.get(`p${i}`)!
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.x + 320).toBeLessThanOrEqual(g.w)
      expect(p.y + 240).toBeLessThanOrEqual(g.h)
    }
  })
})
