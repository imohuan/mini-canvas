/**
 * docService —— 文档门面（设计文档 §九 步骤 5a）的验收：**纯新增、零行为变化**。
 *
 * 锁四件事：
 * 1. 门面覆盖四个老服务的**对外方法**，且转发到同一实例（不是复制/重建数据）；
 * 2. 写路径全经唯一写入口 → 自动进历史、可撤销（"读走 store、写走 graph"不再靠消费方自觉）；
 * 3. **老服务名一个不少**（5a 是新老并存，删名是 5c 的事）；
 * 4. 底层服务缺席时**响亮报错**（不静默返回空数据 —— 那会让缺件变成"莫名没反应"）。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '../canvas/context'
import { Context as KernelContext } from '@mini-canvas/kernel'
import { NodeStore } from '../nodeStore'
import { EdgeStore } from '../edgeStore'
import { Selection } from '../selection'
import { History } from '../history'
import { GraphDocument } from '../graphDocument'
import type { GraphEnvelope } from '../graphDocument'
import { createDocService } from '../docService'
import type { DocService } from '../docService'

/** 与 canvasBasePlugin 同形的最小装配（真服务，不 mock） */
function boot() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  const edgeStore = new EdgeStore()
  const selection = new Selection()
  const history = new History({
    snapshot: (): GraphEnvelope => ({
      nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())) as GraphEnvelope['nodes'],
      edges: JSON.parse(JSON.stringify(edgeStore.getEdges())) as GraphEnvelope['edges'],
    }),
    restore: (g) => {
      const env = (g as GraphEnvelope) ?? { nodes: [], edges: [] }
      nodeStore.replaceAll(env.nodes ?? [])
      edgeStore.replaceAll(env.edges ?? [])
    },
  })
  const graph = new GraphDocument(nodeStore, edgeStore, selection, history)
  // 步骤 5c：四个老服务名已下线；门面由装配方交实例（与 canvasBasePlugin 同一形状）。
  ctx.inject('doc', createDocService({ nodeStore, edgeStore, graph, history }))
  ctx.inject('selection', selection)
  nodeStore.registerType({ type: 'text', label: '文本', defaultSize: { w: 200, h: 100 } })
  return { ctx, nodeStore, edgeStore, selection, history, graph, doc: ctx.get<DocService>('doc') }
}

describe('doc 门面 —— 覆盖四个老服务的对外方法', () => {
  it('读：节点/边/类型表/层级查询都转发到 nodeStore/edgeStore 同一实例', () => {
    const { nodeStore, edgeStore } = boot()
    const doc = createDocService(() => ({ nodeStore, edgeStore, graph: undefined, history: undefined }))

    const a = nodeStore.addNode('text', { x: 0, y: 0 })
    const b = nodeStore.addNodes([{ type: 'text', position: { x: 50, y: 50 } }])
    expect(b).toBe(1)
    const bid = nodeStore.getNodes()[1].id
    const eid = edgeStore.addEdge({ source: a, target: bid })

    expect(doc.getNodes().map((n) => n.id)).toEqual([a, bid])
    expect(doc.getNode(a)?.type).toBe('text')
    expect(doc.getNode('ghost')).toBeUndefined()
    expect(doc.getEdges().map((e) => e.id)).toEqual([eid])
    expect(doc.getEdge(eid)?.source).toBe(a)
    expect(doc.types.get('text')?.label).toBe('文本')

    // 同一实例：改 store 立刻经门面可见（不是拷贝快照）
    nodeStore.addNode('text', { x: 900, y: 900 })
    expect(doc.getNodes()).toHaveLength(3)
  })

  it('层级查询 childNodesOf 转发（容器型节点用）', () => {
    const { nodeStore } = boot()
    const doc = createDocService(() => ({ nodeStore, graph: undefined }))
    const parent = nodeStore.addNodes([{ type: 'text', position: { x: 0, y: 0 } }])
    const pid = nodeStore.getNodes()[0].id
    nodeStore.addNodes([{ type: 'text', position: { x: 1, y: 1 }, parentId: pid }])
    expect(parent).toBe(1)
    expect(doc.childNodesOf(pid).map((n) => n.position)).toEqual([{ x: 1, y: 1 }])
    expect(doc.childNodesOf('ghost')).toEqual([])
  })

})

