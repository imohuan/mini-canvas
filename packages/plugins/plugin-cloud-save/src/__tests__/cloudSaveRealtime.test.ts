/**
 * 实时同步的集成测试：装好插件之后，**AI 改云端 → 本地画布跟着变**。
 *
 * 这条链路是用户要的东西本身：
 *   让 AI（MCP）往画布加个节点 / 改个节点状态 → 不用刷新浏览器，画布上就能看到。
 *
 * 用真内核 + 真插件 + 假服务端（内存 KV + 假 EventSource），只把「网络」换掉。
 * 重点锁住三件事：
 * 1. 插件确实订阅了实时通道，并在卸载时退订；
 * 2. 云端来的新增/删除/修改会落到本地画布；
 * 3. **本地正在编辑的东西不被冲掉**（整包覆盖会犯的错）。
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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** 一个只实现插件用到的那几个接口的内存版 cloud-server */
function fakeCloud() {
  const kv = new Map<string, unknown>()
  /** 增量口被调用了几次（用来断言「确实走的是增量，不是整包」） */
  const deltaCalls: Array<{ kind: 'nodes' | 'edges'; body: any }> = []
  const nodesOf = (): any[] => (kv.get('canvas:graph') as any[]) ?? []
  const setNodes = (n: any[]): void => void kv.set('canvas:graph', n)
  const edgesOf = (): any[] => (kv.get('canvas:graph-edges') as any[]) ?? []
  const setEdges = (e: any[]): void => void kv.set('canvas:graph-edges', e)
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://fake')
    if (url.pathname === '/api/files') {
      return json({ id: 'hash1.png', url: '/uploads/hash1.png', size: 1, mime: 'image/png' })
    }
    // 增量写口：语义与真服务端一致（upsert + lenient），直接作用在内存 kv 上
    if (url.pathname === '/api/canvas/nodes' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      deltaCalls.push({ kind: 'nodes', body })
      let nodes = nodesOf()
      const del = new Set<string>(body.delete ?? [])
      nodes = nodes.filter((n) => !del.has(n.id))
      let edges = edgesOf().filter((e: any) => !del.has(e.source) && !del.has(e.target))
      for (const a of body.add ?? []) {
        const i = nodes.findIndex((n) => n.id === a.id)
        if (i >= 0) nodes[i] = { ...nodes[i], ...a }
        else nodes.push(a)
      }
      for (const u of body.update ?? []) {
        const i = nodes.findIndex((n) => n.id === u.id)
        if (i >= 0) nodes[i] = { ...nodes[i], ...u, data: { ...nodes[i].data, ...(u.data ?? {}) } }
      }
      setNodes(nodes)
      setEdges(edges)
      return json({ ok: true, added: [], deleted: [], updated: [], errors: [] })
    }
    if (url.pathname === '/api/canvas/edges' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      deltaCalls.push({ kind: 'edges', body })
      let edges = edgesOf()
      const del = new Set<string>(body.delete ?? [])
      edges = edges.filter((e: any) => !del.has(e.id))
      for (const a of body.add ?? []) {
        const i = edges.findIndex((e: any) => e.id === a.id)
        if (i >= 0) edges[i] = a
        else edges.push(a)
      }
      setEdges(edges)
      return json({ ok: true, added: [], deleted: [], updated: [], errors: [] })
    }
    const batch = /^\/api\/kv\/([^/]+)\/?$/.exec(url.pathname)
    if (batch && url.searchParams.get('values') === '1' && init?.method === undefined) {
      const prefix = decodeURIComponent(batch[1]) + ':'
      const values: Record<string, unknown> = {}
      for (const [k, v] of kv) if (k.startsWith(prefix)) values[k.slice(prefix.length)] = v
      return json({ ok: true, keys: Object.keys(values), values })
    }
    const m = /^\/api\/kv\/([^/]+)\/(.+)$/.exec(url.pathname)
    if (m) {
      const [, type, key] = m
      const mapKey = type + ':' + decodeURIComponent(key)
      if (init?.method === 'PUT') {
        kv.set(mapKey, JSON.parse(String(init.body)).value)
        return json({ ok: true })
      }
      if (init?.method === 'DELETE') return json({ ok: true, removed: kv.delete(mapKey) })
      if (!kv.has(mapKey)) return json({ ok: false, error: '未保存过' }, 404)
      return json({ value: kv.get(mapKey) })
    }
    return json({ ok: false }, 404)
  }) as typeof fetch
  return { impl, kv, deltaCalls }
}

/** 假 EventSource：记录订阅地址，允许测试手动推事件 */
function fakeEventSource() {
  const instances: Array<{ url: string; closed: boolean }> = []
  const emit = (data: unknown) => {
    for (const inst of instances) {
      if (inst.closed) continue
      const cb = (inst as { handlers?: Map<string, (e: { data: string }) => void> }).handlers?.get('message')
      if (cb) cb({ data: JSON.stringify(data) })
    }
  }
  class FakeEs {
    url: string
    closed = false
    onmessage: ((e: { data: string }) => void) | null = null
    onerror: ((e: unknown) => void) | null = null
    handlers = new Map<string, (e: { data: string }) => void>()
    constructor(url: string) {
      this.url = url
      instances.push(this)
    }
    addEventListener(type: string, cb: (e: { data: string }) => void) {
      this.handlers.set(type, cb)
    }
    close() {
      this.closed = true
    }
    dispatch(type: string, data: unknown) {
      const cb = this.handlers.get(type)
      cb?.({ data: JSON.stringify(data) })
    }
  }
  return { FakeEs, instances, emit }
}

