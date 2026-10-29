/**
 * imageOps —— 四个操作（上传 / 裁剪 / 旋转 / 下载）的行为契约。
 *
 * 用的是内核真件（NodeStore/GraphDocument/History/SaveServiceImpl）+ 真 ResourceStore，
 * 只把"浏览器图片能力"换成假实现 —— 这样验证的就是真实写回链路：
 * 走 graph → 进历史 → 可撤销 → 落盘 → 二次读回还在。
 *
 * 2026-10-01 变更：图片不再写 dataURL，改为**字节进资源库（浏览器 IndexedDB）+ 节点只留 resourceId**。
 * 所以断言从"data.imageUrl 是 dataURL"改成"data.resourceId 有值、imageUrl 是资源库给的地址"，
 * 并新增一条"字节真的进了资源持久化后端（刷新能按 id 取回）"的用例。
 */
import { describe, it, expect } from 'vitest'
import {
  NodeStore, EdgeStore, Selection, History, GraphDocument, SaveServiceImpl, MemoryStorageAdapter,
  ResourceStore, type GraphEnvelope,
} from '@mini-canvas/canvas-data'
import { createImageOps, cropImage, downloadImageNode, expandImageNode, nextCropLabel, nextExpandLabel, rotateImage, uploadImage, type ImageTransform } from '../imageOps'
import type { ExpandBitmapIO } from '../imageExpand'
import type { Rect } from '@mini-canvas/canvas-render'

const BLOB = (tag = 'x') => new Blob([tag], { type: 'image/png' })

/** 假图片加工：不碰 FileReader/canvas，只回可控结果 */
function fakeTransform(overrides: Partial<ImageTransform> = {}): ImageTransform {
  return {
    readImageSize: async () => ({ width: 1000, height: 800 }),
    cropToBlob: async (_url: string, rect: Rect) => ({
      blob: BLOB('cropped'),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    }),
    rotateToBlob: async () => ({ blob: BLOB('rotated'), width: 200, height: 100 }),
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
        return blobs.has(ref) ? 'blob:mem-' + ref : undefined
      },
      async removeResource(ref: string) { blobs.delete(ref) },
    },
  }
}

/**
 * 真内核最小装配：nodeStore/edgeStore/selection/history/graph(commit→save)/save + resources。
 * 资源库注入内存持久化后端，于是"字节有没有真的存下来"可被断言。
 */
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
  // 真资源库：objectURL 由假 backend 生成本会话地址；字节落内存持久化后端（模拟 IndexedDB）
  const { adapter, blobs } = memoryResourceAdapter()
  const resources = new ResourceStore(() => adapter, { revokeUrl() {} })
  nodeStore.registerType({ type: 'image', label: '图片', defaultSize: { w: 320, h: 240 }, nameTemplate: '图片 {{ID}}' })
  const ops = createImageOps({
    // 5c：数据读写走 doc；资源登记走 resources（新）
    get: (name: string) => (name === 'doc' ? graph : name === 'resources' ? resources : undefined),
  } as never)
  const id = graph.createNode('image', { x: 0, y: 0 }, { imageUrl: '' })
  return { nodeStore, graph, history, save, resources, blobs, ops, id }
}

