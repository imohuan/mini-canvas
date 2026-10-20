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
})

describe('任务令牌只能写本节点的产物字段（M1）', () => {
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
