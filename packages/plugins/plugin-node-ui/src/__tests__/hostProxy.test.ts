/**
 * 宿主代发：沙箱 iframe 不碰网络，请求全由宿主（同源 + 管理令牌）发出。
 *
 * 这里用假的 fetch 钉住四件事：
 *   1. URL 与 query 拼得对（画布 id / 槽位 / 文件名都要编码）；
 *   2. 每条请求都带 x-admin-token；
 *   3. 403 原样带后台原因，且提示检查令牌；
 *   4. 任务 SSE 的日志 / 进度逐条转给回调，终局才 resolve。
 */
import { describe, it, expect, vi } from 'vitest'
import { createHostProxy, isSavePayload } from '../hostFetch'

interface Call {
  url: string
  init?: RequestInit
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function proxyWith(calls: Call[], handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, ...(init ? { init } : {}) })
    return handler(url, init)
  })
  return createHostProxy({
    fetchImpl: fetchImpl as unknown as typeof fetch,
    baseUrl: 'http://127.0.0.1:8865/',
    canvasId: 'c 1',
    nodeId: 'n/1',
    token: 'tok-123',
  })
}

describe('宿主代发 · save', () => {
  it('上传到本节点槽位：path / query 都编码正确', async () => {
    const calls: Call[] = []
    const proxy = proxyWith(calls, () => jsonResponse({ ok: true, url: '/api/canvases/c%201/resources/slot-n%2F1.png' }))
    const { url } = await proxy.save(new Blob(['hi'], { type: 'text/plain' }), 'a b.png')
    expect(url).toBe('/api/canvases/c%201/resources/slot-n%2F1.png')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(
      'http://127.0.0.1:8865/api/canvases/c%201/resources?slot=n%2F1&name=a%20b.png',
    )
    expect(calls[0].init?.method).toBe('POST')
    expect(new Headers(calls[0].init?.headers).get('content-type')).toBe('text/plain')
  })

  it('没写扩展名时补 .png（与旧行为一致）', async () => {
    const calls: Call[] = []
    const proxy = proxyWith(calls, () => jsonResponse({ ok: true, url: '/x.png' }))
    await proxy.save(new Uint8Array([1, 2, 3]), 'out')
    expect(calls[0].url).toContain('&name=out.png')
  })

  it('三种字节都认（Blob / Uint8Array / ArrayBuffer）', () => {
    expect(isSavePayload(new Blob(['x']))).toBe(true)
    expect(isSavePayload(new Uint8Array([1]))).toBe(true)
    expect(isSavePayload(new ArrayBuffer(4))).toBe(true)
    expect(isSavePayload('text')).toBe(false)
    expect(isSavePayload({})).toBe(false)
  })
})

describe('宿主代发 · 管理令牌', () => {
  it('每条请求都带 x-admin-token（save / task / cancel / 调试）', async () => {
    const calls: Call[] = []
    const proxy = proxyWith(calls, (url) => {
      if (url.includes('/api/task/events')) return sseResponse(['data: {"type":"done","result":1}\n\n'])
      if (url.includes('/api/task/call')) return jsonResponse({ ok: true, runId: 'r1', state: 'running' })
      if (url.includes('debug-poll')) return jsonResponse({ ok: true, evals: [] })
      if (url.includes('debug-result')) return jsonResponse({ ok: true })
      if (url.includes('/api/task/cancel')) return jsonResponse({ ok: true, runId: 'r1' })
      return jsonResponse({ ok: true, url: '/x.png' })
    })

    await proxy.save(new Blob(['x']), 'x.png')
    await proxy.task({ name: 'a', methods: 'run', args: [] })
    await proxy.cancel('r1')
    await proxy.debugPoll('s1')
    await proxy.debugResult({ session: 's1', id: 'e1', ok: true })

    expect(calls).toHaveLength(5)
    for (const call of calls) {
      expect(new Headers(call.init?.headers).get('x-admin-token')).toBe('tok-123')
    }
  })

  it('403 抛出可读错误：带后台原文并提示检查令牌', async () => {
    const calls: Call[] = []
    const proxy = proxyWith(calls, () => jsonResponse({ ok: false, error: '缺少管理令牌' }, 403))
    await expect(proxy.save(new Blob(['x']), 'x.png')).rejects.toThrow(/403/)
    await expect(proxy.save(new Blob(['x']), 'x.png')).rejects.toThrow(/缺少管理令牌/)
    await expect(proxy.save(new Blob(['x']), 'x.png')).rejects.toThrow(/管理令牌/)
  })

  it('404 / 非 JSON 回包也说人话（不会变成 Unexpected token）', async () => {
    const calls: Call[] = []
    const proxy = proxyWith(calls, () => new Response('<html>not found</html>', { status: 404 }))
    await expect(proxy.save(new Blob(['x']), 'x.png')).rejects.toThrow(/保存产物失败（404）/) 
    await expect(proxy.task({ name: 'a', methods: 'run', args: [] })).rejects.toThrow(/起脚本失败（404）/) 
  })
})

