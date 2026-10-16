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

describe('syncPluginSources —— 插件声明源自动登记/摘除（用户口径：服务起自动加，服务停自动摘）', () => {
  function scanOf(entries: Array<{ plugin: string; sse: string }>) {
    return async () => entries.map((e) => ({ plugin: e.plugin, sse: e.sse, label: '插件声明 · ' + e.plugin }))
  }

  it('声明里有 → 自动登记（来源标记 = AUTO_SOURCE_PREFIX）', async () => {
    const reload = vi.fn(async () => {})
    const { hr } = { hr: createHotReload({ storage: memStorage(), reload, scanPluginSources: scanOf([{ plugin: 'demo', sse: 'http://localhost:5333/sse' }]) }) }
    await hr.syncPluginSources()
    const auto = hr.state.sources.filter((s) => s.label.startsWith('插件声明'))
    expect(auto).toHaveLength(1)
    expect(auto[0]!.url).toBe('http://localhost:5333/sse')
    expect(auto[0]!.type).toBe('sse')
    // 持久化里也在（刷新后照旧）
    expect(hr.state.sources).toHaveLength(1)
  })

  it('声明消失（插件卸了/服务停了）→ 自动源被摘除；手填源不受影响', async () => {
    let entries: Array<{ plugin: string; sse: string }> = [{ plugin: 'demo', sse: 'http://localhost:5333/sse' }]
    const { hr } = { hr: createHotReload({ storage: memStorage(), reload: async () => {}, scanPluginSources: async () => scanOf(entries)() }) }
    await hr.syncPluginSources()
    expect(hr.state.sources.filter((s) => s.label.startsWith('插件声明'))).toHaveLength(1)

    // 用户同时手填了一条自己的源
    hr.addSource({ url: 'http://other:9999/sse', label: '我手填的', type: 'sse', enabled: true })

    // 服务停了：扫描返回空
    entries = []
    await hr.syncPluginSources()
    const autoLeft = hr.state.sources.filter((s) => s.label.startsWith('插件声明'))
    expect(autoLeft).toHaveLength(0)
    // 手填的还在（自动摘除只动自动的）
    expect(hr.state.sources.map((s) => s.label)).toContain('我手填的')
  })

  it('地址变了 → 更新而不是多登一条', async () => {
    let entries: Array<{ plugin: string; sse: string }> = [{ plugin: 'demo', sse: 'http://localhost:5333/sse' }]
    const { hr } = { hr: createHotReload({ storage: memStorage(), reload: async () => {}, scanPluginSources: async () => scanOf(entries)() }) }
    await hr.syncPluginSources()
    // 服务换了端口
    entries = [{ plugin: 'demo', sse: 'http://localhost:5444/sse' }]
    await hr.syncPluginSources()
    const urls = hr.state.sources.filter((s) => s.label.startsWith('插件声明')).map((s) => s.url)
    expect(urls).toEqual(['http://localhost:5444/sse'])
  })

  it('扫描失败（清单拉不到）→ 不动现有状态', async () => {
    const { hr } = { hr: createHotReload({ storage: memStorage(), reload: async () => {}, scanPluginSources: scanOf([{ plugin: 'demo', sse: 'http://localhost:5333/sse' }]) }) }
    await hr.syncPluginSources()
    expect(hr.state.sources).toHaveLength(1)
    // 第二次扫描抛错
    const hr2 = createHotReload({ storage: memStorage(), reload: async () => {}, scanPluginSources: async () => { throw new Error('down') } })
    await hr2.syncPluginSources()
    expect(hr2.state.sources).toHaveLength(0) // 空的照旧空，不炸
  })
})
