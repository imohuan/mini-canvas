/**
 * image-compare smoke：装配不抛、服务/类型注册、FIFO 挤出行为、分割线位置读写。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore, EdgeStore, Selection, History, GraphDocument } from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import { NodeFactory, NodeRegistry, ThemeRegistry } from '@mini-canvas/canvas-data'
import { nodeImageComparePlugin } from '../nodeImageComparePlugin'

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
  ctx.plugin(nodeImageComparePlugin)
  // 上游图片节点的类型（真实环境由 plugin-node-image 注册；本包不依赖它，测试里自己登记）
  nodeStore.registerType({
    type: 'image',
    label: '图片',
    defaultSize: { w: 320, h: 240 },
    outputs: [{ port: 'source', contentType: 'image' }],
  })
  return { ctx, nodeStore, edgeStore }
}

/** 建一个带图的 image 节点（模拟上游图片节点） */
function addImage(nodeStore: NodeStore, url: string): string {
  const id = nodeStore.addNode('image', { x: 0, y: 0 })
  nodeStore.updateNodeData(id, { imageUrl: url })
  return id
}

type CompareSvc = {
  addCompareNode(p: { x: number; y: number }): string
  setDividerPosition(id: string, pct: number): void
  getDividerPosition(id: string): number
  removeNode(id: string): void
}

describe('image-compare 装配 smoke', () => {
  it('插件可装配启动；服务上架、节点类型注册', async () => {
    const { ctx, nodeStore } = boot()
    await ctx.start()
    expect(ctx.get('imageCompare')).toBeTruthy()
    expect(nodeStore.types.has('image-compare')).toBe(true)
    ctx.stop()
  })

  it('注册的连接约束：只收图片、不产出输出、容量留缓冲位', async () => {
    const { ctx, nodeStore } = boot()
    await ctx.start()
    const def = nodeStore.types.get('image-compare')!
    expect(def.label).toBe('图片对比')
    expect(def.resizable).toBe(true)
    expect(def.inputs).toEqual([{ port: 'target', acceptsTypes: ['image'], capacity: 2 }])
    expect(def.outputs).toEqual([])
    ctx.stop()
  })

  it('经服务建节点：默认分割线在中间', async () => {
    const { ctx, nodeStore } = boot()
    await ctx.start()
    const svc = ctx.get<CompareSvc>('imageCompare')
    const id = svc.addCompareNode({ x: 12, y: 34 })
    const node = nodeStore.getNode(id)!
    expect(node.type).toBe('image-compare')
    expect(node.position).toEqual({ x: 12, y: 34 })
    expect(svc.getDividerPosition(id)).toBe(50)
    ctx.stop()
  })

  it('分割线位置读写：自动夹在 0~100', async () => {
    const { ctx } = boot()
    await ctx.start()
    const svc = ctx.get<CompareSvc>('imageCompare')
    const id = svc.addCompareNode({ x: 0, y: 0 })
    svc.setDividerPosition(id, 120)
    expect(svc.getDividerPosition(id)).toBe(100)
    svc.setDividerPosition(id, -5)
    expect(svc.getDividerPosition(id)).toBe(0)
    svc.setDividerPosition(id, 33.5)
    expect(svc.getDividerPosition(id)).toBe(33.5)
    ctx.stop()
  })

  it('FIFO：连第 3 张图时自动挤掉最早那条', async () => {
    const { ctx, nodeStore, edgeStore } = boot()
    await ctx.start()
    const svc = ctx.get<CompareSvc>('imageCompare')
    const cmp = svc.addCompareNode({ x: 0, y: 0 })
    const a = addImage(nodeStore, 'a.png')
    const b = addImage(nodeStore, 'b.png')
    const c = addImage(nodeStore, 'c.png')

    edgeStore.addEdge({ source: a, target: cmp, targetHandle: 'target' })
    edgeStore.addEdge({ source: b, target: cmp, targetHandle: 'target' })
    expect(edgeStore.getEdges()).toHaveLength(2)

    edgeStore.addEdge({ source: c, target: cmp, targetHandle: 'target' })
    const left = edgeStore.getEdges().filter((e) => e.target === cmp)
    // 保留最新两张：b 与 c；最早的 a 被挤掉
    expect(left).toHaveLength(2)
    expect(left.map((e) => e.source)).toEqual([b, c])
    ctx.stop()
  })

  it('FIFO：只有两张时不动', async () => {
    const { ctx, nodeStore, edgeStore } = boot()
    await ctx.start()
    const svc = ctx.get<CompareSvc>('imageCompare')
    const cmp = svc.addCompareNode({ x: 0, y: 0 })
    const a = addImage(nodeStore, 'a.png')
    const b = addImage(nodeStore, 'b.png')
    edgeStore.addEdge({ source: a, target: cmp, targetHandle: 'target' })
    edgeStore.addEdge({ source: b, target: cmp, targetHandle: 'target' })
    expect(edgeStore.getEdges().map((e) => e.source)).toEqual([a, b])
    ctx.stop()
  })

  it('删节点：对比节点与相连边一起消失', async () => {
    const { ctx, nodeStore, edgeStore } = boot()
    await ctx.start()
    const svc = ctx.get<CompareSvc>('imageCompare')
    const cmp = svc.addCompareNode({ x: 0, y: 0 })
    const a = addImage(nodeStore, 'a.png')
    edgeStore.addEdge({ source: a, target: cmp, targetHandle: 'target' })
    svc.removeNode(cmp)
    expect(nodeStore.getNode(cmp)).toBeUndefined()
    expect(edgeStore.getEdges()).toHaveLength(0)
    ctx.stop()
  })
})
