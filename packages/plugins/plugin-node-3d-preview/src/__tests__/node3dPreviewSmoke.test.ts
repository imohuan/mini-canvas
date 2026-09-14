/**
 * node-3d-preview smoke：装配 3D 预览插件不抛、服务与节点类型注册、连接约束生效。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore, EdgeStore, Selection, History, GraphDocument } from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import { NodeFactory, NodeRegistry, ThemeRegistry, validateConnection } from '@mini-canvas/canvas-data'
import { node3dPreviewPlugin } from '../node3dPreviewPlugin'

function boot() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  ctx.inject('nodeStore', nodeStore)
  const edgeStore = new EdgeStore()
  ctx.inject('edgeStore', edgeStore)
  const selection = new Selection()
  ctx.inject('selection', selection)
  const history = new History({
    snapshot: () => ({
      nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())),
      edges: JSON.parse(JSON.stringify(edgeStore.getEdges())),
    }),
    restore: (g: { nodes: unknown[]; edges: unknown[] }) => {
      nodeStore.replaceAll(g.nodes as never)
      edgeStore.replaceAll(g.edges as never)
    },
  })
  ctx.inject('history', history)
  ctx.inject('graph', new GraphDocument(nodeStore, edgeStore, selection, history))
  ctx.inject('command', new CommandRegistry())
  ctx.inject('nodeFactory', new NodeFactory())
  ctx.inject('nodeRegistry', new NodeRegistry())
  ctx.inject('themeRegistry', new ThemeRegistry())
  ctx.plugin(node3dPreviewPlugin)
  return { ctx, nodeStore, edgeStore }
}

describe('node-3d-preview 装配 smoke', () => {
  it('插件可装配启动；服务上架、节点类型注册', async () => {
    const { ctx, nodeStore } = boot()
    await ctx.start()
    expect(ctx.get('panorama3d')).toBeTruthy()
    expect(nodeStore.types.has('3d-preview')).toBe(true)
    ctx.stop()
  })

  it('注册的连接约束：只接一张图、不产出输出', async () => {
    const { ctx, nodeStore } = boot()
    await ctx.start()
    const def = nodeStore.types.get('3d-preview')!
    expect(def.defaultSize).toEqual({ w: 420, h: 280 })
    expect(def.resizable).toBe(true)
    expect(def.inputs).toEqual([{ port: 'target', acceptsTypes: ['image'], capacity: 1 }])
    expect(def.outputs).toEqual([])
    ctx.stop()
  })

  it('经服务建节点：走 graph 建出 3d-preview 节点并带图片地址', async () => {
    const { ctx, nodeStore } = boot()
    await ctx.start()
    const svc = ctx.get<{ addPreviewNode(p: { x: number; y: number }, url?: string): string }>('panorama3d')
    const id = svc.addPreviewNode({ x: 10, y: 20 }, 'pano.png')
    const node = nodeStore.getNode(id)!
    expect(node.type).toBe('3d-preview')
    expect(node.data.imageUrl).toBe('pano.png')
    ctx.stop()
  })

  it('create 委托服务：nodeFactory.create 能建出同种节点', async () => {
    const { ctx, nodeStore } = boot()
    await ctx.start()
    const factory = ctx.get<{ create(t: string, p: { x: number; y: number }): string }>('nodeFactory')
    const id = factory.create('3d-preview', { x: 5, y: 6 })
    expect(nodeStore.getNode(id)!.type).toBe('3d-preview')
    ctx.stop()
  })

  it('换图/删节点：经服务更新 data、删除后节点与相连边一起消失', async () => {
    const { ctx, nodeStore, edgeStore } = boot()
    await ctx.start()
    const svc = ctx.get<{
      addPreviewNode(p: { x: number; y: number }, url?: string): string
      setImageUrl(id: string, url: string): void
      removeNode(id: string): void
    }>('panorama3d')
    const factory = ctx.get<{ create(t: string, p: { x: number; y: number }): string }>('nodeFactory')
    const imgId = factory.create('3d-preview', { x: 0, y: 0 })
    const panoId = svc.addPreviewNode({ x: 40, y: 0 })
    edgeStore.addEdge({ source: imgId, target: panoId, targetHandle: 'target' })

    svc.setImageUrl(panoId, 'new.png')
    expect(nodeStore.getNode(panoId)!.data.imageUrl).toBe('new.png')

    svc.removeNode(panoId)
    expect(nodeStore.getNode(panoId)).toBeUndefined()
    // 删节点连带清掉与它相连的边
    expect(edgeStore.getEdges().some((e) => e.target === panoId)).toBe(false)
    ctx.stop()
  })

  it('连接约束对内核生效：非图片源被拒、只接一条', async () => {
    const { ctx, nodeStore } = boot()
    await ctx.start()
    nodeStore.registerType({ type: 'text', label: '文本', defaultSize: { w: 10, h: 10 }, outputs: [{ port: 'source', contentType: 'text' }] })
    nodeStore.registerType({
      type: 'img',
      label: '图',
      defaultSize: { w: 10, h: 10 },
      outputs: [{ port: 'source', contentType: 'image' }],
    })
    const svc = ctx.get<{ addPreviewNode(p: { x: number; y: number }, url?: string): string }>('panorama3d')
    const panoId = svc.addPreviewNode({ x: 0, y: 0 })
    // 辅助类型只为走内核校验，不经 nodeFactory（那里只登记有 create 实现的类型）
    const imgId = nodeStore.addNode('img', { x: 0, y: 0 })
    const txtId = nodeStore.addNode('text', { x: 0, y: 0 })

    const nodes = new Map(nodeStore.getNodes().map((n) => [n.id, { id: n.id, type: n.type }]))
    const getTypeConn = (t: string) => {
      const d = nodeStore.types.get(t)
      return d && (d.inputs || d.outputs) ? { inputs: d.inputs, outputs: d.outputs } : undefined
    }
    const base = { nodes, edges: [], getTypeConn }
    expect(validateConnection({ source: txtId, target: panoId, targetHandle: 'target' }, base).reason).toBe('type-not-accepted')
    expect(validateConnection({ source: imgId, target: panoId, targetHandle: 'target' }, base).ok).toBe(true)
    // 已有一条入边后，第二条被容量拒
    const imgId2 = nodeStore.addNode('img', { x: 0, y: 0 })
    const nodes2 = new Map(nodeStore.getNodes().map((n) => [n.id, { id: n.id, type: n.type }]))
    const occupied = {
      nodes: nodes2,
      edges: [{ source: imgId, target: panoId, targetHandle: 'target' }],
      getTypeConn,
    }
    expect(validateConnection({ source: imgId2, target: panoId, targetHandle: 'target' }, occupied).reason).toBe('limit-reached')
    ctx.stop()
  })
})
