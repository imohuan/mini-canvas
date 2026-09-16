/**
 * 远端同步（订阅 + 落地）集成测试。
 *
 * 用假的 EventSource 与假的云端读写，验证这条链真的能把「AI 改了画布」变成
 * 「本地画布跟着变」，而且**不误伤本地**：
 *   SSE 事件 → 读云端 → 三方合并 → 应用到本地
 *
 * 特别锁住三件容易做错的事：
 * 1. 自己写上去的东西被回调时不产生任何动作（否则会和本地保存互相触发，转成死循环）；
 * 2. 本地刚建、还没推上去的节点不能被当成「云端删了」而消失；
 * 3. 云端来的、本地没注册过的节点类型要跳过（本地渲染不了，加进来只会是坏数据）。
 */
import { describe, it, expect, vi } from 'vitest'
import { createRemoteSync, type RemoteGraphHandlers, type EventSourceLike } from '../remoteSync'

/** 假 EventSource：测试里手动喂事件，同时能断言订阅的 URL 与是否被关掉 */
function fakeEventSource() {
  const created: Array<{ url: string; close: () => void }> = []
  let current: { handlers: Record<string, (e: { data: string }) => void> } | null = null
  const factory = (url: string): EventSourceLike => {
    const handlers: Record<string, (e: { data: string }) => void> = {}
    const entry = { url, close: vi.fn() }
    created.push(entry)
    current = { handlers }
    return {
      onerror: null,
      close: entry.close,
      addEventListener(type, cb) {
        handlers[type] = cb as (e: { data: string }) => void
      },
    }
  }
  return {
    factory,
    created,
    /** 模拟服务端推来一条事件 */
    emit(data: unknown) {
      current?.handlers['message']?.({ data: JSON.stringify(data) })
    },
    emitById(id: string) {
      current?.handlers[id]?.({ data: '' })
    },
  }
}

/** 记录型「本地图」：把收到的每个动作记下来，便于断言「到底动了什么」 */
function fakeGraph(initial: { nodes: any[]; edges?: any[] }) {
  const nodes = new Map<string, any>(initial.nodes.map((n) => [n.id, n]))
  const edges = new Map<string, any>((initial.edges ?? []).map((e: any) => [e.id, e]))
  const actions: string[] = []
  const handlers: RemoteGraphHandlers = {
    getNodes: () => [...nodes.values()],
    getEdges: () => [...edges.values()],
    // 与真实适配同款的动作顺序：先清边 → 清节点 → 加节点 → 改节点 → 挂边
    applyPlan(plan) {
      for (const id of plan.removeEdgeIds) {
        actions.push(`removeEdge:${id}`)
        edges.delete(id)
      }
      for (const id of plan.removeNodeIds) {
        actions.push(`removeNode:${id}`)
        nodes.delete(id)
      }
      for (const n of plan.addNodes) {
        actions.push(`add:${n.id}`)
        nodes.set(n.id, n)
      }
      for (const n of plan.updateNodes) {
        actions.push(`update:${n.id}`)
        nodes.set(n.id, { ...nodes.get(n.id), position: n.position, data: n.data })
      }
      for (const e of plan.updateEdges) {
        actions.push(`updateEdge:${e.id}`)
        edges.set(e.id, e)
      }
      for (const e of plan.addEdges) {
        actions.push(`addEdge:${e.id}`)
        edges.set(e.id, e)
      }
    },
  }
  return { handlers, actions, nodes, edges }
}

const node = (id: string, x = 0, data: Record<string, unknown> = {}) => ({
  id,
  type: 'text',
  position: { x, y: 0 },
  data,
})

/** 组装一个 watcher：云端内容由 cloud 变量决定，改它就等于「服务端变了」 */
function setup(opts: {
  cloud?: { nodes: any[]; edges?: any[] }
  local: { nodes: any[]; edges?: any[] }
  knownType?: (type: string) => boolean
}) {
  let cloud = { nodes: opts.cloud?.nodes ?? [], edges: opts.cloud?.edges ?? [] }
  const es = fakeEventSource()
  const graph = fakeGraph(opts.local)
  const readCloud = vi.fn(async (_type: string, key: string) => {
    if (key === 'graph') return cloud.nodes
    if (key === 'graph-edges') return cloud.edges
    return undefined
  })
  const sync = createRemoteSync({
    baseUrl: 'http://cloud',
    createEventSource: es.factory,
    readCloud,
    graph: graph.handlers,
    knownType: opts.knownType ?? (() => true),
    debounceMs: 0,
  })
  return {
    sync,
    es,
    graph,
    readCloud,
    setCloud(next: { nodes: any[]; edges?: any[] }) {
      cloud = { nodes: next.nodes, edges: next.edges ?? [] }
    },
  }
}