afterEach(() => vi.unstubAllGlobals())

/**
 * 装配 config：给一个绝对服务地址。
 *
 * 真环境里这个字段留空（同源，cloud-server 托管界面），浏览器 fetch 接受相对路径；
 * 但 Node 的 fetch 不认相对 URL，测试里必须给绝对地址，否则插件发出的请求会在底层炸掉。
 */
const CFG = { cloudSaveBaseUrl: 'http://fake' }

/**
 * 等防抖窗口过去（插件里的合并窗口是 200ms 级）再断言。
 * 真实环境里这个窗口是「一次改动连发几个 key 的通知，只跑一轮同步」用的，测试里就是等一下。
 */
const settle = () => new Promise((r) => setTimeout(r, 350))

/** 装一个「像宿主」的 ctx（与 cloudSavePlugin.test.ts 同款，多返回 nodeStore/edgeStore） */
async function boot(local: { nodes: unknown[]; edges?: unknown[] } = { nodes: [] }) {
  const ctx = new Context()
  const save = new SaveServiceImpl(new MemoryStorageAdapter())
  ctx.inject('save', save)

  const nodeStore = new NodeStore()
  nodeStore.registerType({ type: 'image', label: '图', defaultSize: { w: 100, h: 100 } })
  nodeStore.registerType({ type: 'text', label: '文', defaultSize: { w: 100, h: 100 } })
  ctx.inject('nodeStore', nodeStore)

  const edgeStore = new EdgeStore()
  ctx.inject('edgeStore', edgeStore)
  ctx.inject('selection', new Selection())

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

  const graph = new GraphDocument(nodeStore, edgeStore, ctx.get('selection'), history, (env) => {
    save.set(GRAPH_KEY, env.nodes, 'canvas')
    save.set(GRAPH_EDGES_KEY, env.edges, 'canvas')
  })
  ctx.inject('graph', graph)

  nodeStore.replaceAll(local.nodes as never)
  edgeStore.replaceAll((local.edges ?? []) as never)
  return { ctx, save, nodeStore, edgeStore, graph }
}

const node = (id: string, x = 0, data: Record<string, unknown> = {}, type = 'text') => ({
  id,
  type,
  position: { x, y: 0 },
  data,
})

