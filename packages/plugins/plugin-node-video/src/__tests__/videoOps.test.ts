/**
 * videoOps 的行为契约（真实内核服务 + 假视频加工端口）。
 *
 * 为什么用真实内核：这些操作的要害在"写回"——必须走 graph 唯一写入口、必须**一次写完**
 * （一次操作 = 一条撤销记录）、必须真的落进 nodeStore。用假 store 就验不到这些。
 * 视频解码/截图是浏览器专属，故经 VideoTransform 端口注入假实现。
 */
import { describe, it, expect, beforeEach } from 'vitest'
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
import { CommandRegistry } from '@mini-canvas/kernel'
import {
  captureFrameNode,
  clipVideo,
  createVideoOps,
  cropVideo,
  displaySizeOf,
  videoTitleExtra,
  downloadVideoNode,
  loadVideo,
  readVideoSummary,
  resetClip,
  resetCrop,
  uploadVideo,
  type ServiceGetter,
  type VideoTransform,
} from '../videoOps'

/**
 * 空服务表：模拟"什么服务都没注入"的极简宿主。
 * 这里的断言是"读写都安全降级、不抛"，所以取什么服务都必须拿不到。
 */
const noServices: ServiceGetter = {
  get: (() => undefined) as ServiceGetter['get'],
  tryGet: (() => undefined) as ServiceGetter['tryGet'],
}

/**
 * 起一个带真实内核服务的 ctx（含 video/image 两个类型）。
 * @param opts.withResources 是否注入内存版资源库（默认注入）；false = 极简宿主（上传该回落 objectURL）
 */
function makeCtx(opts: { withResources?: boolean } = {}) {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  nodeStore.registerType({ type: 'video', label: '视频', defaultSize: { w: 480, h: 320 } })
  nodeStore.registerType({ type: 'image', label: '图片', defaultSize: { w: 320, h: 240 } })
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
  // 5c：数据那一格只有 doc 一个名字（四个老服务名已下线）
  ctx.inject('doc', createDocService({ nodeStore, edgeStore, graph, history }))
  ctx.inject('command', new CommandRegistry())
  ctx.inject('settings', { get: () => undefined })
  if (opts.withResources !== false) {
    // 资源库（内存版）：上传/截图要把字节存进来、并拿回可用地址 —— 与真实宿主同一条路
    const resourceBlobs = new Map<string, Blob>()
    let resSeq = 0
    ctx.inject('resources', {
      async put(blob: Blob) {
        resSeq += 1
        const ref = 'res-' + resSeq
        resourceBlobs.set(ref, blob)
        return ref
      },
      async resolve(ref: string) {
        return resourceBlobs.has(ref) ? 'blob:resolved-' + ref : undefined
      },
    })
  }
  return { ctx, nodeStore, edgeStore, history, graph }
}

/** 假视频端口：确定性，不碰 DOM */
function fakeTransform(over: Partial<VideoTransform> = {}): VideoTransform {
  return {
    readMeta: async () => ({ width: 1280, height: 720, duration: 12 }),
    captureFrame: async () => ({ dataUrl: 'data:image/png;base64,AAAA', width: 640, height: 360 }),
    download: () => true,
    pickFile: async () => null,
    objectUrl: () => 'blob:video-1',
    ...over,
  }
}

/** 建一个 video 节点并返回 id */
function makeNode(nodeStore: NodeStore, data: Record<string, unknown> = {}): string {
  nodeStore.addNodes([{ id: 'v1', type: 'video', position: { x: 100, y: 100 }, data }])
  return 'v1'
}

let env: ReturnType<typeof makeCtx>
beforeEach(() => {
  env = makeCtx()
})

