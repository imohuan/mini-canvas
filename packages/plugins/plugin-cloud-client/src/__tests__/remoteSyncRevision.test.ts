import { describe, expect, it, vi } from 'vitest'
import { createRemoteSync } from '../remoteSync'
import type { CanvasGraphSnapshot, MergeEdge, MergeNode } from '../remoteMerge'

/** 本地图的内存替身：只记录 applyPlan 之后的节点，验证同步真的落下 */
function localGraph(initial: MergeNode[] = []) {
  let nodes = initial
  const applied: MergeNode[][] = []
  return {
    handlers: {
      getNodes: (): MergeNode[] => nodes,
      getEdges: (): MergeEdge[] => [],
      applyPlan: (plan: { addNodes: MergeNode[]; updateNodes: MergeNode[] }) => {
        const byId = new Map(nodes.map((n) => [n.id, n]))
        for (const n of plan.addNodes) byId.set(n.id, n)
        for (const n of plan.updateNodes) byId.set(n.id, n)
        nodes = [...byId.values()]
        applied.push(nodes)
      },
    },
    applied,
    get nodes() {
      return nodes
    },
  }
}

const node = (id: string): MergeNode => ({
  id,
  type: 'text',
  position: { x: 0, y: 0 },
  data: { text: id },
})

/** 假后台：版本 + 完整快照，记录请求次数 */
function fakeServer(revision: number, snapshot: CanvasGraphSnapshot) {
  let rev = revision
  let snap = snapshot
  let revisionReads = 0
  let snapshotReads = 0
  return {
    readRevision: async () => {
      revisionReads += 1
      return rev
    },
    readSnapshot: async () => {
      snapshotReads += 1
      return { nodes: snap.nodes, edges: snap.edges, revision: rev }
    },
    set(nextRev: number, next: CanvasGraphSnapshot) {
      rev = nextRev
      snap = next
    },
    advance(next: CanvasGraphSnapshot) {
      rev += 1
      snap = next
    },
    stats: () => ({ revisionReads, snapshotReads }),
  }
}

function makeSync(
  server: ReturnType<typeof fakeServer>,
  graph: ReturnType<typeof localGraph>,
  both: boolean,
) {
  const onError = vi.fn()
  const sync = createRemoteSync({
    readCloud: async () => undefined,
    graph: graph.handlers,
    knownType: () => true,
    subscribe: () => () => {},
    debounceMs: 1,
    revisionPollMs: 0,
    onError,
    readSnapshot: () => server.readSnapshot(),
    ...(both ? { readRevision: () => server.readRevision() } : {}),
  })
  return { sync, onError }
}

describe('定时版本核对（Ping）', () => {
  it('版本没变 → 只问版本，不拉整张画布', async () => {
    const server = fakeServer(5, { nodes: [node('a')], edges: [] })
    const graph = localGraph([node('a')])
    const { sync } = makeSync(server, graph, true)
    await sync.refreshBase()
    sync.start()
    // start() 会主动做一次“订阅建立后核对”（这是必要的：避免恢复完成到订阅之间的窗口漏事件）。
    // 先等这次启动核对完成，再测稳态：此时版本没变，后续核对不应拉整张画布。
    await new Promise((r) => setTimeout(r, 30))
    const initialSnapshotReads = server.stats().snapshotReads
    await sync.check()
    expect(server.stats().revisionReads).toBeGreaterThan(0)
    expect(server.stats().snapshotReads).toBe(initialSnapshotReads)
    expect(sync.serverSnapshot()?.nodes.map((n) => n.id)).toEqual(['a'])
    sync.stop()
  })

  it('漏掉一帧通知后，定时核对发现版本落后并补同步节点', async () => {
    const server = fakeServer(5, { nodes: [node('a')], edges: [] })
    const graph = localGraph([node('a')])
    const { sync } = makeSync(server, graph, true)
    await sync.refreshBase()
    sync.start()
    // start() 的启动核对在版本未变时应直接结束；先等它完成，避免与下面的 check() 重叠。
    await new Promise((r) => setTimeout(r, 30))

    // 模拟 SSE 丢了一条通知：后台已经写成 6，但客户端没有收到事件。
    server.advance({ nodes: [node('a'), node('missed')], edges: [] })
    // 定时 ping 才发现版本不同 → 拉完整快照 → 合并
    await sync.check()
    await waitForSynced(graph, 2)

    expect(graph.nodes.map((n) => n.id).sort()).toEqual(['a', 'missed'])
    expect(graph.applied.length).toBeGreaterThan(0)
    sync.stop()
  })

  it('旧服务端没有版本接口 → 降级为完整快照核对（不误报已同步）', async () => {
    const server = fakeServer(0, { nodes: [node('a')], edges: [] })
    const graph = localGraph([node('a')])
    const { sync } = makeSync(server, graph, false)
    await sync.refreshBase()
    sync.start()

    server.advance({ nodes: [node('a'), node('legacy')], edges: [] })
    await sync.check()
    await waitForSynced(graph, 2)

    expect(graph.nodes.map((n) => n.id).sort()).toEqual(['a', 'legacy'])
    sync.stop()
  })
})

