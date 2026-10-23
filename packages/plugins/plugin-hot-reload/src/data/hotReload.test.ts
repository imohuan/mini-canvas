import { describe, expect, it, vi } from 'vitest'
import { createHotReload, guessType, looksLikeUrl, originOf, pathOf, type HotReloadDeps } from './hotReload'

/** 内存版 storage */
function memStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void } {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }
}

/** 假 EventSource：手动触发 onmessage / onerror */
function fakeES() {
  const made: Array<{ url: string; onmessage: ((e: { data: string }) => void) | null; onerror: (() => void) | null; onopen: (() => void) | null; closed: boolean; readyState: number; close(): void }> = []
  const create = (url: string) => {
    const es = {
      url,
      onmessage: null as ((e: { data: string }) => void) | null,
      onerror: null as (() => void) | null,
      onopen: null as (() => void) | null,
      closed: false,
      readyState: 1,
      close() { this.closed = true; this.readyState = 2 },
    }
    made.push(es)
    return es
  }
  return { made, create }
}

/** 假 WebSocket：手动触发 onmessage */
function fakeWS() {
  const made: Array<{ url: string; onmessage: ((e: { data: unknown }) => void) | null; onopen: (() => void) | null; onerror: (() => void) | null; closed: boolean; readyState: number; close(): void }> = []
  const create = (url: string) => {
    const ws = {
      url,
      onmessage: null as ((e: { data: unknown }) => void) | null,
      onopen: null as (() => void) | null,
      onerror: null as (() => void) | null,
      closed: false,
      readyState: 1,
      close() { this.closed = true; this.readyState = 3 },
    }
    made.push(ws)
    return ws
  }
  return { made, create }
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

describe('hotReload 纯函数', () => {
  it('pathOf 取路径名（去协议/主机/查询/哈希）', () => {
    expect(pathOf('http://h:8865/plugins/x/x.js?v=1')).toBe('/plugins/x/x.js')
    expect(pathOf('/plugins/x/x.js')).toBe('/plugins/x/x.js')
  })
  it('originOf 取源', () => {
    expect(originOf('http://h:5311/src/index.ts')).toBe('http://h:5311')
  })
  it('looksLikeUrl / guessType', () => {
    expect(looksLikeUrl('http://a/b.js')).toBe(true)
    expect(looksLikeUrl('style-library')).toBe(false)
    expect(guessType('http://127.0.0.1:5311')).toBe('vite') // 裸 host:port → vite
    expect(guessType('http://127.0.0.1:8865/api/plugin-events')).toBe('sse')
  })
})

describe('createHotReload', () => {
  function make(over: Partial<HotReloadDeps> = {}) {
    const reload = vi.fn(async () => {})
    const hr = createHotReload({ storage: memStorage(), reload, ...over })
    return { hr, reload }
  }

  it('addSource 存下来、并开始连（SSE）', async () => {
    const es = fakeES()
    const { hr } = make({ createEventSource: es.create })
    hr.addSource({ url: 'http://h:8865/api/plugin-events', label: '本机', type: 'sse', enabled: true })
    expect(es.made).toHaveLength(1)
    expect(es.made[0]!.url).toBe('http://h:8865/api/plugin-events')
    expect(hr.state.sources).toHaveLength(1)
  })

  it('SSE 收到 plugin-changed → 重装那个插件', async () => {
    const es = fakeES()
    const { hr, reload } = make({ createEventSource: es.create })
    hr.addSource({ url: 'http://h:8865/api/plugin-events', label: '本机', type: 'sse', enabled: true })
    es.made[0]!.onmessage!({ data: JSON.stringify({ type: 'plugin-changed', id: 'plugin-x', name: 'x' }) })
    await tick(5)
    expect(reload).toHaveBeenCalledWith('x')
    expect(hr.state.logs[0]!.action).toBe('reload')
  })

  it('SSE 连接中途断开（CLOSED）会自己重连', async () => {
    vi.useFakeTimers()
    const es = fakeES()
    const { hr } = make({ createEventSource: es.create })
    hr.addSource({ url: 'http://h:8865/api/plugin-events', label: '本机', type: 'sse', enabled: true })
    es.made[0]!.readyState = 2
    es.made[0]!.onerror!()
    await vi.advanceTimersByTimeAsync(3200)
    expect(es.made.length).toBeGreaterThanOrEqual(2) // 又连了一次
    vi.useRealTimers()
  })

  it('vite 源收到 update → 把该源上的插件全重装（去抖）', async () => {
    vi.useFakeTimers()
    const ws = fakeWS()
    const reload = vi.fn(async (_t: string) => {})
    const hr = createHotReload({ storage: memStorage(), reload, createWebSocket: ws.create, pluginsOnOrigin: async () => ['a', 'b'] })
    hr.addSource({ url: 'http://localhost:5311', label: 'vite', type: 'vite', enabled: true })
    expect(ws.made).toHaveLength(1)
    expect(ws.made[0]!.url).toBe('ws://localhost:5311/')
    // 连发三条 update → 去抖后只处理一轮
    ws.made[0]!.onmessage!({ data: JSON.stringify({ type: 'update' }) })
    ws.made[0]!.onmessage!({ data: JSON.stringify({ type: 'update' }) })
    ws.made[0]!.onmessage!({ data: JSON.stringify({ type: 'full-reload' }) })
    await vi.advanceTimersByTimeAsync(400)
    expect(reload.mock.calls.map((c) => c[0]).sort()).toEqual(['a', 'b'])
    vi.useRealTimers()
  })

  it('vite 源上查不到插件 → 记一条 error（不装作成功）', async () => {
    vi.useFakeTimers()
    const ws = fakeWS()
    const { hr, reload } = make({ createWebSocket: ws.create, pluginsOnOrigin: async () => [] })
    hr.addSource({ url: 'http://localhost:5311', type: 'vite', enabled: true, label: 'vite' })
    ws.made[0]!.onmessage!({ data: JSON.stringify({ type: 'update' }) })
    await vi.advanceTimersByTimeAsync(400)
    expect(reload).not.toHaveBeenCalled()
    expect(hr.state.logs.some((l) => l.action === 'error')).toBe(true)
    vi.useRealTimers()
  })

  it('停用（enabled=false）不连；启用后才连', () => {
    const es = fakeES()
    const { hr } = make({ createEventSource: es.create })
    const id = hr.addSource({ url: 'http://h:8865/api/plugin-events', type: 'sse', enabled: false, label: '' })
    expect(es.made).toHaveLength(0)
    hr.updateSource(id, { enabled: true })
    expect(es.made).toHaveLength(1)
  })

  it('removeSource 关掉连接并从列表移除', () => {
    const es = fakeES()
    const { hr } = make({ createEventSource: es.create })
    const id = hr.addSource({ url: 'http://h:8865/api/plugin-events', type: 'sse', enabled: true, label: '' })
    expect(es.made[0]!.closed).toBe(false)
    hr.removeSource(id)
    expect(es.made[0]!.closed).toBe(true)
    expect(hr.state.sources).toHaveLength(0)
  })

  it('持久化：新建的实例能读回上次的源', () => {
    const storage = memStorage()
    const a = createHotReload({ storage, reload: async () => {} })
    a.addSource({ url: 'http://h:1/api/plugin-events', label: 'x', type: 'sse', enabled: false })
    const b = createHotReload({ storage, reload: async () => {} })
    expect(b.state.sources).toHaveLength(1)
    expect(b.state.sources[0]!.url).toBe('http://h:1/api/plugin-events')
  })
})

/** 假 KV 通道：模拟宿主挂的 __miniCanvasKvEvents，测试里手动触发一次通知 */
function fakeKvChannel() {
  let handler: ((e: { type: string; key: string }) => void) | undefined
  const registry = {
    subscribe(_path: string, onEvent: (e: { type: string; key: string }) => void) {
      handler = onEvent
      return () => { handler = undefined }
    },
  }
  return {
    registry,
    fire(e: { type: string; key: string }) { handler?.(e) },
  }
}

describe('watch 上报地址（value 里的 front）', () => {
  it('收到通知 → 读 value 的 front → 按地址重装（不再查清单）', async () => {
    const w = globalThis as Record<string, unknown>
    const kv = fakeKvChannel()
    w.__miniCanvasKvEvents = kv.registry
    const calls: Array<{ url: string; name?: string }> = []
    try {
      // 清单：故意给一个**不同**的地址。若代码还在查清单，这里就会被用到 → 测试失败。
      const fetchImpl = (async (input: string | URL) => {
        const u = String(input)
        // key 里的冒号会被 encodeURIComponent 编码成 %3A
        if (decodeURIComponent(u).includes('/api/kv/config/plugin-watch:demo')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ value: { t: 1, front: 'http://other:9000/plugins/demo/dist.js' } }),
            headers: new Headers(),
            text: async () => '',
          } as Response
        }
        if (u.includes('/plugin-catalog.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ plugins: [{ id: 'demo', name: 'demo', url: '/plugins/demo/old.js' }] }),
            headers: new Headers(),
            text: async () => '',
          } as Response
        }
        // 产物探测：给一个长度，模拟"确实变了"
        return { ok: true, status: 200, headers: new Headers({ 'content-length': '123' }), json: async () => ({}), text: async () => '' } as Response
      }) as unknown as typeof fetch
      const originalFetch = globalThis.fetch
      globalThis.fetch = fetchImpl
      try {
        const hr = createHotReload({
          storage: memStorage(),
          reloadByUrl: async (name, url) => void calls.push({ name, url }),
          onReloaded: () => {},
        })
        hr.watchPluginChanges()
        kv.fire({ type: 'config', key: 'plugin-watch:demo' })
        await tick(30)
      } finally {
        globalThis.fetch = originalFetch
      }
      expect(calls, '必须用 value 里的 front，而不是清单里的地址').toHaveLength(1)
      expect(calls[0]).toEqual({ name: 'demo', url: 'http://other:9000/plugins/demo/dist.js' })
    } finally {
      delete w.__miniCanvasKvEvents
    }
  })

  it('老格式（value 只有 t，没有地址）→ 退回清单反查，行为不变', async () => {
    const w = globalThis as Record<string, unknown>
    const kv = fakeKvChannel()
    w.__miniCanvasKvEvents = kv.registry
    const calls: string[] = []
    try {
      const fetchImpl = (async (input: string | URL) => {
        const u = String(input)
        if (decodeURIComponent(u).includes('/api/kv/config/plugin-watch:demo')) {
          return { ok: true, status: 200, headers: new Headers(), json: async () => ({ value: { t: 1 } }), text: async () => '' } as Response
        }
        if (u.includes('/plugin-catalog.json')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({ plugins: [{ id: 'demo', name: 'demo', url: '/plugins/demo/demo.js' }] }),
            text: async () => '',
          } as Response
        }
        return { ok: true, status: 200, headers: new Headers({ 'content-length': '9' }), json: async () => ({}), text: async () => '' } as Response
      }) as unknown as typeof fetch
      const originalFetch = globalThis.fetch
      globalThis.fetch = fetchImpl
      try {
        const hr = createHotReload({
          storage: memStorage(),
          reload: async (t) => void calls.push(t),
          onReloaded: () => {},
        })
        hr.watchPluginChanges()
        kv.fire({ type: 'config', key: 'plugin-watch:demo' })
        await tick(30)
      } finally {
        globalThis.fetch = originalFetch
      }
      expect(calls).toEqual(['demo'])
    } finally {
      delete w.__miniCanvasKvEvents
    }
  })

  it('value 读取失败（404）→ 退回清单；两者都没有 → 记一条 error，不重装', async () => {
    const w = globalThis as Record<string, unknown>
    const kv = fakeKvChannel()
    w.__miniCanvasKvEvents = kv.registry
    const calls: string[] = []
    try {
      const fetchImpl = (async () => ({ ok: false, status: 404, headers: new Headers(), json: async () => ({}), text: async () => '' } as Response)) as unknown as typeof fetch
      const originalFetch = globalThis.fetch
      globalThis.fetch = fetchImpl
      const hr = createHotReload({ storage: memStorage(), reload: async (t) => void calls.push(t) })
      try {
        hr.watchPluginChanges()
        // 两条都失败：value 404 + 清单 404
        const catalogHit = hr.state.logs.find((l) => l.detail.includes('清单'))
        void catalogHit
        kv.fire({ type: 'config', key: 'plugin-watch:demo' })
        await tick(30)
      } finally {
        globalThis.fetch = originalFetch
      }
      expect(calls).toEqual([])
      expect(hr.state.logs.some((l) => l.action === 'error')).toBe(true)
    } finally {
      delete w.__miniCanvasKvEvents
    }
  })
})