describe('loadVideo：载入视频', () => {
  it('写 url + 名字 + 尺寸 + 时长 + 大小，并让卡片跟视频比例', async () => {
    const id = makeNode(env.nodeStore)
    const ops = createVideoOps(env.ctx)
    const ok = await loadVideo(ops, id, 'blob:v', { name: 'a.mp4', size: 2048 }, undefined, fakeTransform())
    expect(ok).toBe(true)
    const data = env.nodeStore.getNode(id)!.data
    expect(data.videoUrl).toBe('blob:v')
    expect(data.videoName).toBe('a.mp4')
    expect(data.videoSize).toBe(2048)
    expect(data.videoWidth).toBe(1280)
    expect(data.videoHeight).toBe(720)
    expect(data.videoDuration).toBe(12)
    // 1280×720 → 560×315（等比 + 封顶 560×360）
    expect(data.cardWidth).toBe(560)
    expect(data.cardHeight).toBe(315)
    expect(env.nodeStore.getNode(id)!.size).toEqual({ w: 560, h: 315 })
  })

  it('换视频会清掉旧的裁剪框与剪辑范围（它们属于上一段视频）', async () => {
    const id = makeNode(env.nodeStore, {
      videoUrl: 'blob:old',
      cropRect: { x: 10, y: 10, width: 100, height: 100 },
      clipStart: 2,
      clipEnd: 5,
    })
    const ops = createVideoOps(env.ctx)
    await loadVideo(ops, id, 'blob:new', undefined, undefined, fakeTransform())
    const data = env.nodeStore.getNode(id)!.data
    expect(data.cropRect).toBeUndefined()
    expect(data.clipStart).toBeUndefined()
    expect(data.clipEnd).toBeUndefined()
  })

  it('元数据读不出来 → 只写 url、不写尺寸（不猜一个数字）', async () => {
    const id = makeNode(env.nodeStore)
    const ops = createVideoOps(env.ctx)
    await loadVideo(ops, id, 'blob:v', undefined, undefined, fakeTransform({ readMeta: async () => null }))
    const data = env.nodeStore.getNode(id)!.data
    expect(data.videoUrl).toBe('blob:v')
    expect(data.videoWidth).toBeUndefined()
    expect(data.cardWidth).toBeUndefined()
  })

  it('整个载入只记一条撤销记录（一次撤销退干净）', async () => {
    const id = makeNode(env.nodeStore)
    const ops = createVideoOps(env.ctx)
    const before = env.history.canUndo()
    expect(before).toBe(false)
    await loadVideo(ops, id, 'blob:v', { name: 'a.mp4' }, undefined, fakeTransform())
    expect(env.history.canUndo()).toBe(true)
    env.history.undo()
    // 一次撤销把 url / 名字 / 尺寸全部退回 —— 不是"退半步"
    expect(env.nodeStore.getNode(id)!.data.videoUrl).toBeUndefined()
    expect(env.nodeStore.getNode(id)!.data.cardWidth).toBeUndefined()
  })

  it('节点不存在 / 地址为空 → false，且不写库', async () => {
    const ops = createVideoOps(env.ctx)
    expect(await loadVideo(ops, 'missing', 'blob:v', undefined, undefined, fakeTransform())).toBe(false)
    const id = makeNode(env.nodeStore)
    expect(await loadVideo(ops, id, '', undefined, undefined, fakeTransform())).toBe(false)
    expect(env.nodeStore.getNode(id)!.data.videoUrl).toBeUndefined()
  })
})

