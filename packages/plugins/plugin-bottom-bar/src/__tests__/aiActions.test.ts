/**
 * aiActions 的纯逻辑契约（Node 可测）：
 * 1. 模板变量：认得的替换、不认得的原样保留；
 * 2. 思考过滤：think 段整块丢弃、跨帧半个标签也能接上、reasoning_content 增量丢弃；
 * 3. 重试：默认 3 轮、5xx 退避重试、4xx 一次判死；
 * 4. KV 清单：没存过 → 内置默认；存过 → 用户清单（非法项丢弃）。
 */
import { describe, it, expect } from 'vitest'
import {
  renderTemplate,
  StreamTextFilter,
  requestAiText,
  loadAiActions,
  normalizeAiActions,
  DEFAULT_AI_ACTIONS,
  AI_ACTIONS_KV_KEY,
} from '../aiActions'

function sseResponse(frames: string[]): Response {
  const enc = new TextEncoder()
  const chunks = frames.map((f) => enc.encode(f))
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

function chunkFrame(content: string): string {
  return 'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] }) + '\n\n'
}

describe('renderTemplate：模板变量', () => {
  it('认得的变量替换，不认得的原样保留', () => {
    const out = renderTemplate('画 {{prompt}}，类型 {{nodeType}}，坏变量 {{nope}}', {
      prompt: '一只猫',
      nodeType: 'image',
    })
    expect(out).toBe('画 一只猫，类型 image，坏变量 {{nope}}')
  })

  it('变量两侧允许空格：{{ prompt }} 也认', () => {
    expect(renderTemplate('{{ prompt }}!', { prompt: 'x' })).toBe('x!')
  })
})

describe('StreamTextFilter：流式思考过滤', () => {
  it('无思考段：增量原样吐出', () => {
    const f = new StreamTextFilter()
    expect(f.push('你好') + f.push('，世界') + f.end()).toBe('你好，世界')
  })

  it('思考段整块丢弃，只留正文', () => {
    const f = new StreamTextFilter()
    expect(f.push('<think>想一下') + f.push('这是内心戏</think>正文') + f.end()).toBe('正文')
  })

  it('思考标签跨帧切开也能接上（半个标签先扣住不吐）', () => {
    const f = new StreamTextFilter()
    expect(f.push('A<thi')).toBe('A')
    expect(f.push('nk>思考</th')).toBe('')
    expect(f.push('ink>B') + f.end()).toBe('B')
  })

  it('思考未闭合到流尾：剩余全丢', () => {
    const f = new StreamTextFilter()
    expect(f.push('正文<think>没收住') + f.end()).toBe('正文')
  })
})

describe('requestAiText：流式 + 重试', () => {
  it('流式增量回调给过滤后的正文；body 不带 model（默认模型由 Agent 渠道决定）', async () => {
    const seen: string[] = []
    let body: Record<string, unknown> = {}
    const res = await requestAiText({
      template: '优化：{{prompt}}',
      vars: { prompt: '一只猫' },
      onDelta: (d) => seen.push(d),
      fetchImpl: async (_url, init) => {
        body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return sseResponse([chunkFrame('<think>内心'), chunkFrame('戏</think>优化后的'), chunkFrame('提示词'), 'data: [DONE]\n\n'])
      },
      sleep: async () => undefined,
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.text).toBe('优化后的提示词')
    expect(seen.join('')).toBe('优化后的提示词')
    expect(body.messages).toEqual([{ role: 'user', content: '优化：一只猫' }])
    expect(body.model).toBeUndefined()
  })

  it('5xx：默认重试 3 轮后失败（attempts=3）', async () => {
    let calls = 0
    const res = await requestAiText({
      template: 'x',
      vars: {},
      fetchImpl: async () => {
        calls += 1
        return new Response(JSON.stringify({ error: { message: '上游挂了' } }), { status: 502 })
      },
      sleep: async () => undefined,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.attempts).toBe(3)
    expect(calls).toBe(3)
  })

  it('4xx：一次判死不重试（参数类错误重试也不会成功）', async () => {
    let calls = 0
    const res = await requestAiText({
      template: 'x',
      vars: {},
      fetchImpl: async () => {
        calls += 1
        return new Response(JSON.stringify({ error: { message: '不支持参数' } }), { status: 400 })
      },
      sleep: async () => undefined,
    })
    expect(res.ok).toBe(false)
    expect(calls).toBe(1)
  })

  it('第一轮 5xx、第二轮成功：结果带 attempts=2', async () => {
    let calls = 0
    const res = await requestAiText({
      template: 'x',
      vars: {},
      fetchImpl: async () => {
        calls += 1
        if (calls === 1) return new Response(JSON.stringify({ error: { message: '抖' } }), { status: 503 })
        return sseResponse([chunkFrame('ok'), 'data: [DONE]\n\n'])
      },
      sleep: async () => undefined,
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.attempts).toBe(2)
  })
})

describe('配置清单：归一与 KV 读写', () => {
  it('normalizeAiActions：非数组 → 内置默认；非法项丢弃', () => {
    expect(normalizeAiActions(undefined)).toEqual(DEFAULT_AI_ACTIONS.map((a) => ({ ...a })))
    const out = normalizeAiActions([{ id: 'a', template: 't' }, { id: '' }, { id: 'b' }, 'junk'])
    expect(out.map((x) => x.id)).toEqual(['a'])
  })

  it('loadAiActions：KV 没存过 → 内置默认；存过 → 用户清单', async () => {
    const empty = await loadAiActions({
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true, keys: [] }), { status: 200 }),
    })
    const withData = await loadAiActions({
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true, values: { [AI_ACTIONS_KV_KEY]: [{ id: 'mine', template: 'T {{prompt}}' }] } }), { status: 200 }),
    })
    expect(empty.map((a) => a.id)).toEqual(DEFAULT_AI_ACTIONS.map((a) => a.id))
    expect(withData.map((a) => a.id)).toEqual(['mine'])
  })
})
