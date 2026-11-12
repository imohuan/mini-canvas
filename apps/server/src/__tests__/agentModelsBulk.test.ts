/**
 * Agent 模型路由单测 —— 重点是「一个渠道配一批模型」这条新链路。
 *
 * 锁的是用户口径（2026-10-02）：编辑一个 Provider 时，
 *   「取消勾选的模型要真的被删掉」而不是留下来 —— 表现就是「删不干净」。
 * 所以 PUT /api/agent/models/bulk 的 removeMissing 语义必须有测试钉住：
 *   - 只删**该 provider 下**没勾的；
 *   - 别的渠道一个不碰。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer, type CloudServer } from '../server'

let dir: string
let srv: CloudServer

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-' + 'models-'))
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
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  return { status: res.status, json, text }
}

/** 已配置（有密钥）的模型 id 列表 */
async function configuredModels(): Promise<Array<{ provider: string; modelId: string }>> {
  const r = await call('GET', '/api/agent/config')
  return r.json.models.filter((m: { hasKey: boolean }) => m.hasKey)
}

describe('PUT /api/agent/models/bulk：一个渠道配一批模型', () => {
  it('一次写入多个模型（同一个 provider）', async () => {
    const r = await call('PUT', '/api/agent/models/bulk', {
      provider: 'gw',
      modelIds: ['a', 'b', 'c'],
      apiKey: 'sk-x',
      baseUrl: 'http://127.0.0.1:3000/v1',
    })
    expect(r.status).toBe(200)
    const ids = (await configuredModels()).filter((m) => m.provider === 'gw').map((m) => m.modelId).sort()
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('再次编辑：只保留勾中的 —— 取消勾选的被真删掉', async () => {
    await call('PUT', '/api/agent/models/bulk', {
      provider: 'gw',
      modelIds: ['a', 'b', 'c'],
      apiKey: 'sk-x',
      baseUrl: 'http://127.0.0.1:3000/v1',
    })
    const r = await call('PUT', '/api/agent/models/bulk', {
      provider: 'gw',
      modelIds: ['a', 'c'],
      removeMissing: true,
    })
    expect(r.status).toBe(200)
    expect(r.json.removed).toEqual(['b'])
    const ids = (await configuredModels()).filter((m) => m.provider === 'gw').map((m) => m.modelId).sort()
    expect(ids).toEqual(['a', 'c'])
  })

  it('removeMissing 只动本渠道：别的 provider 的模型一个不删', async () => {
    await call('PUT', '/api/agent/models/bulk', { provider: 'p1', modelIds: ['x'], apiKey: 'k1', baseUrl: 'http://127.0.0.1:3000/v1' })
    await call('PUT', '/api/agent/models/bulk', { provider: 'p2', modelIds: ['y'], apiKey: 'k2', baseUrl: 'http://127.0.0.1:3001/v1' })
    await call('PUT', '/api/agent/models/bulk', { provider: 'p1', modelIds: ['x2'], removeMissing: true })
    const rows = await configuredModels()
    expect(rows.filter((m) => m.provider === 'p2').map((m) => m.modelId)).toEqual(['y'])
    expect(rows.filter((m) => m.provider === 'p1').map((m) => m.modelId)).toEqual(['x2'])
  })

  it('不传 removeMissing：旧模型留着（避免误删）', async () => {
    await call('PUT', '/api/agent/models/bulk', { provider: 'gw', modelIds: ['a', 'b'], apiKey: 'k', baseUrl: 'http://127.0.0.1:3000/v1' })
    await call('PUT', '/api/agent/models/bulk', { provider: 'gw', modelIds: ['c'] })
    const ids = (await configuredModels()).filter((m) => m.provider === 'gw').map((m) => m.modelId).sort()
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('makeDefault 把指定模型设为默认', async () => {
    const r = await call('PUT', '/api/agent/models/bulk', {
      provider: 'gw',
      modelIds: ['a', 'b'],
      apiKey: 'k',
      baseUrl: 'http://127.0.0.1:3000/v1',
      makeDefault: 'b',
    })
    expect(r.status).toBe(200)
    const cfg = await call('GET', '/api/agent/config')
    expect(cfg.json.defaultRef).toEqual({ provider: 'gw', modelId: 'b' })
  })

  it('空勾选 / 缺 provider → 400（不能把渠道清空）', async () => {
    expect((await call('PUT', '/api/agent/models/bulk', { provider: 'gw', modelIds: [] })).status).toBe(400)
    expect((await call('PUT', '/api/agent/models/bulk', { modelIds: ['a'] })).status).toBe(400)
  })

  it('Base URL 不是合法地址 → 400（错误在存之前就拦住）', async () => {
    const r = await call('PUT', '/api/agent/models/bulk', {
      provider: 'gw',
      modelIds: ['a'],
      baseUrl: 'not-a-url',
    })
    expect(r.status).toBe(400)
    expect(String(r.json.error)).toContain('完整地址')
  })

  it('同一批里的重复 id 会去重', async () => {
    await call('PUT', '/api/agent/models/bulk', {
      provider: 'gw',
      modelIds: ['a', 'a', 'b'],
      apiKey: 'k',
      baseUrl: 'http://127.0.0.1:3000/v1',
    })
    const ids = (await configuredModels()).filter((m) => m.provider === 'gw').map((m) => m.modelId).sort()
    expect(ids).toEqual(['a', 'b'])
  })
})

