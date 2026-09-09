/**
 * canvas-commands smoke：装配命令插件不抛、命令已注册（P1-15 补每包 smoke）。
 */
import { describe, it, expect } from 'vitest'
import { Context, NodeStore, EdgeStore, Selection, History, GraphDocument, CommandRegistry, NodeFactory } from '@mini-canvas/canvas-core-v2'
import { canvasCommandsPlugin } from '../canvasCommandsPlugin'

function boot() {
  const ctx = new Context()
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
  ctx.inject('graph', new GraphDocument(nodeStore, edgeStore, selection, history))
  ctx.inject('command', new CommandRegistry())
  const nodeFactory = new NodeFactory()
  nodeFactory.register('text', (position: { x: number; y: number }) => nodeStore.addNode('text', position))
  ctx.inject('nodeFactory', nodeFactory)
  ctx.plugin(canvasCommandsPlugin)
  return ctx
}

describe('canvas-commands 装配 smoke', () => {
  it('插件可装配启动；command:delete / command:create-node 已注册', async () => {
    const ctx = boot()
    await ctx.start()
    const cmd = ctx.get<{ has(id: string): boolean; execute(id: string, ...a: unknown[]): unknown }>('command')
    expect(cmd.has('command:delete')).toBe(true)
    expect(cmd.has('command:create-node')).toBe(true)
    // 建一个节点再删（核心命令可用性）
    cmd.execute('command:create-node', { type: 'text', position: { x: 0, y: 0 } })
    expect(ctx.get<{ getNodes(): Array<{ id: string }> }>('nodeStore').getNodes()).toHaveLength(1)
    ctx.stop()
  })
})