describe('宿主代发 · task', () => {
  it('POST /api/task/call 带齐 canvasId / nodeId / wait，回包原样返回', async () => {
    const calls: Call[] = []
    const proxy = proxyWith(calls, () => jsonResponse({ ok: true, runId: 'r9', state: 'done', result: 42 }))
    const r = await proxy.task({ name: 'scale', methods: 'run', args: [2], wait: true })
    expect(r).toMatchObject({ ok: true, runId: 'r9', result: 42 })
    expect(calls[0].url).toBe('http://127.0.0.1:8865/api/task/call')
    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      type: 'call',
      name: 'scale',
      methods: 'run',
      args: [2],
      canvasId: 'c 1',
      nodeId: 'n/1',
      wait: true,
    })
    // wait:true 由后台等结束，不该再订阅 SSE
    expect(calls).toHaveLength(1)
  })

  it('★ 订阅 SSE：日志 / 进度逐条转出去，终局才 resolve', async () => {
    const calls: Call[] = []
    const proxy = proxyWith(calls, (url) => {
      if (url.includes('/api/task/call')) return jsonResponse({ ok: true, runId: 'r1', state: 'running' })
      return sseResponse([
        'data: {"type":"log","line":"第一步"}\n\n',
        ': ping\n\n',
        'data: {"type":"progress","value":0.5}\n\n',
        'data: {"type":"log","line":"第二步"}\n\n',
        'data: {"type":"done","result":{"ok":1}}\n\n',
      ])
    })
    const seen: unknown[] = []
    const r = await proxy.task({ name: 'a', methods: 'run', args: [], events: true }, (e) => seen.push(e))
    expect(seen).toEqual([
      { type: 'log', line: '第一步' },
      { type: 'progress', value: 0.5 },
      { type: 'log', line: '第二步' },
    ])
    expect(r).toMatchObject({ ok: true, runId: 'r1', state: 'done', result: { ok: 1 } })
    expect(calls[1].url).toBe('http://127.0.0.1:8865/api/task/events?runId=r1')
  })

  it('任务错误事件转成 ok:false（不抛给调用方，保持旧语义）', async () => {
    const calls: Call[] = []
    const proxy = proxyWith(calls, (url) => {
      if (url.includes('/api/task/call')) return jsonResponse({ ok: true, runId: 'r2', state: 'running' })
      return sseResponse(['data: {"type":"error","message":"脚本炸了"}\n\n'])
    })
    const r = await proxy.task({ name: 'a', methods: 'run', args: [], events: true })
    expect(r).toMatchObject({ ok: false, state: 'error', error: '脚本炸了' })
  })

  it('取消走 POST /api/task/cancel，body 只有 runId', async () => {
    const calls: Call[] = []
    const proxy = proxyWith(calls, () => jsonResponse({ ok: true, runId: 'r1' }))
    await proxy.cancel('r1')
    expect(calls[0].url).toBe('http://127.0.0.1:8865/api/task/cancel')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ runId: 'r1' })
  })
})

describe('宿主代发 · 调试', () => {
  it('poll 带 session；result 走 POST 并原样交 body', async () => {
    const calls: Call[] = []
    const proxy = proxyWith(calls, (url) =>
      url.includes('debug-poll') ? jsonResponse({ ok: true, evals: [{ type: 'stop' }] }) : jsonResponse({ ok: true }),
    )
    await proxy.debugPoll('s 1')
    expect(calls[0].url).toBe('http://127.0.0.1:8865/api/node-ui/debug-poll?session=s%201')
    await proxy.debugResult({ session: 's1', id: 'e1', ok: false, error: 'boom' })
    expect(calls[1].url).toBe('http://127.0.0.1:8865/api/node-ui/debug-result')
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ session: 's1', id: 'e1', ok: false, error: 'boom' })
  })
})
