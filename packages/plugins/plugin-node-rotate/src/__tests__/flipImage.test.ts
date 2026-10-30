import { describe, expect, it } from 'vitest'
import { cardSizePatch, defaultFlipIO, flipImageNode, readFitLimits, type FlipBitmapIO } from '../flipImage'
import { Context } from '@mini-canvas/canvas-data'
import {
  EdgeStore, GraphDocument, History, MemoryStorageAdapter, NodeStore, ResourceStore,
  SaveServiceImpl, Selection, createDocService,
} from '@mini-canvas/canvas-data'

/** 造一个假位图读写口：不碰 canvas，宽度/高度按调用记录返回 */
function fakeIO(): FlipBitmapIO & { painted: Array<{ width: number; height: number; axis: string }> } {
  const painted: Array<{ width: number; height: number; axis: string }> = []
  return {
    painted,
    load: async () => ({ source: { fake: 1 }, width: 640, height: 480 }),
    paint: async (width, height, axis) => {
      painted.push({ width, height, axis })
      return new Blob(['flipped'], { type: 'image/png' })
    },
    release: () => {},
  }
}

/** 内存版资源后端（等价 IndexedDB 适配器的最小面） */
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
        return blobs.has(ref) ? 'blob:mem-' + ref : undefined
      },
      async removeResource(ref: string) { blobs.delete(ref) },
    },
  }
}

/** 真内核最小装配：doc(graph) + resources（settings 需要时在用例里注入） */
function boot() {
  const nodeStore = new NodeStore()
  const edgeStore = new EdgeStore()
  const selection = new Selection()
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
  const save = new SaveServiceImpl(new MemoryStorageAdapter())
  const graph = new GraphDocument(nodeStore, edgeStore, selection, history, (env) => {
    save.set('graph', env.nodes, 'canvas')
  })
  nodeStore.registerType({ type: 'image', label: '图片', defaultSize: { w: 320, h: 240 } })
  const { adapter, blobs } = memoryResourceAdapter()
  const resources = new ResourceStore(() => adapter, { revokeUrl() {} })
  const ctx = new Context()
  ctx.inject('doc', createDocService({ nodeStore, edgeStore, graph, history }))
  ctx.inject('resources', resources)
  return { ctx, nodeStore, history, blobs, id: graph.createNode('image', { x: 0, y: 0 }, { imageUrl: 'blob:src' }) }
}

describe('cardSizePatch（等比 + 封顶，与图片插件同一套数学）', () => {
  it('640×480 最长边压到 420 → 420×315', () => {
    expect(cardSizePatch(640, 480, { minShortSide: 120, maxLongSide: 420 })).toEqual({ w: 420, h: 315 })
  })

  it('小图放大到最短边 120：200×100 → 240×120', () => {
    expect(cardSizePatch(200, 100, { minShortSide: 120, maxLongSide: 420 })).toEqual({ w: 240, h: 120 })
  })

  it('非法尺寸（0 / 负数）→ undefined（不动卡片尺寸）', () => {
    expect(cardSizePatch(0, 100, { minShortSide: 120, maxLongSide: 420 })).toBeUndefined()
    expect(cardSizePatch(-5, 100, { minShortSide: 120, maxLongSide: 420 })).toBeUndefined()
  })
})

describe('readFitLimits', () => {
  it('读设置服务的图片最短边 / 最长边键（overrides 缝）；读不到用兜底值', () => {
    const { ctx } = boot()
    expect(
      readFitLimits(ctx, { get: (k: string) => (k === 'imageCardMinShortSide' ? 90 : k === 'imageCardMaxLongSide' ? 200 : undefined) }),
    ).toEqual({ minShortSide: 90, maxLongSide: 200 })
    // 不传 overrides：读真内核 settings（裸 store 里这些 key 未声明 → undefined → 兜底值）
    expect(readFitLimits(ctx)).toEqual({ minShortSide: 120, maxLongSide: 420 })
  })
})

describe('flipImageNode（真内核：doc + resources + 一次撤销）', () => {
  it('水平翻转：新字节进资源库、data/尺寸一次写完、一条撤销记录', async () => {
    const { ctx, nodeStore, history, blobs, id } = boot()
    const io = fakeIO()
    const depth = history.undoDepth
    expect(await flipImageNode(ctx, id, 'horizontal', io)).toBe(true)
    // 重绘调用按轴发生、宽高不换
    expect(io.painted).toEqual([{ width: 640, height: 480, axis: 'horizontal' }])
    // 写回：新 resourceId、显示地址、像素尺寸、卡片尺寸按上限重算（420×315）
    const data = nodeStore.getNode(id)!.data
    expect(typeof data.resourceId).toBe('string')
    expect(blobs.has(String(data.resourceId))).toBe(true)
    expect(String(data.imageUrl)).toMatch(/^blob:mem-/)
    expect(data.imageWidth).toBe(640)
    expect(data.imageHeight).toBe(480)
    expect(nodeStore.getNode(id)!.size).toEqual({ w: 420, h: 315 })
    // 一次写完 = 一条撤销记录
    expect(history.undoDepth).toBe(depth + 1)
  })

  it('垂直翻转走同一个写回（axis 记录为 vertical）', async () => {
    const { ctx, nodeStore, id } = boot()
    const io = fakeIO()
    expect(await flipImageNode(ctx, id, 'vertical', io)).toBe(true)
    expect(io.painted[0]?.axis).toBe('vertical')
    expect(typeof nodeStore.getNode(id)!.data.resourceId).toBe('string')
  })

  it('没有图（两个来源字段都空）→ false 且不写任何数据', async () => {
    const { ctx, nodeStore, id } = boot()
    // updateNode 的 data 是浅合并：显式 undefined 会写进对象，但 readImageSourceFields
    // 只认 typeof === 'string'，undefined 与空串在"有没有图"的判读上等价（都算没图）。
    nodeStore.updateNodeData(id, { imageUrl: '', resourceId: undefined })
    const io = fakeIO()
    expect(await flipImageNode(ctx, id, 'horizontal', io)).toBe(false)
    expect(io.painted).toEqual([])
    expect(nodeStore.getNode(id)!.data.resourceId).toBeUndefined()
  })

  it('资源库缺失（极简宿主）→ false，重绘可以发生但不写节点', async () => {
    const nodeStore = new NodeStore()
    const edgeStore = new EdgeStore()
    const selection = new Selection()
    const history = new History({
      snapshot: () => ({ nodes: [], edges: [] }),
      restore: () => {},
    })
    const graph = new GraphDocument(nodeStore, edgeStore, selection, history)
    nodeStore.registerType({ type: 'image', label: '图片', defaultSize: { w: 320, h: 240 } })
    const ctx = new Context()
    ctx.inject('doc', createDocService({ nodeStore, edgeStore, graph, history }))
    const id = graph.createNode('image', { x: 0, y: 0 }, { imageUrl: 'blob:src' })
    const io = fakeIO()
    expect(await flipImageNode(ctx, id, 'horizontal', io)).toBe(false)
    expect(nodeStore.getNode(id)!.data.resourceId).toBeUndefined()
  })
})

describe('defaultFlipIO（生产实现：node 环境安全返回 null，不抛）', () => {
  it('load 在非浏览器环境返回 null', async () => {
    expect(await defaultFlipIO.load('blob:x')).toBeNull()
  })

  it('paint 在非浏览器环境返回 null', async () => {
    expect(await defaultFlipIO.paint(100, 80, 'horizontal', {})).toBeNull()
  })
})