describe('uploadImage：上传写回（字节进资源库，不写 base64）', () => {
  it('写 resourceId + 资源库地址 + 文件名 + 尺寸 + 字节数，全部进节点 data', async () => {
    const { nodeStore, ops, id } = boot()
    const file = new File(['x'], 'photo.png', { type: 'image/png' })
    const ok = await uploadImage(ops, id, file, fakeTransform())
    expect(ok).toBe(true)
    const data = nodeStore.getNode(id)!.data
    expect(typeof data.resourceId).toBe('string')
    expect(String(data.imageUrl)).toMatch(/^blob:/)
    expect(data.imageUrl).not.toMatch(/^data:/)
    expect(data.imageName).toBe('photo.png')
    expect(data.imageWidth).toBe(1000)
    expect(data.imageHeight).toBe(800)
    expect(typeof data.imageSize).toBe('number')
  })

  it('图片字节真的落进资源后端（刷新后能按 resourceId 重建地址）', async () => {
    const { nodeStore, ops, id, blobs } = boot()
    await uploadImage(ops, id, new File(['x'], 'photo.png', { type: 'image/png' }), fakeTransform())
    const resourceId = String(nodeStore.getNode(id)!.data.resourceId)
    expect(blobs.has(resourceId)).toBe(true)
    expect(blobs.get(resourceId)!.size).toBeGreaterThan(0)
  })

  it('一次上传只记一条历史，undo 回到空图（走 graph 唯一写入口的直接证据）', async () => {
    const { nodeStore, history, ops, id } = boot()
    const depth = history.undoDepth
    await uploadImage(ops, id, new File(['x'], 'a.png', { type: 'image/png' }), fakeTransform())
    expect(history.undoDepth).toBe(depth + 1)
    history.undo()
    expect(nodeStore.getNode(id)!.data.imageUrl).toBe('')
    expect(nodeStore.getNode(id)!.data.resourceId).toBeUndefined()
  })

  it('派生尺寸走 measured 写入：落盘但不占撤销栈（打开页面不再凭空多一条历史）', () => {
    const { nodeStore, history, ops, id } = boot()
    const depth = history.undoDepth
    // 模拟图片加载后补 naturalWidth/naturalHeight + 卡片尺寸：这是测量，不是用户动作。
    ops.writeMeasured(id, { ...nodeStore.getNode(id)!.data, imageWidth: 320, imageHeight: 240 }, { w: 320, h: 240 })
    expect(history.undoDepth).toBe(depth)
    const node = nodeStore.getNode(id)!
    expect(node.data.imageWidth).toBe(320)
    expect(node.data.cardWidth).toBe(320)
    expect(node.size).toEqual({ w: 320, h: 240 })
  })

  it('普通 write 仍然进撤销栈（用户动作不能被误伤）', () => {
    const { nodeStore, history, ops, id } = boot()
    const depth = history.undoDepth
    ops.write(id, { ...nodeStore.getNode(id)!.data, imageName: 'user.jpg' })
    expect(history.undoDepth).toBe(depth + 1)
  })

  it('读文件失败 / 节点不存在 / 没有资源库 → 返回 false 且不写坏数据', async () => {
    const { nodeStore, ops, id, graph } = boot()
    expect(await uploadImage(ops, 'missing', new File(['x'], 'c.png'), fakeTransform())).toBe(false)
    expect(nodeStore.getNode(id)!.data.imageUrl).toBe('')
    // 没有 resources 服务的极简宿主：宁可失败，也不退回 base64
    const opsNoRes = createImageOps({ get: (n: string) => (n === 'doc' ? graph : undefined) } as never)
    expect(await uploadImage(opsNoRes, id, new File(['x'], 'c.png'), fakeTransform())).toBe(false)
  })

  it('卡片宽高跟图片走（1000×800 由高度封顶 → 375×300）：data 与 node.size 一次写全', async () => {
    const { nodeStore, ops, id } = boot()
    await uploadImage(ops, id, new File(['x'], 'photo.png'), fakeTransform())
    const node = nodeStore.getNode(id)!
    // 1000×800 / 上限 420×300：高是瓶颈（300/800=0.375 < 420/1000=0.42）→ 375×300
    expect(node.data.cardWidth).toBe(375)
    expect(node.data.cardHeight).toBe(300)
    // 内核正式尺寸字段也要有（不能只写 data，否则布局回退链断在中间）
    expect(node.size).toEqual({ w: 375, h: 300 })
  })

  it('换图 = 一条撤销记录（尺寸与 data 同一次提交，不会退半步）', async () => {
    const { nodeStore, history, ops, id } = boot()
    await uploadImage(ops, id, new File(['x'], 'a.png'), fakeTransform())
    const depth = history.undoDepth
    // 再换一张（尺寸也跟着变）
    await uploadImage(ops, id, new File(['x'], 'b.png'), fakeTransform({ readImageSize: async () => ({ width: 300, height: 300 }) }))
    expect(history.undoDepth).toBe(depth + 1)
    expect(nodeStore.getNode(id)!.data.cardWidth).toBe(300)

    history.undo()
    const reverted = nodeStore.getNode(id)!
    expect(reverted.data.imageWidth).toBe(1000)
    expect(reverted.data.cardWidth).toBe(375)
    expect(reverted.size).toEqual({ w: 375, h: 300 })
  })

  it('量不到图片尺寸 → 只写地址与 resourceId，不猜卡片尺寸（保持原尺寸）', async () => {
    const { nodeStore, ops, id } = boot()
    await uploadImage(ops, id, new File(['x'], 'unmeasurable.png'), fakeTransform({ readImageSize: async () => null }))
    const node = nodeStore.getNode(id)!
    expect(typeof node.data.resourceId).toBe('string')
    expect(node.data.cardWidth).toBeUndefined()
    expect(node.data.imageWidth).toBeUndefined()
    expect(node.size).toBeUndefined()
  })

  it('封顶值可配：注入更小的上限 → 卡片算得更小', async () => {
    const { nodeStore, graph, id } = boot()
    // 走真实接线（createImageOps + 注入 settings 服务）：验证"读配置"这条链路本身，而不是只测纯函数
    const { adapter } = memoryResourceAdapter()
    const resources = new ResourceStore(() => adapter, { revokeUrl() {} })
    const opsWithSettings = createImageOps({
      get: (name: string) =>
        name === 'doc'
          ? graph
          : name === 'resources'
            ? resources
            : name === 'settings'
              ? { get: (k: string) => (k === 'imageFitMaxWidth' || k === 'imageFitMaxHeight' ? 200 : undefined) }
              : undefined,
    } as never)
    await uploadImage(opsWithSettings, id, new File(['x'], 'p.png'), fakeTransform())
    // 上限 200×200、图 1000×800 → ratio=0.2 → 200×160
    expect(nodeStore.getNode(id)!.data.cardWidth).toBe(200)
    expect(nodeStore.getNode(id)!.data.cardHeight).toBe(160)
  })
})

