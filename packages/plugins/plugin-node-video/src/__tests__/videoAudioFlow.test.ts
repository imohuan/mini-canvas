/**
 * 视频 → 音频（videoAudioFlow）的契约测试。
 *
 * 用户口径 2026-10-30：视频节点上要有「转为音频」的按钮，点了之后**先出新节点 + 连线**，
 * 节点上显示后台进度，处理完才显示音频内容 —— 与裁剪 / 剪辑同一条顺序。
 *
 * 三条要锁住的行为：
 *   1. 后台可用 → 新建的是 **audio 节点**（不是 video），连线从视频指向它，回填 resourceId；
 *   2. 后台还在跑 → 节点已经出现，带 running 态、且还没写音频地址；
 *   3. 后台报错（例如无声视频）→ 原因写在那个音频节点上，不建第二个节点。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Context, NodeStore, EdgeStore, Selection, History, GraphDocument, createDocService } from '@mini-canvas/canvas-data'
import { videoToAudio } from '../videoAudioFlow'
import { resetCropBackendProbe } from '../videoCropService'

const SRC = '/api/canvases/c1/resources/0123456789abcdef.mp4'
const MP3 = '/api/canvases/c1/resources/ffeeddccbbaa9988.mp3'

function boot() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  nodeStore.registerType({ type: 'video', label: '视频', defaultSize: { w: 480, h: 320 } })
  // 音频类型必须已注册：本功能产出的是 audio 节点，没装音频插件时明确失败（不建孤儿节点）
  nodeStore.registerType({ type: 'audio', label: '音频', defaultSize: { w: 320, h: 120 } })
  const edgeStore = new EdgeStore()
  const selection = new Selection()
  ctx.inject('selection', selection)
  const history = new History({
    snapshot: () => ({ nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())), edges: JSON.parse(JSON.stringify(edgeStore.getEdges())) }),
    restore: (g: { nodes: unknown[]; edges: unknown[] }) => {
      nodeStore.replaceAll(g.nodes as never)
      edgeStore.replaceAll(g.edges as never)
    },
  })
  const graph = new GraphDocument(nodeStore, edgeStore, selection, history)
  ctx.inject('doc', createDocService({ nodeStore, edgeStore, graph, history }))
  ctx.inject('settings', { get: () => undefined })
  return { ctx, nodeStore, edgeStore, selection }
}

function addVideo(nodeStore: NodeStore) {
  nodeStore.addNodes([{
    id: 'v1', type: 'video', position: { x: 0, y: 0 },
    data: { videoUrl: SRC, videoName: '旅行.mp4', videoWidth: 480, videoHeight: 270, videoDuration: 10 },
  }])
  return 'v1'
}

function stubFetch(handlers: { ping?: () => Response; audio?: () => Response | Promise<Response> }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes('/ping')) return handlers.ping ? handlers.ping() : new Response('{}', { status: 200 })
    if (u.includes('/api/video-audio')) {
      if (handlers.audio) return await handlers.audio()
      return new Response('{}', { status: 404 })
    }
    return new Response('{}', { status: 404 })
  }))
}

describe('视频转音频：先建音频节点 + 连线，再回填', () => {
  beforeEach(() => resetCropBackendProbe())
  afterEach(() => vi.unstubAllGlobals())

  it('后台可用 → 新建 audio 节点 + 连线，原视频不动，节点写 resourceId 与时长', async () => {
    const env = boot()
    const id = addVideo(env.nodeStore)
    stubFetch({
      audio: () => new Response(JSON.stringify({
        ok: true, url: MP3, resourceId: 'c1/ffeeddccbbaa9988.mp3', duration: 9.8,
      }), { status: 200 }),
    })
    expect(await videoToAudio(env.ctx, id)).toBe(true)
    // 原视频不动
    expect(env.nodeStore.getNode(id)!.data.videoUrl).toBe(SRC)
    const created = env.nodeStore.getNodes().find((n) => n.id !== id)
    expect(created!.type).toBe('audio')
    expect(created!.data.resourceId).toBe('c1/ffeeddccbbaa9988.mp3')
    expect(created!.data.audioUrl).toBe(MP3)
    expect(created!.data.audioDuration).toBe(9.8)
    expect(created!.data.audioName).toBe('旅行.mp3')
    expect((created!.data.runState as { status: string }).status).toBe('done')
    // 视频 → 音频 一条连线
    expect(env.edgeStore.getEdges()).toHaveLength(1)
    expect(env.edgeStore.getEdges()[0]).toMatchObject({ source: id, target: created!.id })
  })

  it('后台还在跑：音频节点已经出现并带 running 态，此时还没有音频地址', async () => {
    const env = boot()
    const id = addVideo(env.nodeStore)
    let release: (() => void) | null = null
    const gate = new Promise<void>((r) => { release = r })
    stubFetch({
      audio: async () => {
        await gate
        return new Response(JSON.stringify({ ok: true, url: MP3, resourceId: 'c1/ffeeddccbbaa9988.mp3', duration: 9.8 }), { status: 200 })
      },
    })
    const running = videoToAudio(env.ctx, id)
    await new Promise((r) => setTimeout(r, 0))
    const pending = env.nodeStore.getNodes().find((n) => n.id !== id)
    expect(pending!.type).toBe('audio')
    expect(pending!.data.resourceId).toBeUndefined()
    expect((pending!.data.runState as { status: string }).status).toBe('running')
    expect((pending!.data.runState as { message?: string }).message).toContain('音轨')
    // 新节点被选中（进度覆盖层只在单选时渲染）
    expect([...env.selection.ids]).toEqual([pending!.id])
    release!()
    expect(await running).toBe(true)
    const done = env.nodeStore.getNode(pending!.id)!
    expect(done.data.audioUrl).toBe(MP3)
    expect((done.data.runState as { status: string }).status).toBe('done')
  })

  it('后台报错（例如没有音轨）→ 原因写在音频节点上，不建第二个节点', async () => {
    const env = boot()
    const id = addVideo(env.nodeStore)
    stubFetch({
      audio: () => new Response(JSON.stringify({ ok: false, error: '这段视频没有音轨，转不出音频' }), { status: 400 }),
    })
    expect(await videoToAudio(env.ctx, id)).toBe(false)
    const nodes = env.nodeStore.getNodes().filter((n) => n.id !== id)
    expect(nodes).toHaveLength(1)
    expect((nodes[0]!.data.runState as { status: string }).status).toBe('error')
    expect((nodes[0]!.data.runState as { message?: string }).message).toBe('这段视频没有音轨，转不出音频')
  })

  it('后台没装插件（ping 失败）→ null，且不建任何节点', async () => {
    const env = boot()
    const id = addVideo(env.nodeStore)
    stubFetch({ ping: () => new Response('{}', { status: 404 }) })
    // 探针失败时不会发请求；这里直接验行为：返回 null + 画布不变
    expect(await videoToAudio(env.ctx, id)).toBe(null)
    expect(env.nodeStore.getNodes()).toHaveLength(1)
    expect(env.edgeStore.getEdges()).toHaveLength(0)
  })

  it('音频节点类型没装 → null（不建没人渲染的孤儿节点）', async () => {
    const env = boot()
    const id = addVideo(env.nodeStore)
    // 模拟宿主只装了视频插件
    env.nodeStore.types.delete('audio')
    stubFetch({ audio: () => new Response(JSON.stringify({ ok: true, url: MP3, duration: 1 }), { status: 200 }) })
    expect(await videoToAudio(env.ctx, id)).toBe(null)
    expect(env.nodeStore.getNodes()).toHaveLength(1)
  })
})
