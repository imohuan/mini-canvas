/**
 * 项目 / 画布 / 资产这层请求的令牌。
 *
 * 这里的 `req()` 是一个统一出口，写路径（`POST /api/canvases/:id/duplicate` 等）在管理令牌
 * 清单里。以前它裸 fetch —— 表现是「复制画布」点下去 403，而错误只说「请求失败」，
 * 看不出是没带令牌。这里钉住：写请求带上了，且没破坏原来的头。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { duplicateCanvas, renameCanvas, deleteCanvas, listCanvases } from '../composables/projectsApi'

interface Call {
  url: string
  init?: RequestInit
}

const calls: Call[] = []

function stubFetch(body: unknown = { ok: true, canvas: { id: 'c1' }, canvases: [], project: { id: 'p1' }, asset: {} }) {
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', impl)
}

const g = globalThis as { localStorage?: unknown }

beforeEach(() => {
  calls.length = 0
  g.localStorage = {
    m: new Map<string, string>([['mc_admin_token', 'tok-abc']]),
    getItem(k: string) { return (this as unknown as { m: Map<string, string> }).m.get(k) ?? null },
    setItem(k: string, v: string) { (this as unknown as { m: Map<string, string> }).m.set(k, v) },
    removeItem(k: string) { (this as unknown as { m: Map<string, string> }).m.delete(k) },
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete g.localStorage
})

function headersOf(i?: RequestInit): Record<string, string> {
  return Object.fromEntries(new Headers(i?.headers).entries())
}

describe('projectsApi：写请求带管理令牌', () => {
  it('★ 复制画布（POST .../duplicate）带令牌，content-type 还在', async () => {
    stubFetch()
    await duplicateCanvas('c1')
    expect(calls[0]!.url).toBe('/api/canvases/c1/duplicate')
    expect(calls[0]!.init?.method).toBe('POST')
    expect(headersOf(calls[0]!.init)['x-admin-token']).toBe('tok-abc')
  })

  it('★ 改名（PATCH）与删除（DELETE）也带令牌', async () => {
    stubFetch({ ok: true })
    await renameCanvas('c1', '新名字')
    await deleteCanvas('c1')
    expect(headersOf(calls[0]!.init)['x-admin-token']).toBe('tok-abc')
    expect(headersOf(calls[0]!.init)['content-type']).toBe('application/json')
    expect(headersOf(calls[1]!.init)['x-admin-token']).toBe('tok-abc')
  })

  it('读接口不传 init 时也不会炸（令牌可有可无）', async () => {
    stubFetch({ canvases: [] })
    await expect(listCanvases('p1')).resolves.toEqual([])
    expect(calls[0]!.url).toBe('/api/projects/p1/canvases')
  })
})
