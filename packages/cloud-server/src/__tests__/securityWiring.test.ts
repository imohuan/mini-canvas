/**
 * 安全改造在 `server.ts` 里的**真实接线**（不是复刻一个最小中间件）。
 *
 * 三条都是审查报告点名的「测试看着全绿、真机却没生效」：
 *   1. M2：`port: 0` 时 Host 白名单用的是构造时端口，起来后所有请求自拒；
 *   2. M3：令牌中间件只记失败，成功写没有 attempt/ok，泄露后查不出被用来做了什么；
 *   3. M1：任务令牌只校验节点 id，脚本可以用 add/update 改自己节点的 `uiHtml`。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer, type CloudServer } from '../server.js'

let dir: string
let srv: CloudServer

afterEach(async () => {
  srv?.stop()
  if (dir) await fs.rm(dir, { recursive: true, force: true })
})

const TOKEN = 'f'.repeat(64)

/** 起一个**真监听**的服务：port=0 由系统分配，正好覆盖「构造时端口 ≠ 真实端口」。 */
async function boot(): Promise<{ port: number }> {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'security-wiring-'))
  srv = await createCloudServer({
    dir,
    port: 0,
    watchProviders: false,
    adminAuth: true,
    adminToken: TOKEN,
    requestTrust: true,
  })
  const info = await srv.start()
  return { port: info.port }
}

async function readAudit(): Promise<Array<Record<string, unknown>>> {
  try {
    const text = await fs.readFile(path.join(dir, 'audit.log'), 'utf8')
    return text
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as Record<string, unknown>)
  } catch {
    return []
  }
}

describe('port: 0 时 Host 白名单跟着真实端口走（M2）', () => {
  /**
   * ★ `--host 0.0.0.0` 时，白名单必须把本机回环也补进去。
   *
   * 真实踩到：监听 0.0.0.0 之后，浏览器打开 127.0.0.1:端口 会被来源边界 403，
   * 而页面上只写「请求来源不受信任」——看不出是白名单里少了 127.0.0.1。
   */
  it('★ --host 0.0.0.0 时，127.0.0.1 与 localhost 都在白名单里', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'security-wiring-'))
    srv = await createCloudServer({
      dir,
      port: 0,
      hostname: '0.0.0.0',
      watchProviders: false,
      adminAuth: true,
      adminToken: TOKEN,
      requestTrust: true,
    })
    const { port } = await srv.start()
    expect(srv.trust.hosts).toContain('127.0.0.1:' + port)
    expect(srv.trust.hosts).toContain('localhost:' + port)
    // 真的用 127.0.0.1 发一次写请求：来源边界放行 + 令牌正确 → 200
    const res = await fetch('http://127.0.0.1:' + port + '/api/canvas/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
      body: JSON.stringify({ update: [] }),
    })
    expect(res.status).toBe(200)
  })

  /**
   * trustedOrigins 写成大写 scheme / 带尾斜杠时，预检也要回 ACAO。
   *
   * 实请求靠来源边界（那边已经归一了）能过，预检却按原样字符串比 —— 结果是浏览器
   * 只报一句 `Failed to fetch`，看不出是配置笔误。
   */
  it('★ trustedOrigins 归一后再比（大写 / 尾斜杠不会让预检失效）', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'security-wiring-'))
    srv = await createCloudServer({
      dir,
      port: 0,
      watchProviders: false,
      adminAuth: true,
      adminToken: TOKEN,
      requestTrust: true,
      trustedOrigins: ['HTTP://LocalHost:5288/'],
    })
    const { port } = await srv.start()
    const pre = await fetch('http://127.0.0.1:' + port + '/api/canvas/nodes', {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:5288', 'access-control-request-method': 'POST' },
    })
    expect(pre.headers.get('access-control-allow-origin')).toBe('http://localhost:5288')
  })

  it('真实端口上的写请求能过来源边界；selfOrigin 也是真实端口', async () => {
    const { port } = await boot()
    expect(port).toBeGreaterThan(0)
    // 构造时传的是 0；起来后必须换成真实端口，否则 403 host-not-trusted
    expect(srv.trust.hosts).toContain('127.0.0.1:' + port)
    expect(srv.trust.hosts).not.toContain('127.0.0.1:0')
    expect(srv.ctx.tryGet<string>('selfOrigin')).toBe('http://127.0.0.1:' + port)

    // 用核心就有的增量写口（不依赖某个插件装没装）
    const res = await fetch('http://127.0.0.1:' + port + '/api/canvas/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
      body: JSON.stringify({ update: [] }),
    })
    expect(res.status).toBe(200)
  })
})

