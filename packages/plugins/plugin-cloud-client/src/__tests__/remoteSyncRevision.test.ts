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

/** 轮询本地状态直到节点数达到期望（替代固定 sleep，避免测试依赖机器速度） */
async function waitForSynced(graph: { nodes: MergeNode[] }, count: number): Promise<void> {
  const deadline = Date.now() + 500
  while (Date.now() < deadline && graph.nodes.length < count) {
    await new Promise((r) => setTimeout(r, 10))
  }
}
