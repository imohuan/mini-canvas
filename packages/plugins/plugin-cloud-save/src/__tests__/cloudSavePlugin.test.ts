/**
 * 插件主体集成测试：用**真内核 + 真 Context + 真 HttpAdapter**，只把 fetch 换成
 * 一个内存版假服务端。这样能真实验证那条最容易做错的语义：
 *
 * "后装插件时，云端的数据必须能覆盖掉宿主已经恢复出来的本地那份" —— 否则插件就是
 * 只写不读的半残品（数据传上去了，刷新却看到老的）。
 *
 * 顺带锁住：首次上云（云端空 → 推本地上去）、资源搬运（dataURL → /uploads/...）、
 * 以及 config 域默认不上云。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  Context,
  EdgeStore,
  GraphDocument,
  History,
  MemoryStorageAdapter,
  NodeStore,
  SaveServiceImpl,
  Selection,
  GRAPH_EDGES_KEY,
  GRAPH_KEY,
} from '@mini-canvas/canvas-data'
import { cloudSavePlugin } from '../cloudSavePlugin'
import type { CloudSaveService } from '../cloudSavePlugin'

// 装配一律走 `ctx.plugin(mod, config)`：与真实宿主同一条路径
// （内核按 Config schema 校验 + 补默认，apply 收到的永远是全量 config）。

/**
 * 内存版 cloud-server：就实现插件用到的三个接口。
 * key 用 `type:key` 拼成 Map 的键，读写语义与真服务一致（含 404 语义）。
 */
function fakeCloud() {
  const kv = new Map<string, unknown>()
  const uploads = new Map<string, Uint8Array>()
  let uploadCount = 0
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://fake')
    // POST /api/files：把 body 当字节存下来，返回内容寻址 URL
    if (url.pathname === '/api/files') {
      uploadCount += 1
      const body = init?.body as Blob
      const bytes = new Uint8Array(await body.arrayBuffer())
      const id = `hash${uploadCount}.png`
      uploads.set(id, bytes)
      return json({ id, url: `/uploads/${id}`, size: bytes.byteLength, mime: 'image/png' })
    }
    // 批量读：GET /api/kv/:type/?values=1 → 该作用域下所有 key 的值（与真服务一致）
    const batch = /^\/api\/kv\/([^/]+)\/?$/.exec(url.pathname)
    if (batch && url.searchParams.get('values') === '1' && init?.method === undefined) {
      const prefix = `${decodeURIComponent(batch[1])}:`
      const values: Record<string, unknown> = {}
      for (const [k, v] of kv) {
        if (k.startsWith(prefix)) values[k.slice(prefix.length)] = v
      }
      return json({ ok: true, keys: Object.keys(values), values })
    }
    const m = /^\/api\/kv\/([^/]+)\/(.+)$/.exec(url.pathname)
    if (m) {
      const [, type, key] = m
      const mapKey = `${type}:${decodeURIComponent(key)}`
      if (init?.method === 'PUT') {
        kv.set(mapKey, JSON.parse(String(init.body)).value)
        return json({ ok: true })
      }
      if (init?.method === 'DELETE') {
        const had = kv.delete(mapKey)
        return json({ ok: true, removed: had })
      }
      if (!kv.has(mapKey)) return json({ ok: false, error: '未保存过' }, 404)
      return json({ value: kv.get(mapKey) })
    }
    return json({ ok: false }, 404)
  }) as typeof fetch
  return { impl, kv, uploads, stats: () => ({ uploads: uploads.size }) }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// 每个测试都要把全局 fetch 收干净：内核的 SaveService 有 0ms 防抖 flush，
// 上一个用例留下的定时器若在下一个用例里才跑，会拿新用例的 fetch 发出意外请求。
afterEach(() => vi.unstubAllGlobals())

/** 每次都注入同一个假服务端；返回"撤销"函数把 fetch 恢复原样 */
function useCloud(impl: typeof fetch): void {
  vi.stubGlobal('fetch', impl)
}

/** 等内核防抖 flush 落定（微任务 + 0ms 定时器） */
const settle = () => new Promise((r) => setTimeout(r, 5))

/**
 * 建一个"看起来像宿主"的 ctx：跟 createMiniCanvasHost 一样注入各服务，
 * 并且**先**从 localStorage（这里是内存 adapter）恢复出本地画布 —— 模拟真实启动顺序。
 */
async function bootWithLocal(localNodes: unknown[], localEdges: unknown[] = []) {
  const ctx = new Context()
  const save = new SaveServiceImpl(new MemoryStorageAdapter())
  // 本地存档（插件装上之前，宿主已经读出来并恢复过了）
  await save.get(GRAPH_KEY, 'canvas') // no-op，保持与宿主一致的调用形态
  ctx.inject('save', save)

  const nodeStore = new NodeStore()
  nodeStore.registerType({ type: 'image', label: '图', defaultSize: { w: 100, h: 100 } })
  ctx.inject('nodeStore', nodeStore)

  const edgeStore = new EdgeStore()
  ctx.inject('edgeStore', edgeStore)

  const selection = new Selection()
  ctx.inject('selection', selection)

  const history = new History({
    snapshot: () => ({
      nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())),
      edges: JSON.parse(JSON.stringify(edgeStore.getEdges())),
    }),
    restore: (g) => {
      const env = g as { nodes: never[]; edges: never[] }
      nodeStore.replaceAll(env.nodes ?? [])
      edgeStore.replaceAll(env.edges ?? [])
    },
  })
  ctx.inject('history', history)

  const graph = new GraphDocument(nodeStore, edgeStore, selection, history, (env) => {
    save.set(GRAPH_KEY, env.nodes, 'canvas')
    save.set(GRAPH_EDGES_KEY, env.edges, 'canvas')
  })
  ctx.inject('graph', graph)

  // 宿主恢复本地存档（真实顺序：这一步发生在插件装载之前）
  nodeStore.replaceAll(localNodes as never)
  edgeStore.replaceAll(localEdges as never)

  return { ctx, save, nodeStore, edgeStore, graph }
}

