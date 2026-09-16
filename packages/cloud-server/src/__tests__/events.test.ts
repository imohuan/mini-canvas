/**
 * 实时通道单测（`GET /api/kv/events`，SSE）。
 *
 * 锁的是这条链路存在的**唯一理由**：AI 经 MCP 改画布之后，网页端不用刷新就能知道「变了」。
 * 因此这里不测「SSE 格式对不对」，而测「谁写都会惊动订阅者」—— 包括最容易漏掉的那条：
 * **MCP 的写**（不经过 HTTP 的 /api/kv，而是直接落到同一个 KvStore）。
 *
 * 不启真端口，直接把 Request 喂给 app.fetch。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer, type CloudServer } from '../server'

let dir: string
let srv: CloudServer
const openStreams: Array<() => void> = []

afterEach(async () => {
  for (const close of openStreams.splice(0)) close()
  srv?.stop()
  if (dir) await fs.rm(dir, { recursive: true, force: true })
})

async function boot(): Promise<void> {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-events-'))
  srv = await createCloudServer({ dir })
}

/** 等到条件成立或超时（返回 false）。用于等「事件到达」这类异步结果。 */
async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (cond()) return true
    await new Promise((r) => setTimeout(r, 10))
  }
  return cond()
}

type SseFrame = Record<string, unknown>

/**
 * 订阅 SSE 并把事件收进数组（后台读，随用随取）。
 *
 * 只认 data: 行：日志/保活 ping 都不算业务事件，免得「保活帧」被当成「画布变了」。
 * 帧之间用空行分隔，解析按 SSE 规范切。
 */
async function subscribe(query = '') {
  const res = await srv.app.fetch(new Request('http://localhost/api/kv/events' + query))
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/event-stream')

  const events: SseFrame[] = []
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const reading = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        for (;;) {
          const cut = buf.indexOf('\n\n')
          if (cut < 0) break
          const frame = buf.slice(0, cut)
          buf = buf.slice(cut + 2)
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue
            const payload = line.slice('data:'.length).trim()
            if (payload) events.push(JSON.parse(payload) as SseFrame)
          }
        }
      }
    } catch {
      /* 取消订阅时的正常中断 */
    }
  })()
  openStreams.push(() => {
    void reader.cancel()
    void reading
  })
  // 交出一次控制权，让读循环先挂上再开始制造事件
  await new Promise((r) => setTimeout(r, 0))
  return { events }
}

async function put(type: string, key: string, value: unknown): Promise<void> {
  const res = await srv.app.fetch(
    new Request('http://localhost/api/kv/' + type + '/' + key, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value }),
    }),
  )
  expect(res.status).toBe(200)
}

/** 直接调 MCP 工具（与 AI 客户端走的是同一条路） */
async function callMcp(name: string, args: Record<string, unknown>): Promise<string> {
  const res = await srv.app.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }),
  )
  return await res.text()
}

describe('GET /api/kv/events（实时通道）', () => {
  it('网页端 PUT 之后，订阅者收到「哪个 key 变了」', async () => {
    await boot()
    const { events } = await subscribe('?type=canvas')
    await put('canvas', 'graph', [{ id: 'n1' }])

    expect(await waitFor(() => events.length > 0)).toBe(true)
    expect(events[0]).toEqual({ type: 'canvas', key: 'graph' })
  })

  it('MCP 工具改画布也会惊动订阅者（这条才是这个接口存在的理由）', async () => {
    await boot()
    const { events } = await subscribe('?type=canvas')

    // AI 加一个节点：走 MCP，完全不碰 /api/kv
    await callMcp('canvas.batch_nodes', { add: [{ type: 'text', data: { text: '嗨' } }] })

    expect(await waitFor(() => events.some((e) => e.key === 'graph'))).toBe(true)
    // 边也要跟着通知（同一个写批里有 graph 与 graph-edges）
    expect(events.some((e) => e.key === 'graph-edges')).toBe(true)
  })

  it('按作用域过滤：订阅 canvas 的不该收到 config 的动静', async () => {
    await boot()
    const { events } = await subscribe('?type=canvas')

    await put('config', 'theme', 'dark')
    await new Promise((r) => setTimeout(r, 150))
    expect(events).toEqual([])

    await put('canvas', 'graph', [])
    expect(await waitFor(() => events.length > 0)).toBe(true)
    expect(events[0]).toEqual({ type: 'canvas', key: 'graph' })
  })

  it('两个作用域各收各的', async () => {
    await boot()
    const canvasStream = await subscribe('?type=canvas')
    const configStream = await subscribe('?type=config')

    await put('config', 'theme', 'dark')
    await put('canvas', 'graph', [])

    expect(await waitFor(() => configStream.events.length > 0)).toBe(true)
    expect(await waitFor(() => canvasStream.events.length > 0)).toBe(true)
    expect(configStream.events).toEqual([{ type: 'config', key: 'theme' }])
    expect(canvasStream.events).toEqual([{ type: 'canvas', key: 'graph' }])
  })
})
