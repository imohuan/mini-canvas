import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiUrl, friendlyError, putRoot, reload, resolveApiBase } from './api'

/** 记录每次 fetch 的头；返回一个成功响应 */
function stubFetch() {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ ok: true, root: '/x', itemCount: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', impl)
  return calls
}

const g = globalThis as { localStorage?: unknown }
beforeEach(() => {
  g.localStorage = {
    m: new Map<string, string>(),
    getItem(k: string) { return (this as unknown as { m: Map<string, string> }).m.get(k) ?? null },
    setItem(k: string, v: string) { (this as unknown as { m: Map<string, string> }).m.set(k, v) },
    removeItem(k: string) { (this as unknown as { m: Map<string, string> }).m.delete(k) },
  }
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete g.localStorage
})

describe('写接口带管理令牌', () => {
  it('★ putRoot / reload 都带 x-admin-token', async () => {
    ;(g.localStorage as { setItem(k: string, v: string): void }).setItem('mc_admin_token', 'tok')
    const calls = stubFetch()
    await putRoot('', 'style', '/assets')
    await reload('', 'style')
    await putRoot('', 'effect', '/effects')
    await reload('', 'effect')
    for (const c of calls) {
      expect((c.init?.headers as Record<string, string>)['x-admin-token']).toBe('tok')
    }
    expect(calls.map((c) => c.url)).toEqual([
      '/api/style-library/settings',
      '/api/style-library/reload',
      '/api/effect-library/settings',
      '/api/effect-library/reload',
    ])
  })

  it('没有令牌时不带这个头（不是空串）', async () => {
    const calls = stubFetch()
    await reload('', 'style')
    expect((calls[0]!.init?.headers as Record<string, string>)['x-admin-token']).toBeUndefined()
  })
})

describe('apiUrl', () => {
  it('base 为空 = 同源相对路径', () => {
    expect(apiUrl('', '/api/style-library/items')).toBe('/api/style-library/items')
  })
  it('base 非空时补齐斜杠', () => {
    expect(apiUrl('http://127.0.0.1:8865', '/api/x')).toBe('http://127.0.0.1:8865/api/x')
    expect(apiUrl('http://127.0.0.1:8865', 'api/x')).toBe('http://127.0.0.1:8865/api/x')
  })
  it('绝对地址原样返回', () => {
    expect(apiUrl('http://a', 'https://b/c')).toBe('https://b/c')
  })
})

describe('resolveApiBase', () => {
  it('无 ctx → 空串（同源）', () => {
    expect(resolveApiBase(undefined)).toBe('')
  })
  it('优先读设置里的服务地址，并去掉尾斜杠', () => {
    const ctx = { tryGet: (n: string) => (n === 'settings' ? { get: () => 'http://x:1/' } : undefined) }
    expect(resolveApiBase(ctx)).toBe('http://x:1')
  })
  it('设置没有则回落 cloud-client 运行时服务', () => {
    const ctx = {
      tryGet: (n: string) =>
        n === 'cloud-client' ? { status: () => ({ baseUrl: 'http://y:2' }) } : undefined,
    }
    expect(resolveApiBase(ctx)).toBe('http://y:2')
  })
  it('都没有 → 空串', () => {
    const ctx = { tryGet: () => undefined }
    expect(resolveApiBase(ctx)).toBe('')
  })
})

describe('friendlyError', () => {
  it('HTML 应答翻成人话（提示服务地址 / 后台半）', () => {
    const msg = friendlyError("Unexpected token '<'")
    expect(msg).toContain('cloud-server')
    expect(msg).not.toContain('Unexpected')
  })
  it('其它错误原样返回', () => {
    expect(friendlyError('目录不存在：X')).toBe('目录不存在：X')
  })
})

