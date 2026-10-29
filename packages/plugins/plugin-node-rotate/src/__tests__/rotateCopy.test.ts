/**
 * 顶栏「旋转与镜像」按钮的行为契约（用户口径 2026-10-30）：
 * - 点按钮 = 复制当前图片节点（原图不动）；
 * - 原图 → 副本建一条连接线；
 * - 选中的是副本，并且**副本**进入 node-rotate/mode；
 * - 建节点 + 连边一次撤销即可整体回退。
 */
import { describe, expect, it } from 'vitest'
import {
  Context,
  EdgeStore,
  GraphDocument,
  History,
  NodeStore,
  Selection,
  createDocService,
} from '@mini-canvas/canvas-data'
import { duplicateImageForRotate } from '../rotateCopy'
import { ROTATE_MODE_ID, closeRotateMode, rotateMode } from '../rotateSession'

function makeStack() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  nodeStore.registerType({ type: 'image', label: '图片', defaultSize: { w: 320, h: 240 } })
  nodeStore.registerType({ type: 'text', label: '文本', defaultSize: { w: 200, h: 100 } })
  const edgeStore = new EdgeStore()
  const selection = new Selection()
  const history = new History({
    snapshot: () => ({
      nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())),
      edges: JSON.parse(JSON.stringify(edgeStore.getEdges())),
    }),
    restore: (g) => {
      const env = (g ?? {}) as { nodes?: never[]; edges?: never[] }
      nodeStore.replaceAll(env.nodes ?? [])
      edgeStore.replaceAll(env.edges ?? [])
    },
  })
  const doc = createDocService({ nodeStore, edgeStore, graph: new GraphDocument(nodeStore, edgeStore, selection, history), history })
  ctx.inject('doc', doc)
  ctx.inject('selection', selection)
  const entered: Array<{ nodeId: string; modeId: string }> = []
  ctx.provide('nodeToolbar', { enter: (nodeId: string, modeId: string) => void entered.push({ nodeId, modeId }) })
  return { ctx, doc, nodeStore, edgeStore, selection, history, entered }
}

describe('duplicateImageForRotate', () => {
  it('复制图片 → 原图连到副本 → 副本进入旋转模式，原图不变', () => {
    const { ctx, doc, nodeStore, edgeStore, selection, history, entered } = makeStack()
    closeRotateMode()
    doc.addNodes([
      {
        type: 'image',
        position: { x: 40, y: 60 },
        data: { label: '图片 1', resourceId: 'res-1', imageUrl: 'blob:one', imageWidth: 640, imageHeight: 480 },
        size: { w: 320, h: 240 },
      },
    ])
    const original = nodeStore.getNodes()[0]
    const originalSnapshot = JSON.parse(JSON.stringify(original))

    let scheduled: (() => void) | undefined
    const copyId = duplicateImageForRotate(ctx, original.id, { schedule: (fn) => void (scheduled = fn) })

    expect(typeof copyId).toBe('string')
    expect(copyId).not.toBe(original.id)
    expect(nodeStore.getNodes()).toHaveLength(2)
    // 原图一个字节都没动
    expect(nodeStore.getNode(original.id)).toEqual(originalSnapshot)

    const copy = nodeStore.getNode(copyId!)!
    expect(copy.type).toBe('image')
    expect(copy.position).toEqual({ x: original.position.x + 320 + 100, y: original.position.y })
    expect(copy.size).toEqual({ w: 320, h: 240 })
    expect(copy.data.resourceId).toBe('res-1')
    expect(copy.data.imageUrl).toBe('blob:one')
    expect(copy.data.label).toBe('图片 1-副本')

    // 一条线：原图 source → 副本 target
    const edges = edgeStore.getEdges()
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ source: original.id, target: copyId, sourceHandle: 'source', targetHandle: 'target' })

    // 选中副本；模式等视图挂载后进入
    expect([...selection.ids]).toEqual([copyId])
    expect(entered).toEqual([])
    expect(scheduled).toBeTypeOf('function')
    scheduled!()
    expect(entered).toEqual([{ nodeId: copyId, modeId: ROTATE_MODE_ID }])
    expect(rotateMode.value).toBe(copyId)

    // 一次撤销：副本和线一起消失
    history.undo()
    expect(nodeStore.getNodes()).toHaveLength(1)
    expect(edgeStore.getEdges()).toHaveLength(0)
    closeRotateMode()
  })

  it('不是图片节点 → 什么都不建', () => {
    const { ctx, doc, nodeStore, entered } = makeStack()
    closeRotateMode()
    doc.addNodes([{ type: 'text', position: { x: 0, y: 0 }, data: { label: '文本 1', text: 'hi' } }])
    const id = nodeStore.getNodes()[0].id
    expect(duplicateImageForRotate(ctx, id, { schedule: (fn) => fn() })).toBeNull()
    expect(nodeStore.getNodes()).toHaveLength(1)
    expect(entered).toEqual([])
    expect(rotateMode.value).toBeNull()
  })

  it('老存档只在 data 里带尺寸 → 副本沿用迁移后的同一宽高', () => {
    const { ctx, nodeStore } = makeStack()
    closeRotateMode()
    nodeStore.replaceAll([
      {
        id: 'legacy-1',
        type: 'image',
        position: { x: 0, y: 0 },
        data: { label: '旧图', imageUrl: 'blob:old', cardWidth: 360, cardHeight: 240 },
      },
    ])
    const original = nodeStore.getNodes()[0]
    const copyId = duplicateImageForRotate(ctx, original.id, { schedule: (fn) => fn() })
    expect(nodeStore.getNode(copyId!)!.size).toEqual({ w: 360, h: 240 })
    closeRotateMode()
  })

  it('节点不存在 → 返回 null，不抛错', () => {
    const { ctx } = makeStack()
    expect(duplicateImageForRotate(ctx, 'missing', { schedule: (fn) => fn() })).toBeNull()
  })
})