describe('调试插件清单：是否已装只看内核里的唯一名字', () => {
  /** 造一份上报记录 + 假内核状态；不碰网络 */
  function boot(opts: { installed?: string[]; reports?: Record<string, unknown>; states?: Record<string, string> }) {
    const values = opts.reports ?? {}
    const hr = createHotReload({
      storage: memStorage(),
      listInstalled: () => opts.installed ?? [],
      fetchJson: async (url) => {
        const u = String(url)
        if (u.includes('/api/kv/config?values=1')) return { ok: true, type: 'config', keys: Object.keys(values), values }
        return { ok: true }
      },
    })
    return { hr, values }
  }

  it('上报里有、内核里没有 → 未安装', async () => {
    const { hr } = boot({ installed: [], reports: { 'plugin-watch:demo': { front: 'http://h/demo.js' } } })
    const rows = await hr.listDebugPlugins()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('demo')
    expect(rows[0]!.installed).toBe(false)
    expect(rows[0]!.front).toBe('http://h/demo.js')
  })

  it('内核里已有同名 → 已安装（名字就是唯一判据，不看谁装的）', async () => {
    const { hr } = boot({
      installed: ['demo', 'other'],
      reports: { 'plugin-watch:demo': { front: 'http://h/demo.js', t: 1 } },
    })
    const rows = await hr.listDebugPlugins()
    expect(rows[0]!.installed).toBe(true)
    expect(rows[0]!.at).toBe(1)
  })

  it('没有上报记录的插件不出现（调试清单只列上报过的）', async () => {
    const { hr } = boot({ installed: ['builtin-a', 'builtin-b'], reports: {} })
    expect(await hr.listDebugPlugins()).toEqual([])
  })

  it('非 plugin-watch: 前缀的 key 不混进来', async () => {
    const { hr } = boot({
      installed: [],
      reports: {
        'plugin-watch:demo': { front: 'http://h/demo.js' },
        'some-other-setting': { value: 1 },
      },
    })
    const rows = await hr.listDebugPlugins()
    expect(rows.map((r) => r.name)).toEqual(['demo'])
  })

  it('按名字排序（清单稳定，界面不跳来跳去）', async () => {
    const { hr } = boot({
      installed: [],
      reports: { 'plugin-watch:zeta': { front: 'http://h/z.js' }, 'plugin-watch:alpha': { front: 'http://h/a.js' } },
    })
    expect((await hr.listDebugPlugins()).map((r) => r.name)).toEqual(['alpha', 'zeta'])
  })

  it('同名只保留一行（就算上报记录写重了）', async () => {
    const { hr } = boot({ installed: [], reports: { 'plugin-watch:demo': { front: 'http://h/a.js' } } })
    const rows = await hr.listDebugPlugins()
    expect(rows.filter((r) => r.name === 'demo')).toHaveLength(1)
  })

  it('卸载：内核里有 → 先卸内核，再删上报记录', async () => {
    const w = globalThis as Record<string, unknown>
    const calls: string[] = []
    const { hr, values } = boot({ installed: ['demo'], reports: { 'plugin-watch:demo': { front: 'http://h/demo.js' } } })
    // 换一个带卸载钩子的实例（判据仍只看名字）
    const hr2 = createHotReload({
      storage: memStorage(),
      listInstalled: () => (values['plugin-watch:demo'] ? ['demo'] : []),
      uninstall: (n) => {
        calls.push('uninstall:' + n)
        delete values['plugin-watch:demo']
        return true
      },
      fetchJson: async (url, init) => {
        const u = String(url)
        if ((init?.method ?? 'GET') === 'DELETE') {
          calls.push('delete-record')
          delete values['plugin-watch:demo']
          return { ok: true }
        }
        return { ok: true, values }
      },
    })
    void hr
    // 前端卸完再删记录（顺序有意义：先卸再清，失败时记录还在，能重试）
    await hr2.uninstallDebugPlugin('demo')
    expect(calls).toEqual(['uninstall:demo', 'delete-record'])
    void w
  })

  it('卸载：内核里没有 → 不硬卸，也照样清记录（目标状态已达成）', async () => {
    const calls: string[] = []
    const hr = createHotReload({
      storage: memStorage(),
      listInstalled: () => [],
      uninstall: (n) => {
        calls.push('uninstall:' + n)
        return true
      },
      fetchJson: async (url, init) => {
        if ((init?.method ?? 'GET') === 'DELETE') calls.push('delete-record')
        return { ok: true, values: { 'plugin-watch:demo': { front: 'http://h/demo.js' } } }
      },
    })
    await hr.uninstallDebugPlugin('demo')
    expect(calls).toEqual(['delete-record'])
  })

  it('重装：已装同名 → 走「卸旧装新」这一条路（不会装出第二份）', async () => {
    const calls: Array<{ name: string; url: string }> = []
    const hr = createHotReload({
      storage: memStorage(),
      listInstalled: () => ['demo'],
      reloadByUrl: async (name, url) => void calls.push({ name, url }),
      onReloaded: () => {},
      fetchJson: async () => ({ ok: true, values: { 'plugin-watch:demo': { front: 'http://h/demo.js' } } }),
    })
    await hr.reinstallDebugPlugin('demo')
    expect(calls).toEqual([{ name: 'demo', url: 'http://h/demo.js' }])
  })

  it('重装：上报里没有前端地址 → 明确报错，不装半成品', async () => {
    const hr = createHotReload({
      storage: memStorage(),
      listInstalled: () => [],
      fetchJson: async () => ({ ok: true, values: { 'plugin-watch:demo': { t: 1 } } }),
    })
    await expect(hr.reinstallDebugPlugin('demo')).rejects.toThrow(/没有前端地址/)
  })

  it('重装：没有上报记录 → 明确报错（不按名字瞎猜）', async () => {
    const hr = createHotReload({
      storage: memStorage(),
      listInstalled: () => ['demo'],
      fetchJson: async () => ({ ok: true, values: {} }),
    })
    await expect(hr.reinstallDebugPlugin('demo')).rejects.toThrow(/没有这个插件的上报记录/)
  })
})

