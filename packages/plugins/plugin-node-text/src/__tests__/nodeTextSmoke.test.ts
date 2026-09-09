/**
 * node-text smoke：装配 text 节点插件不抛、text 服务与节点类型注册（P1-15 补每包 smoke）。
 */
import { describe, it, expect } from 'vitest'
import { Context, NodeStore, EdgeStore, Selection, History, GraphDocument, CommandRegistry, NodeFactory, NodeRegistry, ThemeRegistry } from '@mini-canvas/canvas-core-v2'
import { nodeTextPlugin } from '../nodeTextPlugin'

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
  ctx.plugin(nodeTextPlugin)
  return ctx
}

describe('node-text 装配 smoke', () => {
  it('插件可装配启动；text 服务上架、节点类型注册、可建 text 节点', async () => {
    const ctx = boot()
    await ctx.start()
    expect(ctx.get('text')).toBeTruthy()
    expect(ctx.get<{ types: Map<string, unknown> }>('nodeStore').types.has('text')).toBe(true)
    const factory = ctx.get<{ create(t: string, p: { x: number; y: number }): string }>('nodeFactory')
    const id = factory.create('text', { x: 1, y: 2 })
    expect(id).toBeTruthy()
    ctx.stop()
  })
})

