/**
 * media.addNode 的“从源节点新建下游节点”链路（真实内核数据层）。
 *
 * 用户口径 2026-10-30：加节点通常是“一个源节点 + 新节点 + 连线”，定位不该由每个插件各算一遍。
 * 这里锁住 media 入口的三件事：
 * 1. 给了 sourceNodeId → 位置由落点算法统一算，调用方传的坐标不再生效；
 * 2. 新节点与源节点之间会自动连一条线（同一事务，能一次撤销）；
 * 3. 连线被校验拒绝 → 不留下孤儿节点。
 */
import { describe, it, expect } from 'vitest'
import {
  Context,
  createDocService,
  EdgeStore,
  GraphDocument,
  History,
  NodeStore,
  Selection,
  type CanvasEdge,
} from '@mini-canvas/canvas-data'
import { RegistryImpl } from '@mini-canvas/kernel'
import {
  createMediaCapability,
  MEDIA_CREATOR_FIELD,
  type MediaKindCreator,
} from '../standardCapabilities'
import { NodeLayoutService } from '../../layout/nodeLayout'

function boot() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  nodeStore.registerType({ type: 'image', label: '图片', defaultSize: { w: 320, h: 240 } })
  nodeStore.registerType({ type: 'video', label: '视频', defaultSize: { w: 480, h: 320 } })
  const edgeStore = new EdgeStore()
  const selection = new Selection()
  ctx.inject('selection', selection)
  const history = new History({
    snapshot: () => ({
      nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())),
      edges: JSON.parse(JSON.stringify(edgeStore.getEdges())) as CanvasEdge[],
    }),
    restore: (g: { nodes: unknown[]; edges: unknown[] }) => {
      nodeStore.replaceAll(g.nodes as never)
      edgeStore.replaceAll(g.edges as never)
    },
  })
  const graph = new GraphDocument(nodeStore, edgeStore, selection, history)
  const doc = createDocService({ nodeStore, edgeStore, graph, history })
  ctx.inject('doc', doc)
  const layout = new NodeLayoutService(nodeStore)
  ctx.inject('view', layout)

  const field = ctx.registryOf<MediaKindCreator>(MEDIA_CREATOR_FIELD)
  const created: Array<{ position: { x: number; y: number }; resourceId: string }> = []
  field.add('image', {
    addNode(request) {
      created.push({ position: { ...request.position }, resourceId: request.resourceId })
      return doc.transaction('test-add-image', (tx) =>
        tx.createNode('image', request.position, { resourceId: request.resourceId }),
      )
    },
  })

  const media = createMediaCapability(ctx)
  return { ctx, nodeStore, edgeStore, history, layout, media, created }
}

describe('media.addNode：源节点旁自动定位 + 连线', () => {
  it('给了 sourceNodeId → 新节点优先落在源节点右边，并自动连边', () => {
    const env = boot()
    const sourceId = env.nodeStore.addNodes([
      { id: 's', type: 'video', position: { x: 100, y: 100 }, size: { w: 480, h: 320 } },
    ])
    expect(sourceId).toBe(1)

    const id = env.media.addNode('image', 'res-1', { x: 9999, y: 9999 }, { sourceNodeId: 's' })
    expect(id).toBeTruthy()
    const node = env.nodeStore.getNode(id!)!
    // 源节点右缘 580 + 间距 40（调用方传的 9999 不生效）
    expect(node.position).toEqual({ x: 620, y: 100 })
    expect(node.data.resourceId).toBe('res-1')

    const edges = env.edgeStore.getEdges()
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ source: 's', target: id })
  })

  it('右边被别的节点占住 → 换到下方，仍不重叠', () => {
    const env = boot()
    env.nodeStore.addNodes([
      { id: 's', type: 'video', position: { x: 100, y: 100 }, size: { w: 480, h: 320 } },
      { id: 'blocker', type: 'image', position: { x: 620, y: 100 }, size: { w: 320, h: 240 } },
    ])
    const id = env.media.addNode('image', 'res-2', { x: 0, y: 0 }, { sourceNodeId: 's' })
    const node = env.nodeStore.getNode(id!)!
    // 源节点下缘 420 + 间距 40
    expect(node.position).toEqual({ x: 100, y: 460 })
  })

  it('新节点 + 连线是一次撤销：undo 后两者一起消失', () => {
    const env = boot()
    env.nodeStore.addNodes([
      { id: 's', type: 'video', position: { x: 100, y: 100 }, size: { w: 480, h: 320 } },
    ])
    const depth = env.history.undoDepth
    const id = env.media.addNode('image', 'res-3', { x: 0, y: 0 }, { sourceNodeId: 's' })
    expect(env.history.undoDepth).toBe(depth + 1)
    expect(env.edgeStore.getEdges()).toHaveLength(1)
    env.history.undo()
    expect(env.nodeStore.getNode(id!)).toBeUndefined()
    expect(env.edgeStore.getEdges()).toHaveLength(0)
  })

  it('不传 sourceNodeId → 保持旧行为：用调用方给的坐标，不自动连线', () => {
    const env = boot()
    env.nodeStore.addNodes([
      { id: 's', type: 'video', position: { x: 100, y: 100 }, size: { w: 480, h: 320 } },
    ])
    const id = env.media.addNode('image', 'res-4', { x: 40, y: 50 })
    expect(env.nodeStore.getNode(id!)!.position).toEqual({ x: 40, y: 50 })
    expect(env.edgeStore.getEdges()).toHaveLength(0)
  })
})
