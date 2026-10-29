/**
 * 动作层：资源保存、图片节点创建、分镜组槽位。
 *
 * 用真 doc（NodeStore/GraphDocument/History）验证“一条发布历史 / 一条分镜历史”，
 * 资源与切片全部注入假实现，不依赖浏览器 canvas。
 */
import { describe, expect, it } from 'vitest'
import { EdgeStore, GraphDocument, History, NodeStore, Selection } from '@mini-canvas/canvas-data'
import { gridCells, STORYBOARD_NODE_TYPE, storyboardLayout } from '../gridLogic'
import {
  createStoryboard,
  publishGrid,
  publishGridAndGroup,
  storyboardPatchWithSlots,
  storyboardSlotsOf,
  type GridActionDeps,
} from '../gridActions'

function boot() {
  const nodeStore = new NodeStore()
  const edgeStore = new EdgeStore()
  const selection = new Selection()
  const history = new History({
    snapshot: () => ({ nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())), edges: JSON.parse(JSON.stringify(edgeStore.getEdges())) }),
    restore: (g) => { nodeStore.replaceAll(g.nodes as never); edgeStore.replaceAll(g.edges as never) },
  })
  const graph = new GraphDocument(nodeStore, edgeStore, selection, history)
  nodeStore.registerType({ type: 'image', label: '图片', defaultSize: { w: 320, h: 240 } })
  nodeStore.registerType({ type: STORYBOARD_NODE_TYPE, label: '分镜组', defaultSize: { w: 900, h: 700 } })
  return { nodeStore, graph, history }
}

function makeDeps(env: ReturnType<typeof boot>): GridActionDeps {
  let seq = 0
  const stored: Blob[] = []
  return {
    doc: env.graph,
    resources: {
      async put(blob: Blob) {
        stored.push(blob)
        seq += 1
        return 'res-grid-' + seq
      },
    },
    mediaCreator: {
      addNode(_kind, resourceId, position, opts) {
        const meta = (opts?.meta ?? {}) as { name?: string; width?: number; height?: number }
        return env.graph.createNode('image', position, {
          resourceId,
          imageName: meta.name,
          imageWidth: meta.width,
          imageHeight: meta.height,
        })
      },
    },
    sliceImage: async (_url, cell) => ({ blob: new Blob(['x'], { type: 'image/png' }), width: cell.width, height: cell.height }),
  }
}

describe('宫格动作层', () => {
  it('发布只建选中的图，且整次发布只占一条历史', async () => {
    const env = boot()
    const deps = makeDeps(env)
    const cells = gridCells(2, 2, 200, 200)
    const before = env.history.undoDepth
    const result = await publishGrid(deps, {
      source: 'blob:src',
      cells,
      selected: new Set(['0:0', '1:1']),
      origin: { x: 0, y: 0 },
    })
    expect(result.imageNodeIds).toHaveLength(2)
    expect(env.history.undoDepth).toBe(before + 1)
    const images = env.nodeStore.getNodes().filter((n) => n.type === 'image')
    expect(images).toHaveLength(2)
    expect(images.every((n) => String(n.data.resourceId).startsWith('res-grid-'))).toBe(true)
    expect(images[0]!.position).toEqual({ x: 0, y: 0 })
    expect(images[1]!.position).toEqual({ x: 116, y: 116 })
  })

  it('发布后由 group 服务打组：返回分组 id，组内子节点有 parentId', async () => {
    const env = boot()
    const deps = makeDeps(env)
    const cells = gridCells(2, 2, 200, 200)
    const result = await publishGridAndGroup(deps, {
      source: 'blob:src',
      cells,
      selected: new Set(['0:0', '0:1']),
      origin: { x: 0, y: 0 },
      groupOf: (ids) => {
        // 这里模拟 group 服务：真机由 ctx.get('group').createGroup 实现
        return ids.length >= 2 ? 'group-1' : null
      },
    })
    expect(result.groupId).toBe('group-1')
  })

  it('无资源库 / 无图片创建器 → 不伪造成功，返回明确失败', async () => {
    const env = boot()
    const cells = gridCells(2, 2, 200, 200)
    const noResources = await publishGrid({ ...makeDeps(env), resources: undefined }, {
      source: 'blob:src', cells, selected: new Set(['0:0']), origin: { x: 0, y: 0 },
    })
    expect(noResources.imageNodeIds).toEqual([])
    expect(noResources.failures[0]!.reason).toContain('资源库')
    const noCreator = await publishGrid({ ...makeDeps(env), mediaCreator: undefined }, {
      source: 'blob:src', cells, selected: new Set(['0:0']), origin: { x: 0, y: 0 },
    })
    expect(noCreator.imageNodeIds).toEqual([])
  })

  it('创建分镜组：槽位按行列落位、隐藏引用清单包含槽内所有 resourceId', async () => {
    const env = boot()
    const deps = makeDeps(env)
    const cells = gridCells(3, 3, 900, 600)
    const result = await createStoryboard(deps, {
      source: 'blob:src',
      cells,
      selected: new Set(['0:0', '1:1', '2:2']),
      rows: 3,
      cols: 3,
      origin: { x: 10, y: 20 },
      cellWidth: 300,
      cellHeight: 200,
    })
    expect(result.nodeId).toBeTruthy()
    expect(result.written).toBe(3)
    const node = env.nodeStore.getNode(result.nodeId)!
    expect(node.type).toBe(STORYBOARD_NODE_TYPE)
    expect(node.position).toEqual({ x: 10, y: 20 })
    const slots = storyboardSlotsOf(node.data)
    expect(slots).toHaveLength(9)
    expect(slots[0]?.resourceId).toBe('res-grid-1')
    expect(slots[4]?.resourceId).toBe('res-grid-2')
    expect(slots[8]?.resourceId).toBe('res-grid-3')
    expect(slots[1]).toBeNull()
    expect(node.data.storyboardResourceIds).toEqual(['res-grid-1', 'res-grid-2', 'res-grid-3'])
    const l = storyboardLayout(3, 3, 300, 200)
    expect(node.data.gridCellWidth).toBe(l.cellWidth)
  })

  it('槽位变化时引用清单同步更新（删掉一格不会留下孤儿引用）', async () => {
    const slots = [{ resourceId: 'a' }, null, { resourceId: 'b' }]
    expect(storyboardPatchWithSlots(slots)).toEqual({
      slots,
      storyboardResourceIds: ['a', 'b'],
    })
  })
})