describe('cropImage：裁剪 = 新建下游图片节点并连边（原图不动）', () => {
  const rect: Rect = { x: 10, y: 20, width: 300, height: 200 }

  it('原图不动，新节点装裁剪结果（新 resourceId/宽高/名字），并有一条边连到原图节点', async () => {
    const { nodeStore, graph, ops, id, blobs } = boot()
    await uploadImage(ops, id, new File(['x'], 'photo.png', { type: 'image/png' }), fakeTransform())
    const beforeId = String(nodeStore.getNode(id)!.data.resourceId)
    const ok = await cropImage(ops, id, rect, fakeTransform())
    expect(ok).toBe(true)
    // 原图节点不动
    expect(nodeStore.getNode(id)!.data.resourceId).toBe(beforeId)
    // 多了一个新节点，且装的是裁剪结果
    expect(nodeStore.getNodes().length).toBe(2)
    const created = nodeStore.getNodes().find((n) => n.id !== id)!
    const data = created.data
    expect(typeof data.resourceId).toBe('string')
    expect(data.resourceId).not.toBe(beforeId)
    expect(blobs.has(String(data.resourceId))).toBe(true)
    expect(data.imageWidth).toBe(300)
    expect(data.imageHeight).toBe(200)
    expect(data.imageSize).toBeUndefined()
    expect(data.imageName).toBe('裁剪')
    expect(data.label).toBe('裁剪')
   // 连边：原图 → 裁剪结果
   const edges = graph.getEdges()
   expect(edges).toHaveLength(1)
    // 方向：原图是上游（source），裁剪结果是下游（target）
    expect(edges[0].source).toBe(id)
    expect(edges[0].target).toBe(created.id)
    // 定位：原图右边缘（x + 卡片宽 375）+ 100 间隔，同一水平线
    expect(created.position.x).toBe(0 + 375 + 100)
    expect(created.position.y).toBe(0)
  })

  it('名字累加：第二次裁剪叫「裁剪 2」，且第二个节点不会被误当成第一个', async () => {
    const { nodeStore, ops, id } = boot()
    await uploadImage(ops, id, new File(['x'], 'photo.png', { type: 'image/png' }), fakeTransform())
  await cropImage(ops, id, rect, fakeTransform())
  await cropImage(ops, id, rect, fakeTransform())
  // 直接走 nextCropLabel：若画布上已有「裁剪」，下一个必须带号
   const existing = nodeStore.getNodes().map((n: { type: string; data?: Record<string, unknown> }) => ({ type: n.type, data: n.data as Record<string, unknown> | undefined }))
   const next = nextCropLabel(existing)
   expect(next).toBe('裁剪 3')
  const labels = nodeStore.getNodes().map((n: { data?: Record<string, unknown> }) => n.data?.label)
    expect(labels).toContain('裁剪')
    expect(labels).toContain('裁剪 2')
  })

  it('nextCropLabel：扫已有名字取下一个号（含裸「裁剪」占 1 号）', () => {
    const nodes = (type: string, labels: string[]) => labels.map((label) => ({ type, data: { label } }))
    expect(nextCropLabel([])).toBe('裁剪')
    expect(nextCropLabel(nodes('image', ['图片 1']))).toBe('裁剪')
    expect(nextCropLabel(nodes('image', ['裁剪']))).toBe('裁剪 2')
    expect(nextCropLabel(nodes('image', ['裁剪', '裁剪 2', '裁剪 5']))).toBe('裁剪 6')
    expect(nextCropLabel(nodes('image', ['裁剪 3']))).toBe('裁剪 4')
    // 文本节点的「裁剪 9」不该占号（名字空间按类型隔离）
    expect(nextCropLabel(nodes('text', ['裁剪 9']))).toBe('裁剪')
  })

  it('无可裁图片 / 空矩形 → false，不动数据', async () => {
    const { nodeStore, ops, id } = boot()
    expect(await cropImage(ops, id, rect, fakeTransform())).toBe(false)
    expect(await cropImage(ops, id, { x: 0, y: 0, width: 0, height: 0 }, fakeTransform())).toBe(false)
    expect(nodeStore.getNode(id)!.data.imageUrl).toBe('')
  })

  it('传给加工层的矩形已整数化（四舍五入）', async () => {
    const { ops, id } = boot()
    await uploadImage(ops, id, new File(['x'], 'p.png'), fakeTransform())
    let seen: Rect | null = null
    await cropImage(ops, id, { x: 10.6, y: 20.4, width: 100.5, height: 50.5 }, fakeTransform({
      cropToBlob: async (_u: string, r: Rect) => {
        seen = r
        return { blob: BLOB('c'), width: r.width, height: r.height }
      },
    }))
    // 边取整后相减：round(10.6+100.5)=111 → 宽 111-11=100
    expect(seen).toEqual({ x: 11, y: 20, width: 100, height: 51 })
  })

  it('裁剪 = 一条撤销记录（新图 + 新尺寸一次写完）', async () => {
    const { nodeStore, history, ops, id } = boot()
    await uploadImage(ops, id, new File(['x'], 'photo.png'), fakeTransform())
    const depth = history.undoDepth
    await cropImage(ops, id, rect, fakeTransform())
    expect(history.undoDepth).toBe(depth + 1)
    history.undo()
    expect(nodeStore.getNode(id)!.data.cardWidth).toBe(375)
  })
})

