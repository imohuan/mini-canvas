import { describe, expect, it, vi } from 'vitest'
import { createPluginReloader, exposePluginReloader, findEntry, looksLikeUrl, type CatalogEntryLike } from '../pluginReload'

const ENTRIES: CatalogEntryLike[] = [
  { id: 'plugin-style-library', name: 'style-library', url: '/plugins/plugin-style-library/plugin-style-library.js', globalName: 'MiniCanvasPluginStyleLibrary' },
  { id: 'plugin-mini-map', name: 'mini-map', url: '/plugins/plugin-mini-map/plugin-mini-map.js', globalName: 'MiniCanvasPluginMiniMap' },
  { id: 'plugin-builtin-x', name: 'builtin-x', url: '', globalName: '' },
]

describe('findEntry', () => {
  it('按 id 找得到', () => {
    expect(findEntry(ENTRIES, 'plugin-style-library')?.name).toBe('style-library')
  })
  it('按运行时名也找得到', () => {
    expect(findEntry(ENTRIES, 'style-library')?.id).toBe('plugin-style-library')
  })
  it('都找不到 → undefined', () => {
    expect(findEntry(ENTRIES, 'nope')).toBeUndefined()
  })
})

describe('looksLikeUrl（判入参是不是 js 地址）', () => {
  it('产物地址认得出', () => {
    expect(looksLikeUrl('/plugins/plugin-style-library/plugin-style-library.js')).toBe(true)
    expect(looksLikeUrl('plugin-style-library.js')).toBe(true)
    expect(looksLikeUrl('https://cdn/x/y.js')).toBe(true)
    expect(looksLikeUrl('/plugins/x/x.js?v=1')).toBe(true)
    expect(looksLikeUrl('x.mjs')).toBe(true)
  })
  it('插件 id / 运行时名不当地址', () => {
    expect(looksLikeUrl('style-library')).toBe(false)
    expect(looksLikeUrl('plugin-style-library')).toBe(false)
    expect(looksLikeUrl('mini-map')).toBe(false)
  })
})

