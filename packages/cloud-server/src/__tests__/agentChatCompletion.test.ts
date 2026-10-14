/**
 * 单轮对话（/api/agent/chat/completion）—— 2026-10-13 用户点名要的那个"中转"。
 *
 * 形状照抄 OpenAI 的 /v1/chat/completions。这里钉四件事：
 *   ① 请求归一化（该认的认、**不该认的明确报错**，别静默忽略）；
 *   ② 重试（SDK 只给状态：retryable 才退避重试，fatal 立刻交出去）；
 *   ③ 响应形状（非流式那个对象、流式那些帧）；
 *   ④ 凭据从**已配好的 provider** 来（没配好就说清怎么配）。
 */
import { describe, it, expect } from 'vitest'
import { normalizeChatRequest, flattenTurn, backoffMs, deltaOfMessage, finalTextOfMessage, usageOfMessage, completeOnce, type BareLLM } from '../agent/chatCompletion'
import { agentChatRoutes } from '../routes/agentChat'

/**
 * 造一个假模型。**帧形状照着真 SDK 打出来的抄**（不是我想当然的形状）：
 *   { type:'model_msg', payload:{ type:'partial_text', event_type:'delta', text:'…' } }
 * 第一版测试用了个编的形状（role 在外层），于是真机上"200 了但回答是空的"没被照到。
 */
function frame(payload: Record<string, unknown>): unknown {
  return { type: 'model_msg', payload }
}
function fakeLLM(script: {
  /** 增量帧 */
  deltas?: string[]
  /** 收尾的完整正文（真 SDK 会推一帧 type:'text'） */
  final?: string
  usage?: unknown
  status?: string
  errorMessage?: string
  throwOn?: 'next'
}): BareLLM {
  return {
    async *streamGenerate() {
      for (const t of script.deltas ?? []) {
        yield frame({ type: 'partial_text', role: 'assistant', event_type: 'delta', text: t })
      }
      if (script.final !== undefined) {
        yield frame({ type: 'text', role: 'assistant', text: script.final, stop_reason: 'completed' })
      }
      if (script.usage !== undefined) yield { type: 'event_msg', payload: { type: 'token_usage', request: script.usage } }
      if (script.throwOn === 'next') throw new Error('网络断了')
      return { status: script.status ?? 'completed', ...(script.errorMessage ? { errorMessage: script.errorMessage } : {}) }
    },
  }
}

const deps = (llm: BareLLM, over: Partial<Parameters<typeof completeOnce>[1]> = {}) =>
  ({
    config: { resolveModel: async () => ({ provider: 'p', modelId: 'm', configured: true, apiKey: 'k' }) },
    makeLLM: () => llm,
    buildMessages: () => [{ role: 'user' }],
    sleep: async () => undefined,
    ...over,
  }) as Parameters<typeof completeOnce>[1]

describe('normalizeChatRequest —— 形状照抄 OpenAI', () => {
  it('认最简形状：messages + model', () => {
    const r = normalizeChatRequest({ model: 'gpt-x', messages: [{ role: 'user', content: '你好' }] })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.messages).toHaveLength(1)
      expect(r.value.model).toBe('gpt-x')
      expect(r.value.stream).toBe(false) // 不给 stream = 非流式（与 OpenAI 一致）
    }
  })

  it('stream / max_tokens / user 都认（含 camelCase 写法）', () => {
    const r = normalizeChatRequest({
      messages: [{ role: 'user', content: 'x' }],
      stream: true,
      max_tokens: 128,
      user: 'u1',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.stream).toBe(true)
      expect(r.value.maxTokens).toBe(128)
      expect(r.value.user).toBe('u1')
    }
    const camel = normalizeChatRequest({ messages: [{ role: 'user', content: 'x' }], maxTokens: 64 })
    expect(camel.ok && camel.value.maxTokens).toBe(64)
  })

  it('★ 不支持的参数明确报错（静默忽略比报错更坏：调用方以为生效了）', () => {
    for (const key of ['tools', 'functions', 'n', 'stop', 'logprobs']) {
      const r = normalizeChatRequest({ messages: [{ role: 'user', content: 'x' }], [key]: [] })
      expect(r.ok, key).toBe(false)
      if (!r.ok) expect(r.error).toContain(key)
    }
  })

  it('缺 messages / 空数组 / 怪 role → 明确报错', () => {
    expect(normalizeChatRequest({}).ok).toBe(false)
    expect(normalizeChatRequest({ messages: [] }).ok).toBe(false)
    const bad = normalizeChatRequest({ messages: [{ role: '根', content: 'x' }] })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('role')
  })

  it('content 可以是字符串，也可以是分片数组（含图片）', () => {
    const r = normalizeChatRequest({
      messages: [
        { role: 'system', content: '你是助手' },
        { role: 'user', content: [{ type: 'text', text: '看图' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } }] },
      ],
    })
    expect(r.ok).toBe(true)
  })
})

