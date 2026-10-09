/**
 * test 模型（用户口径 2026-10-09）：一个本地伪造模型 —— 请求它不走真实后台。
 *
 * 两件事各钉一份：
 *   ① 假端点吐的是**标准 OpenAI Chat Completions SSE**（SDK 的 openai 客户端要能消费）；
 *   ② 服务启动后配置里**自动多出**一个「test模型」，且 base_url 指向本服务的假端点。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer, type CloudServer } from '../server'
import { fakeReplyFor, sseBodyFor, TEST_PROVIDER, TEST_MODEL_ID, testModelBaseUrl } from '../agent/testModel'

let dir: string
let srv: CloudServer

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-' + 'test-model-'))
  srv = await createCloudServer({ dir, watchProviders: false })
})

afterEach(async () => {
  srv.stop()
  await fs.rm(dir, { recursive: true, force: true })
})

async function call(method: string, url: string, body?: unknown) {
  const res = await srv.app.fetch(
    new Request('http://localhost' + url, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(body !== undefined ? { headers: { 'content-type': 'application/json' } } : {}),
    }),
  )
  const text = await res.text()
  let json: any
  try { json = JSON.parse(text) } catch { json = undefined }
  return { status: res.status, json, text }
}

describe('伪造回复的纯函数', () => {
  it('回显这一轮的用户文本（第一行）', () => {
    const reply = fakeReplyFor({ messages: [{ role: 'user', content: '你好呀\n第二行' }] })
    expect(reply).toContain('你好呀')
    expect(reply).toContain('test模型')
  })

  it('多模态分片 content 也能取到文本', () => {
    const reply = fakeReplyFor({ messages: [{ role: 'user', content: [{ type: 'text', text: '看图' }] }] })
    expect(reply).toContain('看图')
  })

  it('SSE：分片 + finish_reason + usage + [DONE]', () => {
    const sse = sseBodyFor('test模型', 'abcdef')
    expect(sse).toContain('data: ' )
    expect(sse).toContain('"object":"chat.completion.chunk"')
    expect(sse).toContain('"finish_reason":"stop"')
    expect(sse).toContain('"usage"')
    expect(sse.trimEnd().endsWith('data: [DONE]')).toBe(true)
  })
})

describe('假端点 /api/test-model/v1/chat/completions', () => {
  it('返回 SSE，且带上这一轮的 echo', async () => {
    const res = await srv.app.fetch(
      new Request('http://localhost/api/test-model/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'test模型', messages: [{ role: 'user', content: 'ping-1234' }] }),
      }),
    )
    expect(res.status).toBe(200)
    expect(String(res.headers.get('content-type'))).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('data: [DONE]')
    // 流式会把回复切成多片（边界可能落在词中间）—— 把所有 delta 拼起来再断言
    const merged = text
      .split('\n')
      .filter((l) => l.startsWith('data: ') && !l.includes('[DONE]'))
      .map((l) => JSON.parse(l.slice(6)))
      .map((o: { choices?: Array<{ delta?: { content?: string } }> }) => o.choices?.[0]?.delta?.content ?? '')
      .join('')
    expect(merged).toContain('ping-1234')
  })

  it('指令 `::test 时长=…::` 会真的把流拖慢（不是立刻返回）', async () => {
    const t0 = Date.now()
    const res = await srv.app.fetch(
      new Request('http://localhost/api/test-model/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'test模型',
          // 自定义内容放长一点 → 多分片；给 600ms 让「拖时间」可观测
          messages: [{ role: 'user', content: '::test 时长=600ms 内容=自定义回复内容要够长才有分片::' }],
        }),
      }),
    )
    const text = await res.text()
    const elapsed = Date.now() - t0
    const merged = text
      .split('\n')
      .filter((l) => l.startsWith('data: ') && !l.includes('[DONE]'))
      .map((l) => JSON.parse(l.slice(6)))
      .map((o: { choices?: Array<{ delta?: { content?: string } }> }) => o.choices?.[0]?.delta?.content ?? '')
      .join('')
    expect(merged).toContain('自定义回复内容要够长才有分片')
    // 至少拖到 400ms（给一点调度余量；不要求精确 600ms）
    expect(elapsed).toBeGreaterThan(400)
  })
})

describe('自动登记 test模型', () => {
  it('GET /api/agent/config 里有它，且有密钥、base_url 指向假端点', async () => {
    const cfg = await call('GET', '/api/agent/config')
    const m = cfg.json.models.find((x: { provider: string }) => x.provider === TEST_PROVIDER)
    expect(m, '配置里应当有 test 渠道').toBeTruthy()
    expect(m.modelId).toBe(TEST_MODEL_ID)
    expect(m.hasKey).toBe(true)
    expect(String(m.baseUrl)).toBe(testModelBaseUrl('http://127.0.0.1:8865'))
  })
})
