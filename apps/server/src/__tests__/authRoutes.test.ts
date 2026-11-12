/**
 * 登录接口：最短 5 位、会话 cookie 能过受保护写接口、恢复通道仍然可用。
 *
 * 两个层面分开测，避免“裸 Request 没有 TCP 对端”把「首设只限本机」和
 * 「登录后能写」混在一起：
 *   ① authRoutes 直连，注入 isLocal（本机语义）；
 *   ② 真实 createCloudServer，账号预先建好，验中间件与 cookie 接线。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer } from '../server.js'
import { createAuthAccount } from '../authAccount.js'
import { createAuthSession } from '../authSession.js'
import { authRoutes } from '../routes/auth.js'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plume-auth-route-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function routes(opts: { local?: boolean; auto?: boolean } = {}) {
  const account = await createAuthAccount({ dataDir: dir })
  const session = await createAuthSession(() => account.secret())
  const app = authRoutes({
    account,
    session,
    enabled: true,
    autoLoginLocal: opts.auto !== false,
    isLocal: () => opts.local === true,
  })
  const post = async (p: string, body: unknown): Promise<Response> =>
    await app.fetch(
      new Request('http://x' + p, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
  return { app, post, account }
}

describe('authRoutes', () => {
  it('少于 5 位拒绝，5 位成功并当场发会话', async () => {
    const { post } = await routes({ local: true })
    expect((await post('/api/auth/setup', { token: 'abcd' })).status).toBe(400)
    const ok = await post('/api/auth/setup', { token: 'abcde' })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('set-cookie') ?? '').toContain('plume_session=')
  })

  it('非本机不能抢先设置令牌', async () => {
    const { post } = await routes({ local: false })
    expect((await post('/api/auth/setup', { token: 'abcde' })).status).toBe(403)
  })

  it('设置过以后再 setup 一律 409（不会被人改掉）', async () => {
    const { post } = await routes({ local: true })
    await post('/api/auth/setup', { token: 'abcde' })
    expect((await post('/api/auth/setup', { token: 'other' })).status).toBe(409)
  })

  it('令牌不对 → 401；对了 → 发 HttpOnly cookie', async () => {
    const { post } = await routes({ local: true })
    await post('/api/auth/setup', { token: 'abcde' })
    expect((await post('/api/auth/login', { token: 'wrong' })).status).toBe(401)
    const good = await post('/api/auth/login', { token: 'abcde' })
    expect(good.status).toBe(200)
    expect(good.headers.get('set-cookie') ?? '').toContain('HttpOnly')
  })

  it('连续输错会被暂时拦住', async () => {
    const { post } = await routes({ local: true })
    await post('/api/auth/setup', { token: 'abcde' })
    for (let i = 0; i < 5; i++) expect((await post('/api/auth/login', { token: 'wrong' })).status).toBe(401)
    expect((await post('/api/auth/login', { token: 'abcde' })).status).toBe(429)
  })

  it('本机回环自动签发会话（已设置令牌时）', async () => {
    const { app, post } = await routes({ local: true })
    await post('/api/auth/setup', { token: 'abcde' })
    const res = await app.fetch(new Request('http://x/api/auth/status'))
    const body = (await res.json()) as { authed?: boolean; configured?: boolean }
    expect(body.configured).toBe(true)
    expect(body.authed).toBe(true)
    expect(res.headers.get('set-cookie') ?? '').toContain('plume_session=')
  })

  it('退出登录会清 cookie', async () => {
    const { post } = await routes({ local: true })
    await post('/api/auth/setup', { token: 'abcde' })
    const out = await post('/api/auth/logout', {})
    expect(out.status).toBe(200)
    expect(out.headers.get('set-cookie') ?? '').toContain('Max-Age=0')
  })
})

describe('登录后能过真实服务的受保护写接口', () => {
  let srv: Awaited<ReturnType<typeof createCloudServer>> | undefined

  async function boot() {
    const account = await createAuthAccount({ dataDir: dir })
    await account.setup('abcde')
    srv = await createCloudServer({
      port: 0,
      dir,
      requestTrust: false,
      mcp: false,
      agent: false,
      adminAuth: true,
      adminToken: 'f'.repeat(64),
    })
    return srv
  }

  afterEach(() => {
    srv?.stop()
    srv = undefined
  })

  it('没有会话 / 没有头 → 403；有会话 cookie → 放行', async () => {
    const server = await boot()
    const login = await server.app.fetch(
      new Request('http://x/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'abcde' }),
      }),
    )
    expect(login.status).toBe(200)
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!

    const write = async (headers: Record<string, string>): Promise<Response> =>
      await server.app.fetch(
        new Request('http://x/api/agent/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: '{}',
        }),
      )
    expect((await write({})).status).toBe(403)
    expect((await write({ cookie })).status).not.toBe(403)
  }, 20_000)

  it('恢复通道：x-admin-token 仍然能用', async () => {
    const server = await boot()
    const res = await server.app.fetch(
      new Request('http://x/api/agent/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-token': 'f'.repeat(64) },
        body: '{}',
      }),
    )
    expect(res.status).not.toBe(403)
  }, 20_000)

  /*
   * ★ 用户实测回归：登录成功后 Agent 仍报「需要登录」。
   * 根因是“未声明的写接口默认要验”把宿主直挂的本地测试模型端点
   * （`/api/test-model/v1/chat/completions`，Agent 对话走它）一起拦掉了。
   */
  it('★ 本地测试模型端点是公开的（不登录也要能过鉴权）', async () => {
    const server = await boot()
    const res = await server.app.fetch(
      new Request('http://x/api/test-model/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    expect(res.status).not.toBe(403)
  }, 20_000)

  it('★ 读了就不用登录：GET 的模型清单不会被令牌挡住', async () => {
    const server = await boot()
    const res = await server.app.fetch(new Request('http://x/api/agent/models'))
    expect(res.status).not.toBe(403)
  }, 20_000)
})
