/**
 * 登录会话：签名 cookie，默认 30 天。
 *
 * 为什么不把令牌写进 cookie：浏览器里的脚本读不到 HttpOnly cookie，令牌不会泄露；
 * cookie 里只有一个过期时间和签名，伪造不了。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export const AUTH_COOKIE_NAME = 'plume_session'
/** 30 天 */
export const AUTH_SESSION_TTL_S = 30 * 24 * 60 * 60

interface Payload {
  exp: number
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

/** 读 cookie 头里某个名字的值 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}

export interface AuthSession {
  issue(now?: number): Promise<{ value: string; cookie: string }>
  verify(value: string | undefined, now?: number): Promise<boolean>
  clearCookie(): string
}

export async function createAuthSession(getSecret: () => Promise<string | undefined>): Promise<AuthSession> {
  /**
   * dev 下前端 5288、后台 8865：同站不同源，`SameSite=Lax` 仍然会带 cookie；
   * 若用户把后台放到另一个站点，需要 `SameSite=None; Secure`（HTTPS）——
   * 这条先按同站处理，跨站部署时由部署者显式放开（见 admin-auth 文档）。
   */
  const cookieHeader = (value: string, maxAge: number): string =>
    AUTH_COOKIE_NAME + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge

  return {
    async issue(now = Date.now()) {
      const secret = await getSecret()
      if (!secret) throw new Error('尚未设置登录令牌，不能签发会话')
      const payload: Payload = { exp: Math.floor(now / 1000) + AUTH_SESSION_TTL_S }
      const body = b64url(JSON.stringify(payload))
      const value = body + '.' + sign(secret, body)
      return { value, cookie: cookieHeader(value, AUTH_SESSION_TTL_S) }
    },
    async verify(value, now = Date.now()) {
      const raw = String(value ?? '')
      const dot = raw.lastIndexOf('.')
      if (dot <= 0) return false
      const body = raw.slice(0, dot)
      const sig = raw.slice(dot + 1)
      const secret = await getSecret()
      if (!secret) return false
      const want = Buffer.from(sign(secret, body))
      const got = Buffer.from(sig)
      if (want.length !== got.length || !timingSafeEqual(want, got)) return false
      try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Payload
        return typeof payload.exp === 'number' && payload.exp * 1000 > now
      } catch {
        return false
      }
    },
    clearCookie() {
      return cookieHeader('', 0)
    },
  }
}