describe('createPluginReloader', () => {
  it('按 id 查清单 → 加载 → 卸旧装新；装完可执行 then 命令', async () => {
    const reloadPlugin = vi.fn()
    const runCommand = vi.fn()
    const loadUmd = vi.fn(async () => ({ name: 'style-library', apply() {} }))
    const fetcher = vi.fn(async () => ENTRIES)

    const r = createPluginReloader({
      fetchCatalog: fetcher,
      loadUmd,
      facade: () => ({ reloadPlugin, getContext: () => ({ get: () => ({ runCommand }) }) }),
    })

    const res = await r.reload('style-library', { then: 'style-library:open' })
    expect(res).toEqual({ name: 'style-library', url: '/plugins/plugin-style-library/plugin-style-library.js' })
    // 用了清单里声明的全局名（取件更稳）
    expect(loadUmd).toHaveBeenCalledWith('/plugins/plugin-style-library/plugin-style-library.js', 'MiniCanvasPluginStyleLibrary')
    // 先卸后装交给 reloadPlugin（它内部做这两步）
    expect(reloadPlugin).toHaveBeenCalledWith('style-library', expect.objectContaining({ name: 'style-library' }))
    expect(runCommand).toHaveBeenCalledWith('style-library:open')
  })

  it('opts.url 给了就不查清单', async () => {
    const fetcher = vi.fn(async () => ENTRIES)
    const loadUmd = vi.fn(async () => ({ name: 'x', apply() {} }))
    const r = createPluginReloader({
      fetchCatalog: fetcher,
      loadUmd,
      facade: () => ({ reloadPlugin: () => {}, getContext: () => ({ get: () => undefined }) }),
    })
    await r.reload('whatever', { url: '/plugins/x/x.js', globalName: 'MiniCanvasPluginX' })
    expect(fetcher).not.toHaveBeenCalled()
    expect(loadUmd).toHaveBeenCalledWith('/plugins/x/x.js', 'MiniCanvasPluginX')
  })

  it('直接把 js 地址当 target 也能重装（地址入参）', async () => {
    const fetcher = vi.fn(async () => ENTRIES)
    const loadUmd = vi.fn(async () => ({ name: 'style-library', apply() {} }))
    const reloadPlugin = vi.fn()
    const r = createPluginReloader({
      fetchCatalog: fetcher,
      loadUmd,
      facade: () => ({ reloadPlugin, getContext: () => ({ get: () => undefined }) }),
    })
    const res = await r.reload('/plugins/plugin-style-library/plugin-style-library.js')
    expect(res.name).toBe('style-library')
    // 不查清单定址（但会为反查全局名读一次缓存清单）
    expect(loadUmd).toHaveBeenCalledWith(
      '/plugins/plugin-style-library/plugin-style-library.js',
      'MiniCanvasPluginStyleLibrary', // 反查清单拿到的全局名
    )
    expect(reloadPlugin).toHaveBeenCalled()
  })

  it('地址入了但清单里没有这条 → 退化成不传全局名（加载器自己兜底取件）', async () => {
    const loadUmd = vi.fn(async () => ({ name: 'x', apply() {} }))
    const r = createPluginReloader({
      fetchCatalog: async () => ENTRIES,
      loadUmd,
      facade: () => ({ reloadPlugin: () => {}, getContext: () => ({ get: () => undefined }) }),
    })
    await r.reload('/plugins/unknown/unknown.js')
    expect(loadUmd).toHaveBeenCalledWith('/plugins/unknown/unknown.js', undefined)
  })

  it('完整地址（带 origin / 查询串）也能反查到全局名，不会挑错插件', async () => {
    // 模拟加载器行为：没全局名提示时说“我挑到了别的插件”，给了正确全局名才返回对的
    const loadUmd = vi.fn(async (_url: string, globalName?: string) =>
      globalName === 'MiniCanvasPluginStyleLibrary'
        ? { name: 'style-library', apply() {} }
        : { name: 'align-arrange', apply() {} },
    )
    const reloadPlugin = vi.fn()
    const r = createPluginReloader({
      fetchCatalog: async () => ENTRIES,
      loadUmd,
      facade: () => ({ reloadPlugin, getContext: () => ({ get: () => undefined }) }),
    })
    const res = await r.reload('http://127.0.0.1:8865/plugins/plugin-style-library/plugin-style-library.js?v=1')
    // 反查到了全局名 → 第二次带上它 → 加载器返回正确插件
    expect(res.name).toBe('style-library')
    expect(reloadPlugin).toHaveBeenCalledWith('style-library', expect.anything())
  })

  it('万一加载器挑错了插件名 → 用清单里的全局名重加载纠错', async () => {
    let calls = 0
    const loadUmd = vi.fn(async (_url: string, globalName?: string) => {
      calls++
      // 第一次（无提示）挑错；只有按对齐的全局名才返回正确插件
      if (globalName === 'MiniCanvasPluginStyleLibrary') return { name: 'style-library', apply() {} }
      return { name: 'wrong-plugin', apply() {} }
    })
    const reloadPlugin = vi.fn()
    const r = createPluginReloader({
      // 故意让反查拿不到全局名：清单里的 globalName 为空
      fetchCatalog: async () => [{ id: 'plugin-style-library', name: 'style-library', url: '/plugins/plugin-style-library/plugin-style-library.js', globalName: '' }],
      loadUmd,
      facade: () => ({ reloadPlugin, getContext: () => ({ get: () => undefined }) }),
    })
    // 没有全局名可纠（清单里也是空）→ 只能接受首次结果，但至少不应崩
    const res = await r.reload('/plugins/plugin-style-library/plugin-style-library.js')
    // 旧约定兜底：mod.name='wrong-plugin' 推导 MiniCanvasPluginWrongPlugin ≠ 对齐名，
    // 加载器第二次仍返回 wrong-plugin → 保留首次结果，共 2 次调用
    expect(res.name).toBe('wrong-plugin')
    expect(calls).toBe(2)
  })

  it('清单里没有该插件 → 抛清晰错误', async () => {
    const r = createPluginReloader({
      fetchCatalog: async () => ENTRIES,
      loadUmd: async () => ({ name: 'y', apply() {} }),
      facade: () => ({ reloadPlugin: () => {}, getContext: () => ({ get: () => undefined }) }),
    })
    await expect(r.reload('does-not-exist')).rejects.toThrow(/清单里找不到插件/)
  })

  it('宿主没就绪（没有 MiniCanvasUI）→ 抛清晰错误', async () => {
    const r = createPluginReloader({
      fetchCatalog: async () => ENTRIES,
      loadUmd: async () => ({ name: 'z', apply() {} }),
      facade: () => undefined,
    })
    await expect(r.reload('style-library')).rejects.toThrow(/宿主还没就绪/)
  })

  it('已装判定只来自 host.manager.list()：旧 ctx 里同名条目不算', async () => {
    const r = createPluginReloader({
      fetchCatalog: async () => ENTRIES,
      loadUmd: async () => ({ name: 'style-library', apply() {} }),
      facade: () => ({
        reloadPlugin: () => {},
        // 旧 ctx 故意列一条：如果实现回退到 ctx.get('pluginManager')，这里会让断言变红。
        getContext: () => ({ get: () => ({ list: () => [{ name: 'mini-map' }] }) }),
        getHost: () => ({ manager: { list: () => [{ name: 'style-library' }] } }),
      }),
    })
    const rows = await r.list()
    // 只认 manager：style-library 已装，mini-map 未装（旧 ctx 那条不能“救活”它）
    expect(rows.find((x) => x.name === 'style-library')?.installed).toBe(true)
    expect(rows.find((x) => x.name === 'mini-map')?.installed).toBe(false)
    expect(rows.some((x) => x.name === 'builtin-x')).toBe(false)
  })
})

