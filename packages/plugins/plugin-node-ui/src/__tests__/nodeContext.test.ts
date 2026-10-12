import { describe, it, expect } from 'vitest'
import { buildNodeContext, UI_DATA_KEYS } from '../nodeUiPlugin'

/** 造一个最小的 ctx（只实现 buildNodeContext 用到的 tryGet 与 get） */
function fakeCtx(nodes: Array<Record<string, unknown>>, edges: Array<{ source: string; target: string }>, settings: Record<string, unknown> = {}) {
  const doc = {
    getNode: (id: string) => nodes.find((n) => n.id === id),
    getNodes: () => nodes,
    getEdges: () => edges,
  }
  return {
    get: (name: string) => (name === 'doc' ? doc : undefined),
    tryGet: (name: string) => (name === 'settings' ? { get: (k: string) => settings[k] } : undefined),
  } as never
}

describe('给 Agent 的上下文（一次拿齐"该画什么"）', () => {
  const nodes = [
    { id: '1', type: 'image', data: { label: '封面', imageUrl: '/api/a.png' } },
    { id: '2', type: 'text', data: { text: '一段说明' } },
    { id: '3', type: 'ui', data: { [UI_DATA_KEYS.inputs]: [{ key: 'sales', type: 'table' }] } },
    // 没连到本节点的（不该出现在上游里）
    { id: '4', type: 'image', data: { imageUrl: '/api/other.png' } },
  ]
  const edges = [
    { source: '1', target: '3' },
    { source: '2', target: '3' },
  ]

  it('带上节点、画布、后台地址', () => {
    const c = buildNodeContext(fakeCtx(nodes, edges), '3')
    expect(c.nodeId).toBe('3')
    expect(c.canvasId).toBe('default')
    expect(typeof c.baseUrl).toBe('string')
  })

  it('只收连进本节点的上游素材，并带上节点 id（操作画布要按 id 找）', () => {
    const c = buildNodeContext(fakeCtx(nodes, edges), '3')
    expect(c.upstream).toHaveLength(2)
    expect(c.upstream.map((u) => u.nodeId)).toEqual(['1', '2'])
    expect(c.upstream[0]).toMatchObject({ kind: 'image', url: '/api/a.png' })
    expect(c.upstream[1]).toMatchObject({ kind: 'text', value: '一段说明' })
    // 没连进来的那个不该出现
    expect(c.upstream.some((u) => u.url === '/api/other.png')).toBe(false)
  })

  it('带上声明的输入参数（没声明就是空数组，不影响）', () => {
    const c = buildNodeContext(fakeCtx(nodes, edges), '3')
    expect(c.inputs).toEqual([{ key: 'sales', type: 'table' }])
  })

  it('给后台地址时附上接口速查（Agent 才知道怎么真的动手）', () => {
    const c = buildNodeContext(fakeCtx(nodes, edges, { uiNodeBaseUrl: 'http://localhost:8865' }), '3')
    expect(c.baseUrl).toBe('http://localhost:8865')
    expect(c.apiHint).toContain('/api/canvases/')
    expect(c.apiHint).toContain('/api/jobs')
  })

  it('节点不存在也不抛（返回一份空上下文，让调用方自己判断）', () => {
    const c = buildNodeContext(fakeCtx(nodes, edges), 'nope')
    expect(c.nodeId).toBe('nope')
    expect(c.upstream).toEqual([])
    expect(c.inputs).toEqual([])
  })

  it('连了多个同一素材只算一次（重复连线不该出现两条）', () => {
    const dup = [...edges, { source: '1', target: '3' }]
    const c = buildNodeContext(fakeCtx(nodes, dup), '3')
    expect(c.upstream.filter((u) => u.nodeId === '1')).toHaveLength(1)
  })
})