describe('expandImageNode：扩展 = 新建下游图片节点并连边（原图不动，与裁剪同一套模式）', () => {
  /** 假位图端口：不碰真实 canvas，直接回可控结果 */
  const fakeExpandIO = (overrides: Partial<ExpandBitmapIO> = {}): ExpandBitmapIO => ({
    load: async () => ({ source: {} as CanvasImageSource, width: 1000, height: 800 }),
    paint: async (bounds: { width: number; height: number }) => BLOB('expanded:' + bounds.width + 'x' + bounds.height),
    release: () => {},
    ...overrides,
  })

  it('原图不动，新节点装扩展结果（新 resourceId/宽高/名字），并有一条边连到原图节点', async () => {
    const { nodeStore, graph, ops, id, blobs } = boot()
    await uploadImage(ops, id, new File(['x'], 'photo.png', { type: 'image/png' }), fakeTransform())
    const beforeId = String(nodeStore.getNode(id)!.data.resourceId)
    // 框往左上各扩 100：原图 1000×800 → 结果 1200×1000
    const ok = await expandImageNode(ops, id, { x: -100, y: -100, width: 1200, height: 1000 }, fakeExpandIO())
    expect(ok).toBe(true)
    // 原图节点不动
    expect(nodeStore.getNode(id)!.data.resourceId).toBe(beforeId)
    // 多了一个新节点，且装的是扩展结果
    expect(nodeStore.getNodes().length).toBe(2)
    const created = nodeStore.getNodes().find((n) => n.id !== id)!
    const data = created.data
    expect(typeof data.resourceId).toBe('string')
    expect(data.resourceId).not.toBe(beforeId)
    expect(blobs.has(String(data.resourceId))).toBe(true)
    expect(data.imageWidth).toBe(1200)
    expect(data.imageHeight).toBe(1000)
    expect(data.imageName).toBe('扩展')
    expect(data.label).toBe('扩展')
    // 连边：原图 → 扩展结果（原图是上游）
    const edges = graph.getEdges()
    expect(edges).toHaveLength(1)
    expect(edges[0].source).toBe(id)
    expect(edges[0].target).toBe(created.id)
    // 定位：原图右边缘 + 100 间隔，同一水平线
    expect(created.position.x).toBe(0 + 375 + 100)
    expect(created.position.y).toBe(0)
  })

  it('名字累加：第二次扩展叫「扩展 2」，且与「裁剪」名字空间互不干扰', async () => {
    const { nodeStore, ops, id } = boot()
    await uploadImage(ops, id, new File(['x'], 'photo.png', { type: 'image/png' }), fakeTransform())
    const expandRect = { x: -100, y: -100, width: 1200, height: 1000 }
    await expandImageNode(ops, id, expandRect, fakeExpandIO())
    await expandImageNode(ops, id, expandRect, fakeExpandIO())
    const labels = nodeStore.getNodes().map((n: { data?: Record<string, unknown> }) => n.data?.label)
    expect(labels).toContain('扩展')
    expect(labels).toContain('扩展 2')
    // 名字空间隔离：扩展的扫描不认「裁剪 N」，裁剪的扫描不认「扩展 N」
    const existing = nodeStore.getNodes().map((n: { type: string; data?: Record<string, unknown> }) => ({ type: n.type, data: n.data as Record<string, unknown> | undefined }))
    expect(nextExpandLabel(existing)).toBe('扩展 3')
    expect(nextCropLabel(existing)).toBe('裁剪')
  })

  it('框没扩出去（仍包着原图）→ 不建节点不连边', async () => {
    const { nodeStore, graph, ops, id } = boot()
    await uploadImage(ops, id, new File(['x'], 'photo.png', { type: 'image/png' }), fakeTransform())
    const ok = await expandImageNode(ops, id, { x: 0, y: 0, width: 1000, height: 800 }, fakeExpandIO())
    expect(ok).toBe(false)
    expect(nodeStore.getNodes().length).toBe(1)
    expect(graph.getEdges()).toHaveLength(0)
  })

  it('扩展 = 一条撤销记录（新节点 + 连边一次写完）', async () => {
    const { nodeStore, history, ops, id } = boot()
    await uploadImage(ops, id, new File(['x'], 'photo.png', { type: 'image/png' }), fakeTransform())
    const depth = history.undoDepth
    await expandImageNode(ops, id, { x: -100, y: -100, width: 1200, height: 1000 }, fakeExpandIO())
    expect(history.undoDepth).toBe(depth + 1)
    history.undo()
    // 撤销后：回到只有原图一个节点的状态
    expect(nodeStore.getNodes().length).toBe(1)
    expect(nodeStore.getNode(id)!.data.imageWidth).toBe(1000)
  })
})

