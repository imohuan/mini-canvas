/**
 * 通用 `/api/*` 转发（CanvasUI.api）。
 *
 * 沙箱页是不透明源，自己 fetch 会被请求边界挡；所以它把路径交上来，
 * 由宿主带令牌与同源身份代发。这里钉住三件事：
 *   1. 只允许 /api/ 下的同源路径（否则就成了任意地址代理）；
 *   2. 带管理令牌，GET 不带 body；
 *   3. 回包保留 status / 头 / 原始字节（页面要能自己 .json() / .text()）。
 */
import { describe, expect, it } from 'vitest'
import { createHostProxy } from '../hostFetch'

function recorder(response: { status?: number; headers?: Record<string, string>; body?: string } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(response.body ?? '{"ok":true}', {
      status: response.status ?? 200,
      headers: { 'content-type': 'application/json', ...(response.headers ?? {}) },
    })
  }) as unknown as typeof fetch
  return { calls, impl }
}

describe('宿主通用转发', () => {
  it('GET /api/... 带令牌、不带 body', async () => {
    const { calls, impl } = recorder({ body: '{"nodes":[]}' })
    const proxy = createHostProxy({ fetchImpl: impl, baseUrl: 'http://x', canvasId: 'c1', nodeId: 'n1', token: 'tok' })
    const res = await proxy.fetchApi({ path: '/api/canvases/c1', method: 'GET' })
    expect(calls[0]!.url).toBe('http://x/api/canvases/c1')
    expect((calls[0]!.init?.headers as Record<string, string>)['x-admin-token']).toBe('tok')
    expect(calls[0]!.init?.body).toBeUndefined()
    expect(res.status).toBe(200)
    expect(new TextDecoder().decode(res.body)).toBe('{"nodes":[]}')
  })

  it('POST 带 body 与自定义头', async () => {
    const { calls, impl } = recorder({ status: 201, body: 'created' })
    const proxy = createHostProxy({ fetchImpl: impl, baseUrl: 'http://x/', canvasId: 'c1', nodeId: 'n1', token: 'tok' })
    const res = await proxy.fetchApi({
      path: '/api/canvases/c1/nodes',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"add":[]}',
    })
    expect(calls[0]!.url).toBe('http://x/api/canvases/c1/nodes')
    expect(calls[0]!.init?.body).toBe('{"add":[]}')
    const h = calls[0]!.init?.headers as Record<string, string>
    expect(h['content-type']).toBe('application/json')
    expect(h['x-admin-token']).toBe('tok')
    expect(res.status).toBe(201)
  })

  it('拒绝非 /api/ 路径与绝对地址', async () => {
    const { calls, impl } = recorder()
    const proxy = createHostProxy({ fetchImpl: impl, baseUrl: 'http://x', canvasId: 'c1', nodeId: 'n1', token: 'tok' })
    await expect(proxy.fetchApi({ path: '/health' })).rejects.toThrow('/api/')
    await expect(proxy.fetchApi({ path: 'http://evil.test/x' })).rejects.toThrow('/api/')
    await expect(proxy.fetchApi({ path: '//evil.test/api/x' })).rejects.toThrow('/api/')
    expect(calls.length).toBe(0)
  })

  it('非 2xx 也原样返回（不抛），由页面自己判断', async () => {
    const { impl } = recorder({ status: 403, body: '{"ok":false,"error":"no"}' })
    const proxy = createHostProxy({ fetchImpl: impl, baseUrl: 'http://x', canvasId: 'c1', nodeId: 'n1', token: 'tok' })
    const res = await proxy.fetchApi({ path: '/api/x' })
    expect(res.status).toBe(403)
    expect(new TextDecoder().decode(res.body)).toContain('no')
  })
})
