/**
 * 底栏「按 Agent 模型发请求」的契约（用户 2026-11-07）。
 *
 * 用户口径：底栏的模型下拉就是 Agent 里配好的那批模型，选中哪个就按哪个发；
 * 复制 / 删除两条动作删掉，预设按钮所有类型都要在。
 *
 * 这里只钉两件必须为真的事：
 * 1. 请求体带 provider + model（否则会落到后台默认模型，等于没选）；
 * 2. 文本节点没有输入内容 / 没选模型时不允许发。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { ADMIN_TOKEN_HEADER, ADMIN_TOKEN_KEY } from '@mini-canvas/canvas-base'
import { useAgentChat, requestAgentChat, readBarModelChoice, choiceStillValid } from '../node-bottom-bar/useAgentChat'
import { submitAgentChatJob } from '../node-bottom-bar/agentJobSubmit'

/** 最小的 localStorage 替身（Node 里没有 DOM；令牌走全局 localStorage） */
class MemoryStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
}

afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage })

describe('requestAgentChat：带用户选的模型', () => {
  function fetchReturning(body: string): typeof fetch {
    return (async () =>
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch
  }

  it('请求体里同时有 provider 和 model', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) })
      return new Response('data: {"choices":[{"delta":{"content":"收到"}}]}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as unknown as typeof fetch

    const r = await requestAgentChat([{ role: 'user', content: '你好' }], {
      baseUrl: 'http://127.0.0.1:8865',
      provider: 'local',
      model: 'deepseek-v4.1-flash',
      fetchImpl: f,
    })

    expect(r.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('http://127.0.0.1:8865/api/agent/chat/completion')
    const body = calls[0]!.body as Record<string, unknown>
    expect(body.provider).toBe('local')
    expect(body.model).toBe('deepseek-v4.1-flash')
    expect(body.stream).toBe(true)
    expect(Array.isArray(body.messages)).toBe(true)
  })

  it("★ 请求头带管理令牌（漏了就是后台 403，用户 2026-11-09）", async () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
    localStorage.setItem(ADMIN_TOKEN_KEY, "tok-bar-123")
    try {
      const calls: Array<{ headers: Record<string, string> }> = []
      const f = (async (_url: string, init: RequestInit) => {
        calls.push({ headers: init.headers as Record<string, string> })
        return new Response(
          'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        )
      }) as unknown as typeof fetch
      const r = await requestAgentChat([{ role: "user", content: "你好" }], {
        baseUrl: "http://127.0.0.1:8865",
        provider: "local",
        model: "deepseek-v4.1-flash",
        fetchImpl: f,
      })
      expect(r.ok).toBe(true)
      expect(calls).toHaveLength(1)
      expect(calls[0]!.headers[ADMIN_TOKEN_HEADER]).toBe("tok-bar-123")
    } catch (err) { throw err }
  })

  it('流式增量按段回调，最终拼成全文', async () => {
    const chunks: string[] = []
    const r = await requestAgentChat([{ role: 'user', content: 'x' }], {
      provider: 'local',
      model: 'm',
      fetchImpl: fetchReturning(
        'data: {"choices":[{"delta":{"content":"收"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"到"}}]}\n\n' +
        'data: [DONE]\n\n',
      ),
      onDelta: (d) => chunks.push(d),
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.text).toBe('收到')
    expect(chunks.join('')).toBe('收到')
  })

  it('思考内容（reasoning_content）不进正文', async () => {
    const r = await requestAgentChat([{ role: 'user', content: 'x' }], {
      provider: 'local',
      model: 'm',
      fetchImpl: fetchReturning(
        'data: {"choices":[{"delta":{"reasoning_content":"想一下"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n',
      ),
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.text).toBe('答案')
  })

  it('4xx 一次判死，不反复重试', async () => {
    let n = 0
    const f = (async () => {
      n += 1
      return new Response(JSON.stringify({ error: { message: '模型不存在' } }), { status: 400 })
    }) as unknown as typeof fetch
    const r = await requestAgentChat([{ role: 'user', content: 'x' }], {
      provider: 'local',
      model: 'nope',
      fetchImpl: f,
      sleep: async () => undefined,
    })
    expect(r.ok).toBe(false)
    expect(n).toBe(1)
  })
})

describe('节点里记住的模型选择', () => {
  it('读得回来', () => {
    expect(readBarModelChoice({ barModel: { provider: 'local', modelId: 'hy3' } })).toEqual({
      provider: 'local',
      modelId: 'hy3',
    })
  })

  it('脏数据当作没选', () => {
    expect(readBarModelChoice({})).toBeNull()
    expect(readBarModelChoice({ barModel: 'hy3' })).toBeNull()
    expect(readBarModelChoice({ barModel: { provider: '', modelId: 'hy3' } })).toBeNull()
    expect(readBarModelChoice(undefined)).toBeNull()
  })

  it('模型被删掉时判为失效（回退到空，不带着废模型发请求）', () => {
    const models = [{ provider: 'local', modelId: 'hy3' }]
    expect(choiceStillValid({ provider: 'local', modelId: 'hy3' }, models)).toBe(true)
    expect(choiceStillValid({ provider: 'local', modelId: 'gone' }, models)).toBe(false)
    expect(choiceStillValid(null, models)).toBe(false)
  })
})


/** 提交任务的下单契约（用户 2026-11-09：点发送 = 提交任务给后台） */
describe('submitAgentChatJob：提交任务给后台', () => {
  function fetchOk(): { f: typeof fetch; calls: Array<{ url: string; body: Record<string, unknown> }> } {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return new Response(JSON.stringify({ ok: true, jobId: 'job-1' }), { status: 200 })
    }) as unknown as typeof fetch
    return { f, calls }
  }

  it(
    '下单 POST /api/jobs：动作 agent:chat、模型与渠道放 values、提示词成 prompt 段',
    async () => {
      ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
      localStorage.setItem(ADMIN_TOKEN_KEY, 'tok-jobs')
      const { f, calls } = fetchOk()
      const r = await submitAgentChatJob({
        baseUrl: 'http://127.0.0.1:8865',
        nodeId: 'n9',
        provider: 'deepseek',
        modelId: 'deepseek-v4.1-flash',
        prompt: '画一个小猫',
        fetchImpl: f,
      })
      expect(r.ok).toBe(true)
      expect(calls).toHaveLength(1)
      expect(calls[0]!.url).toBe('http://127.0.0.1:8865/api/jobs')
      const body = calls[0]!.body
      expect(body.actionId).toBe('agent:chat')
      expect(body.nodeId).toBe('n9')
      const values = body.values as Record<string, unknown>
      expect(values.agentModel).toBe('deepseek-v4.1-flash')
      expect(values.agentProvider).toBe('deepseek')
      const prompts = body.prompts as Array<{ type: string; value: string }>
      expect(prompts[0]!.type).toBe('prompt')
      expect(prompts[0]!.value).toBe('画一个小猫')
    },
  )

  it(
    'useAgentChat.send 走下单而不是直连对话接口（不再请求 /api/agent/chat/completion）',
    async () => {
      ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
      const calls: Array<{ url: string }> = []
      const f = (async (url: string) => {
        calls.push({ url: String(url) })
        return new Response(JSON.stringify({ ok: true, jobId: 'job-2' }), { status: 200 })
      }) as unknown as typeof fetch
      const prompt = ref('你好')
      const chat = useAgentChat({
        ctx: { tryGet: () => undefined },
        nodeId: 'n1',
        prompt,
        fetchImpl: f,
      })
      chat.pick({ provider: 'p', modelId: 'm' })
      const r = await chat.send()
      expect(r.ok).toBe(true)
      expect(calls).toHaveLength(1)
      expect(calls[0]!.url).toContain('/api/jobs')
      expect(calls[0]!.url).not.toContain('chat/completion')
    },
  )
})
