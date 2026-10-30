/**
 * 真裁剪链路（videoCropFlow）的契约测试。
 *
 * 用户口径（2026-10-30）：裁剪必须是**真的换了视频文件**，不是记个框靠 CSS 取景。
 * 这条链路的三个关键行为：
 *   1. 后台可用 → 节点写新地址 + 新尺寸，并且**清掉 cropRect**（取景映射不再需要）；
 *   2. 后台不可用（没装插件 / 源不是画布资源）→ 占位节点标失败，返回 false，调用方回落取景式；
 *   3. 后台报错 → 占位节点标失败（用户口径：占位节点先出现，失败态写在占位节点上）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Context, NodeStore, EdgeStore, Selection, History, GraphDocument, createDocService } from '@mini-canvas/canvas-data'
import { cropNodeWithBackend } from '../videoCropFlow'
import { createVideoOps } from '../videoOps'
import { resetCropBackendProbe } from '../videoCropService'
import { setCropPending, isCropPending } from '../videoSession'

function boot() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  nodeStore.registerType({ type: 'video', label: '视频', defaultSize: { w: 480, h: 320 } })
  const edgeStore = new EdgeStore()
  const selection = new Selection()
  ctx.inject('selection', selection)
  const history = new History({
    snapshot: () => ({ nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())), edges: [] }),
    restore: (g: { nodes: unknown[] }) => nodeStore.replaceAll(g.nodes as never),
  })
  const graph = new GraphDocument(nodeStore, edgeStore, selection, history)
  ctx.inject('doc', createDocService({ nodeStore, edgeStore, graph, history }))
  ctx.inject('settings', { get: () => undefined })
  return { ctx, nodeStore, edgeStore }
}

const SRC = '/api/canvases/c1/resources/0123456789abcdef.mp4'

function addVideo(nodeStore: NodeStore, data: Record<string, unknown> = {}) {
  nodeStore.addNodes([{
    id: 'v1', type: 'video', position: { x: 0, y: 0 },
    data: { videoUrl: SRC, videoWidth: 480, videoHeight: 270, videoDuration: 10, ...data },
  }])
  return 'v1'
}

/** 假 fetch：ping 可配、裁剪接口可配 */
function stubFetch(handlers: { ping?: () => Response; crop?: () => Response | Promise<Response> }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes('/ping')) return handlers.ping ? handlers.ping() : new Response('{}', { status: 200 })
    if (handlers.crop) return await handlers.crop()
    return new Response('{}', { status: 404 })
  }))
}

describe('videoCropFlow：真裁剪', () => {
  beforeEach(() => resetCropBackendProbe())
  afterEach(() => vi.unstubAllGlobals())

  it('后台可用 → 新建下游节点 + 连线，原视频不动', async () => {
    const env = boot()
    const id = addVideo(env.nodeStore)
    stubFetch({
      crop: () => new Response(JSON.stringify({
        ok: true, url: '/api/canvases/c1/resources/aabbccddeeff0011.mp4', resourceId: 'c1/aabbccddeeff0011.mp4', width: 200, height: 150,
      }), { status: 200 }),
    })
    const ok = await cropNodeWithBackend(env.ctx, createVideoOps(env.ctx), id, { x: 4, y: 6, width: 200, height: 150 })
    expect(ok).toBe(true)
    // 原节点保持不动（用户口径 2026-10-30：裁剪出新节点 + 连线）
    expect(env.nodeStore.getNode(id)!.data.videoUrl).toBe(SRC)
    const created = env.nodeStore.getNodes().find((n) => n.id !== id && n.type === 'video')
    expect(created).toBeTruthy()
    expect(created!.data.videoUrl).toBe('/api/canvases/c1/resources/aabbccddeeff0011.mp4')
    expect(created!.data.videoWidth).toBe(200)
    expect(created!.data.videoHeight).toBe(150)
    // 裁画面不改时间轴：时长必须从源节点抄过来（否则底栏参考卡显示 0:00）
    expect(created!.data.videoDuration).toBe(10)
    // 原视频 → 新节点连了一条边
    expect(env.edgeStore.getEdges()).toHaveLength(1)
    expect(env.edgeStore.getEdges()[0]).toMatchObject({ source: id, target: created!.id })
  })

  it('后台没装插件（ping 失败）→ 返回 null、不建节点（调用方回落取景式）', async () => {
    const env = boot()
    const id = addVideo(env.nodeStore)
    stubFetch({ ping: () => new Response('{}', { status: 404 }) })
    expect(await cropNodeWithBackend(env.ctx, createVideoOps(env.ctx), id, { x: 0, y: 0, width: 10, height: 10 })).toBeNull()
    // 后台没有 ffmpeg 时不该先建一个注定失败的占位节点
    expect(env.nodeStore.getNodes()).toHaveLength(1)
    expect(env.edgeStore.getEdges()).toHaveLength(0)
    // 回落模式下节点不该被改动
    expect(env.nodeStore.getNode(id)!.data.videoUrl).toBe(SRC)
  })

  it('后台报错 → 占位节点标失败，原视频不动', async () => {
    const env = boot()
    const id = addVideo(env.nodeStore)
    stubFetch({ crop: () => new Response(JSON.stringify({ ok: false, error: 'ffmpeg 退出码 1' }), { status: 500 }) })
    expect(await cropNodeWithBackend(env.ctx, createVideoOps(env.ctx), id, { x: 0, y: 0, width: 10, height: 10 })).toBe(false)
    const pending = env.nodeStore.getNodes().find((n) => n.id !== id && n.type === 'video')
    expect((pending!.data.runState as { status: string }).status).toBe('error')
    expect(env.nodeStore.getNode(id)!.data.videoWidth).toBe(480)
  })

  it('「处理中」会话态可置位/复位（顶栏据此禁用按钮）', () => {
    expect(isCropPending('n')).toBe(false)
    setCropPending('n', true)
    expect(isCropPending('n')).toBe(true)
    setCropPending('n', false)
    expect(isCropPending('n')).toBe(false)
  })
})

