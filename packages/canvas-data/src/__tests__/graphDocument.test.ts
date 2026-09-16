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

  /**
   * 加边**必须过规则校验**（用户明确要求："添加连接线的时候 绝对不能绕过这个规则检验"）。
   *
   * 背景：以前 graph.addEdge 直接写 edgeStore，**没有任何校验** —— 于是插件/云端/测试都能
   * 绕开自连/成环/重复/类型/容量把非法边塞进图。现在规则在唯一写入口落闸，谁加边都躲不过。
   */
  it('自连被拒：graph.addEdge 不落脏边', () => {
    const { graph, nodeStore, edgeStore } = makeGraph()
    nodeStore.registerType({ type: 'a', label: 'A', defaultSize: { w: 10, h: 10 } })
    const a = graph.createNode('a', { x: 0, y: 0 })
    graph.addEdge({ source: a, target: a })
    expect(edgeStore.getEdges()).toHaveLength(0)
  })

  it('重复边被拒：同一条 canonical 连接只留一条', () => {
    const { graph, nodeStore, edgeStore } = makeGraph()
    nodeStore.registerType({ type: 'a', label: 'A', defaultSize: { w: 10, h: 10 } })
    const a = graph.createNode('a', { x: 0, y: 0 })
    const b = graph.createNode('a', { x: 5, y: 5 })
    graph.addEdge({ source: a, target: b })
    graph.addEdge({ source: a, target: b })
    expect(edgeStore.getEdges()).toHaveLength(1)
  })

  it('成环被拒：a→b→c 之后再补 c→a 不落边', () => {
    const { graph, nodeStore, edgeStore } = makeGraph()
    nodeStore.registerType({ type: 'a', label: 'A', defaultSize: { w: 10, h: 10 } })
    const a = graph.createNode('a', { x: 0, y: 0 })
    const b = graph.createNode('a', { x: 1, y: 1 })
    const c = graph.createNode('a', { x: 2, y: 2 })
    graph.addEdge({ source: a, target: b })
    graph.addEdge({ source: b, target: c })
    graph.addEdge({ source: c, target: a })
    expect(edgeStore.getEdges()).toHaveLength(2)
  })

  it('类型不匹配被拒：只收 text 的输入口拒绝来自 image 的边', () => {
    const { graph, nodeStore, edgeStore } = makeGraph()
    nodeStore.registerType({
      type: 'img',
      label: 'I',
      defaultSize: { w: 10, h: 10 },
      outputs: [{ port: 'source', contentType: 'image' }],
    })
    nodeStore.registerType({
      type: 'txt',
      label: 'T',
      defaultSize: { w: 10, h: 10 },
      inputs: [{ port: 'target', acceptsTypes: ['text'] }],
    })
    const i = graph.createNode('img', { x: 0, y: 0 })
    const t = graph.createNode('txt', { x: 5, y: 5 })
    graph.addEdge({ source: i, target: t })
    expect(edgeStore.getEdges()).toHaveLength(0)
  })

  it('临时脚手架边（data.transient）不校验：拖线中的占位边端点可能还没进 store', () => {
    const { graph, nodeStore, edgeStore } = makeGraph()
    nodeStore.registerType({ type: 'a', label: 'A', defaultSize: { w: 10, h: 10 } })
    const a = graph.createNode('a', { x: 0, y: 0 })
    graph.addEdge({ source: a, target: '__ghost__', data: { transient: true } })
    expect(edgeStore.getEdges()).toHaveLength(1)
  })

  /**
   * connectEdge —— 全路径统一入口（用户明确要求：所有建线操作都走同一个函数，
   * 在那里同时解决 evictOnFull / capacity / 校验，全部通过才建）。
   */
  describe('connectEdge —— 统一入口：校验 + 容量挤出 + 结构化结果', () => {
    function bootWithCap(capacity: number, evictOnFull?: boolean) {
      const g = makeGraph()
      g.nodeStore.registerType({
        type: 't',
        label: 'T',
        defaultSize: { w: 10, h: 10 },
        inputs: [{ port: 'target', capacity, ...(evictOnFull !== undefined ? { evictOnFull } : {}) }],
      })
      return g
    }

    it('没声明 capacity = 不限条数：连多少条都 ok', () => {
      const { graph, edgeStore, nodeStore } = makeGraph()
      nodeStore.registerType({ type: 't', label: 'T', defaultSize: { w: 10, h: 10 }, inputs: [{ port: 'target' }] })
      const t = graph.createNode('t', { x: 0, y: 0 })
      const results = []
      for (let i = 0; i < 5; i++) {
        const s = graph.createNode('t', { x: i + 1, y: 0 })
        results.push(graph.connectEdge({ source: s, target: t, sourceHandle: 'source', targetHandle: 'target' }))
      }
      expect(results.every((r) => r.status === 'ok')).toBe(true)
      expect(results.every((r) => r.evictedEdgeId === undefined)).toBe(true)
      expect(edgeStore.getEdges().filter((e) => e.target === t)).toHaveLength(5)
    })

    it('capacity=2 满额 → 默认挤最老一条，结果带 evictedEdgeId', () => {
      const { graph, edgeStore } = bootWithCap(2)
      const t = graph.createNode('t', { x: 0, y: 0 })
      const ids = [0, 1, 2].map((i) => graph.createNode('t', { x: i + 1, y: 0 }))
      const r1 = graph.connectEdge({ source: ids[0], target: t, sourceHandle: 'source', targetHandle: 'target' })
      const r2 = graph.connectEdge({ source: ids[1], target: t, sourceHandle: 'source', targetHandle: 'target' })
      expect(r1.status).toBe('ok')
      expect(r2.status).toBe('ok')
      // 第 3 条：满额 → 挤掉第一条（FIFO），新边照常建成
      const r3 = graph.connectEdge({ source: ids[2], target: t, sourceHandle: 'source', targetHandle: 'target' })
      expect(r3.status).toBe('ok')
      expect(r3.evictedEdgeId).toBe(r1.edgeId)
      const kept = edgeStore.getEdges().filter((e) => e.target === t).map((e) => e.source)
      expect(kept).toEqual([ids[1], ids[2]])
    })

    it('capacity=1 + evictOnFull:false → 满即拒，不挤', () => {
      const { graph, edgeStore } = bootWithCap(1, false)
      const t = graph.createNode('t', { x: 0, y: 0 })
      const a = graph.createNode('t', { x: 1, y: 0 })
      const b = graph.createNode('t', { x: 2, y: 0 })
      const r1 = graph.connectEdge({ source: a, target: t, sourceHandle: 'source', targetHandle: 'target' })
      expect(r1.status).toBe('ok')
      const r2 = graph.connectEdge({ source: b, target: t, sourceHandle: 'source', targetHandle: 'target' })
      expect(r2.status).toBe('rejected')
      expect(r2.reason).toBe('limit-reached')
      expect(r2.edgeId).toBe('')
      expect(edgeStore.getEdges().filter((e) => e.target === t)).toHaveLength(1)
    })

    it('重复边 → status=duplicate（幂等，不报错也不重复建）', () => {
      const { graph, edgeStore, nodeStore } = makeGraph()
      nodeStore.registerType({ type: 't', label: 'T', defaultSize: { w: 10, h: 10 } })
      const a = graph.createNode('t', { x: 0, y: 0 })
      const b = graph.createNode('t', { x: 1, y: 0 })
      const r1 = graph.connectEdge({ source: a, target: b, sourceHandle: 'source', targetHandle: 'target' })
      const r2 = graph.connectEdge({ source: a, target: b, sourceHandle: 'source', targetHandle: 'target' })
      expect(r1.status).toBe('ok')
      expect(r2.status).toBe('duplicate')
      expect(edgeStore.getEdges()).toHaveLength(1)
    })

    it('被挤掉的边与新建边在同一条历史记录里：一次撤销全退', () => {
      const { graph, edgeStore, history } = bootWithCap(1)
      const t = graph.createNode('t', { x: 0, y: 0 })
      const a = graph.createNode('t', { x: 1, y: 0 })
      const b = graph.createNode('t', { x: 2, y: 0 })
      graph.connectEdge({ source: a, target: t, sourceHandle: 'source', targetHandle: 'target' })
      const depthBefore = history.undoDepth
      const r = graph.connectEdge({ source: b, target: t, sourceHandle: 'source', targetHandle: 'target' })
      expect(r.evictedEdgeId).toBeTruthy()
      // 挤出 + 落边 = 一条历史（撤销一次，两条边都回到加边前状态）
      expect(history.undoDepth).toBe(depthBefore + 1)
      graph.undo()
      const kept = edgeStore.getEdges().filter((e) => e.target === t).map((e) => e.source)
      expect(kept).toEqual([a])
    })
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
