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

  it('★ 最小权限：沙箱页面不能借宿主令牌调危险接口', async () => {
    const { calls, impl } = recorder()
    const proxy = createHostProxy({ fetchImpl: impl, baseUrl: 'http://x', canvasId: 'c1', nodeId: 'n1', token: 'tok' })
    const forbidden = [
      '/api/task/call',
      '/api/task/cancel',
      '/api/agent/chat/completion',
      '/api/agent/models',
      '/api/server-plugins/install',
      '/api/npm-plugins/install',
      '/api/node-packages/import',
      '/api/node-ui/debug-accept',
      '/api/style-library/settings',
      '/api/kv/config/x',
      '/api/history/batch-delete',
    ]
    for (const path of forbidden) {
      await expect(proxy.fetchApi({ path, method: 'POST' })).rejects.toThrow('允许范围')
    }
    // 非 /api/ 路径走的是另一条拒绝（同样的目的，不同的文案）
    await expect(proxy.fetchApi({ path: '/mcp' })).rejects.toThrow('/api/')
    expect(calls.length).toBe(0)
  })

  it('★ 允许的那几类仍然放行（读画布 / 改节点 / 下单 / 传资产）', async () => {
    const { calls, impl } = recorder()
    const proxy = createHostProxy({ fetchImpl: impl, baseUrl: 'http://x', canvasId: 'c1', nodeId: 'n1', token: 'tok' })
    for (const path of [
      '/api/canvases',
      '/api/canvases/c1',
      '/api/canvases/c1/nodes',
      '/api/canvases/c1/edges',
      '/api/canvases/c1/view',
      '/api/canvases/c1/resources?name=a.png',
      '/api/canvas/nodes',
      '/api/canvas/edges',
      '/api/jobs',
      '/api/assets',
      '/api/asset-folders',
      '/api/canvases/c1/resources',
    ]) {
      await expect(proxy.fetchApi({ path, method: 'POST' })).resolves.toBeTruthy()
    }
    expect(calls.length).toBe(12)
    // 只读接口用 GET 测（用 POST 去读会被最小权限挡下，这是有意的）
    await expect(proxy.fetchApi({ path: '/api/actions', method: 'GET' })).resolves.toBeTruthy()
    await expect(proxy.fetchApi({ path: '/api/canvases', method: 'GET' })).resolves.toBeTruthy()
  })

  it('非 2xx 也原样返回（不抛），由页面自己判断', async () => {
    const { impl } = recorder({ status: 403, body: '{"ok":false,"error":"no"}' })
    const proxy = createHostProxy({ fetchImpl: impl, baseUrl: 'http://x', canvasId: 'c1', nodeId: 'n1', token: 'tok' })
    const res = await proxy.fetchApi({ path: '/api/canvases' })
    expect(res.status).toBe(403)
    expect(new TextDecoder().decode(res.body)).toContain('no')
  })
})
