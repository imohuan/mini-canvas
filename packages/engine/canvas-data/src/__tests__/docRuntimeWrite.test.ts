/**
 * updateNodeRuntime —— 写节点的**运行期状态**（进度帧）：落盘，但**不进撤销栈**。
 *
 * 为什么单独一条 API：进度帧每几百毫秒一次，若每帧都 withRecord，撤销栈会被冲垮
 * （用户按一次 Ctrl+Z 只退一格进度条）。而这类状态又必须持久化 —— 刷新页面不能丢
 * （用户明确要求）。两条一起要，只能把「写」与「记一次操作」拆开。
 */
import { describe, it, expect } from 'vitest'
import { NodeStore } from '../nodeStore'
import { EdgeStore } from '../edgeStore'
import { Selection } from '../selection'
import { History } from '../history'
import { GraphDocument } from '../graphDocument'

function makeGraph() {
  const nodeStore = new NodeStore()
  nodeStore.registerType({ type: 'text', label: '文本', defaultSize: { w: 100, h: 100 } })
  const edgeStore = new EdgeStore()
  const selection = new Selection()
  const history = new History({
    snapshot: () => ({ nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())), edges: [] }),
    restore: () => {},
  })
  const commits: number[] = []
  const graph = new GraphDocument(nodeStore, edgeStore, selection, history, () => commits.push(1))
  return { graph, nodeStore, history, commits }
}

describe('updateNodeRuntime：写节点 data 但不进撤销栈', () => {
  it('data 落进 nodeStore，且提交（落盘）被触发', () => {
    const { graph, nodeStore, commits } = makeGraph()
    const id = graph.createNode('text', { x: 0, y: 0 }, { text: 'hi' })
    const before = commits.length
    graph.updateNodeRuntime(id, { data: { runState: { status: 'running', progress: 12 } } })
    expect(nodeStore.getNode(id)?.data.runState).toEqual({ status: 'running', progress: 12 })
    expect(commits.length).toBeGreaterThan(before)
  })

  it('撤销栈深度不变（Ctrl+Z 退的是上一步真实操作，不是进度帧）', () => {
    const { graph, history } = makeGraph()
    const id = graph.createNode('text', { x: 0, y: 0 }, { text: 'hi' })
    const depth = history.undoDepth
    graph.updateNodeRuntime(id, { data: { runState: { status: 'running', progress: 40 } } })
    graph.updateNodeRuntime(id, { data: { runState: { status: 'running', progress: 80 } } })
    expect(history.undoDepth).toBe(depth)
  })

  it('与 updateNode 对照：后者会进历史（证明前一条不是因为什么都没写进去）', () => {
    const { graph, history } = makeGraph()
    const id = graph.createNode('text', { x: 0, y: 0 }, { text: 'hi' })
    const depth = history.undoDepth
    graph.updateNode(id, { data: { text: '改过' } })
    expect(history.undoDepth).toBe(depth + 1)
  })

  it('节点不存在时抛错（与 updateNode 同语义，不静默）', () => {
    const { graph } = makeGraph()
    expect(() => graph.updateNodeRuntime('nope', { data: { a: 1 } })).toThrow()
  })

  /**
   * 用户 2026-11-16 的真实问题：加载卡右上角的时间一会儿有一会儿没有。
   * 进度帧是整块替换 runState 的，写入方漏带 startedAt 就会把它抹掉。
   * 现在在数据层统一合并：同一个任务的进度帧自动沿用上一帧的字段。
   */
  it('同一任务的进度帧沿用缺失字段（startedAt 不会被抹掉）', () => {
    const { graph, nodeStore } = makeGraph()
    const id = graph.createNode('text', { x: 0, y: 0 }, { text: 'hi' })
    graph.updateNodeRuntime(id, { data: { runState: { status: 'running', taskId: 'j1', startedAt: 1_700_000_000_000 } } })
    graph.updateNodeRuntime(id, { data: { runState: { status: 'running', taskId: 'j1', progress: 40 } } })
    expect(nodeStore.getNode(id)?.data.runState).toMatchObject({
      status: 'running',
      taskId: 'j1',
      progress: 40,
      startedAt: 1_700_000_000_000,
    })
  })

  it('新帧给了值就覆盖旧值（不是只增不改）', () => {
    const { graph, nodeStore } = makeGraph()
    const id = graph.createNode('text', { x: 0, y: 0 }, { text: 'hi' })
    graph.updateNodeRuntime(id, { data: { runState: { status: 'running', taskId: 'j1', progress: 10, message: '旧文案' } } })
    graph.updateNodeRuntime(id, { data: { runState: { status: 'running', taskId: 'j1', progress: 60, message: '新文案' } } })
    expect(nodeStore.getNode(id)?.data.runState).toMatchObject({ progress: 60, message: '新文案' })
  })

  it('换了任务不继承上一个任务的字段（避免老任务的东西串过来）', () => {
    const { graph, nodeStore } = makeGraph()
    const id = graph.createNode('text', { x: 0, y: 0 }, { text: 'hi' })
    graph.updateNodeRuntime(id, {
      data: { runState: { status: 'running', taskId: 'j1', progress: 100, startedAt: 1, value: 20000, suffix: 'tokens' } },
    })
    graph.updateNodeRuntime(id, { data: { runState: { status: 'running', taskId: 'j2', progress: 0 } } })
    const rs = nodeStore.getNode(id)?.data.runState as Record<string, unknown>
    expect(rs).toMatchObject({ taskId: 'j2', progress: 0 })
    expect(rs.startedAt).toBeUndefined()
    expect(rs.value).toBeUndefined()
    expect(rs.suffix).toBeUndefined()
  })

  it('新一帧还没有任务号时不继承旧任务号（重新提交不能被旧任务覆盖）', () => {
    const { graph, nodeStore } = makeGraph()
    const id = graph.createNode('text', { x: 0, y: 0 }, { text: 'hi' })
    // 上一个任务还停在 running
    graph.updateNodeRuntime(id, { data: { runState: { status: 'running', taskId: 'old-job', progress: 80, startedAt: 1 } } })
    // 用户重新点提交：running 但任务号还没回来
    graph.updateNodeRuntime(id, { data: { runState: { status: 'running', progress: 0, startedAt: 2 } } })
    const rs = nodeStore.getNode(id)?.data.runState as Record<string, unknown>
    expect(rs.taskId).toBeUndefined()
    expect(rs).toMatchObject({ status: 'running', progress: 0, startedAt: 2 })
  })

  it('终态整帧替换：done / error 不带着运行中的字段', () => {
    const { graph, nodeStore } = makeGraph()
    const id = graph.createNode('text', { x: 0, y: 0 }, { text: 'hi' })
    graph.updateNodeRuntime(id, { data: { runState: { status: 'running', taskId: 'j1', value: 20000, tail: '半句' } } })
    graph.updateNodeRuntime(id, { data: { runState: { status: 'done', taskId: 'j1', progress: 100 } } })
    const rs = nodeStore.getNode(id)?.data.runState as Record<string, unknown>
    expect(rs).toMatchObject({ status: 'done', progress: 100 })
    expect(rs.value).toBeUndefined()
    expect(rs.tail).toBeUndefined()
  })
})