describe('uploadVideo：文件 → 资源库地址 → 载入', () => {
  it('有资源库时节点里写 resolve 出来的地址（不是 blob: 临时地址），文件信息一次写完', async () => {
    const id = makeNode(env.nodeStore)
    const ops = createVideoOps(env.ctx)
    const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' })
    const ok = await uploadVideo(ops, id, file, fakeTransform())
    expect(ok).toBe(true)
    const data = env.nodeStore.getNode(id)!.data
    // 资源库地址（本地是资源库重建的地址、云端是同源 URL）；**不是** transform.objectUrl 的 blob: 兜底
    expect(data.videoUrl).toBe('blob:resolved-res-1')
    expect(data.videoUrl).not.toBe('blob:video-1')
    expect(data.videoName).toBe('clip.mp4')
    expect(data.resourceId).toBe('res-1')
    // 一次撤销退回上传前（url 与 resourceId 一起退）
    env.history.undo()
    expect(env.nodeStore.getNode(id)!.data.videoUrl).toBeUndefined()
    expect(env.nodeStore.getNode(id)!.data.resourceId).toBeUndefined()
  })

  it('没有资源库服务（极简宿主）→ 回落 objectURL，不崩、不写 resourceId', async () => {
    const bare = makeCtx({ withResources: false })
    bare.nodeStore.addNodes([{ id: 'v1', type: 'video', position: { x: 0, y: 0 }, data: {} }])
    const ops = createVideoOps(bare.ctx)
    const ok = await uploadVideo(ops, 'v1', new File(['x'], 'a.mp4'), fakeTransform())
    expect(ok).toBe(true)
    const data = bare.nodeStore.getNode('v1')!.data
    expect(data.videoUrl).toBe('blob:video-1')
    expect(data.resourceId).toBeUndefined()
  })

  it('拿不到任何地址（无资源库且 objectURL 也拿不到）→ false，不写库', async () => {
    const bare = makeCtx({ withResources: false })
    bare.nodeStore.addNodes([{ id: 'v1', type: 'video', position: { x: 0, y: 0 }, data: {} }])
    const ops = createVideoOps(bare.ctx)
    const ok = await uploadVideo(ops, 'v1', new File(['x'], 'a.mp4'), fakeTransform({ objectUrl: () => '' }))
    expect(ok).toBe(false)
    expect(bare.nodeStore.getNode('v1')!.data.videoUrl).toBeUndefined()
  })
})

describe('cropVideo / resetCrop：取景式裁剪', () => {
  it('写进 cropRect，并让卡片跟裁框比例', () => {
    const id = makeNode(env.nodeStore, { videoUrl: 'blob:v', videoWidth: 1280, videoHeight: 720 })
    const ops = createVideoOps(env.ctx)
    expect(cropVideo(ops, id, { x: 100, y: 50, width: 640, height: 360 })).toBe(true)
    const data = env.nodeStore.getNode(id)!.data
    expect(data.cropRect).toEqual({ x: 100, y: 50, width: 640, height: 360 })
    // 640×360 → 560×315
    expect(data.cardWidth).toBe(560)
    expect(data.cardHeight).toBe(315)
  })

  it('裁框夹进原画面内（脏数据不该写进库）', () => {
    const id = makeNode(env.nodeStore, { videoUrl: 'blob:v', videoWidth: 1000, videoHeight: 500 })
    const ops = createVideoOps(env.ctx)
    cropVideo(ops, id, { x: 990, y: 490, width: 500, height: 500 })
    const rect = env.nodeStore.getNode(id)!.data.cropRect as { x: number; y: number; width: number; height: number }
    expect(rect.x).toBeLessThanOrEqual(999)
    expect(rect.y).toBeLessThanOrEqual(499)
    expect(rect.width).toBeLessThanOrEqual(1000)
    expect(rect.height).toBeLessThanOrEqual(500)
  })

  it('没有视频尺寸 → false（没画面可裁）', () => {
    const id = makeNode(env.nodeStore, { videoUrl: 'blob:v' })
    const ops = createVideoOps(env.ctx)
    expect(cropVideo(ops, id, { x: 0, y: 0, width: 100, height: 100 })).toBe(false)
  })

  it('resetCrop 清掉裁框并把卡片回到原始比例', () => {
    const id = makeNode(env.nodeStore, {
      videoUrl: 'blob:v',
      videoWidth: 1280,
      videoHeight: 720,
      cropRect: { x: 0, y: 0, width: 400, height: 400 },
      cardWidth: 400,
      cardHeight: 400,
    })
    const ops = createVideoOps(env.ctx)
    expect(resetCrop(ops, id)).toBe(true)
    const data = env.nodeStore.getNode(id)!.data
    expect(data.cropRect).toBeUndefined()
    expect(data.cardWidth).toBe(560)
    expect(data.cardHeight).toBe(315)
  })
})

