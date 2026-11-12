import { describe, expect, it } from 'vitest'
import {
  UpstreamCycleError,
  buildParentIndex,
  collectAncestors,
  directUpstreamOf,
  topoOrderFrom,
  upstreamDepth,
  type UpstreamGraphInput,
} from '../upstreamGraph'

const node = (id: string, type = 'text') => ({ id, type, data: {} })
const edge = (source: string, target: string) => ({ source, target })

function graph(nodes: string[], edges: Array<[string, string]>): UpstreamGraphInput {
  return { nodes: nodes.map((id) => node(id)), edges: edges.map(([s, t]) => edge(s, t)) }
}

describe('upstreamGraph · 直接上游', () => {
  it('返回连进当前节点的一层', () => {
    const g = graph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']])
    expect(directUpstreamOf(g, 'c')).toEqual(['b'])
    expect(directUpstreamOf(g, 'b')).toEqual(['a'])
    expect(directUpstreamOf(g, 'a')).toEqual([])
  })

  it('同一对端点只保留一条（重复边去重）', () => {
    const g: UpstreamGraphInput = { nodes: [node('a'), node('b')], edges: [edge('a', 'b'), edge('a', 'b')] }
    expect(buildParentIndex(g).get('b')).toEqual(['a'])
  })
})

describe('upstreamGraph · 整条祖先链', () => {
  it('三层链路从末端拿到全部祖先', () => {
    const g = graph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']])
    expect(new Set(collectAncestors(g, 'c'))).toEqual(new Set(['a', 'b']))
    expect(upstreamDepth(g, 'c')).toBe(2)
  })

  it('分叉：两个上游都在', () => {
    const g = graph(['a', 'b', 'c'], [['a', 'c'], ['b', 'c']])
    expect(new Set(collectAncestors(g, 'c'))).toEqual(new Set(['a', 'b']))
  })

  it('菱形依赖：共同祖先只出现一次', () => {
    const g = graph(['a', 'b', 'c', 'd'], [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']])
    const ancestors = collectAncestors(g, 'd')
    expect(ancestors.filter((id) => id === 'a')).toHaveLength(1)
    expect(new Set(ancestors)).toEqual(new Set(['a', 'b', 'c']))
  })
})

describe('upstreamGraph · 拓扑序', () => {
  it('上游先出，末端最后', () => {
    const g = graph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']])
    expect(topoOrderFrom(g, 'c')).toEqual(['a', 'b', 'c'])
  })

  it('分叉 + 菱形：每个节点只出一次，末端最后', () => {
    const g = graph(['a', 'b', 'c', 'd'], [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']])
    const order = topoOrderFrom(g, 'd')
    expect(order).toHaveLength(4)
    expect(order.at(-1)).toBe('d')
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'))
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'))
  })

  it('结果稳定：同一张图多次调用一致', () => {
    const g = graph(['a', 'b', 'c'], [['a', 'c'], ['b', 'c']])
    expect(topoOrderFrom(g, 'c')).toEqual(topoOrderFrom(g, 'c'))
  })

  it('无上游时只返回自己', () => {
    expect(topoOrderFrom(graph(['a'], []), 'a')).toEqual(['a'])
  })
})

describe('upstreamGraph · 环', () => {
  it('cycle=error 抛错并列出环上节点', () => {
    const g = graph(['a', 'b'], [['a', 'b'], ['b', 'a']])
    expect(() => topoOrderFrom(g, 'a', { cycle: 'error' })).toThrow(UpstreamCycleError)
  })

  it('cycle=skip 不死循环，仍给出顺序', () => {
    const g = graph(['a', 'b'], [['a', 'b'], ['b', 'a']])
    const order = topoOrderFrom(g, 'a', { cycle: 'skip' })
    expect(order).toContain('a')
    expect(order.length).toBeLessThanOrEqual(2)
  })
})

describe('upstreamGraph · 边界', () => {
  it('默认忽略中间态边', () => {
    const g: UpstreamGraphInput = {
      nodes: [node('a'), node('b')],
      edges: [{ source: 'a', target: 'b', data: { transient: true } }],
    }
    expect(collectAncestors(g, 'b')).toEqual([])
    expect(collectAncestors(g, 'b', { includeTransient: true })).toEqual(['a'])
  })

  it('默认不把分组当数据源', () => {
    const g: UpstreamGraphInput = {
      nodes: [node('g', 'group'), node('b')],
      edges: [edge('g', 'b')],
    }
    expect(collectAncestors(g, 'b')).toEqual([])
    expect(collectAncestors(g, 'b', { includeGroups: true })).toEqual(['g'])
  })

  it('maxDepth 限制层数', () => {
    const g = graph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']])
    expect(collectAncestors(g, 'c', { maxDepth: 1 })).toEqual(['b'])
  })
})