describe('flattenTurn —— 单轮：历史一起发过来，服务端不存', () => {
  it('system 单独给、user 与 assistant 拼成一段、图片抠出来', () => {
    const t = flattenTurn([
      { role: 'system', content: '你是助手' },
      { role: 'user', content: '第一句' },
      { role: 'assistant', content: '第一答' },
      { role: 'user', content: [{ type: 'text', text: '第二句' }, { type: 'image_url', image_url: 'http://x/a.png' }] },
    ])
    expect(t.systemPrompt).toBe('你是助手')
    expect(t.userText).toContain('第一句')
    expect(t.userText).toContain('[助手] 第一答')
    expect(t.userText).toContain('第二句')
    expect(t.images).toEqual(['http://x/a.png'])
  })
})

describe('帧解析 —— 形状照真 SDK 的抄（role 在 payload 里）', () => {
  it('增量帧：只认 partial_text + event_type=delta', () => {
    expect(deltaOfMessage(frame({ type: 'partial_text', event_type: 'delta', text: '你' }))).toBe('你')
    // start / stop 帧的 text 是空的，不该被当成内容
    expect(deltaOfMessage(frame({ type: 'partial_text', event_type: 'start', text: '' }))).toBe('')
    expect(deltaOfMessage(frame({ type: 'partial_text', event_type: 'stop', text: '' }))).toBe('')
    // 别的 payload 类型一律不是正文
    expect(deltaOfMessage(frame({ type: 'thinking', text: '想' }))).toBe('')
    expect(deltaOfMessage({ role: 'assistant', payload: { text: '旧形状' } })).toBe('')
    expect(deltaOfMessage(null)).toBe('')
  })

  it('完整帧：type=text 给的是全文（收尾那帧）', () => {
    expect(finalTextOfMessage(frame({ type: 'text', role: 'assistant', text: '你好呀' }))).toBe('你好呀')
    expect(finalTextOfMessage(frame({ type: 'partial_text', event_type: 'delta', text: '你' }))).toBeUndefined()
  })

  it('用量帧：type=token_usage', () => {
    // 用量在 payload.request（本次请求）/ payload.session（会话累计）—— 名字照真 SDK
    expect(usageOfMessage(frame({ type: 'token_usage', request: { inputTokens: 1 }, session: { inputTokens: 9 } }))).toEqual({
      inputTokens: 1,
    })
    expect(usageOfMessage(frame({ type: 'text', text: 'x' }))).toBeUndefined()
    // 外层是 event_msg 也要认（真机里用量帧就是 event_msg —— 第一版只认 model_msg，于是全 0）
    expect(
      usageOfMessage({ type: 'event_msg', payload: { type: 'token_usage', request: { output: 3, total: 7 } } }),
    ).toEqual({ output: 3, total: 7 })
  })
})

describe('completeOnce —— 一次就成 / 重试 / 立刻放弃', () => {
  it('一次就成：把各帧正文拼起来，状态 completed', async () => {
    const r = await completeOnce({ messages: [{ role: 'user', content: 'q' }] }, deps(fakeLLM({ deltas: ['你', '好'], final: '你好' })))
    expect(r.text).toBe('你好')
    expect(r.status).toBe('completed')
    expect(r.attempts).toBe(1)
  })

  it('★ retryable → 退避后重试，成功则 attempts=2', async () => {
    let calls = 0
    const llm: BareLLM = {
      async *streamGenerate() {
        calls++
        if (calls === 1) return { status: 'retryable', errorMessage: '网络断了' }
        yield frame({ type: 'text', role: 'assistant', text: '第二次成了' })
        return { status: 'completed' }
      },
    }
    const seen: number[] = []
    const r = await completeOnce(
      { messages: [{ role: 'user', content: 'q' }] },
      deps(llm, { onRetry: (i) => seen.push(i.attempt) }),
    )
    expect(r.status).toBe('completed')
    expect(r.text).toBe('第二次成了')
    expect(r.attempts).toBe(2)
    expect(seen).toEqual([1])
  })

  it('★ fatal → **不重试**（同样的请求再试一百次也不会成功）', async () => {
    let calls = 0
    const llm: BareLLM = {
      async *streamGenerate() {
        calls++
        return { status: 'fatal', errorMessage: '密钥不对' }
      },
    }
    const r = await completeOnce({ messages: [{ role: 'user', content: 'q' }] }, deps(llm))
    expect(r.status).toBe('fatal')
    expect(calls).toBe(1)
    expect(r.errorMessage).toBe('密钥不对')
  })

  it('一直 retryable → 用满次数后把最后那个错交出去', async () => {
    let calls = 0
    const llm: BareLLM = {
      async *streamGenerate() {
        calls++
        return { status: 'retryable', errorMessage: '还是不通' }
      },
    }
    const r = await completeOnce({ messages: [{ role: 'user', content: 'q' }] }, deps(llm))
    expect(calls).toBe(3) // 默认 3 次
    expect(r.status).toBe('retryable')
    expect(r.attempts).toBe(3)
  })

  it('抛出来的异常也算可重试（与 SDK 对未归类错误的处置一致）', async () => {
    const r = await completeOnce({ messages: [{ role: 'user', content: 'q' }] }, deps(fakeLLM({ throwOn: 'next' })))
    expect(r.status).toBe('retryable')
    expect(r.errorMessage).toContain('网络断了')
    expect(r.attempts).toBe(3)
  })

  it('★ 凭据没配好 → fatal + 说清去哪儿配（不闷声失败）', async () => {
    const r = await completeOnce(
      { messages: [{ role: 'user', content: 'q' }] },
      deps(fakeLLM({}), { config: { resolveModel: async () => ({ configured: false }) } as never }),
    )
    expect(r.status).toBe('fatal')
    expect(r.errorMessage).toContain('模型')
    expect(r.errorMessage).toContain('API Key')
  })

  it('★ 点了名但配置里没这个模型 → fatal（**不偷偷用默认模型**）', async () => {
    const r = await completeOnce(
      { messages: [{ role: 'user', content: 'q' }], model: '不存在的模型' },
      deps(fakeLLM({ final: '不该走到这里' }), {
        // resolveModel 的口径是"没指定就用默认"，所以指定但找不到时会回默认那个
        config: {
          resolveModel: async () => ({ provider: 'p', modelId: 'default-model', configured: true, apiKey: 'k' }),
        } as never,
      }),
    )
    expect(r.status).toBe('fatal')
    expect(r.errorMessage).toContain('不存在的模型')
    expect(r.attempts).toBe(0)
  })
})

