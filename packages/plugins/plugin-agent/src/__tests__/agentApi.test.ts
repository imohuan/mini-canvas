/** SSE 解析：逐帧切分、半帧拼接、错误文案 */
import { afterEach, describe, it, expect } from 'vitest'
import { ADMIN_TOKEN_HEADER, ADMIN_TOKEN_KEY } from '@mini-canvas/canvas-base'
import { AgentApi, type ChatEvent } from '../agentApi'

/** 最小的 localStorage 替身（Node 里没有 DOM；令牌走全局 localStorage） */
class MemoryStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
}

afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage })

function headersOf(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {}
  new Headers(init?.headers).forEach((v, k) => { out[k] = v })
  return out
}

/** 把若干片拼成一个假 Response（可用来验「一帧被切成两片」） */
function sseResponse(parts: string[]): Response {
  const enc = new TextEncoder()
  const chunks = parts.map((p) => enc.encode(p))
  let i = 0
  return new Response(
    new ReadableStream({
      pull(ctrl) {
        if (i >= chunks.length) {
          ctrl.close()
          return
        }
        ctrl.enqueue(chunks[i++])
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )
}

describe('SSE 解析', () => {
  it('逐帧切分并忽略保活注释帧', async () => {
    const api = new AgentApi({
      fetchImpl: async () => sseResponse([
        ': ping\n\n',
        'data: {"type":"text","delta":"你","partial":true}\n\n',
        'data: {"type":"done"}\n\n',
      ]),
    })
    const seen: ChatEvent[] = []
    await api.sendMessage('default', 's1', 'hi', {}, (e) => seen.push(e))
    expect(seen.map((e) => e.type)).toEqual(['text', 'done'])
  })

  it('一帧被切成两片也能拼回来（buffer 逻辑）', async () => {
    const api = new AgentApi({
      fetchImpl: async () => sseResponse(['data: {"type":"text","de', 'lta":"好","partial":true}\n\n']),
    })
    const seen: ChatEvent[] = []
    await api.sendMessage('default', 's1', 'hi', {}, (e) => seen.push(e))
    expect(seen).toHaveLength(1)
    expect((seen[0] as { delta?: string }).delta).toBe('好')
  })

  it('坏帧跳过，不因一帧解析失败杀掉整条流', async () => {
    const api = new AgentApi({
      fetchImpl: async () => sseResponse(['data: 不是json\n\n', 'data: {"type":"done"}\n\n']),
    })
    const seen: ChatEvent[] = []
    await api.sendMessage('default', 's1', 'hi', {}, (e) => seen.push(e))
    expect(seen.map((e) => e.type)).toEqual(['done'])
  })
})

describe('错误处理', () => {
  it('把服务端的 error 文案抛出来（用户能直接照做）', async () => {
    const api = new AgentApi({
      fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: '尚未配置可用模型' }), { status: 503 }),
    })
    await expect(api.sendMessage('default', 's1', 'hi', {}, () => undefined)).rejects.toThrow('尚未配置可用模型')
  })

  it('请求带上了这一轮选的模型 / MCP / 技能', async () => {
    let body: Record<string, unknown> = {}
    const api = new AgentApi({
      fetchImpl: async (_url, init) => {
        body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return sseResponse(['data: {"type":"done"}\n\n'])
      },
    })
    await api.sendMessage(
      'default',
      's1',
      'hi',
      { provider: 'local', modelId: 'deepseek-auto', mcpServers: ['smart'], skills: ['code-review'] },
      () => undefined,
    )
    expect(body.provider).toBe('local')
    expect(body.modelId).toBe('deepseek-auto')
    expect(body.mcpServers).toEqual(['smart'])
    expect(body.skills).toEqual(['code-review'])
  })
})

describe('管理令牌', () => {
  it('json() 一处覆盖所有 Agent 请求：会话写与 chat/completion 都带同一个头', async () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
    localStorage.setItem(ADMIN_TOKEN_KEY, 'agent-tok')
    const seen: Array<{ url: string; headers: Record<string, string> }> = []
    const api = new AgentApi({
      fetchImpl: async (url, init) => {
        seen.push({ url: String(url), headers: headersOf(init) })
        if (String(url).includes('/messages')) return sseResponse(['data: {"type":"done"}\n\n'])
        return new Response(JSON.stringify({ ok: true, id: 's1', resumed: false }), { status: 200 })
      },
    })

    await api.createSession('default')
    await api.sendMessage('default', 's1', 'hi', {}, () => undefined)
    await api.goalOp('default', 's1', { op: 'pause' })

    expect(seen.map((s) => s.url)).toEqual([
      '/api/agent/canvases/default/sessions',
      '/api/agent/canvases/default/sessions/s1/messages',
      '/api/agent/canvases/default/sessions/s1/goal',
    ])
    expect(seen.every((s) => s.headers[ADMIN_TOKEN_HEADER] === 'agent-tok')).toBe(true)
  })

  it('没有令牌时任何请求都不带该头（不是空串头）', async () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
    const seen: Array<Record<string, string>> = []
    const api = new AgentApi({
      fetchImpl: async (url, init) => {
        seen.push(headersOf(init))
        if (String(url).includes('/messages')) return sseResponse(['data: {"type":"done"}\n\n'])
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      },
    })
    await api.createSession('default')
    await api.sendMessage('default', 's1', 'hi', {}, () => undefined)
    expect(seen.every((h) => !(ADMIN_TOKEN_HEADER in h))).toBe(true)
  })
})
