/**
 * node-text smoke：装配 text 节点插件不抛、text 服务与节点类型注册（P1-15 补每包 smoke）。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore, EdgeStore, Selection, History, GraphDocument } from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import { NodeFactory, NodeRegistry, ThemeRegistry } from '@mini-canvas/canvas-data'
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

  it('段注册：content + 底部状态栏（顶部操作条已按用户要求删除）', async () => {
    const ctx = boot()
    await ctx.start()
    // 与内核 resolveSegment 同一读法：registry.get(type).segments[segment]
    const registry = ctx.get<{
      get(t: string): { segments: Record<string, unknown> } | undefined
    }>('nodeRegistry')
    const segments = registry.get('text')?.segments ?? {}
    expect(segments.content).toBeTruthy()
    expect(segments['bottom-toolbar']).toBeTruthy()
    // 顶部操作条（加粗/字号/颜色/对齐）已删：段位不该再被注册
    expect(segments['top-toolbar']).toBeUndefined()
    ctx.stop()
  })

  it('两条命令都注册上了（复制/删除），样式命令已删', async () => {
    const ctx = boot()
    await ctx.start()
    const cmd = ctx.get<{ has(id: string): boolean }>('command')
    for (const id of ['text.duplicate', 'text.delete']) {
      expect(cmd.has(id)).toBe(true)
    }
    expect(cmd.has('text.bold')).toBe(false)
    expect(cmd.has('text.style')).toBe(false)
    ctx.stop()
  })
})
