/**
 * edgeStore.test —— EdgeStore 纯逻辑单测（边下沉内核后的数据源）。
 *
 * 覆盖：加边/去重、按 id 删边、删节点连带清边、清悬挂边、整体回填、订阅(add/remove/replace 触发)。
 */
import { describe, it, expect } from 'vitest'
import { EdgeStore, edgeStoreId } from '../edgeStore'
import type { StoredEdgeInput } from '../edgeStore'

function aliveIds(nodes: Array<{ id: string }>): Set<string> {
  return new Set(nodes.map((n) => n.id))
}

describe('EdgeStore（边数据服务）', () => {
  it('addEdge 生成稳定 id(source→target)，重复连去重为一条', () => {
    const es = new EdgeStore()
    const id1 = es.addEdge({ source: '1', target: '2' })
    expect(id1).toBe(edgeStoreId('1', '2'))
    // 同源同目标再加 → 同一 id，替换不新增
    const id2 = es.addEdge({ source: '1', target: '2' })
    expect(id2).toBe(id1)
    expect(es.getEdges()).toHaveLength(1)
    expect(es.getEdge(id1)?.type).toBe('custom')
  })

  it('addEdge 保留 type / sourceHandle / targetHandle', () => {
    const es = new EdgeStore()
    es.addEdge({ source: '1', target: '2', type: 'straight', sourceHandle: 'out', targetHandle: 'in' })
    const e = es.getEdges()[0]
    expect(e.type).toBe('straight')
    expect(e.sourceHandle).toBe('out')
    expect(e.targetHandle).toBe('in')
  })

  it('removeEdge 按 id 删；不存在 no-op', () => {
    const es = new EdgeStore()
    es.addEdge({ source: '1', target: '2' })
    expect(es.removeEdge(edgeStoreId('1', '2'))).toBe(true)
    expect(es.getEdges()).toHaveLength(0)
    expect(es.removeEdge('nope')).toBe(false)
  })

  it('removeEdgesOfNode 删节点连带清掉相连的边', () => {
    const es = new EdgeStore()
    es.addEdge({ source: '1', target: '2' })
    es.addEdge({ source: '2', target: '3' })
    es.addEdge({ source: '4', target: '5' }) // 与 2 无关，保留
    const n = es.removeEdgesOfNode('2')
    expect(n).toBe(2)
    expect(es.getEdges().map((e) => e.source + '->' + e.target)).toEqual(['4->5'])
  })

  it('pruneDanglingEdges 清掉 source/target 不在存活集的边', () => {
    const es = new EdgeStore()
    es.addEdge({ source: '1', target: '2' })
    es.addEdge({ source: '2', target: '3' })
    es.addEdge({ source: '3', target: '1' })
    const removed = es.pruneDanglingEdges(aliveIds([{ id: '1' }, { id: '2' }])) // 3 没了
    expect(removed).toBe(2) // 2->3 与 3->1 都因 3 消失被清
    expect(es.getEdges().map((e) => e.source + '->' + e.target)).toEqual(['1->2'])
  })

  it('replaceAll 整体回填(刷新恢复)，id 缺省自动补', () => {
    const es = new EdgeStore()
    const edges: StoredEdgeInput[] = [
      { id: 'a', source: '1', target: '2' },
      { source: '3', target: '4' }, // 无 id → 按 source/target 生成
    ]
    es.replaceAll(edges)
    expect(es.getEdges()).toHaveLength(2)
    expect(es.getEdge('a')?.source).toBe('1')
    expect(es.getEdges().some((e) => e.id === edgeStoreId('3', '4'))).toBe(true)
  })

  it('subscribe：add/remove/replace 各自触发，返回句柄可停收', () => {
    const es = new EdgeStore()
    const reasons: string[] = []
    const off = es.subscribe((r, id) => reasons.push(r + (id ? ':' + id : '')))
    es.addEdge({ source: '1', target: '2' })
    es.removeEdge(edgeStoreId('1', '2'))
    es.addEdge({ source: '2', target: '3' })
    es.replaceAll([])
    expect(reasons).toEqual(['add:e-1-2', 'remove:e-1-2', 'add:e-2-3', 'replace'])
    off()
    es.addEdge({ source: '5', target: '6' })
    expect(reasons).toHaveLength(4) // 停收
  })
})