describe('cloud-save 实时同步', () => {
  it('装好后订阅实时通道，卸载后关掉连接', async () => {
    const fake = fakeCloud()
    const es = fakeEventSource()
    vi.stubGlobal('fetch', fake.impl)
    vi.stubGlobal('EventSource', es.FakeEs)

    const { ctx } = await boot({ nodes: [] })
    ctx.plugin(cloudSavePlugin, CFG)
    await ctx.start()
    await settle()

    expect(es.instances.length).toBe(1)
    expect(es.instances[0].url).toContain('/api/kv/events?type=canvas')
    expect(es.instances[0].closed).toBe(false)

    ctx.stop()
    expect(es.instances[0].closed).toBe(true)
  })

  it('AI 在云端加了节点 → 本地画布上出现（这条就是用户要的效果）', async () => {
    const fake = fakeCloud()
    const es = fakeEventSource()
    vi.stubGlobal('fetch', fake.impl)
    vi.stubGlobal('EventSource', es.FakeEs)

    fake.kv.set('canvas:graph', [node('a')])
    fake.kv.set('canvas:graph-edges', [])
    const { ctx, nodeStore } = await boot({ nodes: [node('a')] })
    ctx.plugin(cloudSavePlugin, CFG)
    await ctx.start()
    await settle()

    // AI 直接改了服务器上的数据（模拟 MCP 工具写盘）
    fake.kv.set('canvas:graph', [node('a'), node('ai-1', 500, { text: 'AI 写的' })])
    es.emit({ type: 'canvas', key: 'graph' })
    await settle()

    expect(nodeStore.getNodes().map((n) => n.id).sort()).toEqual(['a', 'ai-1'])
    expect(nodeStore.getNode('ai-1')?.data.text).toBe('AI 写的')
  })

  it('AI 删了节点 → 本地跟着删', async () => {
    const fake = fakeCloud()
    const es = fakeEventSource()
    vi.stubGlobal('fetch', fake.impl)
    vi.stubGlobal('EventSource', es.FakeEs)

    fake.kv.set('canvas:graph', [node('a'), node('b')])
    fake.kv.set('canvas:graph-edges', [])
    const { ctx, nodeStore } = await boot({ nodes: [node('a'), node('b')] })
    ctx.plugin(cloudSavePlugin, CFG)
    await ctx.start()
    await settle()

    fake.kv.set('canvas:graph', [node('b')])
    es.emit({ type: 'canvas', key: 'graph' })
    await settle()

    expect(nodeStore.getNodes().map((n) => n.id)).toEqual(['b'])
  })

  it('AI 改了节点状态（data）→ 本地节点跟着变', async () => {
    const fake = fakeCloud()
    const es = fakeEventSource()
    vi.stubGlobal('fetch', fake.impl)
    vi.stubGlobal('EventSource', es.FakeEs)

    fake.kv.set('canvas:graph', [node('a', 0, { runState: 'idle' })])
    fake.kv.set('canvas:graph-edges', [])
    const { ctx, nodeStore } = await boot({ nodes: [node('a', 0, { runState: 'idle' })] })
    ctx.plugin(cloudSavePlugin, CFG)
    await ctx.start()
    await settle()

    fake.kv.set('canvas:graph', [node('a', 0, { runState: 'running' })])
    es.emit({ type: 'canvas', key: 'graph' })
    await settle()

    expect(nodeStore.getNode('a')?.data.runState).toBe('running')
  })

  it('本地刚建、还没推上去的节点，不会被云端事件抹掉', async () => {
    const fake = fakeCloud()
    const es = fakeEventSource()
    vi.stubGlobal('fetch', fake.impl)
    vi.stubGlobal('EventSource', es.FakeEs)

    fake.kv.set('canvas:graph', [node('a')])
    fake.kv.set('canvas:graph-edges', [])
    const { ctx, nodeStore } = await boot({ nodes: [node('a')] })
    ctx.plugin(cloudSavePlugin, CFG)
    await ctx.start()
    await settle()

    // 用户在这个瞬间用手建了个节点（此刻云端还没有它）
    nodeStore.addNodes([{ type: 'text', position: { x: 900, y: 0 }, id: 'local-new' }])
    es.emit({ type: 'canvas', key: 'graph' })
    await settle()

    expect(nodeStore.getNodes().map((n) => n.id).sort()).toEqual(['a', 'local-new'])
  })

  it('关掉实时同步开关 → 不订阅（画布照常能保存）', async () => {
    const fake = fakeCloud()
    const es = fakeEventSource()
    vi.stubGlobal('fetch', fake.impl)
    vi.stubGlobal('EventSource', es.FakeEs)

    const { ctx, nodeStore } = await boot({ nodes: [node('a')] })
    ctx.plugin(cloudSavePlugin, { ...CFG, cloudSaveRealtime: false })
    await ctx.start()
    await settle()

    expect(es.instances.length).toBe(0)
    // 功能其余部分不受影响
    expect(nodeStore.getNodes().length).toBe(1)
  })
})

describe('cloud-save 保存走的是**增量**口，不是整包覆盖', () => {
  /**
   * 这条是补上一个真实缺口：原来的假服务端没实现增量口，于是保存请求全部落到整包兜底，
   * 「只提交增量」这个核心改动在集成层**完全没被验到**（那几行「增量接口不可用」的警告不是噪声，是必然）。
   */
  it('本地新建节点后保存 → 只发增量，且只带这次新增的那一个', async () => {
    const fake = fakeCloud()
    const es = fakeEventSource()
    vi.stubGlobal('fetch', fake.impl)
    vi.stubGlobal('EventSource', es.FakeEs)

    fake.kv.set('canvas:graph', [node('a')])
    fake.kv.set('canvas:graph-edges', [])
    const { ctx, graph } = await boot({ nodes: [node('a')] })
    ctx.plugin(cloudSavePlugin, CFG)
    await ctx.start()
    await settle()

    // 用户新建一个节点。走 graph（真实宿主就是这条：它经 commit 回调触发保存），
    // 直接写 nodeStore 不会触发保存 —— 那是绕过宿主、测不到东西的写法。
    graph.addNodes([{ type: 'text', position: { x: 500, y: 0 }, id: 'new-1' }])
    await settle()

    expect(fake.deltaCalls.length).toBeGreaterThan(0)
    // 只报这一个新增；不是把整张画布（含 a）整份推上去
    const last = fake.deltaCalls[fake.deltaCalls.length - 1]
    expect(last.body.add.map((n: any) => n.id)).toEqual(['new-1'])
    // 云端那份现在两个节点都在（增量被正确应用）
    expect((fake.kv.get('canvas:graph') as any[]).map((n) => n.id).sort()).toEqual(['a', 'new-1'])
  })

  it('没有变化时一个字节都不发（不发空增量）', async () => {
    const fake = fakeCloud()
    const es = fakeEventSource()
    vi.stubGlobal('fetch', fake.impl)
    vi.stubGlobal('EventSource', es.FakeEs)

    fake.kv.set('canvas:graph', [node('a')])
    fake.kv.set('canvas:graph-edges', [])
    const { ctx, save } = await boot({ nodes: [node('a')] })
    ctx.plugin(cloudSavePlugin, CFG)
    await ctx.start()
    await settle()
    const before = fake.deltaCalls.length

    // 手动触发一次保存（内容没变）
    await save.flush()
    await settle()
    expect(fake.deltaCalls.length).toBe(before)
  })
})
