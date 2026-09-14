/**
 * imageOps —— 四个操作（上传 / 裁剪 / 旋转 / 下载）的行为契约。
 *
 * 用的是内核真件（NodeStore/GraphDocument/History/SaveServiceImpl），只把"浏览器图片能力"
 * 换成假实现 —— 这样验证的就是真实写回链路：走 graph → 进历史 → 可撤销 → 落盘 → 二次读回还在。
 */
import { describe, it, expect } from 'vitest'
import { NodeStore, EdgeStore, Selection, History, GraphDocument, SaveServiceImpl, MemoryStorageAdapter, type GraphEnvelope } from '@mini-canvas/canvas-data'
import { createImageOps, cropImage, downloadImageNode, rotateImage, uploadImage, type ImageTransform } from '../imageOps'
import type { Rect } from '../cropGeometry'

/** 假图片加工：不碰 FileReader/canvas，只回可控结果 */
function fakeTransform(overrides: Partial<ImageTransform> = {}): ImageTransform {
  return {
    fileToDataUrl: async () => 'data:image/png;base64,AAAA',
    readImageSize: async () => ({ width: 1000, height: 800 }),
    cropToDataUrl: async (_url, rect) => ({
      dataUrl: 'data:image/png;base64,CROPPED',
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    }),
    rotateToDataUrl: async () => ({ dataUrl: 'data:image/png;base64,ROTATED', width: 200, height: 100 }),
    downloadImage: () => true,
    pickImageFile: async () => null,
    ...overrides,
  }
}

/** 真内核最小装配：nodeStore/edgeStore/selection/history/graph(commit→save)/save */
function boot(adapter = new MemoryStorageAdapter()) {
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
  const save = new SaveServiceImpl(adapter)
  const graph = new GraphDocument(nodeStore, edgeStore, selection, history, (env) => {
    save.set('graph', env.nodes, 'canvas')
  })
  nodeStore.registerType({ type: 'image', label: '图片', defaultSize: { w: 320, h: 240 } })
  const ops = createImageOps({
    get: (name: string) => (name === 'nodeStore' ? nodeStore : name === 'graph' ? graph : undefined),
  } as never)
  const id = graph.createNode('image', { x: 0, y: 0 }, { imageUrl: '' })
  return { nodeStore, graph, history, save, adapter, ops, id }
}

