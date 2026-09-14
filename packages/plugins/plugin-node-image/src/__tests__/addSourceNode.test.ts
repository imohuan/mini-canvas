/**
 * addSourceNode —— 底部生成面板「添加素材」的行为契约。
 *
 * 用户的动作是「点加号 → 选一张本地图片 → 它成为本节点的上游素材」。
 * 结果必须同时满足两件事，缺一不可：
 * 1. 新图片节点真的被建出来并且带上了 dataURL（不然素材行里是空的）；
 * 2. 有一条边从新节点连到本节点（不然它不算「连进来的素材」，@ 引用与赠送都看不到）。
 *
 * 只把「浏览器图片能力」换成假实现，其余走真内核（graph 唯一写入口 → 进历史 → 落盘）。
 */
import { describe, it, expect } from 'vitest'
import { NodeStore, EdgeStore, Selection, History, GraphDocument, SaveServiceImpl, MemoryStorageAdapter, type GraphEnvelope } from '@mini-canvas/canvas-data'
import { addSourceNode, createImageOps, type ImageTransform } from '../imageOps'

/** 假图片加工：不碰 FileReader/canvas，只回可控结果 */
function fakeTransform(overrides: Partial<ImageTransform> = {}): ImageTransform {
  return {
    fileToDataUrl: async () => 'data:image/png;base64,SRC',
    readImageSize: async () => ({ width: 640, height: 480 }),
    cropToDataUrl: async () => null,
    rotateToDataUrl: async () => null,
    downloadImage: () => true,
    pickImageFile: async () => null,
    ...overrides,
  }
}

/** 真内核最小装配：nodeStore/edgeStore/selection/history/graph(commit→save)/save */
function boot() {
  const nodeStore = new NodeStore()
  const edgeStore = new EdgeStore()
  const selection = new Selection()
  const history = new History({
    snapshot: () => ({
      nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())),
      edges: JSON.parse(JSON.stringify(edgeStore.getEdges())),
    }) as GraphEnvelope,
    restore: (g: GraphEnvelope) => {
      nodeStore.replaceAll(g.nodes as never)
      edgeStore.replaceAll(g.edges as never)
    },
  })
  const save = new SaveServiceImpl(new MemoryStorageAdapter())
  const graph = new GraphDocument(nodeStore, edgeStore, selection, history, (env) => {
    save.set('graph', env.nodes, 'canvas')
  })
  nodeStore.registerType({ type: 'image', label: '图片', defaultSize: { w: 320, h: 240 } })
  const ops = createImageOps({
    // 与真实宿主同形的服务表：加素材要按输入口容量挤最老一条，就得能读到边与节点类型声明
    get: (name: string) =>
      name === 'nodeStore' ? nodeStore : name === 'edgeStore' ? edgeStore : name === 'graph' ? graph : undefined,
  } as never)
  const target = graph.createNode('image', { x: 400, y: 0 }, { imageUrl: 'data:image/png;base64,OLD' })
  return { nodeStore, edgeStore, graph, history, ops, target }
}

describe('addSourceNode：加素材 = 建上游图片节点 + 连进来', () => {
  it('建出带 dataURL 与尺寸的新节点，并连一条边到本节点输入口', async () => {
    const { nodeStore, edgeStore, ops, target } = boot()
    const newId = await addSourceNode(ops, target, new File(['x'], 'src.png'), { x: 10, y: 20 }, fakeTransform())
    expect(newId).toBeTruthy()

    const created = nodeStore.getNode(newId!)!
    expect(created.type).toBe('image')
    expect(created.data.imageUrl).toBe('data:image/png;base64,SRC')
    expect(created.data.imageName).toBe('src.png')
    expect(created.data.imageWidth).toBe(640)
    expect(created.data.imageHeight).toBe(480)

    const edges = edgeStore.getEdges()
    expect(edges).toHaveLength(1)
    expect(edges[0].source).toBe(newId)
    expect(edges[0].target).toBe(target)
  })

  it('新节点落在给定位置（面板把它摆在目标节点左侧）', async () => {
    const { nodeStore, ops, target } = boot()
    const newId = await addSourceNode(ops, target, new File(['x'], 's.png'), { x: -260, y: 12 }, fakeTransform())
    const created = nodeStore.getNode(newId!)!
    expect(created.position).toEqual({ x: -260, y: 12 })
  })

  it('一次「加素材」是**一条**可撤销记录：undo 后节点与边一起消失', async () => {
    const { nodeStore, edgeStore, history, ops, target } = boot()
    const depth = history.undoDepth
    await addSourceNode(ops, target, new File(['x'], 's.png'), { x: 0, y: 0 }, fakeTransform())
    expect(history.undoDepth).toBe(depth + 1)
    expect(nodeStore.getNodes()).toHaveLength(2)
    history.undo()
    expect(nodeStore.getNodes()).toHaveLength(1)
    expect(edgeStore.getEdges()).toHaveLength(0)
  })

  it('读文件失败 → 不建节点、不连边（不留下半截素材）', async () => {
    const { nodeStore, edgeStore, ops, target } = boot()
    const failing = fakeTransform({ fileToDataUrl: async () => { throw new Error('boom') } })
    const newId = await addSourceNode(ops, target, new File(['x'], 's.png'), { x: 0, y: 0 }, failing)
    expect(newId).toBeNull()
    expect(nodeStore.getNodes()).toHaveLength(1)
    expect(edgeStore.getEdges()).toHaveLength(0)
  })

  it('输入口容量=1：再加一个素材会挤掉最老的那条边（不违反节点声明的容量）', async () => {
    const { edgeStore, ops, target } = boot()
    const first = await addSourceNode(ops, target, new File(['x'], 'a.png'), { x: 0, y: 0 }, fakeTransform())
    const second = await addSourceNode(ops, target, new File(['x'], 'b.png'), { x: 0, y: 0 }, fakeTransform())
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()

    const edges = edgeStore.getEdges()
    // 仍然只有一条入边，且连的是最新加的那个素材（FIFO 挤最老）
    expect(edges).toHaveLength(1)
    expect(edges[0].source).toBe(second)
  })

  it('挤掉旧边与建新边是**一条**撤销记录（undo 不会留下半截状态）', async () => {
    const { edgeStore, history, ops, target } = boot()
    await addSourceNode(ops, target, new File(['x'], 'a.png'), { x: 0, y: 0 }, fakeTransform())
    const depth = history.undoDepth
    await addSourceNode(ops, target, new File(['x'], 'b.png'), { x: 0, y: 0 }, fakeTransform())
    expect(history.undoDepth).toBe(depth + 1)
    history.undo()
    // 撤回第二步 → 回到"只有第一个素材连着"
    const edges = edgeStore.getEdges()
    expect(edges).toHaveLength(1)
  })
})
