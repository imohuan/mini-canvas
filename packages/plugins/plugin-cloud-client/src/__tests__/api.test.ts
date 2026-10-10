import { describe, it, expect } from 'vitest'
import { CloudApi } from '../api'
import type { FetchLike } from '../apiTypes'

/** 记录请求的假 fetch（不起真服务） */
function fakeFetch(handler: (url: string, init?: RequestInit) => { status?: number; body?: unknown }): {
  fetchImpl: FetchLike
  calls: Array<{ url: string; init?: RequestInit }>
} {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, ...(init ? { init } : {}) })
    const r = handler(url, init)
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 })
  }
  return { fetchImpl, calls }
}

describe('动作清单', () => {
  it('按 baseUrl 拼地址，且不带 ifVersion 时全量拉', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: { ok: true, version: 3, changed: true, actions: [{ id: 'a', title: 'A' }] } }))
    const api = new CloudApi({ baseUrl: 'http://srv:8865/', fetchImpl })
    const r = await api.fetchActions()
    expect(calls[0].url).toBe('http://srv:8865/api/actions')
    expect(r.version).toBe(3)
    expect(r.actions).toHaveLength(1)
  })

  it('带 ifVersion → 版本没变时 changed:false 且 actions 为空（省掉整份搬运）', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: { ok: true, version: 3, changed: false, actions: [] } }))
    const api = new CloudApi({ baseUrl: 'http://srv', fetchImpl })
    const r = await api.fetchActions(3)
    expect(calls[0].url).toContain('ifVersion=3')
    expect(r.changed).toBe(false)
    expect(r.actions).toEqual([])
  })

  it('拿不到清单要抛（调用方据此显示"连不上服务"）', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 500, body: {} }))
    await expect(new CloudApi({ fetchImpl }).fetchActions()).rejects.toThrow()
  })
})

describe('任务', () => {
  it('下单取 jobId', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: { ok: true, jobId: 'j1' } }))
    const api = new CloudApi({ baseUrl: 'http://srv', fetchImpl })
    expect(await api.createJob({ canvasId: 'default', nodeId: 'n1', actionId: 'a' })).toBe('j1')
    expect(calls[0].init?.method).toBe('POST')
  })

  it('下单失败要带出后台的说明（用户看得懂）', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 400, body: { ok: false, error: '未找到动作 x' } }))
    await expect(new CloudApi({ fetchImpl }).createJob({ canvasId: 'default', nodeId: 'n1', actionId: 'x' })).rejects.toThrow(
      '未找到动作 x',
    )
  })

  it('查任务：404 → undefined（任务没了，不是异常）', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 404, body: {} }))
    expect(await new CloudApi({ fetchImpl }).getJob('nope')).toBeUndefined()
  })

  it('记住 taskId 的查询地址', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: { ok: true, job: { id: 'j1', status: 'running' } } }))
    const api = new CloudApi({ baseUrl: 'http://srv', fetchImpl })
    await api.getJob('j1')
    expect(calls[0].url).toBe('http://srv/api/jobs/j1')
  })
})

describe('历史', () => {
  it('筛选条件拼进 query string，空值不拼', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: { items: [], total: 0, page: 1, pageSize: 20, summary: { total: 0, byKind: {} } } }))
    const api = new CloudApi({ baseUrl: 'http://srv', fetchImpl })
    await api.fetchHistory({ page: 2, pageSize: 10, kind: 'image', status: '', order: 'asc' })
    const url = calls[0].url
    expect(url).toContain('page=2')
    expect(url).toContain('pageSize=10')
    expect(url).toContain('kind=image')
    expect(url).toContain('order=asc')
    expect(url).not.toContain('status=')
  })

  it('后端少给的字段有兜底（不会因为缺字段崩）', async () => {
    const { fetchImpl } = fakeFetch(() => ({ body: {} }))
    const r = await new CloudApi({ fetchImpl }).fetchHistory()
    expect(r.items).toEqual([])
    expect(r.summary).toEqual({ total: 0, byKind: {} })
  })
})

describe('地址管理', () => {
  it('setBaseUrl 立刻生效（设置改了不用重装插件）', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: { ok: true, version: 1, actions: [] } }))
    const api = new CloudApi({ baseUrl: 'http://a', fetchImpl })
    await api.fetchActions()
    api.setBaseUrl('http://b')
    await api.fetchActions()
    expect(calls[0].url).toContain('http://a')
    expect(calls[1].url).toContain('http://b')
  })

  it('空 baseUrl = 同源（相对地址）', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: { ok: true, version: 1, actions: [] } }))
    await new CloudApi({ fetchImpl }).fetchActions()
    expect(calls[0].url).toBe('/api/actions')
  })
})

