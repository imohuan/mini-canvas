/**
 * 真裁剪链路（videoCropFlow）的契约测试。
 *
 * 用户口径（2026-10-30）：裁剪必须是**真的换了视频文件**，不是记个框靠 CSS 取景。
 * 这条链路的三个关键行为：
 *   1. 后台可用 → 节点写新地址 + 新尺寸，并且**清掉 cropRect**（取景映射不再需要）；
 *   2. 后台不可用（没装插件 / 源不是画布资源）→ 返回 null，调用方回落取景式；
 *   3. 后台报错 → 返回 null（回落），不把节点写坏。
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
  return { ctx, nodeStore }
}

const SRC = '/api/canvases/c1/resources/0123456789abcdef.mp4'

function addVideo(nodeStore: NodeStore, data: Record<string, unknown> = {}) {
  nodeStore.addNodes([{
    id: 'v1', type: 'video', position: { x: 0, y: 0 },
    data: { videoUrl: SRC, videoWidth: 480, videoHeight: 270, ...data },
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

  it('后台可用 → 写新文件地址与尺寸，并清掉 cropRect', async () => {
    const env = boot()
    const id = addVideo(env.nodeStore, { cropRect: { x: 0, y: 0, width: 10, height: 10 } })
    stubFetch({
      crop: () => new Response(JSON.stringify({
        ok: true, url: '/api/canvases/c1/resources/slot-v1.mp4', resourceId: 'c1/slot-v1.mp4', width: 200, height: 150,
      }), { status: 200 }),
    })
    const ok = await cropNodeWithBackend(env.ctx, createVideoOps(env.ctx), id, { x: 4, y: 6, width: 200, height: 150 })
    expect(ok).toBe(true)
    const data = env.nodeStore.getNode(id)!.data
    expect(data.videoUrl).toBe('/api/canvases/c1/resources/slot-v1.mp4')
    expect(data.videoWidth).toBe(200)
    expect(data.videoHeight).toBe(150)
    // 真裁剪后画面就是新文件本身，取景框必须消失
    expect('cropRect' in data).toBe(false)
  })

  it('后台没装插件（ping 失败）→ 返回 null（调用方回落取景式）', async () => {
    const env = boot()
    const id = addVideo(env.nodeStore)
    stubFetch({ ping: () => new Response('{}', { status: 404 }) })
    expect(await cropNodeWithBackend(env.ctx, createVideoOps(env.ctx), id, { x: 0, y: 0, width: 10, height: 10 })).toBeNull()
    // 回落模式下节点不该被改动
    expect(env.nodeStore.getNode(id)!.data.videoUrl).toBe(SRC)
  })

  it('后台报错 → 返回 null，不写坏节点', async () => {
    const env = boot()
    const id = addVideo(env.nodeStore)
    stubFetch({ crop: () => new Response(JSON.stringify({ ok: false, error: 'ffmpeg 退出码 1' }), { status: 500 }) })
    expect(await cropNodeWithBackend(env.ctx, createVideoOps(env.ctx), id, { x: 0, y: 0, width: 10, height: 10 })).toBeNull()
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

