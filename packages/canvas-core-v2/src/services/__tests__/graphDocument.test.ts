import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NodeStore } from '../nodeStore'
import { EdgeStore } from '../edgeStore'
import { Selection } from '../selection'
import { History } from '../history'
import { GraphDocument } from '../graphDocument'
import type { GraphEnvelope } from '../graphDocument'

function makeGraph(opts?: { commit?: (env: GraphEnvelope) => void }) {
  const nodeStore = new NodeStore()
  const edgeStore = new EdgeStore()
  const selection = new Selection()
  const history = new History({
    snapshot: (): GraphEnvelope => ({
      nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())) as never,
      edges: JSON.parse(JSON.stringify(edgeStore.getEdges())) as never,
    }),
    restore: (g) => {
      const env = (g as GraphEnvelope) ?? { nodes: [], edges: [] }
      nodeStore.replaceAll(env.nodes as never)
      edgeStore.replaceAll(env.edges as never)
    },
  })
  const graph = new GraphDocument(nodeStore, edgeStore, selection, history, opts?.commit)
  return { nodeStore, edgeStore, selection, history, graph }
}

beforeEach(() => {
  vi.useRealTimers()
})

describe('GraphDocument —— 唯一写入口', () => {
  it('createNode/addEdge 写入 store 并同步触发提交回调(每次变更一次)', () => {
    const commit = vi.fn()
    const { graph, nodeStore, edgeStore } = makeGraph({ commit })
    nodeStore.registerType({ type: 'a', label: 'A', defaultSize: { w: 10, h: 10 } })
    nodeStore.registerType({ type: 'b', label: 'B', defaultSize: { w: 10, h: 10 } })
    const a = graph.createNode('a', { x: 0, y: 0 })
    const b = graph.createNode('b', { x: 5, y: 5 })
    graph.addEdge({ source: a, target: b })
    // 同步提交：三次变更各触发一次，最后一次信封为最终整图
    expect(commit).toHaveBeenCalledTimes(3)
    expect(commit.mock.calls[2][0].nodes).toHaveLength(2)
    expect(commit.mock.calls[2][0].edges).toHaveLength(1)
  })

  it('removeNodes 级联：删节点清相连边、清仍存活子节点 parentId、清选中态', () => {
    const { graph, nodeStore, edgeStore, selection } = makeGraph()
    nodeStore.registerType({ type: 'a', label: 'A', defaultSize: { w: 10, h: 10 } })
    const parent = graph.createNode('a', { x: 0, y: 0 })
    const child = graph.createNode('a', { x: 1, y: 1 })
    const other = graph.createNode('a', { x: 9, y: 9 })
    graph.updateNode(child, { parentId: parent })
    graph.addEdge({ source: parent, target: child })
    graph.addEdge({ source: child, target: other })
    selection.set([parent, child, other])

    graph.removeNodes([parent])
    expect(nodeStore.getNode(parent)).toBeUndefined()
    // 子节点父被删 → parentId 清掉
    expect(nodeStore.getNode(child)?.parentId).toBeUndefined()
    // 只删 parent：parent→child 被级联清，child→other 与两端存活节点保留
    expect(edgeStore.getEdges().map((e) => e.id)).toEqual(['e-2-3'])
    expect(selection.has(parent)).toBe(false)
    // 未删节点仍保留选中（pruneSelection 只移幽灵，不清有效选中）
    expect(selection.has(child)).toBe(true)
    expect(selection.has(other)).toBe(true)
  })

  it('removeEdges 清边并清该边选中态', () => {
    const { graph, nodeStore, edgeStore, selection } = makeGraph()
    nodeStore.registerType({ type: 'a', label: 'A', defaultSize: { w: 10, h: 10 } })
    const a = graph.createNode('a', { x: 0, y: 0 })
    const b = graph.createNode('a', { x: 5, y: 5 })
    const eid = graph.addEdge({ source: a, target: b })
    selection.setEdges([eid])
    graph.removeEdges([eid])
    expect(edgeStore.getEdges()).toHaveLength(0)
    expect(selection.hasEdge(eid)).toBe(false)
  })

  it('undo/redo 统一作用节点+边，并在变化后清选中与触发提交', async () => {
    const commit = vi.fn()
    const { graph, nodeStore, edgeStore, selection } = makeGraph({ commit })
    nodeStore.registerType({ type: 'a', label: 'A', defaultSize: { w: 10, h: 10 } })
    const a = graph.createNode('a', { x: 0, y: 0 })
    const b = graph.createNode('a', { x: 5, y: 5 })
    graph.addEdge({ source: a, target: b })
    selection.set([a])

    graph.undo() // 撤销 addEdge：边消失，两节点仍在
    expect(nodeStore.getNode(a)).toBeDefined()
    expect(nodeStore.getNode(b)).toBeDefined()
    expect(edgeStore.getEdges()).toHaveLength(0)
    graph.undo() // 撤销 createNode(b)
    expect(nodeStore.getNode(b)).toBeUndefined()
    graph.undo() // 撤销 createNode(a)
    expect(nodeStore.getNode(a)).toBeUndefined()
    expect(edgeStore.getEdges()).toHaveLength(0)
    expect(selection.size).toBe(0)

    graph.redo()
    expect(nodeStore.getNode(a)).toBeDefined()
    graph.redo()
    expect(nodeStore.getNode(b)).toBeDefined()
    graph.redo()
    expect(edgeStore.getEdges()).toHaveLength(1)
    await new Promise((r) => setTimeout(r, 5))
    // 防抖合并：至少有一次最终图提交，且最终信封内容正确
    expect(commit.mock.calls.length).toBeGreaterThanOrEqual(1)
    const last = commit.mock.calls[commit.mock.calls.length - 1][0]
    expect(last.nodes).toHaveLength(2)
    expect(last.edges).toHaveLength(1)
  })

  it('transaction 内多次写合并为一条历史', () => {
    const { graph, nodeStore, history } = makeGraph()
    nodeStore.registerType({ type: 'a', label: 'A', defaultSize: { w: 10, h: 10 } })
    graph.transaction('create-two', (tx) => {
      tx.createNode('a', { x: 0, y: 0 })
      tx.createNode('a', { x: 1, y: 1 })
    })
    expect(nodeStore.getNodes()).toHaveLength(2)
    expect(history.undoDepth).toBe(1)
  })
})