describe('写操作的审计成对：attempt → ok / rejected（M3）', () => {
  it('带令牌的成功写记 attempt + ok，动作能归类到 canvas/write', async () => {
    const { port } = await boot()
    await fetch('http://127.0.0.1:' + port + '/api/canvas/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
      body: JSON.stringify({ update: [] }),
    })
    const lines = await readAudit()
    const mine = lines.filter((l) => l.path === '/api/canvas/nodes' && l.action === 'canvas/write')
    expect(mine.map((l) => l.result)).toEqual(['attempt', 'ok'])
    expect(mine[0]!.token).toBe('ok')
  })

  it('缺令牌的写只记一条 auth-failed/rejected，且没有 attempt', async () => {
    const { port } = await boot()
    const res = await fetch('http://127.0.0.1:' + port + '/api/canvas/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ update: [] }),
    })
    expect(res.status).toBe(403)
    const lines = await readAudit()
    expect(lines.filter((l) => l.action === 'auth-failed').map((l) => l.result)).toEqual(['rejected'])
    expect(lines.some((l) => l.result === 'attempt')).toBe(false)
  })

  it('令牌对但业务 400：attempt 有结局，结局是 rejected 带状态码', async () => {
    const { port } = await boot()
    const res = await fetch('http://127.0.0.1:' + port + '/api/canvas/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
      body: 'not json',
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    const lines = await readAudit()
    const mine = lines.filter((l) => l.action === 'canvas/write')
    expect(mine[mine.length - 1]!.result).toBe('rejected')
    expect(String(mine[mine.length - 1]!.reason)).toMatch(/^http-4/)
  })

  /**
   * ★ 整画布覆盖（PUT）不要令牌（首版取舍），但它必须留审计。
   *
   * 审查 N2 实测：写完整张画布后 audit.log 一行没多 —— 而它是最彻底的一种改法。
   */
  it('★ PUT 整画布覆盖：不要求令牌，但记 attempt + ok（canvas/overwrite）', async () => {
    const { port } = await boot()
    const res = await fetch('http://127.0.0.1:' + port + '/api/canvases/default', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodes: [], edges: [] }),
    })
    expect(res.status).toBe(200)
    const lines = await readAudit()
    const mine = lines.filter((l) => l.action === 'canvas/overwrite' && l.method === 'PUT')
    expect(mine.map((l) => l.result)).toEqual(['attempt', 'ok'])
    expect(mine[0]!.token).toBe('missing')
  })
})

