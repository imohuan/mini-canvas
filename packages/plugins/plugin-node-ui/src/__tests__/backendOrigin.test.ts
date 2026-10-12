import { describe, it, expect } from 'vitest'
import { selfOrigin } from '../server'
import { fetchBackendOrigin, type FetchLike } from '../uiOrigin'

/** 造一个假的后台响应 */
function fakeFetch(handler: (url: string) => Partial<{ ok: boolean; status: number; json: () => Promise<unknown> }>): FetchLike {
  return async (url) => {
    const r = handler(url)
    return { ok: r.ok ?? true, status: r.status ?? 200, json: r.json ?? (async () => ({})) }
  }
}

describe('后台自报地址（生成页面要直连它）', () => {
  it('从 Host 头推出 origin', () => {
    const c = { req: { header: (n: string) => (n === 'host' ? 'localhost:8865' : undefined), url: 'http://x/api', json: async () => ({}) }, json: () => new Response() }
    expect(selfOrigin(c)).toBe('http://localhost:8865')
  })

  it('经代理时优先用 x-forwarded-proto', () => {
    const c = {
      req: {
        header: (n: string) => (n === 'host' ? 'example.com' : n === 'x-forwarded-proto' ? 'https' : undefined),
        url: 'http://x/api',
        json: async () => ({}),
      },
      json: () => new Response(),
    }
    expect(selfOrigin(c)).toBe('https://example.com')
  })

  it('没有 Host 头 = 空串（调用方回落同源，而不是编一个地址）', () => {
    const c = { req: { header: () => undefined, url: 'http://x/api', json: async () => ({}) }, json: () => new Response() }
    expect(selfOrigin(c)).toBe('')
  })
})

describe('问后台要它的地址（前端用）', () => {
  it('拿到就返回它', async () => {
    const impl = fakeFetch(() => ({ json: async () => ({ ok: true, origin: 'http://localhost:8865' }) }))
    expect(await fetchBackendOrigin('', { fetchImpl: impl })).toBe('http://localhost:8865')
  })

  it('后台没这个接口 / 回的不是对象 = 空串（不抛）', async () => {
    const impl = fakeFetch(() => ({ ok: false, status: 404, json: async () => ({}) }))
    expect(await fetchBackendOrigin('', { fetchImpl: impl })).toBe('')
  })

  it('网络挂了 = 空串（纯前端场景不该报错）', async () => {
    const impl: FetchLike = async () => { throw new Error('ECONNREFUSED') }
    expect(await fetchBackendOrigin('', { fetchImpl: impl })).toBe('')
  })

  it('拼的是 /api/node-ui/info', async () => {
    let seen = ''
    const impl = fakeFetch((url) => { seen = url; return { json: async () => ({ origin: 'http://x' }) } })
    await fetchBackendOrigin('http://localhost:8865/', { fetchImpl: impl })
    expect(seen).toBe('http://localhost:8865/api/node-ui/info')
  })
})

