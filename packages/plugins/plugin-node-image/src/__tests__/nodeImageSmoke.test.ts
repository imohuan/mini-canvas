/**
 * node-image smoke：装配 image 节点插件不抛、image 服务与节点类型注册（P1-15 补每包 smoke）。
 */
import { describe, it, expect } from 'vitest'
import { Context, NodeStore, EdgeStore, Selection, History, GraphDocument, CommandRegistry, NodeFactory, NodeRegistry, ThemeRegistry } from '@mini-canvas/canvas-core-v2'
import { nodeImagePlugin } from '../nodeImagePlugin'

function boot() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
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
  ctx.inject('graph', new GraphDocument(nodeStore, edgeStore, selection, history))
  ctx.inject('command', new CommandRegistry())
  ctx.inject('nodeFactory', new NodeFactory())
  ctx.inject('nodeRegistry', new NodeRegistry())
  ctx.inject('themeRegistry', new ThemeRegistry())
  ctx.plugin(nodeImagePlugin)
  return ctx
}

describe('node-image 装配 smoke', () => {
  it('插件可装配启动；image 服务上架、节点类型注册', async () => {
    const ctx = boot()
    await ctx.start()
    expect(ctx.get('image')).toBeTruthy()
    expect(ctx.get<{ types: Map<string, unknown> }>('nodeStore').types.has('image')).toBe(true)
    // 建一个 image 节点（create 委托 image 服务走 graph）
    const factory = ctx.get<{ create(t: string, p: { x: number; y: number }): string }>('nodeFactory')
    const id = factory.create('image', { x: 5, y: 6 })
    expect(id).toBeTruthy()
    expect(ctx.get<{ getNodes(): Array<{ id: string; type: string }> }>('nodeStore').getNodes()).toHaveLength(1)
    ctx.stop()
  })
})



