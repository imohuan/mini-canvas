/**
 * 密钥掩码单测 —— 锁住「编辑渠道时密钥不能丢」这条用户口径。
 *
 * 用户报的 bug：添加渠道正常，但**编辑时 APIKey 消失**，重新拉取直接 401。
 * 两个成因，各有测试：
 *   ① 界面把掩码显示在输入框里 → 保存/拉取时会原样回传 → 若被当成真密钥写进去/拿去请求，必然 401；
 *   ② 拉取时表单有 baseUrl、密钥格是空（或掩码）→ 若只在 baseUrl 也为空时才回落到已存凭据，
 *      就会拿空密钥去认证，同样 401。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer, type Server } from 'node:http'
import { createCloudServer, type CloudServer } from '../server'
import { maskSecret, isSecretMask } from '../agent/config'

let dir: string
let srv: CloudServer
let upstream: Server
let upstreamPort = 0
/** 上游收到的 Authorization 头（用来验证「确实带上了已存的密钥」） */
let seenAuth: string[] = []

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-' + 'mask-'))
  srv = await createCloudServer({ dir, watchProviders: false })
  seenAuth = []
  upstream = createServer((req, res) => {
    seenAuth.push(String(req.headers.authorization ?? ''))
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] }))
  })
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => {
    upstreamPort = (upstream.address() as { port: number }).port
    r()
  }))
})

afterEach(async () => {
  srv.stop()
  await new Promise<void>((r) => upstream.close(() => r()))
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

const UPSTREAM = () => 'http://127.0.0.1:' + upstreamPort + '/v1'

describe('maskSecret / isSecretMask', () => {
  it('长密钥：保留前 3 位与末 4 位，中间打点', () => {
    expect(maskSecret('sk-abcdefghijklmnop')).toBe('sk-…mnop')
  })
  it('短密钥整串打点（不泄露本身）', () => {
    expect(maskSecret('short')).toBe('••••••')
  })
  it('空值 → 空串（不产生假掩码）', () => {
    expect(maskSecret('')).toBe('')
  })
  it('掩码能被认出来，真密钥不会被误判', () => {
    expect(isSecretMask(maskSecret('sk-abcdefghijklmnop'))).toBe(true)
    expect(isSecretMask('••••••')).toBe(true)
    expect(isSecretMask('sk-real-key-1234567890')).toBe(false)
    expect(isSecretMask('')).toBe(false)
  })
})

describe('config 接口下发掩码（明文永不回传）', () => {
  it('配好密钥后：hasKey=true + 掩码，响应里没有明文', async () => {
    const KEY = 'sk-supersecret-1234567890'
    await call('PUT', '/api/agent/models/bulk', {
      provider: 'gw', modelIds: ['model-a'], apiKey: KEY, baseUrl: UPSTREAM(),
    })
    const cfg = await call('GET', '/api/agent/config')
    const m = cfg.json.models.find((x: { provider: string }) => x.provider === 'gw')
    expect(m.hasKey).toBe(true)
    expect(m.apiKeyMask).toBe(maskSecret(KEY))
    expect(cfg.text).not.toContain(KEY)
  })
})

describe('编辑渠道：掩码回传不能毁掉密钥', () => {
  it('保存时把掩码原样回传 → 密钥保持不变（不会被写成掩码）', async () => {
    const KEY = 'sk-supersecret-1234567890'
    await call('PUT', '/api/agent/models/bulk', {
      provider: 'gw', modelIds: ['model-a'], apiKey: KEY, baseUrl: UPSTREAM(),
    })
    const mask = maskSecret(KEY)
    // 界面编辑后保存：apiKey=掩码（用户没动那一格）
    await call('PUT', '/api/agent/models/bulk', {
      provider: 'gw', modelIds: ['model-a', 'model-b'], apiKey: mask, baseUrl: UPSTREAM(), removeMissing: true,
    })
    // 拉取一次：上游必须收到**真密钥**（说明掩码没被写进配置）
    seenAuth = []
    await call('POST', '/api/agent/models/available', {
      provider: 'gw', baseUrl: UPSTREAM(), apiKey: mask,
    })
    expect(seenAuth[0]).toBe('Bearer ' + KEY)
  })

  it('新增模型时掩码回传 → 新模型继承真密钥（不会变无密钥）', async () => {
    const KEY = 'sk-supersecret-1234567890'
    await call('PUT', '/api/agent/models/bulk', {
      provider: 'gw', modelIds: ['model-a'], apiKey: KEY, baseUrl: UPSTREAM(),
    })
    await call('PUT', '/api/agent/models/bulk', {
      provider: 'gw', modelIds: ['model-a', 'model-b'], apiKey: maskSecret(KEY),
    })
    const cfg = await call('GET', '/api/agent/config')
    const ys = cfg.json.models.filter((x: { provider: string }) => x.provider === 'gw')
    expect(ys.map((m: { modelId: string }) => m.modelId).sort()).toEqual(['model-a', 'model-b'])
    // 两个都得有密钥，否则界面上「像是没保存上」
    expect(ys.every((m: { hasKey: boolean }) => m.hasKey)).toBe(true)
  })

  it('用户输入真密钥 → 覆盖旧密钥（掩码判定不误伤正常输入）', async () => {
    const OLD = 'sk-old-key-1234567890'
    const NEW = 'sk-new-key-0987654321'
    await call('PUT', '/api/agent/models/bulk', {
      provider: 'gw', modelIds: ['model-a'], apiKey: OLD, baseUrl: UPSTREAM(),
    })
    await call('PUT', '/api/agent/models/bulk', {
      provider: 'gw', modelIds: ['model-a'], apiKey: NEW,
    })
    seenAuth = []
    await call('POST', '/api/agent/models/available', { provider: 'gw', baseUrl: UPSTREAM() })
    expect(seenAuth[0]).toBe('Bearer ' + NEW)
  })
})

describe('拉取模型：表单带 baseUrl、密钥为空/掩码时要回落到已存凭据', () => {
  it('baseUrl 走表单、密钥留空 → 用已存的密钥（不 401）', async () => {
    const KEY = 'sk-supersecret-1234567890'
    await call('PUT', '/api/agent/models/bulk', {
      provider: 'gw', modelIds: ['model-a'], apiKey: KEY, baseUrl: UPSTREAM(),
    })
    seenAuth = []
    const r = await call('POST', '/api/agent/models/available', { provider: 'gw', baseUrl: UPSTREAM() })
    expect(r.json.ok).toBe(true)
    expect(seenAuth[0]).toBe('Bearer ' + KEY)
  })

  it('两个都留空 → 完全回落到已存凭据（模型清单能拉回来）', async () => {
    const KEY = 'sk-supersecret-1234567890'
    await call('PUT', '/api/agent/models/bulk', {
      provider: 'gw', modelIds: ['model-a'], apiKey: KEY, baseUrl: UPSTREAM(),
    })
    seenAuth = []
    const r = await call('POST', '/api/agent/models/available', { provider: 'gw' })
    expect(r.json.ok).toBe(true)
    expect(r.json.models).toEqual(['model-a', 'model-b'])
    expect(seenAuth[0]).toBe('Bearer ' + KEY)
  })

  it('没有任何凭据可回落 → 明确报错，而不是空手去请求', async () => {
    const r = await call('POST', '/api/agent/models/available', { provider: 'nope' })
    expect(r.json.ok).toBe(false)
    expect(String(r.json.error)).toContain('Base URL')
  })
})