describe('backoffMs —— 指数退避、有上限', () => {
  it('600 / 1200 / 2400…，不超过 maxMs', () => {
    expect(backoffMs(1)).toBe(600)
    expect(backoffMs(2)).toBe(1200)
    expect(backoffMs(3)).toBe(2400)
    expect(backoffMs(20)).toBe(8000)
  })
})

describe('路由 —— 非流式那个对象 / 流式那些帧', () => {
  // 用量形状照真 SDK：{ cache_read, cache_write, output, total }（没有单独的输入字段）
  const runner = async () => ({ text: '你好呀', status: 'completed', attempts: 1, usage: { output: 5, total: 8 } })

  const post = (app: ReturnType<typeof agentChatRoutes>, body: unknown) =>
    app.request('/api/agent/chat/completion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('非流式 → chat.completion 形状（choices[0].message.content + usage）', async () => {
    const app = agentChatRoutes({ config: {} as never, run: runner as never })
    const res = await post(app, { model: 'm', messages: [{ role: 'user', content: '你好' }] })
    expect(res.status).toBe(200)
    const j = (await res.json()) as Record<string, unknown>
    expect(j.object).toBe('chat.completion')
    expect(String(j.id)).toMatch(/^chatcmpl-/)
    const choices = j.choices as Array<{ message: { role: string; content: string }; finish_reason: string }>
    expect(choices[0]!.message).toEqual({ role: 'assistant', content: '你好呀' })
    expect(choices[0]!.finish_reason).toBe('stop')
    expect(j.usage).toEqual({ prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 })
  })

  it('参数不支持 → 400 + invalid_request_error（带上 param）', async () => {
    const app = agentChatRoutes({ config: {} as never, run: runner as never })
    const res = await post(app, { messages: [{ role: 'user', content: 'x' }], tools: [] })
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { type: string; param?: string } }
    expect(j.error.type).toBe('invalid_request_error')
    expect(j.error.param).toBe('tools')
  })

  it('跑失败 → 502（retryable 用尽）/ 400（fatal），错误里带 attempts', async () => {
    const bad = async () => ({ text: '', status: 'retryable', attempts: 3, errorMessage: '还是不通' })
    const app = agentChatRoutes({ config: {} as never, run: bad as never })
    const res = await post(app, { messages: [{ role: 'user', content: 'x' }] })
    expect(res.status).toBe(502)
    const j = (await res.json()) as { error: { message: string; attempts: number } }
    expect(j.error.message).toBe('还是不通')
    expect(j.error.attempts).toBe(3)

    const fatal = async () => ({ text: '', status: 'fatal', attempts: 0, errorMessage: '密钥不对' })
    const app2 = agentChatRoutes({ config: {} as never, run: fatal as never })
    expect((await post(app2, { messages: [{ role: 'user', content: 'x' }] })).status).toBe(400)
  })

  it('流式 → role 帧 + content 帧 + finish 帧 + [DONE]', async () => {
    const streaming = async (
      _i: unknown,
      hooks: { onDelta?: (t: string) => void },
    ) => {
      hooks.onDelta?.('你')
      hooks.onDelta?.('好')
      return { text: '你好', status: 'completed', attempts: 1 }
    }
    const app = agentChatRoutes({ config: {} as never, run: streaming as never })
    const res = await post(app, { messages: [{ role: 'user', content: 'x' }], stream: true })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('chat.completion.chunk')
    expect(text).toContain('"role":"assistant"')
    expect(text).toContain('"content":"你"')
    expect(text).toContain('"finish_reason":"stop"')
    expect(text.trim().endsWith('data: [DONE]')).toBe(true)
  })
})

