/**
 * 真剪辑链路（videoClipFlow）的契约测试。
 *
 * 用户口径（2026-10-30）：时间切割也要真的换文件，并且确认后出新节点 + 连线。
 * 与裁剪的差别：画面尺寸不变，所以新节点抄源节点的宽高；不写 clipStart/clipEnd。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Context, NodeStore, EdgeStore, Selection, History, GraphDocument, createDocService } from '@mini-canvas/canvas-data'
import { clipNodeWithBackend } from '../videoClipFlow'
import { createVideoOps } from '../videoOps'
import { resetCropBackendProbe } from '../videoCropService'
import { isClipPending, setClipPending } from '../videoSession'

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
const CUT = '/api/canvases/c1/resources/ffeeddccbbaa9988.mp4'

function addVideo(nodeStore: NodeStore) {
  nodeStore.addNodes([{
    id: 'v1', type: 'video', position: { x: 0, y: 0 },
    data: { videoUrl: SRC, videoWidth: 480, videoHeight: 270, videoDuration: 10 },
  }])
  return 'v1'
}

/** 假 fetch：ping 可配、切段接口可配 */
function stubFetch(handlers: { ping?: () => Response; cut?: () => Response | Promise<Response> }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes('/ping')) return handlers.ping ? handlers.ping() : new Response('{}', { status: 200 })
    if (handlers.cut) return await handlers.cut()
    return new Response('{}', { status: 404 })
  }))
}

describe('videoClipFlow：真剪辑（时间切割）', () => {
  beforeEach(() => resetCropBackendProbe())
  afterEach(() => vi.unstubAllGlobals())

  it('后台可用 → 新建下游节点 + 连线，原视频不动，且不写剪辑区间', async () => {
    const env = boot()
    const id = addVideo(env.nodeStore)
    stubFetch({
      cut: () => new Response(JSON.stringify({ ok: true, url: CUT, resourceId: 'c1/ffeeddccbbaa9988.mp4', duration: 3.5 }), { status: 200 }),
    })
    expect(await clipNodeWithBackend(env.ctx, createVideoOps(env.ctx), id, 2, 5.5)).toBe(true)
    // 原节点保持不动（用户口径：切割出新节点 + 连线）
    expect(env.nodeStore.getNode(id)!.data.videoUrl).toBe(SRC)
    expect(env.nodeStore.getNode(id)!.data.clipStart).toBeUndefined()
    const created = env.nodeStore.getNodes().find((n) => n.id !== id && n.type === 'video')
    expect(created).toBeTruthy()
    expect(created!.data.videoUrl).toBe(CUT)
    expect(created!.data.videoDuration).toBe(3.5)
    // 切时间不改画面尺寸：宽高抄源节点
    expect(created!.data.videoWidth).toBe(480)
    expect(created!.data.videoHeight).toBe(270)
    // 新文件只剩这一段，再叠播放区间会二次裁剪
    expect(created!.data.clipStart).toBeUndefined()
    expect(created!.data.clipEnd).toBeUndefined()
    expect(env.edgeStore.getEdges()).toHaveLength(1)
    expect(env.edgeStore.getEdges()[0]).toMatchObject({ source: id, target: created!.id })
  })

  it('新节点名是「剪辑」，不与「裁剪」撞名', async () => {
    const env = boot()
    const id = addVideo(env.nodeStore)
    stubFetch({ cut: () => new Response(JSON.stringify({ ok: true, url: CUT, duration: 1 }), { status: 200 }) })
    await clipNodeWithBackend(env.ctx, createVideoOps(env.ctx), id, 0, 1)
    const created = env.nodeStore.getNodes().find((n) => n.id !== id && n.type === 'video')
    expect(created!.data.label).toBe('剪辑')
  })

  it('后台没装插件（ping 失败）→ 返回 null（调用方回落元数据式）', async () => {
    const env = boot()
    const id = addVideo(env.nodeStore)
    stubFetch({ ping: () => new Response('{}', { status: 404 }) })
    expect(await clipNodeWithBackend(env.ctx, createVideoOps(env.ctx), id, 0, 1)).toBeNull()
    expect(env.nodeStore.getNodes()).toHaveLength(1)
  })

  it('后台报错 → 返回 null，不建节点、不动原视频', async () => {
    const env = boot()
    const id = addVideo(env.nodeStore)
    stubFetch({ cut: () => new Response(JSON.stringify({ ok: false, error: 'ffmpeg 退出码 1' }), { status: 500 }) })
    expect(await clipNodeWithBackend(env.ctx, createVideoOps(env.ctx), id, 0, 1)).toBeNull()
    expect(env.nodeStore.getNodes()).toHaveLength(1)
    expect(env.nodeStore.getNode(id)!.data.videoUrl).toBe(SRC)
  })

  it('后台说 ok 但没给时长 → 返回 null（不建只有地址的坏节点）', async () => {
    const env = boot()
    const id = addVideo(env.nodeStore)
    stubFetch({ cut: () => new Response(JSON.stringify({ ok: true, url: CUT }), { status: 200 }) })
    expect(await clipNodeWithBackend(env.ctx, createVideoOps(env.ctx), id, 0, 1)).toBeNull()
    expect(env.nodeStore.getNodes()).toHaveLength(1)
  })

  it('「切段处理中」会话态可置位/复位', () => {
    expect(isClipPending('n')).toBe(false)
    setClipPending('n', true)
    expect(isClipPending('n')).toBe(true)
    setClipPending('n', false)
    expect(isClipPending('n')).toBe(false)
  })
})