describe('doc 门面 —— 写路径统一走唯一写入口（历史 + 提交）', () => {
  it('写方法都进历史：一步 undo 可整体回退', () => {
    const { nodeStore, edgeStore, history, graph } = boot()
    const doc: DocService = createDocService(() => ({ nodeStore, edgeStore, history, graph }))

    const a = doc.createNode('text', { x: 0, y: 0 }, { text: 'hi' })
    expect(doc.getNode(a)?.data.text).toBe('hi')
    const b = doc.createNode('text', { x: 300, y: 0 })
    const eid = doc.addEdge({ source: a, target: b })
    expect(eid).toBeTruthy()

    const depthBefore = history.undoDepth
    doc.updateNode(a, { data: { text: 'edited' } })
    expect(history.undoDepth).toBe(depthBefore + 1)
    doc.updateNodeData(a, { text: 'again' })
    expect(doc.getNode(a)?.data.text).toBe('again')
    expect(history.undoDepth).toBe(depthBefore + 2)
  })

  it('undo/redo 覆盖节点 + 边（一次 undo 恢复整图）', () => {
    const { nodeStore, edgeStore, history, graph } = boot()
    const doc = createDocService(() => ({ nodeStore, edgeStore, history, graph }))

    const a = doc.createNode('text', { x: 0, y: 0 })
    const b = doc.createNode('text', { x: 300, y: 0 })
    doc.connectEdge({ source: a, target: b })
    expect(doc.getEdges()).toHaveLength(1)
    expect(doc.canUndo()).toBe(true)

    doc.undo()
    expect(doc.getEdges()).toHaveLength(0)
    doc.redo()
    expect(doc.getEdges()).toHaveLength(1)
  })

  it('transaction：fn 内多次写合并成一条历史；snapshot/replaceAll 与 onCommit 转发', () => {
    const { nodeStore, edgeStore, history, graph } = boot()
    const doc = createDocService(() => ({ nodeStore, edgeStore, history, graph }))

    const depth0 = history.undoDepth
    doc.transaction('batch', (tx) => {
      tx.createNode('text', { x: 0, y: 0 })
      tx.createNode('text', { x: 10, y: 0 })
    })
    expect(doc.getNodes()).toHaveLength(2)
    expect(history.undoDepth).toBe(depth0 + 1)

    const snap = doc.snapshot()
    expect(snap.nodes).toHaveLength(2)
    // 快照与内部引用隔离（外部改动不污染 store）
    snap.nodes.length = 0
    expect(doc.getNodes()).toHaveLength(2)

    const seen: number[] = []
    const off = doc.onCommit((env) => seen.push(env.nodes.length))
    doc.createNode('text', { x: 20, y: 0 })
    expect(seen.at(-1)).toBe(3)
    off()
    expect(doc.hasPendingCommit()).toBe(false)

    doc.replaceAll([])
    expect(doc.getNodes()).toHaveLength(0)
  })

  it('subscribe：一次订阅覆盖节点与边两桶', () => {
    const { nodeStore, edgeStore, history, graph } = boot()
    const doc = createDocService(() => ({ nodeStore, edgeStore, history, graph }))
    const events: string[] = []
    const off = doc.subscribe((c) => events.push(`${c.kind}:${c.reason}`))

    const a = doc.createNode('text', { x: 0, y: 0 })
    const b = doc.createNode('text', { x: 100, y: 0 })
    const eid = doc.addEdge({ source: a, target: b })
    doc.removeEdges([eid])
    off()
    doc.createNode('text', { x: 500, y: 0 })

    expect(events[0]).toBe('node:add')
    expect(events).toContain('edge:add')
    expect(events).toContain('edge:remove')
    // 退订后不再收到
    expect(events.filter((e) => e === 'node:add')).toHaveLength(2)
  })

  it('removeNodes 转发级联语义（相连边一起清）', () => {
    const { nodeStore, edgeStore, history, graph } = boot()
    const doc = createDocService(() => ({ nodeStore, edgeStore, history, graph }))
    const a = doc.createNode('text', { x: 0, y: 0 })
    const b = doc.createNode('text', { x: 100, y: 0 })
    doc.addEdge({ source: a, target: b })
    expect(doc.getEdges()).toHaveLength(1)
    expect(doc.removeNodes([a])).toBe(1)
    expect(doc.getEdges()).toHaveLength(0)
  })
})

