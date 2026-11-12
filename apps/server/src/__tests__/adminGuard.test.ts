import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { createAdminAuth, isAdminPath, type AdminAuth } from '../adminAuth'

let dir: string
let auth: AdminAuth

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'admin-guard-'))
  auth = await createAdminAuth({ dataDir: dir })
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** 按 server.ts 的接线方式装一个最小中间件：只做路径判定 + 令牌校验。 */
function buildApp(): Hono {
  const app = new Hono()
  app.use('/api/*', async (c, next) => {
    if (!isAdminPath(c.req.method, c.req.path)) return next()
    if (auth.verify(c.req.header('x-admin-token')) !== 'ok') {
      return c.json({ ok: false, error: '需要管理令牌（x-admin-token）' }, 403)
    }
    return next()
  })
  app.all('/api/*', (c) => c.json({ ok: true, method: c.req.method }))
  return app
}

describe('isAdminPath 与最小中间件', () => {
  it('GET 不需要令牌（读接口放行）', async () => {
    const res = await buildApp().request('/api/task/events')
    expect(res.status).toBe(200)
  })

  it('受保护的写接口四种方法无令牌都 403，且处理器没执行', async () => {
    const app = buildApp()
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await app.request('/api/agent/prompts', { method })
      expect(res.status).toBe(403)
      const body = await res.json() as { ok: boolean }
      expect(body.ok).toBe(false)
    }
  })

  it('错误令牌与缺令牌同样 403（不区分，避免探测）', async () => {
    const app = buildApp()
    const missing = await app.request('/api/task/call', { method: 'POST' })
    const bad = await app.request('/api/task/call', {
      method: 'POST',
      headers: { 'x-admin-token': '0'.repeat(64) },
    })
    expect(missing.status).toBe(403)
    expect(bad.status).toBe(403)
    expect(await bad.json()).toEqual(await missing.json())
  })

  it('带正确令牌放行', async () => {
    const app = buildApp()
    const res = await app.request('/api/task/call', {
      method: 'POST',
      headers: { 'x-admin-token': auth.token },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, method: 'POST' })
  })

  it('画布写接口：POST 要令牌，PUT 整画布保存放行', async () => {
    const app = buildApp()
    expect((await app.request('/api/canvases/d/nodes', { method: 'POST' })).status).toBe(403)
    expect((await app.request('/api/canvases/d', { method: 'PUT' })).status).toBe(200)
    expect((await app.request('/api/canvases/d/nodes', { method: 'GET' })).status).toBe(200)
  })

  it('资产 / KV 写接口不在首版清单，无令牌也放行', async () => {
    const app = buildApp()
    expect((await app.request('/api/assets', { method: 'POST' })).status).toBe(200)
    expect((await app.request('/api/kv/config', { method: 'PUT' })).status).toBe(200)
  })

  it('OPTIONS 预检不被令牌拦住', async () => {
    const res = await buildApp().request('/api/server-plugins/install', {
      method: 'OPTIONS',
      headers: { origin: 'http://127.0.0.1:8865' },
    })
    expect(res.status).toBe(200)
  })
})
