/**
 * auto-save + graph 提交链路集成：graph 写 → commit 回调 save.set → 脏队列；
 * auto-save 周期性 flush → 数据落盘（P0-1 修复后链路完整，本测试补证据）。
 */
import { describe, it, expect } from 'vitest'
import { Context, createCanvasBasePlugin, MemoryStorageAdapter } from '@mini-canvas/canvas-data'
import { NodeStore, EdgeStore, Selection, History, GraphDocument, SaveServiceImpl, createDocService } from '@mini-canvas/canvas-data'
import { autoSavePlugin } from '../autoSavePlugin'
import type { AutoSaveService } from '../autoSavePlugin'

function boot() {
  const ctx = new Context()
  const save = new SaveServiceImpl(new MemoryStorageAdapter())
  ctx.inject('save', save)
  const nodeStore = new NodeStore()
  nodeStore.registerType({ type: 'text', label: '文本', defaultSize: { w: 100, h: 40 } })
  const edgeStore = new EdgeStore()
  const selection = new Selection()
  ctx.inject('selection', selection)
  const history = new History({
    snapshot: () => ({ nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())), edges: JSON.parse(JSON.stringify(edgeStore.getEdges())) }),
    restore: (g: { nodes: unknown[]; edges: unknown[] }) => { nodeStore.replaceAll(g.nodes as never); edgeStore.replaceAll(g.edges as never) },
  })
  // graph commit 回调：把整图写进 save 脏队列（宿主 createMiniCanvasHost 同款）
  const graph = new GraphDocument(nodeStore, edgeStore, selection, history, (env) => {
    save.set('graph', env.nodes, 'canvas')
  })
  // 5c：数据那一格只有 doc 一个名字（四个老服务名已下线）
  ctx.inject('doc', createDocService({ nodeStore, edgeStore, graph, history }))
  ctx.plugin(autoSavePlugin)
  return { ctx, save, nodeStore }
}

describe('auto-save + graph 链路（P0-1 完整闭环）', () => {
  it('graph 建节点 → 脏队列有图 → auto-save.saveNow 落盘 graph', async () => {
    const { ctx, save, nodeStore } = boot()
    await ctx.start()
    const doc = ctx.get<{ createNode(t: string, p: { x: number; y: number }): string }>('doc')
    doc.createNode('text', { x: 3, y: 4 })
    // graph commit 已把节点写进 save 脏队列（不依赖 auto-save 自己 set 图）
    expect(save.isDirty()).toBe(true)
    const svc = ctx.get<{ autoSave: AutoSaveService }>('save').autoSave
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
    const svc = ctx.get<{ autoSave: AutoSaveService }>('save').autoSave
    nodeStore.addNode('text', { x: 0, y: 0 })
    expect(svc.isDirty()).toBe(true)
    ctx.stop()
  })
})

/**
 * 新入口：引擎挂到 save.autoSave，旧服务名 `auto-save` 不再存在。
 * 这里只钉"挂上了、旧名取不到"，周期语义由 canvas-data 的引擎单测覆盖。
 */
describe('auto-save 并入 save', () => {
  it('装插件后 save.autoSave 可用，旧 auto-save 服务名取不到', async () => {
    const ctx = new Context()
    const base = createCanvasBasePlugin({ adapter: new MemoryStorageAdapter() })
    ctx.plugin(base.plugin)
    ctx.plugin(autoSavePlugin)
    await ctx.start()
    const save = ctx.get<{ autoSave?: { isEnabled(): boolean } }>('save')
    expect(save.autoSave).toBeDefined()
    expect(save.autoSave?.isEnabled()).toBe(true)
    // 旧名已删：插件服务不再占一个「看起来可换实现」的名字
    expect(ctx.hasService('auto-save')).toBe(false)
    ctx.stop()
  })
})