describe('多画布 / 防叠加', () => {
  it('别的画布的 SSE 事件不会触发当前画布的整包合并', async () => {
    const server = fakeServer(5, { nodes: [node('a')], edges: [] })
    const graph = localGraph([node('a')])
    let deliver: ((e: { type: string; key: string; canvasId?: string; revision?: number }) => void) | undefined
    const sync = createRemoteSync({
      readCloud: async () => undefined,
      readSnapshot: () => server.readSnapshot(),
      readRevision: () => server.readRevision(),
      graph: graph.handlers,
      knownType: () => true,
      canvasId: 'current',
      subscribe: (onChange) => {
        deliver = onChange
        return () => {}
      },
      debounceMs: 1,
      revisionPollMs: 0,
    })
    await sync.refreshBase()
    sync.start()
    await new Promise((r) => setTimeout(r, 30))
    const before = server.stats().snapshotReads
    // 另一张画布变了：不能拉当前画布，也不能改本地
    deliver?.({ type: 'canvas', key: 'graph', canvasId: 'other', revision: 99 })
    await new Promise((r) => setTimeout(r, 30))
    expect(server.stats().snapshotReads).toBe(before)
    expect(graph.nodes.map((n) => n.id)).toEqual(['a'])
    sync.stop()
  })

  it('核对请求并发时只保留一轮（不会越堆越多）', async () => {
    const server = fakeServer(5, { nodes: [node('a')], edges: [] })
    const graph = localGraph([node('a')])
    const { sync } = makeSync(server, graph, true)
    await sync.refreshBase()
    sync.start()
    await new Promise((r) => setTimeout(r, 30))
    const before = server.stats().revisionReads
    // 连续触发多次：应共享同一轮核对，而不是每个调用都发一次版本请求。
    await Promise.all([sync.check(), sync.check(), sync.check(), sync.check()])
    const delta = server.stats().revisionReads - before
    expect(delta).toBeGreaterThanOrEqual(1)
    expect(delta).toBeLessThanOrEqual(2)
    sync.stop()
  })
})

