import { describe, expect, it } from 'vitest'
import { runAutoLayout } from '../layoutEngine'
import type { AutoLayoutConfig, LayoutEdge, LayoutNode } from '../types'

/**
 * 「组内水平/垂直间距」的轴向归属。
 *
 * 用户报告：水平间距应该是 X 轴，但表现为 Y 轴。
 * 根因：dagre 的 nodesep/ranksep 含义随流向翻转，旧实现写死 nodesep=x / ranksep=y，
 * 于是横向流(LR)下水平/垂直正好接反。本测试把正确语义锁死：
 *   - 无论什么方向，intraSpacing.x 只影响水平(X)方向的距离；
 *   - 无论什么方向，intraSpacing.y 只影响垂直(Y)方向的距离。
 */

const node = (id: string): LayoutNode => ({
  id,
  type: 'x',
  position: { x: 0, y: 0 },
  size: { w: 100, h: 80 },
})
const edge = (id: string, source: string, target: string): LayoutEdge => ({ id, source, target })

function config(over: Partial<AutoLayoutConfig> = {}): AutoLayoutConfig {
  return {
    direction: 'LR',
    intraSpacing: { x: 60, y: 80 },
    interSpacing: { x: 120, y: 120 },
    focusHeightRatio: 0.5,
    minZoom: 0.1,
    maxZoom: 4,
    debug: false,
    ...over,
  }
}

/** 跑一次布局，返回 id → 位置 */
function layout(nodes: LayoutNode[], edges: LayoutEdge[], cfg: AutoLayoutConfig) {
  const result = runAutoLayout({
    nodes: nodes.map((n) => ({ ...n, position: { ...n.position } })),
    edges,
    groups: [],
    config: cfg,
  })
  const map = new Map<string, { x: number; y: number }>()
  for (const n of result.nodes) map.set(n.id, { ...n.position })
  return map
}

describe('组内间距的轴向归属（chain：不同 rank）', () => {
  it('LR：水平间距(intraSpacing.x) 拉开 X 轴距离', () => {
    const nodes = [node('a'), node('b')]
    const edges = [edge('e1', 'a', 'b')]

    const narrow = layout(nodes, edges, config({ direction: 'LR', intraSpacing: { x: 20, y: 80 } }))
    const wide = layout(nodes, edges, config({ direction: 'LR', intraSpacing: { x: 300, y: 80 } }))

    const gapNarrow = narrow.get('b')!.x - narrow.get('a')!.x
    const gapWide = wide.get('b')!.x - wide.get('a')!.x
    expect(gapWide).toBeGreaterThan(gapNarrow)
  })

  it('LR：垂直间距(intraSpacing.y) 不该改变 X 轴距离', () => {
    const nodes = [node('a'), node('b')]
    const edges = [edge('e1', 'a', 'b')]

    const small = layout(nodes, edges, config({ direction: 'LR', intraSpacing: { x: 60, y: 20 } }))
    const large = layout(nodes, edges, config({ direction: 'LR', intraSpacing: { x: 60, y: 300 } }))

    const gx1 = small.get('b')!.x - small.get('a')!.x
    const gx2 = large.get('b')!.x - large.get('a')!.x
    expect(gx2).toBeCloseTo(gx1, 5)
  })

  it('TB：垂直间距(intraSpacing.y) 拉开 Y 轴距离', () => {
    const nodes = [node('a'), node('b')]
    const edges = [edge('e1', 'a', 'b')]

    const narrow = layout(nodes, edges, config({ direction: 'TB', intraSpacing: { x: 60, y: 20 } }))
    const wide = layout(nodes, edges, config({ direction: 'TB', intraSpacing: { x: 60, y: 300 } }))

    const gapNarrow = narrow.get('b')!.y - narrow.get('a')!.y
    const gapWide = wide.get('b')!.y - wide.get('a')!.y
    expect(gapWide).toBeGreaterThan(gapNarrow)
  })

  it('TB：水平间距(intraSpacing.x) 不该改变 Y 轴距离', () => {
    const nodes = [node('a'), node('b')]
    const edges = [edge('e1', 'a', 'b')]

    const small = layout(nodes, edges, config({ direction: 'TB', intraSpacing: { x: 20, y: 80 } }))
    const large = layout(nodes, edges, config({ direction: 'TB', intraSpacing: { x: 300, y: 80 } }))

    const gy1 = small.get('b')!.y - small.get('a')!.y
    const gy2 = large.get('b')!.y - large.get('a')!.y
    expect(gy2).toBeCloseTo(gy1, 5)
  })
})

describe('组内间距的轴向归属（siblings：同一 rank）', () => {
  it('LR：同层两节点由垂直间距(intraSpacing.y) 拉开 Y 轴', () => {
    // a → b、a → c：b 与 c 处于同一 rank（同层），dagre 用 nodesep 隔开它们
    const nodes = [node('a'), node('b'), node('c')]
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'a', 'c')]

    const small = layout(nodes, edges, config({ direction: 'LR', intraSpacing: { x: 60, y: 20 } }))
    const large = layout(nodes, edges, config({ direction: 'LR', intraSpacing: { x: 60, y: 300 } }))

    const sepSmall = Math.abs(small.get('b')!.y - small.get('c')!.y)
    const sepLarge = Math.abs(large.get('b')!.y - large.get('c')!.y)
    expect(sepLarge).toBeGreaterThan(sepSmall)
  })

  it('TB：同层两节点由水平间距(intraSpacing.x) 拉开 X 轴', () => {
    const nodes = [node('a'), node('b'), node('c')]
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'a', 'c')]

    const small = layout(nodes, edges, config({ direction: 'TB', intraSpacing: { x: 20, y: 80 } }))
    const large = layout(nodes, edges, config({ direction: 'TB', intraSpacing: { x: 300, y: 80 } }))

    const sepSmall = Math.abs(small.get('b')!.x - small.get('c')!.x)
    const sepLarge = Math.abs(large.get('b')!.x - large.get('c')!.x)
    expect(sepLarge).toBeGreaterThan(sepSmall)
  })
})