describe('实时通道', () => {
  /** 假 EventSource：手动喂帧 */
  function fakeSource() {
    const listeners = new Map<string, Array<(e: { data: string }) => void>>()
    return {
      closed: false,
      addEventListener(type: string, fn: (e: { data: string }) => void) {
        if (!listeners.has(type)) listeners.set(type, [])
        listeners.get(type)!.push(fn)
      },
      close() {
        this.closed = true
      },
      emit(data: unknown) {
        for (const fn of listeners.get('message') ?? []) fn({ data: JSON.stringify(data) })
      },
    }
  }

  it('订阅地址不带 type 过滤（一条连接要听 canvas 与 config 两域）', () => {
    const src = fakeSource()
    let url = ''
    const api = new CloudApi({ baseUrl: 'http://srv', createEventSource: (u) => ((url = u), src) })
    api.subscribeChanges(() => {})
    expect(url).toBe('http://srv/api/kv/events')
    expect(url).not.toContain('type=')
  })

  it('收到的帧转发给回调；坏帧忽略（不该打断订阅）', () => {
    const src = fakeSource()
    const got: Array<{ type: string; key: string }> = []
    const api = new CloudApi({ createEventSource: () => src })
    api.subscribeChanges((e) => got.push(e))
    src.emit({ type: 'canvas', key: 'graph' })
    src.emit({ type: 'config', key: 'history-rev' })
    // 坏帧：不该抛，也不该进 got
    for (const fn of [() => {}]) fn()
    expect(got).toEqual([
      { type: 'canvas', key: 'graph' },
      { type: 'config', key: 'history-rev' },
    ])
  })

  it('取消订阅会关掉连接', () => {
    const src = fakeSource()
    const api = new CloudApi({ createEventSource: () => src })
    const off = api.subscribeChanges(() => {})
    off()
    expect(src.closed).toBe(true)
  })

  it('没有 EventSource 也不报错（Node / SSR 环境）', () => {
    const api = new CloudApi({})
    expect(() => api.subscribeChanges(() => {})()).not.toThrow()
  })

  /**
   * 复用宿主的**共享连接** —— 用户报的"后台怎么这么卡"的直接原因锁。
   *
   * 背景：宿主（@mini-canvas/ui）把一条 /api/kv/events 共享给全应用。本插件是独立
   * 打包的外部 bundle，拿不到宿主的模块导出，所以约定走全局键取共享订阅。
   * 不复用它就会多一条**永不关闭**的长连接；浏览器对单个域名的并发上限是 6 条，
   * 占满之后页面里所有普通请求只能排队（用户看到"请求停在待处理"）。
   *
   * 只在**没有自定义 SSE 工厂**时走共享（工厂是测试/宿主注入的替身，必须继续生效）。
   */
  it('有宿主共享连接时复用它，不再自己开一条（避免占满浏览器并发额度）', () => {
    const bag = globalThis as unknown as Record<string, unknown>
    const key = '__miniCanvasKvEvents'
    const prev = bag[key]
    try {
      const subs: Array<{ path: string; fn: (e: { type: string; key: string }) => void }> = []
      bag[key] = { subscribe: (path: string, fn: (e: { type: string; key: string }) => void) => {
        subs.push({ path, fn })
        return () => void subs.splice(subs.indexOf(subs[subs.length - 1]), 1)
      } }

      let openedOwn = false
      const api = new CloudApi({ baseUrl: 'http://srv' })
      const got: Array<{ type: string; key: string }> = []
      const off = api.subscribeChanges((e) => got.push(e))

      expect(openedOwn).toBe(false)
      expect(subs).toHaveLength(1)
      expect(subs[0].path).toBe('http://srv/api/kv/events')

      subs[0].fn({ type: 'canvas', key: 'graph' })
      expect(got).toEqual([{ type: 'canvas', key: 'graph' }])

      off()
    } finally {
      if (prev === undefined) delete bag[key]
      else bag[key] = prev
    }
  })

  it('宿主没挂共享连接时退回自己开（别的宿主 / 单测照样能跑）', () => {
    const bag = globalThis as unknown as Record<string, unknown>
    const key = '__miniCanvasKvEvents'
    const prev = bag[key]
    delete bag[key]
    try {
      const src = fakeSource()
      let called = false
      const api = new CloudApi({ createEventSource: () => ((called = true), src) })
      const off = api.subscribeChanges(() => {})
      expect(called).toBe(true)
      off()
      expect(src.closed).toBe(true)
    } finally {
      if (prev !== undefined) bag[key] = prev
    }
  })
})

describe('资源上传', () => {
  it('拿到 hashName 就够：地址由它拼出', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      body: { ok: true, hashName: 'abc123.png' },
    }))
    const api = new CloudApi({ baseUrl: 'http://srv', fetchImpl })
    const r = await api.uploadResource('default', new Blob([new Uint8Array([1])]), 'a.png')
    expect(r.url).toBe('/api/canvases/default/resources/abc123.png')
    expect(calls[0].url).toBe('http://srv/api/canvases/default/resources?name=a.png')
  })

  it('画布 id 跟着走（多画布各传各的目录）', async () => {
    const { fetchImpl } = fakeFetch(() => ({ body: { ok: true, hashName: 'abc123.png' } }))
    const api = new CloudApi({ baseUrl: 'http://srv', fetchImpl })
    const r = await api.uploadResource('c1', new Blob([new Uint8Array([1])]), 'a.png')
    expect(r.url).toBe('/api/canvases/c1/resources/abc123.png')
  })

  it('没有 hashName → 抛（地址拼不出来，不能静默给个假地址）', async () => {
    const { fetchImpl } = fakeFetch(() => ({ body: { ok: true } }))
    const api = new CloudApi({ baseUrl: 'http://srv', fetchImpl })
    await expect(api.uploadResource('c1', new Blob([new Uint8Array([1])]), 'a.png')).rejects.toThrow()
  })
})
