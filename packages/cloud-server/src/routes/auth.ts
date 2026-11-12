/**
 * 登录接口（cloud-server 一侧）。
 *
 * 三个口子，全部不要求令牌（它们就是用来拿令牌的）：
 *   GET  /api/auth/status   → { configured, authed, local }
 *   POST /api/auth/setup    → 首次设置自定义令牌（只允许本人本机）
 *   POST /api/auth/login    → 校验令牌，发 30 天会话 cookie
 *   POST /api/auth/logout   → 清 cookie
 *   POST /api/auth/change   → 登录后换令牌（旧令牌立即作废）
 *
 * 安全问题必须说清楚：`setup` 只在**没有设置过令牌**时可用，并且只接受本机回环请求。
 * 否则远程任何人都能抢先把这台机器的令牌设成自己的。
 */
import { Hono } from 'hono'
import type { AuthAccount } from '../authAccount.js'
import type { AuthSession } from '../authSession.js'
import { AUTH_COOKIE_NAME, readCookie } from '../authSession.js'
import { isLoopbackRequest } from '../static.js'

export interface AuthRoutesOptions {
  account: AuthAccount
  session: AuthSession
  /** 关掉鉴权时（--no-admin-auth）所有接口都回“已登录” */
  enabled: boolean
  /** 本机回环时自动签发会话（用户口径 2026-11-12：本机打开不用输令牌） */
  autoLoginLocal?: boolean
  /** 登录失败限速：同一 IP 连续错 N 次后暂停。缺省 5 次 / 60 秒 */
  loginLimit?: { max: number; windowMs: number }
  /** 判断“是不是本机直连”。缺省用 TCP 对端 + Host + 无转发头的三重判定（见 static.ts） */
  isLocal?: (c: unknown) => boolean
}

export function authRoutes(opts: AuthRoutesOptions): Hono {
  const app = new Hono()
  const isLocal = opts.isLocal ?? isLoopbackRequest
  /**
   * 只允许同站读取本接口的 JSON。
   *
   * 为什么要它：`/api/auth/status` 会顺带回一个 Set-Cookie（本机自动登录）。
   * 若响应能被别的网站跨源读取，等于把“这台机器已经登录”变成一个可探测信号；
   * 这里统一 `no-store` 且禁缓存，避免中间层缓存了别人的会话状态。
   */
  app.use('/api/auth/*', async (c, next) => {
    c.header('cache-control', 'no-store')
    await next()
  })
  const limit = opts.loginLimit ?? { max: 5, windowMs: 60_000 }
  /** ip → { count, until } */
  const failures = new Map<string, { count: number; until: number }>()

  function clientKey(c: { req: { header(name: string): string | undefined } }): string {
    // 本机直连时用固定串即可；远程按 Host 区分（部署在反代后时由部署者自己配 trusted-host）
    return (c.req.header('x-forwarded-for') ?? c.req.header('host') ?? 'local').split(',')[0]!.trim()
  }

  function tooMany(key: string): number | undefined {
    const hit = failures.get(key)
    if (!hit) return undefined
    if (hit.count < limit.max) return undefined
    const left = hit.until - Date.now()
    return left > 0 ? left : undefined
  }

  function noteFailure(key: string): void {
    const now = Date.now()
    const hit = failures.get(key)
    if (!hit || hit.until < now) {
      failures.set(key, { count: 1, until: now + limit.windowMs })
      return
    }
    hit.count += 1
    if (hit.count >= limit.max) hit.until = now + limit.windowMs
  }

  async function sessionValue(c: { req: { header(name: string): string | undefined } }): Promise<{
    authed: boolean
    cookie?: string
  }> {
    if (!opts.enabled) return { authed: true }
    const existing = readCookie(c.req.header('cookie'), AUTH_COOKIE_NAME)
    if (existing && (await opts.session.verify(existing))) return { authed: true }
    // 本机回环：自动发一个会话（省掉首次输入）。没设过令牌时不发 —— 先让用户设一个。
    if (opts.autoLoginLocal && isLocal(c) && (await opts.account.isConfigured())) {
      try {
        const fresh = await opts.session.issue()
        return { authed: true, cookie: fresh.cookie }
      } catch {
        return { authed: false }
      }
    }
    return { authed: false }
  }

  app.get('/api/auth/status', async (c) => {
    const configured = opts.enabled ? await opts.account.isConfigured() : true
    const s = await sessionValue(c)
    if (s.cookie) c.header('set-cookie', s.cookie)
    return c.json({ ok: true, enabled: opts.enabled, configured, authed: s.authed, local: isLocal(c) })
  })

  app.post('/api/auth/setup', async (c) => {
    if (!isLocal(c)) {
      return c.json({ ok: false, error: '首次设置密码只允许在本机操作' }, 403)
    }
    if (await opts.account.isConfigured()) {
      return c.json({ ok: false, error: '已经设置过令牌' }, 409)
    }
    let body: { token?: unknown }
    try {
      body = (await c.req.json()) as { token?: unknown }
    } catch {
      return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    }
    const token = typeof body.token === 'string' ? body.token : ''
    const result = await opts.account.setup(token)
    if (result === 'too-short') return c.json({ ok: false, error: '密码至少要 5 位' }, 400)
    if (result === 'exists') return c.json({ ok: false, error: '已经设置过密码' }, 409)
    const fresh = await opts.session.issue()
    c.header('set-cookie', fresh.cookie)
    return c.json({ ok: true })
  })

  app.post('/api/auth/login', async (c) => {
    const key = clientKey(c)
    const blockedMs = tooMany(key)
    if (blockedMs) {
      return c.json({ ok: false, error: '尝试次数太多，请稍后再试' }, 429, {
        'retry-after': String(Math.ceil(blockedMs / 1000)),
      })
    }
    let body: { token?: unknown }
    try {
      body = (await c.req.json()) as { token?: unknown }
    } catch {
      return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    }
    const token = typeof body.token === 'string' ? body.token : ''
    if (!(await opts.account.verify(token))) {
      noteFailure(key)
      return c.json({ ok: false, error: '密码不对' }, 401)
    }
    failures.delete(key)
    const fresh = await opts.session.issue()
    c.header('set-cookie', fresh.cookie)
    return c.json({ ok: true })
  })

  app.post('/api/auth/logout', (c) => {
    c.header('set-cookie', opts.session.clearCookie())
    return c.json({ ok: true })
  })

  app.post('/api/auth/change', async (c) => {
    const s = await sessionValue(c)
    if (!s.authed) return c.json({ ok: false, error: '请先登录' }, 401)
    let body: { token?: unknown; current?: unknown }
    try {
      body = (await c.req.json()) as { token?: unknown; current?: unknown }
    } catch {
      return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    }
    // 换令牌是危险动作：必须再出示一次当前令牌，防止有人借你已登录的浏览器改掉
    const current = typeof body.current === 'string' ? body.current : ''
    if (!(await opts.account.verify(current))) return c.json({ ok: false, error: '当前密码不对' }, 401)
    const next = typeof body.token === 'string' ? body.token : ''
    const result = await opts.account.change(next)
    if (result === 'too-short') return c.json({ ok: false, error: '密码至少要 5 位' }, 400)
    if (result === 'not-configured') return c.json({ ok: false, error: '还没有设置过密码' }, 409)
    return c.json({ ok: true })
  })

  return app
}
