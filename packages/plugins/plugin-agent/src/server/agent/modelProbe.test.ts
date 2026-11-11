/**
 * 模型「检测」必须真的发一次对话请求（用户口径 2026-11-11）。
 *
 * 这里起一个本地 OpenAI 兼容端点，故意让它在 `/v1/models` 上正常、
 * 但只接受 Chat Completions —— 用来证明：
 *   1. 检测不是只列模型清单，而是真的聊了一句；
 *   2. 自动检测会挑中真正能用的那个协议；
 *   3. 地址不通时，错误能回到界面上，而不是静默成功。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentConfigService } from './config.js'
import type { AgentKvPort } from '../ports.js'

function memoryKv(): AgentKvPort {
  const data = new Map<string, unknown>()
  return {
    async get<T>(type: string, key: string) {
      return data.get(type + '/' + key) as T | undefined
    },
    async set(type: string, key: string, value: unknown) {
      data.set(type + '/' + key, value)
    },
  }
}

let dir = ''
let server: Server
let port = 0

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-model-probe-'))
  server = createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ data: [{ id: 'm-a' }] }))
      return
    }
    // 只认 Chat Completions（Responses / Anthropic 协议这里一律 404）。
    // 流式故意**不带 usage_metadata**：真实第三方网关照抄的常见形状，SDK 会判失败；
    // 非流式返回正常 JSON —— 检测应该走兜底、结论仍然是“通”。
    if (req.url === '/v1/chat/completions') {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        const body = raw ? (JSON.parse(raw) as { stream?: boolean }) : {}
        if (body.stream !== true) {
          res.setHeader('content-type', 'application/json')
          res.end(
            JSON.stringify({
              id: 'x',
              object: 'chat.completion',
              model: 'm-a',
              choices: [{ index: 0, message: { role: 'assistant', content: 'OK' } }],
            }),
          )
          return
        }
        res.setHeader('content-type', 'text/event-stream')
        res.write(
          'data: ' +
            JSON.stringify({
              id: 'x',
              object: 'chat.completion.chunk',
              created: 1,
              model: 'm-a',
              choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }],
            }) +
            '\n\n',
        )
        res.write(
          'data: ' +
            JSON.stringify({
              id: 'x',
              object: 'chat.completion.chunk',
              created: 1,
              model: 'm-a',
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            }) +
            '\n\n',
        )
        res.end('data: [DONE]\n\n')
      })
      return
    }
    res.statusCode = 404
    res.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address()
  port = typeof addr === 'object' && addr ? addr.port : 0
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await fs.rm(dir, { recursive: true, force: true })
})

describe('模型检测（真实请求）', () => {
  it('自动检测挑中 openai-chat，并拿回模型的回复', async () => {
    const svc = new AgentConfigService(dir, { kv: memoryKv() })
    const r = await svc.probeModel({
      modelId: 'm-a',
      baseUrl: 'http://127.0.0.1:' + port + '/v1',
      apiKey: 'sk-test',
      clientType: 'auto',
    })
    expect(r.ok).toBe(true)
    expect(r.clientType).toBe('openai-chat')
    expect(r.reply).toContain('OK')
    // 流式缺 usage_metadata → 走了非流式兜底：结论必须是“通”，不能把兼容网关判红
    expect(r.tried[0]?.clientType).toBe('openai-chat')
    expect(r.tried.length).toBeGreaterThan(0)
  })

  it('协议写死成不匹配的那个：失败要带回原因', async () => {
    const svc = new AgentConfigService(dir, { kv: memoryKv() })
    const r = await svc.probeModel({
      modelId: 'm-a',
      baseUrl: 'http://127.0.0.1:' + port + '/v1',
      apiKey: 'sk-test',
      clientType: 'openai-responses',
    })
    expect(r.ok).toBe(false)
    expect(r.tried).toHaveLength(1)
    expect(r.error).toBeTruthy()
  })

  it('地址不通：明确报错，不静默成功', async () => {
    const svc = new AgentConfigService(dir, { kv: memoryKv() })
    const r = await svc.probeModel({
      modelId: 'm-a',
      baseUrl: 'http://127.0.0.1:1/v1',
      apiKey: 'sk-test',
      clientType: 'openai-chat',
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('手输的模型 ID 也会被测（不依赖上游清单是否列出它）', async () => {
    const svc = new AgentConfigService(dir, { kv: memoryKv() })
    const r = await svc.probeModel({
      modelId: 'custom-model-not-in-listing',
      baseUrl: 'http://127.0.0.1:' + port + '/v1',
      apiKey: 'sk-test',
      clientType: 'auto',
    })
    // 这个桩不校验模型名，重点是“照样发得出去、拿得回结论”
    expect(r.ok).toBe(true)
    expect(r.clientType).toBe('openai-chat')
  })

  it('新模型还没保存时，密钥回落到同一渠道已存的那份', async () => {
    const svc = new AgentConfigService(dir, { kv: memoryKv() })
    await svc.upsertModel({
      provider: 'gw',
      modelId: 'known-model',
      apiKey: 'sk-channel',
      baseUrl: 'http://127.0.0.1:' + port + '/v1',
    })
    // 新模型什么都不填，只给渠道名：应该拿到网关里已存的密钥
    const r = await svc.probeModel({ provider: 'gw', modelId: 'brand-new-model', clientType: 'openai-chat' })
    expect(r.ok).toBe(true)
  })

  it('缺密钥 / 认证失败这类英文报错会翻成中文', async () => {
    const svc = new AgentConfigService(dir, { kv: memoryKv() })
    const r = await svc.probeModel({ modelId: 'm-a', baseUrl: 'http://127.0.0.1:' + port + '/v1', clientType: 'openai-chat' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('密钥')
  })
})
