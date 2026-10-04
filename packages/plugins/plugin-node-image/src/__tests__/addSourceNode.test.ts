/**
 * addSourceNode —— 底部生成面板「添加素材」的行为契约。
 *
 * 用户的动作是「点加号 → 选一张本地图片 → 它成为本节点的上游素材」。
 * 结果必须同时满足两件事，缺一不可：
 * 1. 新图片节点真的被建出来并且拿到了资源引用（不然素材行里是空的）；
 * 2. 有一条边从新节点连到本节点（不然它不算「连进来的素材」，@ 引用与赠送都看不到）。
 *
 * 2026-10-01 变更：素材字节进资源库（IndexedDB），节点只留 resourceId + 本会话地址，
 * 不再把 base64 塞进 data.imageUrl。只把「浏览器图片能力」换成假实现，其余走真内核。
 */
import { describe, it, expect } from 'vitest'
import {
  NodeStore, EdgeStore, Selection, History, GraphDocument, SaveServiceImpl, MemoryStorageAdapter,
  ResourceStore, createDocService, type GraphEnvelope,
} from '@mini-canvas/canvas-data'
import { addSourceNode, createImageOps, type ImageTransform } from '../imageOps'

const BLOB = (tag = 'src') => new Blob([tag], { type: 'image/png' })

/** 假图片加工：不碰 FileReader/canvas，只回可控结果 */
function fakeTransform(overrides: Partial<ImageTransform> = {}): ImageTransform {
  return {
    readImageSize: async () => ({ width: 640, height: 480 }),
    cropToBlob: async () => null,
    rotateToBlob: async () => null,
    downloadImage: () => true,
    pickImageFile: async () => null,
    ...overrides,
  }
}

/** 内存版资源适配器（等价于本地 IndexedDB 适配器） */
function memoryResourceAdapter() {
  const blobs = new Map<string, Blob>()
  let seq = 0
  return {
    blobs,
    adapter: {
      id: 'memory-resource',
      capability: {},
      async get() { return undefined },
      async set() {},
      async remove() {},
      async putResource(blob: Blob) {
        seq += 1
        const ref = 'res-' + seq
        blobs.set(ref, blob)
        return ref
      },
      async resolveResource(ref: string) {
        return blobs.has(ref) ? 'blob:src-' + ref : undefined
      },
      async removeResource(ref: string) { blobs.delete(ref) },
    },
  }
}

/** 真内核最小装配：nodeStore/edgeStore/selection/history/graph(commit→save)/save + resources */
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
  const doc = createDocService({ nodeStore, edgeStore, graph, history })
  const { adapter, blobs } = memoryResourceAdapter()
  const resources = new ResourceStore(() => adapter, { revokeUrl() {} })
  nodeStore.registerType({ type: 'image', label: '图片', defaultSize: { w: 320, h: 240 } })
  const ops = createImageOps({
    // 与真实宿主同形的服务表：加素材要按输入口容量挤最老一条，就得能读到边与节点类型声明
    // 5c：数据读写走 doc；资源登记走 resources
    get: (name: string) => (name === 'doc' ? doc : name === 'resources' ? resources : undefined),
  } as never)
  const target = graph.createNode('image', { x: 400, y: 0 }, { imageUrl: 'blob:old' })
  return { nodeStore, edgeStore, graph, doc, save, resources, blobs, ops, target, history }
}

describe('addSourceNode：加素材 = 建上游图片节点 + 连进来', () => {
  it('建出带资源引用的新节点，并连一条边到本节点输入口', async () => {
    const { nodeStore, edgeStore, ops, target } = boot()
    const newId = await addSourceNode(ops, target, new File(['x'], 'src.png', { type: 'image/png' }), { x: 10, y: 20 }, fakeTransform())
    expect(newId).toBeTruthy()

    const created = nodeStore.getNode(newId!)!
    expect(created.type).toBe('image')
    expect(typeof created.data.resourceId).toBe('string')
    expect(String(created.data.imageUrl)).toMatch(/^blob:/)
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
    const newId = await addSourceNode(ops, target, BLOB(), { x: -260, y: 12 }, fakeTransform())
    const created = nodeStore.getNode(newId!)!
    expect(created.position).toEqual({ x: -260, y: 12 })
  })

  it('一次「加素材」是**一条**可撤销记录：undo 后节点与边一起消失', async () => {
    const { nodeStore, edgeStore, history, ops, target } = boot()
    const depth = history.undoDepth
    await addSourceNode(ops, target, BLOB(), { x: 0, y: 0 }, fakeTransform())
    expect(history.undoDepth).toBe(depth + 1)
    expect(nodeStore.getNodes()).toHaveLength(2)
    history.undo()
    expect(nodeStore.getNodes()).toHaveLength(1)
    expect(edgeStore.getEdges()).toHaveLength(0)
  })

  it('没有资源库 → 不建节点、不连边（不留下半截素材，也不退回 base64）', async () => {
    const { nodeStore, edgeStore, ops, target, doc } = boot()
    const opsNoRes = createImageOps({ get: (n: string) => (n === 'doc' ? doc : undefined) } as never)
    const newId = await addSourceNode(opsNoRes, target, BLOB(), { x: 0, y: 0 }, fakeTransform())
    expect(newId).toBeNull()
    expect(nodeStore.getNodes()).toHaveLength(1)
    expect(edgeStore.getEdges()).toHaveLength(0)
    void ops
  })

  it('图片节点未声明 capacity = 不限条数：两个素材都保留（2026-09 新语义）', async () => {
    // 旧断言"挤掉最老的只剩一条"基于旧内核语义（未声明 capacity 按 1 算）。
    // 新语义：未声明 = 不限条数 —— 图片节点的生成面板本来就支持多素材行，两条都该留着。
    const { edgeStore, ops, target } = boot()
    const first = await addSourceNode(ops, target, BLOB('a'), { x: 0, y: 0 }, fakeTransform())
    const second = await addSourceNode(ops, target, BLOB('b'), { x: 0, y: 0 }, fakeTransform())
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()

    const edges = edgeStore.getEdges()
    expect(edges).toHaveLength(2)
    expect(edges.map((e) => e.source).sort()).toEqual([first, second].sort())
  })

  it('加素材（建节点+连边）是**一条**撤销记录：undo 一次回到只有目标节点', async () => {
    const { edgeStore, history, ops, target } = boot()
    await addSourceNode(ops, target, BLOB('a'), { x: 0, y: 0 }, fakeTransform())
    const depth = history.undoDepth
    await addSourceNode(ops, target, BLOB('b'), { x: 0, y: 0 }, fakeTransform())
    expect(history.undoDepth).toBe(depth + 1)
    history.undo()
    // 撤回第二步 → 第一个素材（节点+边）一起消失
    const edges = edgeStore.getEdges()
    expect(edges).toHaveLength(1)
  })
})