describe('cloud-save 安装后的云端优先恢复', () => {
  it('云端有数据 → 覆盖掉宿主已恢复的本地那份（这是"换机器能看到"的关键）', async () => {
    const fake = fakeCloud()
    // 云端：两个节点
    fake.kv.set('canvas:graph', [{ id: 'cloud-1', type: 'image', position: { x: 0, y: 0 }, data: {} }, { id: 'cloud-2', type: 'image', position: { x: 1, y: 1 }, data: {} }])
    fake.kv.set('canvas:graph-edges', [])

    useCloud(fake.impl)
    const { ctx, nodeStore } = await bootWithLocal([{ id: 'local-1', type: 'image', position: { x: 9, y: 9 }, data: {} }])
    ctx.plugin(cloudSavePlugin)
    await ctx.start()

    // 直接把 fetch 换成假的（真环境是浏览器全局 fetch）
    const svc = ctx.get<CloudSaveService>('cloud-save')
    const st = await svc.sync()

    expect(st.phase).toBe('restored')
    expect(st.restoredNodes).toBe(2)
    expect(nodeStore.getNodes().map((n) => n.id)).toEqual(['cloud-1', 'cloud-2'])
    await settle()
  })

  it('云端空（从未上云）→ 把本地这份推上去，数量记为 0', async () => {
    const fake = fakeCloud()
    useCloud(fake.impl)
    const { ctx, nodeStore } = await bootWithLocal([{ id: 'local-1', type: 'image', position: { x: 0, y: 0 }, data: {} }])
    ctx.plugin(cloudSavePlugin)
    await ctx.start()

    const st = await ctx.get<CloudSaveService>('cloud-save').sync()
    expect(st.phase).toBe('seeded')
    // 本地那份已经到云端了（首次上云）
    expect(fake.kv.get('canvas:graph')).toEqual(nodeStore.getNodes())
    await settle()
  })

  it('云端"保存过的空画布"（[]）→ 恢复成空，不重新长默认节点', async () => {
    const fake = fakeCloud()
    useCloud(fake.impl)
    fake.kv.set('canvas:graph', [])
    fake.kv.set('canvas:graph-edges', [])
    const { ctx, nodeStore } = await bootWithLocal([{ id: 'seeded', type: 'image', position: { x: 0, y: 0 }, data: {} }])
    ctx.plugin(cloudSavePlugin)
    await ctx.start()

    const st = await ctx.get<CloudSaveService>('cloud-save').sync()
    expect(st.phase).toBe('restored') // 不是 seeded！
    expect(nodeStore.getNodes()).toEqual([])
    await settle()
  })
})

describe('cloud-save 的资源搬运', () => {
  it('把节点里的大 dataURL 换成 /uploads/... 稳定地址', async () => {
    const fake = fakeCloud()
    useCloud(fake.impl)
    // 造一张够大的图（> 默认 32KB 门槛）
    const big = 'data:image/png;base64,' + btoa('x'.repeat(64 * 1024))
    const { ctx, nodeStore } = await bootWithLocal([
      { id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { imageUrl: big } },
    ])
    ctx.plugin(cloudSavePlugin)
    await ctx.start()

    const st = await ctx.get<CloudSaveService>('cloud-save').sync()
    expect(st.uploadedResources).toBe(1)
    expect(fake.stats().uploads).toBe(1)
    // 节点里现在是一个稳定 URL（刷新/换机器都取得到）
    expect(String(nodeStore.getNode('n1')?.data.imageUrl)).toBe('/uploads/hash1.png')
    await settle()
  })

  it('关掉搬运开关 → 原样留在画布里', async () => {
    const fake = fakeCloud()
    useCloud(fake.impl)
    const big = 'data:image/png;base64,' + btoa('y'.repeat(64 * 1024))
    const { ctx, nodeStore } = await bootWithLocal([
      { id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { imageUrl: big } },
    ])
    ctx.plugin(cloudSavePlugin, { cloudSaveUploadLocalImages: false })
    await ctx.start()

    const st = await ctx.get<CloudSaveService>('cloud-save').sync()
    expect(st.uploadedResources).toBe(0)
    expect(fake.stats().uploads).toBe(0)
    expect(String(nodeStore.getNode('n1')?.data.imageUrl)).toBe(big)
    await settle()
  })
})

describe('cloud-save 换后端的作用域', () => {
  it('默认只换 canvas + resource；config 留在本地（设置不该被多机器共享）', async () => {
    const fake = fakeCloud()
    useCloud(fake.impl)
    const { ctx, save } = await bootWithLocal([])
    ctx.plugin(cloudSavePlugin)
    await ctx.start()
    await ctx.get<CloudSaveService>('cloud-save').sync()

    // canvas 走网络
    await save.flush()
    save.set('theme', 'dark', 'config')
    await save.flush()
    // config 没上云（fake 服务端里没有 config:theme）
    expect(fake.kv.has('config:theme')).toBe(false)

    // 打开开关就应该上云
    const { ctx: ctx2, save: save2 } = await bootWithLocal([])
    ctx2.plugin(cloudSavePlugin, { cloudSaveIncludeConfig: true })
    await ctx2.start()
    save2.set('theme', 'dark', 'config')
    await save2.flush()
    expect(fake.kv.get('config:theme')).toBe('dark')
    await settle()
  })
})