describe('clipVideo / resetClip：剪辑范围', () => {
  it('写进 clipStart/clipEnd（经 clamp 收敛）', () => {
    const id = makeNode(env.nodeStore, { videoUrl: 'blob:v', videoDuration: 12 })
    const ops = createVideoOps(env.ctx)
    expect(clipVideo(ops, id, 3, 8)).toBe(true)
    expect(env.nodeStore.getNode(id)!.data.clipStart).toBe(3)
    expect(env.nodeStore.getNode(id)!.data.clipEnd).toBe(8)
  })

  it('越界范围被夹住（播放器不会拿到越界的 currentTime）', () => {
    const id = makeNode(env.nodeStore, { videoUrl: 'blob:v', videoDuration: 10 })
    const ops = createVideoOps(env.ctx)
    clipVideo(ops, id, -5, 99)
    expect(env.nodeStore.getNode(id)!.data.clipStart).toBe(0)
    expect(env.nodeStore.getNode(id)!.data.clipEnd).toBe(10)
  })

  it('没有视频 → false', () => {
    const id = makeNode(env.nodeStore)
    const ops = createVideoOps(env.ctx)
    expect(clipVideo(ops, id, 1, 2)).toBe(false)
  })

  it('resetClip 清掉范围（回到整段）', async () => {
    const id = makeNode(env.nodeStore, { videoUrl: 'blob:v', videoDuration: 12, clipStart: 2, clipEnd: 4 })
    const ops = createVideoOps(env.ctx)
    expect(resetClip(ops, id)).toBe(true)
    expect(env.nodeStore.getNode(id)!.data.clipStart).toBeUndefined()
    expect(env.nodeStore.getNode(id)!.data.clipEnd).toBeUndefined()
  })
})

describe('captureFrameNode：截图建图片节点', () => {
  it('在视频节点右侧建一个 image 节点，写入资源引用与真实像素尺寸（不写 base64）', async () => {
    const id = makeNode(env.nodeStore, { videoUrl: 'blob:v', videoName: 'clip.mp4', cardWidth: 560 })
    const ops = createVideoOps(env.ctx)
    const newId = await captureFrameNode(ops, id, 65, fakeTransform())
    expect(newId).toBeTruthy()
    const node = env.nodeStore.getNode(newId!)!
    expect(node.type).toBe('image')
    // 截图是**新的一张图**：必须走资源库，不能把 base64 写进节点（那会原样落进云端画布数据）
    expect(node.data.imageUrl).not.toMatch(/^data:/)
    expect(typeof node.data.resourceId).toBe('string')
    expect(node.data.imageName).toBe('clip_1-05.png')
    expect(node.data.imageWidth).toBe(640)
    expect(node.data.imageHeight).toBe(360)
  })

  it('新节点摆在视频节点右边（不叠在一起）', async () => {
    const id = makeNode(env.nodeStore, { videoUrl: 'blob:v', cardWidth: 560 })
    const ops = createVideoOps(env.ctx)
    const newId = await captureFrameNode(ops, id, 0, fakeTransform())
    const node = env.nodeStore.getNode(newId!)!
    expect(node.position.x).toBeGreaterThan(100)
    expect(node.position.y).toBe(100)
  })

  it('图片类型没注册（图片插件没装）→ null，不留孤儿节点', async () => {
    const { ctx, nodeStore } = makeCtx()
    nodeStore.unregisterType('image')
    nodeStore.addNodes([{ id: 'v1', type: 'video', position: { x: 0, y: 0 }, data: { videoUrl: 'blob:v' } }])
    const ops = createVideoOps(ctx)
    expect(await captureFrameNode(ops, 'v1', 0, fakeTransform())).toBeNull()
  })

  it('没有视频 → null（截不到帧，不建空节点）', async () => {
    const id = makeNode(env.nodeStore)
    const ops = createVideoOps(env.ctx)
    expect(await captureFrameNode(ops, id, 0, fakeTransform())).toBeNull()
  })

  it('取帧失败 → null（不建半成品节点）', async () => {
    const id = makeNode(env.nodeStore, { videoUrl: 'blob:v' })
    const ops = createVideoOps(env.ctx)
    expect(await captureFrameNode(ops, id, 0, fakeTransform({ captureFrame: async () => null }))).toBeNull()
    expect(env.nodeStore.getNodes()).toHaveLength(1)
  })
})