describe('uploadImage：上传写回', () => {
  it('写 dataURL + 文件名 + 尺寸 + 字节数，全部进节点 data', async () => {
    const { nodeStore, ops, id } = boot()
    const file = new File(['x'], 'photo.png', { type: 'image/png' })
    const ok = await uploadImage(ops, id, file, fakeTransform())
    expect(ok).toBe(true)
    const data = nodeStore.getNode(id)!.data
    expect(data.imageUrl).toBe('data:image/png;base64,AAAA')
    expect(data.imageName).toBe('photo.png')
    expect(data.imageWidth).toBe(1000)
    expect(data.imageHeight).toBe(800)
    expect(typeof data.imageSize).toBe('number')
  })

  it('一次上传只记一条历史，undo 回到空图（走 graph 唯一写入口的直接证据）', async () => {
    const { nodeStore, history, ops, id } = boot()
    const depth = history.undoDepth
    await uploadImage(ops, id, new File(['x'], 'a.png', { type: 'image/png' }), fakeTransform())
    expect(history.undoDepth).toBe(depth + 1)
    history.undo()
    expect(nodeStore.getNode(id)!.data.imageUrl).toBe('')
  })

  it('落盘后二次读回仍在（刷新不丢的关键：存的是 dataURL 不是 objectURL）', async () => {
    const adapter = new MemoryStorageAdapter()
    const { ops, id, save } = boot(adapter)
    await uploadImage(ops, id, new File(['x'], 'b.png', { type: 'image/png' }), fakeTransform())
    await save.flush()
    const saved = await adapter.get<Array<{ data: Record<string, unknown> }>>('canvas:graph')
    expect(saved?.[0]?.data.imageUrl).toBe('data:image/png;base64,AAAA')
    expect(saved?.[0]?.data.imageName).toBe('b.png')
  })

  it('读文件失败 / 节点不存在 → 返回 false 且不写坏数据', async () => {
    const { nodeStore, ops, id } = boot()
    const failing = fakeTransform({ fileToDataUrl: async () => { throw new Error('boom') } })
    expect(await uploadImage(ops, id, new File(['x'], 'c.png'), failing)).toBe(false)
    expect(await uploadImage(ops, 'missing', new File(['x'], 'c.png'), fakeTransform())).toBe(false)
    expect(nodeStore.getNode(id)!.data.imageUrl).toBe('')
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
    const { nodeStore, graph, history, ops, id } = boot()
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
    void graph
  })

  it('量不到图片尺寸 → 只写地址，不猜卡片尺寸（保持原尺寸）', async () => {
    const { nodeStore, ops, id } = boot()
    await uploadImage(ops, id, new File(['x'], 'unmeasurable.png'), fakeTransform({ readImageSize: async () => null }))
    const node = nodeStore.getNode(id)!
    expect(node.data.imageUrl).toBe('data:image/png;base64,AAAA')
    expect(node.data.cardWidth).toBeUndefined()
    expect(node.data.imageWidth).toBeUndefined()
    expect(node.size).toBeUndefined()
  })

  it('封顶值可配：注入更小的上限 → 卡片算得更小', async () => {
    const { nodeStore, graph, id } = boot()
    // 走真实接线（createImageOps + 注入 settings 服务）：验证"读配置"这条链路本身，而不是只测纯函数
    const opsWithSettings = createImageOps({
      get: (name: string) =>
        name === 'nodeStore'
          ? nodeStore
          : name === 'graph'
            ? graph
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

describe('cropImage：裁剪原地替换', () => {
  const rect: Rect = { x: 10, y: 20, width: 300, height: 200 }

  it('原地替换 imageUrl 并同步新宽高（不新建节点）', async () => {
    const { nodeStore, ops, id } = boot()
    await uploadImage(ops, id, new File(['x'], 'photo.png', { type: 'image/png' }), fakeTransform())
    const countBefore = nodeStore.getNodes().length
    const ok = await cropImage(ops, id, rect, fakeTransform())
    expect(ok).toBe(true)
    expect(nodeStore.getNodes().length).toBe(countBefore)
    const data = nodeStore.getNode(id)!.data
    expect(data.imageUrl).toBe('data:image/png;base64,CROPPED')
    expect(data.imageWidth).toBe(300)
    expect(data.imageHeight).toBe(200)
    // 裁剪后原图字节数不再代表内容 → 必须清掉，否则状态栏显示过期大小
    expect(data.imageSize).toBeUndefined()
    expect(data.imageName).toBe('photo.png')
    // 裁剪后卡片尺寸也跟着新图（300×200 小于上限，原样）→ data 与 node.size 都有
    expect(data.cardWidth).toBe(300)
    expect(data.cardHeight).toBe(200)
    expect(nodeStore.getNode(id)!.size).toEqual({ w: 300, h: 200 })
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
      cropToDataUrl: async (_u, r) => {
        seen = r
        return { dataUrl: 'data:image/png;base64,C', width: r.width, height: r.height }
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
    expect(nodeStore.getNode(id)!.data.imageUrl).toBe('data:image/png;base64,AAAA')
    expect(nodeStore.getNode(id)!.data.cardWidth).toBe(375)
  })
})

describe('rotateImage / downloadImageNode', () => {
  it('旋转写回新图与交换后的宽高', async () => {
    const { nodeStore, ops, id } = boot()
    await uploadImage(ops, id, new File(['x'], 'p.png'), fakeTransform())
    expect(await rotateImage(ops, id, fakeTransform())).toBe(true)
    const data = nodeStore.getNode(id)!.data
    expect(data.imageUrl).toBe('data:image/png;base64,ROTATED')
    expect(data.imageWidth).toBe(200)
    expect(data.imageHeight).toBe(100)
  })

  it('下载用清洗后的文件名（脏后缀不会带进文件名）', () => {
    const { ops, id, nodeStore } = boot()
    nodeStore.updateNodeData(id, { imageUrl: 'data:image/png;base64,X', imageName: 'shot.png_crop' })
    let seenName = ''
    const ok = downloadImageNode(ops, id, fakeTransform({
      downloadImage: (_url, name) => {
        seenName = name
        return true
      },
    }))
    expect(ok).toBe(true)
    expect(seenName).toBe('shot.png')
  })

  it('没有图时不下载', () => {
    const { ops, id } = boot()
    expect(downloadImageNode(ops, id, fakeTransform())).toBe(false)
  })

  it('旋转后卡片宽高跟着互换后的比例重算', async () => {
    const { nodeStore, ops, id } = boot()
    await uploadImage(ops, id, new File(['x'], 'p.png'), fakeTransform())
    expect(nodeStore.getNode(id)!.data.cardWidth).toBe(375)
    // 旋转把 1000×800 变成 800×1000 → 宽不再封顶，改由高度封顶：ratio=0.3 → 240×300
    expect(await rotateImage(ops, id, fakeTransform({ rotateToDataUrl: async () => ({ dataUrl: 'data:image/png;base64,R', width: 800, height: 1000 }) }))).toBe(true)
    const node = nodeStore.getNode(id)!
    expect(node.data.cardWidth).toBe(240)
    expect(node.data.cardHeight).toBe(300)
    expect(node.size).toEqual({ w: 240, h: 300 })
  })
})
