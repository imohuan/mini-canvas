/**
 * HttpAdapter 单测（假 fetch，不碰真网络）。
 *
 * 重点是两条容易写错的：
 * 1. **404 → undefined**（不是 null、不是抛错）：数据层靠它区分"从未保存过"
 *    与"保存过空画布"，写错会让空画布刷新后重新长出默认节点；
 * 2. **key 前缀只留一份**：SaveService 给的 key 已带 type 前缀，URL 里 type 又是独立一段，
 *    不摘掉就会拼出 `canvas/canvas:graph` 这种双前缀，服务端永远读不到。
 */
import { describe, it, expect } from 'vitest'
import { HttpAdapter, joinUrl } from '../httpAdapter'

/** 记录调用的假 fetch */
function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    return handler(url, init)
  }) as typeof fetch
  return { impl, calls }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('joinUrl', () => {
  it('去掉尾部斜杠，避免出现 //api', () => {
    expect(joinUrl('http://x:1/', '/api/kv')).toBe('http://x:1/api/kv')
    expect(joinUrl('', '/api/kv')).toBe('/api/kv')
    expect(joinUrl('http://x:1', '/api/kv')).toBe('http://x:1/api/kv')
  })
})

describe('HttpAdapter.get', () => {
  it('200 → 返回 value', async () => {
    const { impl } = fakeFetch(() => json({ value: [{ id: '1' }] }))
    const a = new HttpAdapter({ type: 'canvas', fetchImpl: impl })
    expect(await a.get('canvas:graph')).toEqual([{ id: '1' }])
  })

  it('404 → undefined（从未保存过，不是错误）', async () => {
    const { impl } = fakeFetch(() => json({ ok: false }, 404))
    const a = new HttpAdapter({ type: 'canvas', fetchImpl: impl })
    expect(await a.get('canvas:graph')).toBeUndefined()
  })

  it('保存过的空数组 → 返回 []（与"从未保存"必须区分开）', async () => {
    const { impl } = fakeFetch(() => json({ value: [] }))
    const a = new HttpAdapter({ type: 'canvas', fetchImpl: impl })
    expect(await a.get('canvas:graph')).toEqual([])
  })

  it('500 → 抛错（真故障不该被当成"没数据"静默吞掉）', async () => {
    const { impl } = fakeFetch(() => json({ ok: false }, 500))
    const a = new HttpAdapter({ type: 'canvas', fetchImpl: impl })
    await expect(a.get('canvas:graph')).rejects.toThrow('读取失败 500')
  })

  it('URL 只带一份 type 前缀，key 做 URL 编码', async () => {
    const { impl, calls } = fakeFetch(() => json({ value: 1 }))
    const a = new HttpAdapter({ type: 'canvas', fetchImpl: impl })
    await a.get('canvas:graph-edges')
    expect(calls[0].url).toBe('/api/kv/canvas/graph-edges')

    // 裸 key（没前缀）也不该被拼坏
    await a.get('graph')
    expect(calls[1].url).toBe('/api/kv/canvas/graph')

    // 带斜杠/空格的 key 要编码，不能变成路径
    await a.get('canvas:project p1/theme')
    expect(calls[2].url).toBe('/api/kv/canvas/project%20p1%2Ftheme')
  })

  it('baseUrl 生效（跨源：画布在 dev server，数据指到 cloud-server）', async () => {
    const { impl, calls } = fakeFetch(() => json({ value: 1 }))
    const a = new HttpAdapter({ type: 'resource', baseUrl: 'http://127.0.0.1:8865/', fetchImpl: impl })
    await a.get('resource:img')
    expect(calls[0].url).toBe('http://127.0.0.1:8865/api/kv/resource/img')
  })
})

describe('HttpAdapter.set / remove', () => {
  it('set 发 PUT + { value } JSON', async () => {
    const { impl, calls } = fakeFetch(() => json({ ok: true }))
    const a = new HttpAdapter({ type: 'canvas', fetchImpl: impl })
    await a.set('canvas:graph', [{ id: 'a' }])
    expect(calls[0].url).toBe('/api/kv/canvas/graph')
    expect(calls[0].init?.method).toBe('PUT')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ value: [{ id: 'a' }] })
  })

  it('set 非 2xx → 抛错（不能假装存成功了）', async () => {
    const { impl } = fakeFetch(() => json({ ok: false }, 413))
    const a = new HttpAdapter({ type: 'canvas', fetchImpl: impl })
    await expect(a.set('canvas:graph', [])).rejects.toThrow('写入失败 413')
  })

  it('remove 发 DELETE；404 也算成功（幂等）', async () => {
    const { impl, calls } = fakeFetch(() => json({ ok: true, removed: false }, 404))
    const a = new HttpAdapter({ type: 'canvas', fetchImpl: impl })
    await a.remove('canvas:graph')
    expect(calls[0].init?.method).toBe('DELETE')
  })

  it('能力声明：可列出、非事务、不在线（供上层感知）', () => {
    const a = new HttpAdapter({ type: 'canvas', fetchImpl: fakeFetch(() => json({})).impl })
    expect(a.id).toBe('http')
    expect(a.capability).toEqual({ list: true, transactional: false, offline: false })
  })
})
