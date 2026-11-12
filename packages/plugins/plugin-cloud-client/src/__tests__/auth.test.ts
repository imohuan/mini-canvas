/**
 * cloud-client 的登录：只发四个请求、不存明文、最短 5 位、cookie 要带上。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudAuth, validateTokenInput } from '../auth.js'

type Call = { url: string; init: RequestInit & { credentials?: RequestCredentials } }

function fakeFetch(reply: (url: string) => { status?: number; body?: unknown }) {
  const calls: Call[] = []
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    const r = reply(String(url))
    return {
      ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
      status: r.status ?? 200,
      json: async () => r.body ?? {},
    } as Response
  }
  return { calls, fetchImpl }
}

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('validateTokenInput', () => {
  it('最短 5 位（前后空白不算）', () => {
    expect(validateTokenInput('abcd')).toBeTruthy()
    expect(validateTokenInput('  abcd  ')).toBeTruthy()
    expect(validateTokenInput('abcde')).toBeUndefined()
  })
})

describe('CloudAuth', () => {
  it('status/登录/退出都带 cookie 凭据', async () => {
    const { calls, fetchImpl } = fakeFetch((url) => {
      if (url.endsWith('/api/auth/status')) return { body: { ok: true, enabled: true, configured: true, authed: false } }
      return { body: { ok: true } }
    })
    const auth = new CloudAuth({ baseUrl: '', fetchImpl })
    await auth.refresh()
    await auth.login('abcde')
    await auth.logout()
    expect(calls.length).toBeGreaterThanOrEqual(3)
    for (const c of calls) expect(c.init.credentials).toBe('include')
  })

  it('没有明文令牌被写进 localStorage', async () => {
    const { fetchImpl } = fakeFetch(() => ({ body: { ok: true, enabled: true, configured: true, authed: false } }))
    const auth = new CloudAuth({ baseUrl: '', fetchImpl })
    await auth.refresh()
    await auth.login('my-secret-token')
    expect(localStorage.getItem('plume_admin_token')).toBeNull()
  })

  it('登录失败把后台错误原样给出', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 401, body: { ok: false, error: '令牌不对' } }))
    const auth = new CloudAuth({ baseUrl: '', fetchImpl })
    expect(await auth.login('abcde')).toBe('令牌不对')
  })

  it('后台不可达时 status 视为“不需要登录”，不锁死界面', async () => {
    const auth = new CloudAuth({
      baseUrl: '',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED')
      },
    })
    const s = await auth.refresh()
    expect(s.enabled).toBe(false)
    expect(s.authed).toBe(true)
  })
})
