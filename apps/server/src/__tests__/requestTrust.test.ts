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

  it('大小写不敏感：大写 scheme/host 的 Origin 与 Host 都能认（反代 / 自定义客户端）', () => {
    expect(checkRequestTrust(req('GET', '/api/x', {
      host: '127.0.0.1:8865', origin: 'HTTP://LOCALHOST:5288',
    }), OPTS).ok).toBe(true)
    expect(checkRequestTrust(req('GET', '/api/x', {
      host: '127.0.0.1:8865', origin: 'HTTP://127.0.0.1:8865',
    }), OPTS).ok).toBe(true)
    // 白名单里带尾斜杠 / 大写也照样认
    expect(checkRequestTrust(req('GET', '/api/x', {
      host: 'localhost:8865', origin: 'http://localhost:5288/',
    }), { ...OPTS, trustedOrigins: ['HTTP://LocalHost:5288'] }).ok).toBe(true)
    // 但大写不能变成绕过：别的源仍然拒
    expect(checkRequestTrust(req('GET', '/api/x', {
      host: '127.0.0.1:8865', origin: 'HTTP://EVIL.EXAMPLE',
    }), OPTS).ok).toBe(false)
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

  /**
   * 用户 2026-11-17 实测：可视化节点的沙箱 iframe（不透明源）里 `<audio src>` 永远播不出来，
   * 因为浏览器给这类请求标 `Sec-Fetch-Site: cross-site` + `Sec-Fetch-Dest: audio`。
   * 只放行「画布资源的只读媒体显示」这一种，别的一律照旧拒。
   */
  it('跨站媒体显示：只放行画布资源的只读 GET / HEAD', () => {
    const media = (path: string, dest: string, method = 'GET') =>
      checkRequestTrust(
        req(method, path, {
          host: '127.0.0.1:8865',
          'sec-fetch-site': 'cross-site',
          'sec-fetch-dest': dest,
        }),
        OPTS,
      )
    expect(media('/api/canvases/c1/resources/a.mp3', 'audio').ok).toBe(true)
    expect(media('/api/canvases/c1/resources/a.png', 'image').ok).toBe(true)
    expect(media('/api/canvases/c1/resources/a.mp4', 'video', 'HEAD').ok).toBe(true)

    // 脚本自己发的 fetch（dest 是 empty）照样拒：不能靠它读画布数据
    expect(media('/api/canvases/c1/resources/a.mp3', 'empty').ok).toBe(false)
    // 画布数据接口不在此列
    expect(media('/api/canvases/c1', 'image').ok).toBe(false)
    expect(media('/api/canvases/c1/nodes', 'image').ok).toBe(false)
    // 写方法不在此列
    expect(media('/api/canvases/c1/resources/a.mp3', 'audio', 'POST').ok).toBe(false)
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
