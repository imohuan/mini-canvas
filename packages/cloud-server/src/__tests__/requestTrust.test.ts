import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { checkRequestTrust, createRequestTrust, type TrustRequestLike } from '../requestTrust'

const OPTS = {
  trustedHosts: ['127.0.0.1:8865', 'localhost:8865'],
  trustedOrigins: ['http://localhost:5288'],
}

function req(method: string, path: string, headers: Record<string, string> = {}): TrustRequestLike {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  return {
    method,
    path,
    header: (name: string) => lower[name.toLowerCase()],
  }
}

describe('checkRequestTrust', () => {
  it('可信 Host 且无 Origin → 放行（curl / 本地工具）', () => {
    expect(checkRequestTrust(req('GET', '/api/canvases', { host: '127.0.0.1:8865' }), OPTS)).toEqual({ ok: true })
  })

  it('Host 去除首尾空白后比较；两个主机名都认', () => {
    expect(checkRequestTrust(req('GET', '/api/x', { host: '  localhost:8865 ' }), OPTS).ok).toBe(true)
  })

  it('Host 缺失或不在白名单 → 拒绝（DNS 重绑定面）', () => {
    expect(checkRequestTrust(req('GET', '/api/x'), OPTS)).toMatchObject({ ok: false })
    const bad = checkRequestTrust(req('GET', '/api/x', { host: 'rebind.test:8865' }), OPTS)
    expect(bad.ok).toBe(false)
  })

  it('Origin 等于 http(s)://Host → 放行', () => {
    expect(checkRequestTrust(req('GET', '/api/x', {
      host: '127.0.0.1:8865', origin: 'http://127.0.0.1:8865',
    }), OPTS).ok).toBe(true)
    expect(checkRequestTrust(req('GET', '/api/x', {
      host: '127.0.0.1:8865', origin: 'https://127.0.0.1:8865',
    }), OPTS).ok).toBe(true)
  })

  it('trustedOrigins 显式追加的 dev 代理放行', () => {
    expect(checkRequestTrust(req('GET', '/api/x', {
      host: 'localhost:8865', origin: 'http://localhost:5288',
    }), OPTS).ok).toBe(true)
  })

  it('Origin 既不等于 Host 也不在白名单 → 拒绝', () => {
    const r = checkRequestTrust(req('POST', '/api/task/call', {
      host: '127.0.0.1:8865', origin: 'http://evil.example',
    }), OPTS)
    expect(r).toEqual({ ok: false, reason: 'origin-not-trusted' })
  })

  it('Origin: null 默认拒绝；即使打开 allowOpaqueOrigin，cross-site 也拒绝', () => {
    const base = { host: '127.0.0.1:8865', origin: 'null' }
    expect(checkRequestTrust(req('GET', '/api/x', base), OPTS).ok).toBe(false)
    expect(checkRequestTrust(req('GET', '/api/x', base), { ...OPTS, allowOpaqueOrigin: true }).ok).toBe(false)
    expect(checkRequestTrust(req('GET', '/api/x', { ...base, 'sec-fetch-site': 'cross-site' }),
      { ...OPTS, allowOpaqueOrigin: true }).ok).toBe(false)
    // 文档实测不存在这个组合；参数打开时也只在这种组合下才可能放行。
    expect(checkRequestTrust(req('GET', '/api/x', { ...base, 'sec-fetch-site': 'same-origin' }),
      { ...OPTS, allowOpaqueOrigin: true }).ok).toBe(true)
  })

  it('sec-fetch-site: cross-site 一律拒绝（即使 Origin 看起来同源）', () => {
    expect(checkRequestTrust(req('POST', '/api/x', {
      host: '127.0.0.1:8865', origin: 'http://127.0.0.1:8865', 'sec-fetch-site': 'cross-site',
    }), OPTS)).toEqual({ ok: false, reason: 'cross-site' })
  })

  it('OPTIONS 直接放行（预检不带令牌，也不带 Host 之外的信任信息）', () => {
    expect(checkRequestTrust(req('OPTIONS', '/api/task/call', { origin: 'null' }), OPTS).ok).toBe(true)
  })

  it('非 /api、非 /mcp 路径直接放行（含静态页与资源）', () => {
    for (const p of ['/', '/assets/a.js', '/api', '/mcpx']) {
      expect(checkRequestTrust(req('GET', p, { host: 'evil.test' }), OPTS).ok).toBe(true)
    }
  })

  it('/mcp 与 /mcp? 也做 Host 校验', () => {
    expect(checkRequestTrust(req('GET', '/mcp', { host: 'evil.test' }), OPTS).ok).toBe(false)
    expect(checkRequestTrust(req('POST', '/mcp?x=1', { host: 'evil.test' }), OPTS).ok).toBe(false)
    expect(checkRequestTrust(req('POST', '/mcp', { host: 'localhost:8865' }), OPTS).ok).toBe(true)
  })
})

describe('createRequestTrust 中间件', () => {
  it('不可信来源返回 403 + 固定文案，处理器不执行', async () => {
    const app = new Hono()
    app.use('*', createRequestTrust(OPTS))
    let ran = false
    app.get('/api/x', (c) => {
      ran = true
      return c.json({ ok: true })
    })
    const res = await app.request('/api/x', { headers: { host: 'evil.test:8865' } })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ ok: false, error: '请求来源不受信任' })
    expect(ran).toBe(false)
  })

  it('可信来源正常进入处理器', async () => {
    const app = new Hono()
    app.use('*', createRequestTrust(OPTS))
    app.get('/api/x', (c) => c.json({ ok: true }))
    const res = await app.request('/api/x', { headers: { host: '127.0.0.1:8865' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
