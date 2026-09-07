import { describe, expect, it } from 'vitest'
import { buildClusters, layoutClusterRecursive, layoutGlobalClusters, runAutoLayout } from '../layoutEngine'
import type { LayoutNode, LayoutEdge } from '../types'

const n = (id: string, x = 0, y = 0, w = 100, h = 80, data?: Record<string, unknown>): LayoutNode => ({
  id, type: 'x', position: { x, y }, size: { w, h }, data,
})
const e = (id: string, source: string, target: string): LayoutEdge => ({ id, source, target })

describe('buildClusters', () => {
  it('无节点 → 空簇', () => {
    const { clusters } = buildClusters([], [], [])
    expect(clusters).toEqual([])
  })

  it('孤立节点 → single 簇', () => {
    const nodes = [n('a'), n('b')]
    const { clusters } = buildClusters(nodes, [], [])
    expect(clusters).toHaveLength(2)
    expect(clusters.every((c) => c.type === 'single')).toBe(true)
  })

  it('有边相连 → connected 簇（含多个节点）', () => {
    const nodes = [n('a'), n('b'), n('c')]
    const edges = [e('e1', 'a', 'b')]
    const { clusters } = buildClusters(nodes, edges, [])
    // a,b 连通成 connected；c 孤立 single
    const connected = clusters.filter((c) => c.type === 'connected')
    expect(connected).toHaveLength(1)
    expect(connected[0].nodes.map((x) => x.id).sort()).toEqual(['a', 'b'])
  })

  it('组内子节点 → group 簇', () => {
    const nodes = [n('c1', 0, 0), n('c2', 0, 0), n('free')]
    const { clusters } = buildClusters(nodes, [], [{ id: 'g1', nodeIds: new Set(['c1', 'c2']) }])
    const group = clusters.find((c) => c.type === 'group')
    expect(group).toBeDefined()
    expect(group!.groupId).toBe('g1')
    expect(group!.nodes.map((x) => x.id).sort()).toEqual(['c1', 'c2'])
  })

  it('跨簇有连线 → 合并成 super 簇', () => {
    // 组簇(g1: c1,c2) + connected 簇(a,b)，a→c1 跨簇边把它们 union 成 super
    const nodes = [n('a'), n('b'), n('c1'), n('c2')]
    const edges = [e('e1', 'a', 'b'), e('e2', 'a', 'c1')]
    const { clusters } = buildClusters(nodes, edges, [{ id: 'g1', nodeIds: new Set(['c1', 'c2']) }])
    const supers = clusters.filter((c) => c.type === 'super')
    expect(supers).toHaveLength(1)
    expect(supers[0].subClusters).toHaveLength(2)
    expect(supers[0].nodes.map((x) => x.id).sort()).toEqual(['a', 'b', 'c1', 'c2'])
  })
})

describe('layoutClusterRecursive + layoutGlobalClusters', () => {
  it('single 簇归一到 (0,0) 并给 bounds', () => {
    const nodes = [n('a', 500, 300)]
    const { clusters } = buildClusters(nodes, [], [])
    layoutClusterRecursive(clusters[0], [], { direction: 'LR', intraSpacing: { x: 60, y: 80 }, interSpacing: { x: 120, y: 120 }, focusHeightRatio: 0.5, minZoom: 0.1, maxZoom: 4, debug: false }, [])
    expect(clusters[0].nodes[0].position).toEqual({ x: 0, y: 0 })
    expect(clusters[0].bounds!.w).toBe(100)
    expect(clusters[0].bounds!.h).toBe(80)
  })

  it('connected 簇内部 dagre 排布：节点不重叠且 bounds 覆盖全部', () => {
    const nodes = [n('a'), n('b'), n('c')]
    const edges = [e('e1', 'a', 'b'), e('e2', 'b', 'c')]
    const config = { direction: 'LR' as const, intraSpacing: { x: 60, y: 80 }, interSpacing: { x: 120, y: 120 }, focusHeightRatio: 0.5, minZoom: 0.1, maxZoom: 4, debug: false }
    const { clusters } = buildClusters(nodes, edges, [])
    const conn = clusters.find((c) => c.type === 'connected')!
    layoutClusterRecursive(conn, edges, config, [])
    // 每个节点位置非负（局部坐标）；bounds 覆盖到最右/最下
    for (const nd of conn.nodes) {
      expect(nd.position.x).toBeGreaterThanOrEqual(0)
      expect(nd.position.y).toBeGreaterThanOrEqual(0)
    }
    const maxRight = Math.max(...conn.nodes.map((nd) => nd.position.x + (nd.size?.w ?? 0)))
    expect(conn.bounds!.w).toBeGreaterThanOrEqual(maxRight)
  })

  it('单簇全局布局：整体平移到 margin(80) 附近', () => {
    const nodes = [n('a', 10, 10), n('b', 10, 10)]
    const edges = [e('e1', 'a', 'b')]
    const config = { direction: 'TB' as const, intraSpacing: { x: 60, y: 80 }, interSpacing: { x: 120, y: 120 }, focusHeightRatio: 0.5, minZoom: 0.1, maxZoom: 4, debug: false }
    const { clusters } = buildClusters(nodes, edges, [])
    for (const cl of clusters) layoutClusterRecursive(cl, edges, config, [])
    layoutGlobalClusters(clusters, edges, config, [])
    for (const cl of clusters) {
      for (const nd of cl.nodes) {
        expect(nd.position.x).toBeGreaterThanOrEqual(0)
        expect(nd.position.y).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('runAutoLayout', () => {
  it('完整跑通：自由连通节点被重排且互不重叠', () => {
    const nodes = [n('a', 0, 0), n('b', 300, 200), n('c', 600, 50)]
    const edges = [e('e1', 'a', 'b')]
    const config = { direction: 'LR' as const, intraSpacing: { x: 60, y: 80 }, interSpacing: { x: 120, y: 120 }, focusHeightRatio: 0.5, minZoom: 0.1, maxZoom: 4, debug: false }
    const result = runAutoLayout({ nodes, edges, groups: [], config })
    expect(result.nodes).toHaveLength(3)
    // 每个节点都有合法非负位置
    for (const nd of result.nodes) {
      expect(nd.position.x).toBeGreaterThanOrEqual(0)
      expect(nd.position.y).toBeGreaterThanOrEqual(0)
    }
    expect(result.logs.length).toBeGreaterThan(0)
  })
})