describe('正在编辑的字段：延迟落地、其他变化照常', () => {
  it('被拖动节点的 position 不在本轮覆盖，但新增节点与其他节点照常合并', async () => {
    const server = fakeServer(1, {
      nodes: [node('edited'), node('plain')],
      edges: [],
    })
    const edited = { ...node('edited'), position: { x: 0, y: 0 } }
    const graph = localGraph([edited, node('plain')])
    const { sync } = makeSync(server, graph, true)
    ;(graph.handlers as { editingFields?: (id: string) => ReadonlySet<string> }).editingFields = (id) =>
      id === 'edited' ? new Set(['position']) : new Set()
    await sync.refreshBase()
    sync.start()
    await new Promise((r) => setTimeout(r, 30))

    // 远端同时改了被拖动节点位置、另一个节点、并新增一个
    server.advance({
      nodes: [
        { ...edited, position: { x: 999, y: 999 } },
        { ...node('plain'), data: { text: 'remote-changed' } },
        node('new-node'),
      ],
      edges: [],
    })
    await sync.check()
    const deadline = Date.now() + 500
    while (Date.now() < deadline && !graph.nodes.some((n) => n.id === 'new-node')) {
      await new Promise((r) => setTimeout(r, 10))
    }

    expect(graph.nodes.find((n) => n.id === 'edited')?.position).toEqual({ x: 0, y: 0 })
    expect(graph.nodes.find((n) => n.id === 'plain')?.data.text).toBe('remote-changed')
    expect(graph.nodes.some((n) => n.id === 'new-node')).toBe(true)
    expect(sync.status().deferred).toBe(true)
    sync.stop()
  })

  it('编辑结束后再核对，被延迟的远端更新会补上', async () => {
    const server = fakeServer(1, { nodes: [node('edited')], edges: [] })
    const graph = localGraph([node('edited')])
    const { sync } = makeSync(server, graph, true)
    let editing = true
    ;(graph.handlers as { editingFields?: (id: string) => ReadonlySet<string> }).editingFields = () =>
      editing ? new Set(['position']) : new Set()
    await sync.refreshBase()
    sync.start()
    await new Promise((r) => setTimeout(r, 30))

    server.advance({
      nodes: [{ ...node('edited'), position: { x: 100, y: 100 } }],
      edges: [],
    })
    await sync.check()
    await new Promise((r) => setTimeout(r, 40))
    expect(graph.nodes[0].position).toEqual({ x: 0, y: 0 })

    editing = false
    // 版本没再变，但编辑结束后仍需把上次延迟的那一版重新核对。
    await sync.check()
    const deadline2 = Date.now() + 500
    while (Date.now() < deadline2 && graph.nodes[0].position?.x !== 100) {
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(graph.nodes[0].position).toEqual({ x: 100, y: 100 })
    expect(sync.status().deferred).toBe(false)
    sync.stop()
  })
})

describe('本地保存成功、合并基准还没推进的窗口', () => {
  it('服务器随后修改了本地刚保存的同 id 节点：修改要落地，不能复制副本', async () => {
    // 真机路径：本地新建 id=1 → 保存成功 → SSE 先到 → base 还停在保存前。
    // 若只看旧 base，会把 1 当成“本地新增撞号”，复制出 2、3 两份；
    // 若只按“已提交”跳过碰撞，又会忽略 AI 随后对 1 的内容修改。
    const server = fakeServer(1, { nodes: [node('1')], edges: [] })
    const graph = localGraph([node('1')])
    const submitted = { nodes: [node('1')], edges: [] }
    ;(graph.handlers as { wasSubmitted?: (id: string) => boolean }).wasSubmitted = (id) => id === '1'
    ;(graph.handlers as { submittedSnapshot?: () => CanvasGraphSnapshot }).submittedSnapshot = () => submitted
    const sync = createRemoteSync({
      readCloud: async () => undefined,
      readSnapshot: () => server.readSnapshot(),
      readRevision: () => server.readRevision(),
      graph: graph.handlers,
      knownType: () => true,
      subscribe: () => () => {},
      debounceMs: 1,
      revisionPollMs: 0,
    })
    await sync.refreshBase()
    sync.start()
    await new Promise((r) => setTimeout(r, 30))

    // 服务器一侧：同一个 id 的内容被 AI 改了
    server.advance({
      nodes: [{ ...node('1'), data: { text: 'AI 改过' } }],
      edges: [],
    })
    await sync.check()
    const deadline = Date.now() + 500
    // 等“内容真的落地”，不能只等节点数：节点数一开始就已经是 1。
    while (Date.now() < deadline && graph.nodes[0]?.data.text !== 'AI 改过') {
      await new Promise((r) => setTimeout(r, 10))
    }

    expect(graph.nodes.map((n) => n.id)).toEqual(['1'])
    expect(graph.nodes[0].data.text).toBe('AI 改过')
    sync.stop()
  })
})

describe('落地失败后的版本重试', () => {
  it('applyPlan 抛错时不推进 knownRevision，下一次核对仍会重试这一版', async () => {
    // 旧实现读到快照就先 knownRevision=2；applyPlan 抛错后版本核对看到“服务器没再涨”，
    // 于是永远跳过这一版 —— 表现为后台已变、页面不变，刷新才恢复。
    const server = fakeServer(1, { nodes: [node('a')], edges: [] })
    const graph = localGraph([node('a')])
    let failNext = false
    let applyCalls = 0
    const handlers = graph.handlers as {
      applyPlan: (plan: { addNodes: MergeNode[]; updateNodes: MergeNode[] }) => void
    }
    const apply = handlers.applyPlan
    handlers.applyPlan = (plan) => {
      applyCalls += 1
      if (failNext) {
        failNext = false
        throw new Error('boom')
      }
      apply(plan)
    }
    const errors: string[] = []
    const sync = createRemoteSync({
      readCloud: async () => undefined,
      readSnapshot: () => server.readSnapshot(),
      readRevision: () => server.readRevision(),
      graph: graph.handlers,
      knownType: () => true,
      subscribe: () => () => {},
      debounceMs: 1,
      revisionPollMs: 0,
      onError: (message) => errors.push(message),
    })
    await sync.refreshBase()
    sync.start()
    await new Promise((r) => setTimeout(r, 30))

    failNext = true
    server.advance({ nodes: [node('a'), node('b')], edges: [] })
    await sync.check()
    await new Promise((r) => setTimeout(r, 40))
    expect(errors.length).toBeGreaterThan(0)
    expect(sync.status().knownRevision).toBe(1) // 失败不能把 2 记成已确认
    expect(graph.nodes.map((n) => n.id)).toEqual(['a'])

    // 下一次核对：服务器版本没再上涨，也必须重试 2 这一版并把节点补进来。
    await sync.check()
    const deadline = Date.now() + 500
    while (Date.now() < deadline && graph.nodes.length < 2) await new Promise((r) => setTimeout(r, 10))
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(sync.status().knownRevision).toBe(2)
    expect(applyCalls).toBeGreaterThanOrEqual(2)
    sync.stop()
  })
})

/** 轮询本地状态直到节点数达到期望（替代固定 sleep，避免测试依赖机器速度） */
async function waitForSynced(graph: { nodes: MergeNode[] }, count: number): Promise<void> {
  const deadline = Date.now() + 500
  while (Date.now() < deadline && graph.nodes.length < count) {
    await new Promise((r) => setTimeout(r, 10))
  }
}