describe('exposePluginReloader', () => {
  it('watch()：收到 SSE 变更 → 自动 reload；返回的函数能停掉监听', async () => {
    // 假 EventSource：手动触发 onmessage，验证 watch 的接线
    const instances: Array<{ url: string; onmessage: ((e: { data: string }) => void) | null; closed: boolean }> = []
    class FakeES {
      url: string
      onmessage: ((e: { data: string }) => void) | null = null
      closed = false
      constructor(url: string) {
        this.url = url
        instances.push(this as never)
      }
      close() { this.closed = true }
    }
    vi.stubGlobal('EventSource', FakeES)

    const reloadPlugin = vi.fn()
    const loadUmd = vi.fn(async () => ({ name: 'style-library', apply() {} }))
    const onEvent = vi.fn()
    const r = createPluginReloader({
      fetchCatalog: async () => ENTRIES,
      loadUmd,
      facade: () => ({ reloadPlugin, getContext: () => ({ get: () => undefined }) }),
    })

    const stop = r.watch({ onEvent })
    expect(instances).toHaveLength(1)
    expect(instances[0]!.url).toBe('/api/plugin-events') // 地址自己拼（同源）

    instances[0]!.onmessage!({ data: JSON.stringify({ type: 'plugin-changed', id: 'plugin-style-library', name: 'style-library' }) })
    await new Promise((res) => setTimeout(res, 10))
    expect(reloadPlugin).toHaveBeenCalledWith('style-library', expect.anything())
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ name: 'style-library' }), 'before')

    stop()
    expect(instances[0]!.closed).toBe(true)
    vi.unstubAllGlobals()
  })

  it('watch()：only 过滤 —— 不在名单里的插件不重装', async () => {
    const instances: Array<{ onmessage: ((e: { data: string }) => void) | null }> = []
    class FakeES {
      onmessage: ((e: { data: string }) => void) | null = null
      constructor(_url: string) { instances.push(this as never) }
      close() {}
    }
    vi.stubGlobal('EventSource', FakeES)
    const reloadPlugin = vi.fn()
    const r = createPluginReloader({
      fetchCatalog: async () => ENTRIES,
      loadUmd: async () => ({ name: 'mini-map', apply() {} }),
      facade: () => ({ reloadPlugin, getContext: () => ({ get: () => undefined }) }),
    })
    r.watch({ only: ['style-library'] })
    instances[0]!.onmessage!({ data: JSON.stringify({ type: 'plugin-changed', id: 'plugin-mini-map', name: 'mini-map' }) })
    await new Promise((res) => setTimeout(res, 10))
    expect(reloadPlugin).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
  it('挂到 window 指定 key，且幂等（已有不覆盖）', () => {
    const target: Record<string, unknown> = {}
    vi.stubGlobal('MiniCanvasUI', undefined)
    // 直接把 globalThis 当目标：exposePluginReloader 内部用 globalThis
    const r1 = exposePluginReloader('MiniCanvasPluginTest')
    expect((globalThis as Record<string, unknown>).MiniCanvasPluginTest).toBe(r1)
    const sentinel = { marker: true }
    ;(globalThis as Record<string, unknown>).MiniCanvasPluginTest = sentinel
    exposePluginReloader('MiniCanvasPluginTest')
    expect((globalThis as Record<string, unknown>).MiniCanvasPluginTest).toBe(sentinel)
    delete (globalThis as Record<string, unknown>).MiniCanvasPluginTest
    vi.unstubAllGlobals()
    void target
  })
})
