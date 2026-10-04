/**
 * CloudKvAdapter —— 把 config / shortcut 这两格接到服务器 KV 接口。
 *
 * 为什么要有它：云模式下不换这两格，设置与快捷键就留在浏览器 local，换台机器全丢。
 * 这里锁两条：① 读写走对的 URL；② **404 = 从未保存过 → undefined**（不能把 404 当错误）。
 */
import { describe, it, expect } from 'vitest'
import { createCloudKvAdapter, bareKvKey } from '../cloudKvAdapter'
import type { FetchLike } from '../apiTypes'

/** 假后端：KV 读写，记录收到的请求 */
function fakeBackend(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial))
  const calls: Array<{ method: string; path: string }> = []
  const fetchImpl: FetchLike = async (url, init) => {
    const path = String(url).replace('http://srv', '')
    const method = init?.method ?? 'GET'
    calls.push({ method, path })
    if (method === 'GET') {
      const key = decodeURIComponent(path.split('/').pop() ?? '')
      if (!store.has(key)) return new Response(JSON.stringify({ ok: false }), { status: 404 })
      return new Response(JSON.stringify({ value: store.get(key) }), { status: 200 })
    }
    if (method === 'PUT') {
      const key = decodeURIComponent(path.split('/').pop() ?? '')
      store.set(key, JSON.parse(String(init?.body ?? '{}')).value)
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  return { fetchImpl, calls, store }
}

describe('bareKvKey：物理 key → 裸 key', () => {
  it('摘掉 type 前缀（URL 里 type 是独立一段）', () => {
    expect(bareKvKey('config', 'config:settings')).toBe('settings')
    expect(bareKvKey('config', 'settings')).toBe('settings')
  })
})

describe('CloudKvAdapter', () => {
  it('set / get 走 /api/kv/<type>/<key>，值保持一致', async () => {
    const b = fakeBackend()
    const a = createCloudKvAdapter({ baseUrl: 'http://srv', type: 'config', fetchImpl: b.fetchImpl })
    await a.set('config:settings', { theme: 'dark' })
    expect(await a.get('config:settings')).toEqual({ theme: 'dark' })
    expect(b.calls[0].path).toBe('/api/kv/config/settings')
    expect(b.calls[0].method).toBe('PUT')
  })

  it('从未保存过 → 404 → 返回 undefined（不是错误）', async () => {
    const b = fakeBackend()
    const a = createCloudKvAdapter({ baseUrl: 'http://srv', type: 'shortcut', fetchImpl: b.fetchImpl })
    await expect(a.get('shortcut:map')).resolves.toBeUndefined()
  })

  it('remove 幂等：删不存在的也算成功', async () => {
    const b = fakeBackend()
    const a = createCloudKvAdapter({ baseUrl: 'http://srv', type: 'config', fetchImpl: b.fetchImpl })
    await expect(a.remove('config:foo')).resolves.toBeUndefined()
  })

  it('shortcut 域走自己的 URL（两格互不干扰）', async () => {
    const b = fakeBackend()
    const a = createCloudKvAdapter({ baseUrl: 'http://srv', type: 'shortcut', fetchImpl: b.fetchImpl })
    await a.set('shortcut:map', { save: 'Ctrl+S' })
    expect(b.calls[0].path).toBe('/api/kv/shortcut/map')
  })

  it('服务端 5xx → 抛错（不静默吞掉，免得"存了没存上"看不出来）', async () => {
    const fetchImpl: FetchLike = async () => new Response('boom', { status: 500 })
    const a = createCloudKvAdapter({ baseUrl: 'http://srv', type: 'config', fetchImpl })
    await expect(a.set('config:x', 1)).rejects.toThrow()
  })
})