describe('rotateImage / downloadImageNode', () => {
  it('旋转写回新图与交换后的宽高', async () => {
    const { nodeStore, ops, id } = boot()
    await uploadImage(ops, id, new File(['x'], 'p.png'), fakeTransform())
    expect(await rotateImage(ops, id, fakeTransform())).toBe(true)
    const data = nodeStore.getNode(id)!.data
    expect(typeof data.resourceId).toBe('string')
    expect(data.imageWidth).toBe(200)
    expect(data.imageHeight).toBe(100)
  })

  it('下载用清洗后的文件名（脏后缀不会带进文件名）', async () => {
    const { ops, id, nodeStore } = boot()
    nodeStore.updateNodeData(id, { imageUrl: 'blob:mock-1', imageName: 'shot.png_crop' })
    let seenName = ''
    const ok = await downloadImageNode(ops, id, fakeTransform({
      downloadImage: (_url: string, name: string) => {
        seenName = name
        return true
      },
    }))
    expect(ok).toBe(true)
    expect(seenName).toBe('shot.png')
  })

  it('没有图时不下载', async () => {
    const { ops, id } = boot()
    expect(await downloadImageNode(ops, id, fakeTransform())).toBe(false)
  })

  it('旋转后卡片宽高跟着互换后的比例重算', async () => {
    const { nodeStore, ops, id } = boot()
    await uploadImage(ops, id, new File(['x'], 'p.png'), fakeTransform())
    expect(nodeStore.getNode(id)!.data.cardWidth).toBe(375)
    // 旋转把 1000×800 变成 800×1000 → 宽不再封顶，改由高度封顶：ratio=0.3 → 240×300
    expect(await rotateImage(ops, id, fakeTransform({ rotateToBlob: async () => ({ blob: BLOB('r'), width: 800, height: 1000 }) }))).toBe(true)
    const node = nodeStore.getNode(id)!
    expect(node.data.cardWidth).toBe(240)
    expect(node.data.cardHeight).toBe(300)
    expect(node.size).toEqual({ w: 240, h: 300 })
  })
})
