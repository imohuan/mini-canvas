/**
 * auto-save + graph 提交链路集成：graph 写 → commit 回调 save.set → 脏队列；
 * auto-save 周期性 flush → 数据落盘（P0-1 修复后链路完整，本测试补证据）。
 */
import { describe, it, expect } from 'vitest'
import { Context, NodeStore, EdgeStore, Selection, History, GraphDocument, SaveServiceImpl, MemoryStorageAdapter } from '@mini-canvas/canvas-core-v2'
import { autoSavePlugin } from '../autoSavePlugin'
import type { AutoSaveService } from '../autoSavePlugin'

function boot() {
  const ctx = new Context()
  const save = new SaveServiceImpl(new MemoryStorageAdapter())
  ctx.inject('save', save)
  const nodeStore = new NodeStore()
  nodeStore.registerType({ type: 'text', label: '文本', defaultSize: { w: 100, h: 40 } })
  ctx.inject('nodeStore', nodeStore)
  const edgeStore = new EdgeStore()
  ctx.inject('edgeStore', edgeStore)
  const selection = new Selection()
  ctx.inject('selection', selection)
  const history = new History({
    snapshot: () => ({ nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())), edges: JSON.parse(JSON.stringify(edgeStore.getEdges())) }),
    restore: (g: { nodes: unknown[]; edges: unknown[] }) => { nodeStore.replaceAll(g.nodes as never); edgeStore.replaceAll(g.edges as never) },
  })
  ctx.inject('history', history)
  // graph commit 回调：把整图写进 save 脏队列（宿主 createMiniCanvasHost 同款）
  ctx.inject('graph', new GraphDocument(nodeStore, edgeStore, selection, history, (env) => {
    save.set('graph', env.nodes, 'canvas')
  }))
  ctx.plugin(autoSavePlugin)
  return { ctx, save, nodeStore }
}

describe('auto-save + graph 链路（P0-1 完整闭环）', () => {
  it('graph 建节点 → 脏队列有图 → auto-save.saveNow 落盘 graph', async () => {
    const { ctx, save, nodeStore } = boot()
    await ctx.start()
    const graph = ctx.get<{ createNode(t: string, p: { x: number; y: number }): string }>('graph')
    graph.createNode('text', { x: 3, y: 4 })
    // graph commit 已把节点写进 save 脏队列（不依赖 auto-save 自己 set 图）
    expect(save.isDirty()).toBe(true)
    const svc = ctx.get<AutoSaveService>('auto-save')
    expect(svc.isDirty()).toBe(true)
    await svc.saveNow()
    const saved = await save.get<unknown[]>('graph', 'canvas')
    expect(saved).toHaveLength(1)
    expect(save.isDirty()).toBe(false)
    ctx.stop()
  })
  it('nodeStore 变化经订阅置脏（auto-save 直接订阅内核事件源）', async () => {
    const { ctx, save, nodeStore } = boot()
    await ctx.start()
    const svc = ctx.get<AutoSaveService>('auto-save')
    nodeStore.addNode('text', { x: 0, y: 0 })
    expect(svc.isDirty()).toBe(true)
    ctx.stop()
  })
})

