import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore } from '@mini-canvas/canvas-data'
import { EdgeStore } from '../../edgeStore'
import { Selection } from '../../selection'
import { History } from '../../history'
import { GraphDocument } from '../../graphDocument'
import { createDocService } from '../../docService'
import { NodeRegistry } from '../registry/nodeRegistry'
import { ThemeRegistry } from '../registry/themeRegistry'
import { CommandRegistry } from '@mini-canvas/kernel'
import { NodeFactory } from '../nodeFactory'
import type { PluginModule, PluginScope } from '@mini-canvas/kernel'

/**
 * ctx.nodes.setSize —— 插件作者改节点尺寸的一等入口。
 * 锁：薄糖与 doc.setNodeSize 同一实现（写 size + 自动镜像），且非法尺寸拒写。
 */
async function boot(plugins: PluginModule[]): Promise<{ ctx: Context; nodeStore: NodeStore }> {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  const edgeStore = new EdgeStore()
  const selection = new Selection()
  const history = new History({
    snapshot: () => ({ nodes: nodeStore.getSnapshot(), edges: [] }),
    restore: (s: never) => nodeStore.replaceAll((s as { nodes: never[] }).nodes ?? []),
  })
  const graph = new GraphDocument(nodeStore, edgeStore, selection, history, () => {})
  ctx.inject('doc', createDocService({ nodeStore, edgeStore, graph, history }))
  ctx.inject('nodeRegistry', new NodeRegistry())
  ctx.inject('themeRegistry', new ThemeRegistry())
  ctx.inject('command', new CommandRegistry())
  ctx.inject('nodeFactory', new NodeFactory())
  for (const p of plugins) ctx.plugin(p)
  await ctx.start()
  return { ctx, nodeStore }
}

const mk = (name: string, setup: (c: PluginScope) => void): PluginModule => ({ name, setup })

describe('ctx.nodes.setSize', () => {
  it('设尺寸 → node.size 与 data 镜像都更新', async () => {
    let nodeId = ''
    const { nodeStore } = await boot([
      mk('p', (c) => {
        c.nodes.register({ type: 'strip', label: '长条', size: { w: 320, h: 240 }, in: { name: 'X' } })
        const doc = c.get<{ createNode(t: string, p: { x: number; y: number }): string }>('doc')
        nodeId = doc.createNode('strip', { x: 0, y: 0 })
        c.nodes.setSize(nodeId, 1600, 100)
      }),
    ])
    const n = nodeStore.getNode(nodeId)!
    expect(n.size).toEqual({ w: 1600, h: 100 })
    expect(n.data.cardWidth).toBe(1600)
    expect(n.data.cardHeight).toBe(100)
  })

  it('非法尺寸 → false 且不写', async () => {
    let ok = true
    const { nodeStore } = await boot([
      mk('p', (c) => {
        c.nodes.register({ type: 'strip', label: '长条', size: { w: 320, h: 240 }, in: { name: 'X' } })
        const doc = c.get<{ createNode(t: string, p: { x: number; y: number }): string }>('doc')
        const id = doc.createNode('strip', { x: 0, y: 0 })
        ok = c.nodes.setSize(id, Number.NaN, 100)
      }),
    ])
    expect(ok).toBe(false)
    // 没写 → 保持缺席（用类型默认）
    expect(nodeStore.getNodes()[0].size).toBeUndefined()
  })

  it('ctx.nodes.setLabel / move / setParent / remove 都在（薄糖走 doc 同一实现）', async () => {
    let ids: Record<string, string> = {}
    const { nodeStore } = await boot([
      mk('p', (c) => {
        c.nodes.register({ type: 'strip', label: '长条', size: { w: 320, h: 240 }, in: { name: 'X' } })
        const doc = c.get<{ createNode(t: string, p: { x: number; y: number }): string }>('doc')
        const a = doc.createNode('strip', { x: 0, y: 0 })
        const g = doc.createNode('strip', { x: 0, y: 0 })
        ids = { a, g }
        c.nodes.setLabel(a, '我的')
        c.nodes.move(a, { x: 30, y: 40 })
        c.nodes.setParent(a, g)
      }),
    ])
    const a = nodeStore.getNode(ids.a)!
    expect(a.data.label).toBe('我的')
    expect(a.position).toEqual({ x: 30, y: 40 })
    expect(a.parentId).toBe(ids.g)
  })

  it('ctx.nodes.remove 删节点', async () => {
    let removed: boolean | null = null
    let id = ''
    const { nodeStore } = await boot([
      mk('p', (c) => {
        c.nodes.register({ type: 'strip', label: '长条', size: { w: 320, h: 240 }, in: { name: 'X' } })
        const doc = c.get<{ createNode(t: string, p: { x: number; y: number }): string }>('doc')
        id = doc.createNode('strip', { x: 0, y: 0 })
        removed = c.nodes.remove(id)
      }),
    ])
    expect(removed).toBe(true)
    expect(nodeStore.getNode(id)).toBeUndefined()
  })
})