describe('任务令牌只能写本节点的产物字段（M1）', () => {
  /**
   * ★ 被来源边界拒掉的写请求也要留审计。
   *
   * 这条中间件在令牌关之前就返回 403，后面的审计根本不会跑 ——
   * 而「谁在尝试从网页里改我的画布」恰好就是这一类。
   */
  it('★ 恶意 Origin / 伪造 Host 的写请求：403 且留一条 rejected 审计', async () => {
    const { port } = await boot()
    const bad = await fetch('http://127.0.0.1:' + port + '/api/canvas/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
      body: JSON.stringify({ update: [] }),
    })
    expect(bad.status).toBe(403)
    // 读请求被拒不留痕（DNS 重绑定探路不值得刷屏）
    await fetch('http://127.0.0.1:' + port + '/api/canvases', { headers: { origin: 'http://evil.example' } })

    const lines = await readAudit()
    const mine = lines.filter((l) => l.path === '/api/canvas/nodes')
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ action: 'auth-failed', result: 'rejected', origin: 'http://evil.example' })
    expect(String(mine[0]!.reason)).toBe('origin-not-trusted')
    expect(lines.some((l) => l.path === '/api/canvases' && l.result === 'rejected')).toBe(false)
  })

  it('/mcp 没有令牌，但每次调用都留 attempt + 工具名（M6 的最低要求）', async () => {
    const { port } = await boot()
    const res = await fetch('http://127.0.0.1:' + port + '/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'canvas_list_canvases', arguments: {} } }),
    })
    // 只要不是被来源边界拒掉就行（这里验的是审计，不验业务结果）
    expect(res.status).toBeLessThan(500)
    await res.text()
    const lines = await readAudit()
    const mine = lines.filter((l) => l.action === 'mcp/call')
    expect(mine[0]).toMatchObject({ result: 'attempt', path: '/mcp#canvas_list_canvases', token: 'disabled' })
    expect(mine.some((l) => l.result === 'ok' || l.result === 'rejected')).toBe(true)
  })

  it('独立调试源只拿到「写产物」这一条窄通道，不是可信来源', async () => {
    const { port } = await boot()
    const debugUrl = (srv.ctx.tryGet<{ url: string }>('debugOrigin') ?? { url: '' }).url
    expect(debugUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    // 关键：它**不在** trustedOrigins 里 —— 那上面的页面是用户 HTML
    expect(srv.trust.origins).not.toContain(debugUrl)
    // 预检必须放行 x-task-token，否则调试页只会看到 Failed to fetch
    const pre = await fetch('http://127.0.0.1:' + port + '/api/canvases/default/resources?slot=n1', {
      method: 'OPTIONS',
      headers: {
        origin: debugUrl,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-task-token',
      },
    })
    expect(pre.status).toBeLessThan(400)
    expect((pre.headers.get('access-control-allow-headers') ?? '').toLowerCase()).toContain('x-task-token')


    // 同一个来源打别的接口：来源边界直接拒（不是靠令牌兜底）
    for (const [path, method] of [
      ['/api/canvas/nodes', 'POST'],
      ['/api/kv/settings', 'PUT'],
      ['/api/canvases/default/nodes', 'POST'],
      ['/api/task/call', 'POST'],
      ['/api/server-plugins/install', 'POST'],
    ] as const) {
      const res = await fetch('http://127.0.0.1:' + port + path, {
        method,
        headers: { 'content-type': 'application/json', origin: debugUrl },
        body: '{}',
      })
      expect(res.status, path).toBe(403)
    }
  })

  it('★ 调试页（另一个端口）能用短令牌真把产物写回本节点', async () => {
    const { port } = await boot()
    const debugUrl = (srv.ctx.tryGet<{ url: string }>('debugOrigin') ?? { url: '' }).url
    const tokens = srv.ctx.tryGet<{ issue(c: string, n: string): string }>('taskTokens')!
    const token = tokens.issue('default', 'n1')
    // 这条请求的 Origin 是调试源（与后台不同源）：来源边界、CORS、令牌、上传四关全过才 200
    const res = await fetch('http://127.0.0.1:' + port + '/api/canvases/default/resources?slot=n1&name=out.png', {
      method: 'POST',
      headers: { 'content-type': 'image/png', origin: debugUrl, 'x-task-token': token },
      body: new Uint8Array([137, 80, 78, 71]),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe(debugUrl)
    const body = (await res.json()) as { ok?: boolean; url?: string }
    expect(body.ok).toBe(true)
    expect(body.url).toBe('/api/canvases/default/resources/slot-n1.png')
  })

  it('同样的短令牌，换个画布 / 换个槽位一律 403', async () => {
    const { port } = await boot()
    const debugUrl = (srv.ctx.tryGet<{ url: string }>('debugOrigin') ?? { url: '' }).url
    const tokens = srv.ctx.tryGet<{ issue(c: string, n: string): string }>('taskTokens')!
    const token = tokens.issue('default', 'n1')
    const bad = await fetch('http://127.0.0.1:' + port + '/api/canvases/default/resources?slot=n2&name=out.png', {
      method: 'POST',
      headers: { 'content-type': 'image/png', origin: debugUrl, 'x-task-token': token },
      body: new Uint8Array([1, 2, 3]),
    })
    expect(bad.status).toBe(403)
  })

  type Verify = (input: { token?: string; canvasId: string; body: Record<string, unknown> }) => boolean

  it('update 自己的产物字段放行；夹带 uiHtml / 改别的节点 / add 一律拒', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'security-wiring-'))
    srv = await createCloudServer({ dir, watchProviders: false })
    const tokens = srv.ctx.tryGet<{ issue(c: string, n: string): string }>('taskTokens')!
    const verify = srv.ctx.tryGet<Verify>('verifyTaskWrite')!
    const token = tokens.issue('c1', 'n1')

    // 正路：脚本把产物写回自己
    expect(verify({ token, canvasId: 'c1', body: { update: [{ id: 'n1', data: { uiOutputUrl: '/x.png' } }] } })).toBe(true)
    expect(verify({ token, canvasId: 'c1', body: { update: [{ id: 'n1', data: { imageUrl: '/a.png', text: 'hi' } }] } })).toBe(true)

    // 夹带界面代码：脚本不该能给自己换一套 HTML
    expect(verify({ token, canvasId: 'c1', body: { update: [{ id: 'n1', data: { uiHtml: '<script>x</script>' } }] } })).toBe(false)
    expect(
      verify({ token, canvasId: 'c1', body: { update: [{ id: 'n1', data: { uiOutputUrl: '/x.png', uiScripts: 'evil' } }] } }),
    ).toBe(false)

    // 改别的节点 / 增删
    expect(verify({ token, canvasId: 'c1', body: { update: [{ id: 'n2', data: { uiOutputUrl: '/x.png' } }] } })).toBe(false)
    expect(verify({ token, canvasId: 'c1', body: { add: [{ id: 'n1', data: { uiOutputUrl: '/x.png' } }] } })).toBe(false)
    expect(verify({ token, canvasId: 'c1', body: { delete: ['n1'] } })).toBe(false)
    // 跨画布
    expect(verify({ token, canvasId: 'c2', body: { update: [{ id: 'n1', data: { text: 'x' } }] } })).toBe(false)
    // 空 update / 没有 update
    expect(verify({ token, canvasId: 'c1', body: { update: [] } })).toBe(false)
    expect(verify({ token, canvasId: 'c1', body: {} })).toBe(false)
    // 没有令牌
    expect(verify({ canvasId: 'c1', body: { update: [{ id: 'n1', data: { text: 'x' } }] } })).toBe(false)
  })
})
