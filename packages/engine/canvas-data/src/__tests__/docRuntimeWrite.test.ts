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
})
