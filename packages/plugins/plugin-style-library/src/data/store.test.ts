import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createStyleLibraryService, createLibraryService, PAGE_SIZE } from './store'

/** 造一个假的 /items 响应 */
function page(offset: number, limit: number, total = 200) {
  const n = Math.max(0, Math.min(limit, total - offset))
  return {
    ok: true, offset, limit, total, hasMore: offset + n < total,
    items: Array.from({ length: n }, (_, i) => ({
      id: offset + i, name: 'item' + (offset + i), author: 'a', category: 'c', tags: [],
      commercial: false, exclusive: false, runCount: 0, likeCount: 0, imageCount: 1,
      cover: '/c', images: ['/c'], videos: [],
    })),
  }
}

describe('style-library 数据服务', () => {
  let calls: string[]
  beforeEach(() => {
    calls = []
    vi.stubGlobal('fetch', (url: string) => {
      calls.push(String(url))
      const u = new URL(String(url), 'http://x')
      if (u.pathname.endsWith('/items')) {
        const offset = Number(u.searchParams.get('offset') ?? 0)
        const limit = Number(u.searchParams.get('limit') ?? PAGE_SIZE)
        return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(page(offset, limit))) })
      }
      if (u.pathname.endsWith('/meta')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify({
            ok: true, root: 'X:/r', source: 'index', itemCount: 200, fileCount: 400,
            categories: [{ name: 'c', count: 200 }], scannedAt: 'now',
          })),
        })
      }
      return Promise.resolve({ ok: true, text: () => Promise.resolve('{}') })
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('refresh 拉首屏、loadMore 追加下一页', async () => {
    const svc = createStyleLibraryService({ pageSize: 40 })
    await svc.refresh()
    expect(svc.state.items.length).toBe(40)
    expect(svc.state.total).toBe(200)
    expect(svc.state.hasMore).toBe(true)
    await svc.loadMore()
    expect(svc.state.items.length).toBe(80)
    // 追加是"接着 offset 拉"，不是重拉首屏
    expect(calls.filter((c) => c.includes('offset=40')).length).toBe(1)
  })

  it('并发 loadMore 被闸门挡住（只发一次请求）', async () => {
    const svc = createStyleLibraryService({ pageSize: 40 })
    await svc.refresh()
    const before = calls.length
    await Promise.all([svc.loadMore(), svc.loadMore(), svc.loadMore()])
    expect(calls.length - before).toBe(1)
    expect(svc.state.items.length).toBe(80)
  })

  it('setPageSize 立即生效（重置分页按新粒度重拉）', async () => {
    const svc = createStyleLibraryService({ pageSize: 40 })
    await svc.refresh()
    expect(svc.state.items.length).toBe(40)
    await svc.setPageSize(12)
    expect(svc.state.items.length).toBe(12)
    await svc.setPageSize(12) // 同值：不重复请求
    const n = calls.length
    await svc.setPageSize(12)
    expect(calls.length).toBe(n)
  })

  it('setCategory / setQuery 重置分页并带上参数', async () => {
    const svc = createStyleLibraryService({ pageSize: 40 })
    await svc.refresh()
    await svc.loadMore()
    expect(svc.state.items.length).toBe(80)
    await svc.setCategory('摄影写真')
    expect(svc.state.items.length).toBe(40) // 重置回一页
    expect(String(calls.at(-1))).toContain('category=')
    await svc.setQuery('猫')
    expect(String(calls.at(-1))).toContain('q=')
  })

  it('state 是响应式的（服务注入后改动能被 Vue 追踪）', async () => {
    const { isReactive } = await import('vue')
    const svc = createStyleLibraryService({ pageSize: 40 })
    expect(isReactive(svc.state)).toBe(true)
  })

  it('loadMore 失败不清空已有列表', async () => {
    const svc = createStyleLibraryService({ pageSize: 40 })
    await svc.refresh()
    vi.stubGlobal('fetch', () => Promise.reject(new Error('网络断了')))
    await svc.loadMore()
    expect(svc.state.items.length).toBe(40) // 已有数据还在
    expect(svc.state.error).toContain('网络断了')
  })

  it('特效库打的是 /api/effect-library 前缀（两库共用一套逻辑、不同路由）', async () => {
    const svc = createLibraryService('effect', { pageSize: 20 })
    await svc.refresh()
    expect(svc.state.kind).toBe('effect')
    expect(calls.some((c) => c.includes('/api/effect-library/items'))).toBe(true)
    expect(calls.some((c) => c.includes('/api/effect-library/meta'))).toBe(true)
  })

  it('风格库打的是 /api/style-library 前缀', async () => {
    const svc = createLibraryService('style', { pageSize: 20 })
    await svc.refresh()
    expect(svc.state.kind).toBe('style')
    expect(calls.some((c) => c.includes('/api/style-library/items'))).toBe(true)
  })
})