const tick = () => new Promise((r) => setTimeout(r, 5))

describe('createRemoteSync —— 订阅与落地', () => {
  it('订阅 canvas 作用域的实时通道', () => {
    const { sync, es } = setup({ local: { nodes: [] } })
    sync.start()
    expect(es.created[0].url).toContain('/api/kv/events')
    expect(es.created[0].url).toContain('type=canvas')
    sync.stop()
  })

  it('AI 在云端加了节点 → 本地出现该节点', async () => {
    const { sync, es, graph, setCloud } = setup({ local: { nodes: [node('a')] } })
    // 先把 base 建立起来（= 云端当前状态）
    setCloud({ nodes: [node('a')] })
    sync.start()
    await sync.refreshBase()

    // AI 加了个节点
    setCloud({ nodes: [node('a'), node('ai-1', 500, { text: 'AI 写的' })] })
    es.emit({ type: 'canvas', key: 'graph' })
    await tick()

    expect(graph.nodes.has('ai-1')).toBe(true)
    expect(graph.nodes.get('ai-1').data.text).toBe('AI 写的')
    expect(graph.actions).toEqual(['add:ai-1'])
    sync.stop()
  })

  it('本地刚建、还没推上去的节点不会被云端事件抹掉', async () => {
    const { sync, es, graph } = setup({
      cloud: { nodes: [node('a')] },
      local: { nodes: [node('a'), node('local-new')] },
    })
    sync.start()
    await sync.refreshBase()
    es.emit({ type: 'canvas', key: 'graph' })
    await tick()

    expect(graph.nodes.has('local-new')).toBe(true)
    expect(graph.actions).toEqual([])
    sync.stop()
  })

  it('自己刚推上去的改动，被回调时不产生动作（防与本地保存互相触发）', async () => {
    const { sync, es, graph, setCloud } = setup({ local: { nodes: [node('a')] } })
    setCloud({ nodes: [node('a')] })
    sync.start()
    await sync.refreshBase()

    // 本地移动了 a 并推上云端（云端内容 = 本地内容）
    const moved = node('a', 999)
    graph.nodes.set('a', moved)
    setCloud({ nodes: [moved] })
    es.emit({ type: 'canvas', key: 'graph' })
    await tick()

    expect(graph.actions).toEqual([])
    sync.stop()
  })

  it('云端删了节点 → 本地跟着删（AI 说删就删）', async () => {
    const { sync, es, graph, setCloud } = setup({
      cloud: { nodes: [node('a'), node('b')] },
      local: { nodes: [node('a'), node('b')] },
    })
    sync.start()
    await sync.refreshBase()
    setCloud({ nodes: [node('b')] })
    es.emit({ type: 'canvas', key: 'graph' })
    await tick()

    expect(graph.nodes.has('a')).toBe(false)
    expect(graph.nodes.has('b')).toBe(true)
    sync.stop()
  })

  it('本地渲染不了的节点类型（插件没装）→ 跳过，不往本地塞', async () => {
    const { sync, es, graph, setCloud } = setup({ local: { nodes: [] }, knownType: () => false })
    setCloud({ nodes: [] })
    sync.start()
    await sync.refreshBase()
    setCloud({ nodes: [{ ...node('x'), type: '外星节点' }] })
    es.emit({ type: 'canvas', key: 'graph' })
    await tick()

    expect(graph.nodes.has('x')).toBe(false)
    sync.stop()
  })

  it('一次事件引发一次读取（多个 key 的通知合并成一轮）', async () => {
    const { sync, es, setCloud, readCloud } = setup({ local: { nodes: [] } })
    setCloud({ nodes: [] })
    sync.start()
    await sync.refreshBase()
    const calls = readCloud.mock.calls.length
    es.emit({ type: 'canvas', key: 'graph' })
    es.emit({ type: 'canvas', key: 'graph-edges' })
    await tick()
    // 两个通知只换来一轮读取（每个 key 各一次）
    expect(readCloud.mock.calls.length).toBe(calls + 2)
    sync.stop()
  })

  it('stop() 之后不再响应事件，并关掉连接', async () => {
    const { sync, es, graph, setCloud } = setup({ local: { nodes: [] } })
    setCloud({ nodes: [] })
    sync.start()
    await sync.refreshBase()
    sync.stop()

    setCloud({ nodes: [node('later')] })
    es.emit({ type: 'canvas', key: 'graph' })
    await tick()

    expect(graph.actions).toEqual([])
    expect(es.created[0].close).toHaveBeenCalled()
  })
})