describe('downloadVideoNode', () => {
  it('把清洗过的文件名交给下载实现', () => {
    const id = makeNode(env.nodeStore, { videoUrl: 'blob:v', videoName: 'clip.mov' })
    const ops = createVideoOps(env.ctx)
    let seen = ''
    const ok = downloadVideoNode(
      ops,
      id,
      fakeTransform({
        download: (_u, name) => {
          seen = name
          return true
        },
      }),
    )
    expect(ok).toBe(true)
    expect(seen).toBe('clip.mp4')
  })

  it('没有视频 → false（不去下载空地址）', () => {
    const id = makeNode(env.nodeStore)
    expect(downloadVideoNode(createVideoOps(env.ctx), id, fakeTransform())).toBe(false)
  })
})

describe('displaySizeOf / readVideoSummary：展示读值', () => {
  it('裁过就按裁框算显示比例（卡片该跟裁出来的那块一致）', () => {
    expect(
      displaySizeOf({ videoWidth: 1280, videoHeight: 720, cropRect: { x: 0, y: 0, width: 400, height: 800 } }),
    ).toEqual({ width: 400, height: 800 })
  })

  it('没裁就按整幅画面', () => {
    expect(displaySizeOf({ videoWidth: 1280, videoHeight: 720 })).toEqual({ width: 1280, height: 720 })
  })

  it('readVideoSummary：名字缺失回落文案；尺寸/时长缺失按 0（状态栏据此不出那一段）', () => {
    expect(readVideoSummary({ videoName: 'a.mp4', videoWidth: 100, videoHeight: 50, videoDuration: 3 })).toEqual({
      name: 'a.mp4',
      width: 100,
      height: 50,
      duration: 3,
    })
    expect(readVideoSummary({}).name).toBe('未命名视频')
    expect(readVideoSummary(undefined).duration).toBe(0)
  })
})

describe('服务缺失时的安全降级（极简宿主 / 单测桩）', () => {
  it('没有 nodeStore/graph 时读写都不抛', async () => {
    const bare = createVideoOps(noServices)
    expect(bare.read('x')).toBeUndefined()
    expect(() => bare.write('x', {})).not.toThrow()
    expect(await loadVideo(bare, 'x', 'blob:v')).toBe(false)
    expect(cropVideo(bare, 'x', { x: 0, y: 0, width: 1, height: 1 })).toBe(false)
    expect(clipVideo(bare, 'x', 0, 1)).toBe(false)
    expect(downloadVideoNode(bare, 'x')).toBe(false)
  })

  it('settings 缺失时 fitLimits 回落 560×360', () => {
    const bare = createVideoOps(noServices)
    expect(bare.fitLimits?.()).toEqual({ maxWidth: 560, maxHeight: 360 })
  })

  it('没有资源库服务时 persistVideo/persistImage 返回 undefined（调用方各自兜底）', async () => {
    const bare = createVideoOps(noServices)
    expect(await bare.persistVideo?.(new Blob(['x']), 'a.mp4')).toBeUndefined()
    expect(await bare.persistImage?.(new Blob(['x']), 'a.png')).toBeUndefined()
  })

  it('资源库 put 抛错时 persistVideo 也返回 undefined（不把上传整条路炸掉）', async () => {
    const ctx = new Context()
    ctx.inject('resources', {
      async put() {
        throw new Error('后端不可用')
      },
      async resolve() {
        return 'blob:never'
      },
    })
    const ops = createVideoOps(ctx)
    expect(await ops.persistVideo?.(new Blob(['x']), 'a.mp4')).toBeUndefined()
  })
})