describe('doc 门面 —— 四个老服务名已下线（步骤 5c）', () => {
  it('数据那一格只有 doc 一个名字：老名取不到，且 doc 指向同一批数据', () => {
    const { ctx, nodeStore, edgeStore, history, graph, doc } = boot()

    // doc 是基础插件注入的**真服务**（5c 起不再由能力层按名解析内置）
    expect(doc).toBeDefined()
    expect(ctx.hasService('doc')).toBe(true)

    // 5c 的目标：nodeStore/edgeStore/graph/history 四个名字下线（取不到）
    expect(ctx.get('nodeStore')).toBeUndefined()
    expect(ctx.get('edgeStore')).toBeUndefined()
    expect(ctx.get('graph')).toBeUndefined()
    expect(ctx.get('history')).toBeUndefined()
    // 底层实例本身当然还在（宿主/渲染层直接持有），只是不再按名可取
    expect(nodeStore.getNodes()).toEqual([])
    expect(edgeStore.getEdges()).toEqual([])
    expect(graph.getNodes()).toEqual([])
    expect(history.undoDepth).toBe(0)

    // 门面与底层实例指向同一批数据（同一批对象，不是拷贝）
    const id = doc.createNode('text', { x: 0, y: 0 })
    expect(nodeStore.getNode(id)).toBeDefined()
    expect(graph.getNodes()).toHaveLength(1)
    expect(doc.getNodes()).toHaveLength(1)
    // 同一个实例（多次 get 拿到的门面是同一个；用户数据只有一份）
    expect(ctx.get('doc')).toBe(doc)
  })

  it('doc 也能落节点类型（registerNodeType 助手的数据侧写口）', () => {
    const { doc } = boot()
    doc.registerType({ type: 'extra', label: '额外', defaultSize: { w: 10, h: 10 } })
    expect(doc.types.has('extra')).toBe(true)
    doc.unregisterType('extra')
    expect(doc.types.has('extra')).toBe(false)
  })

  it('能力层未装时 ctx 无 doc（纯内核不带画布服务）', () => {
    // 纯内核 new Context()：不装画布能力层 → doc 不存在（doc 是画布层内置服务）
    const plain = new KernelContext()
    expect(plain.get('doc')).toBeUndefined()
  })
})

describe('doc 门面 —— 缺底层服务时报错（不静默返回空数据）', () => {
  it('读节点缺 nodeStore → 抛出写明缺谁', () => {
    const doc = createDocService(() => ({}))
    expect(() => doc.getNodes()).toThrow(/"nodeStore"/)
  })

  it('写/撤销缺 graph → 抛出写明缺谁', () => {
    const doc = createDocService(() => ({}))
    expect(() => doc.createNode('text', { x: 0, y: 0 })).toThrow(/"graph"/)
    expect(() => doc.undo()).toThrow(/"graph"/)
  })
})


describe('doc 门面 —— 统一 ID 分配（节点与边都用自增数字）', () => {
  it('nextNodeId：从 1 起自增，且跳过已被占用的号', () => {
    const { nodeStore, edgeStore, history, graph } = boot()
    const doc = createDocService(() => ({ nodeStore, edgeStore, history, graph }))
    expect(doc.nextNodeId()).toBe('1')
    expect(doc.nextNodeId()).toBe('2')
    // 已经有人用了 3（比如复制粘贴/后端建过）→ 不能再吐 3
    nodeStore.addNodes([{ id: '3', type: 'text', position: { x: 0, y: 0 } }])
    expect(doc.nextNodeId()).toBe('4')
    // 分配结果要能直接拿去建节点，不会撞已有的
    const id = doc.nextNodeId()
    doc.addNodes([{ id, type: 'text', position: { x: 0, y: 0 } }])
    expect(doc.getNode(id)).toBeDefined()
  })

  it('nextNodeId 分配多个时互不相同（批量建节点用）', () => {
    const { nodeStore, edgeStore, history, graph } = boot()
    const doc = createDocService(() => ({ nodeStore, edgeStore, history, graph }))
    const ids = [doc.nextNodeId(), doc.nextNodeId(), doc.nextNodeId()]
    expect(new Set(ids).size).toBe(3)
    expect(ids).toEqual(['1', '2', '3'])
  })

  it('nextEdgeId：连接线同样是自增数字，且不与已有边撞', () => {
    const { nodeStore, edgeStore, history, graph } = boot()
    const doc = createDocService(() => ({ nodeStore, edgeStore, history, graph }))
    expect(doc.nextEdgeId()).toBe('1')
    expect(doc.nextEdgeId()).toBe('2')
    edgeStore.addEdge({ source: 'a', target: 'b', id: '3' } as never)
    expect(doc.nextEdgeId()).toBe('4')
  })

  it('节点与边的号各自独立计数（互不影响）', () => {
    const { nodeStore, edgeStore, history, graph } = boot()
    const doc = createDocService(() => ({ nodeStore, edgeStore, history, graph }))
    doc.nextNodeId()
    doc.nextNodeId()
    expect(doc.nextEdgeId()).toBe('1')
    expect(doc.nextNodeId()).toBe('3')
  })

  it('replaceAll 之后计数跟上（刷新恢复的图里有 1/2/3 → 下一个是 4）', () => {
    const { nodeStore, edgeStore, history, graph } = boot()
    const doc = createDocService(() => ({ nodeStore, edgeStore, history, graph }))
    doc.replaceAll(
      [
        { id: '1', type: 'text', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'text', position: { x: 0, y: 0 }, data: {} },
        { id: '7', type: 'text', position: { x: 0, y: 0 }, data: {} },
      ],
      [{ id: '1', source: '1', target: '2' }],
    )
    expect(doc.nextNodeId()).toBe('8')
    expect(doc.nextEdgeId()).toBe('2')
  })
})
