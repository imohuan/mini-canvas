import { describe, it, expect } from 'vitest'
import { Context, SaveServiceImpl, MemoryStorageAdapter } from '@mini-canvas/canvas-data'
import { createPluginManagerService, INSTALLED_KEY, absolutize, baseOfCatalogUrl } from '../pluginManagerService'
import type { PluginModule } from '@mini-canvas/canvas-base'

/** 假宿主：记着装过哪些插件，支持 install/uninstall/reload/list（与 canvas-render 的 PluginManager 同子集） */
function fakeHost() {
  const installed = new Map<string, { name: string; state: string; missingDeps: string[] }>()
  return {
    installed,
    manager: {
      async install(mod: PluginModule) { installed.set(mod.name, { name: mod.name, state: 'active', missingDeps: [] }); return mod.name },
      uninstall(name: string) { return installed.delete(name) },
      async reload() { /* noop */ },
      list() { return [...installed.values()] },
    },
  }
}

/** 假 save：内存键值 */
function fakeSave() {
  const kv = new Map<string, unknown>()
  return { kv, save: { async get<T>(k: string) { return kv.get(k) as T | undefined }, set(k: string, v: unknown) { kv.set(k, v) } } }
}

/**
 * 假 document/window：脚本一 append 就立刻“执行”——按脚本 src 里的插件名挂一个全局，再触发 onload。
 * 为什么按 src 而不是一次挂一堆：加载器是「取脚本新挂的全局」，若一次全挂，装 a 会误挑到 b。
 * src 形如 …/plugin-a/a.js，从中取 `plugin-a` 作为插件名。
 */
function fakeDom(win: Record<string, unknown>, opts: { failUrls?: string[] } = {}) {
  const document = {
    createElement() {
      return {} as Record<string, unknown>
    },
    head: {
      appendChild(el: Record<string, unknown>) {
        const src = String(el.src ?? '')
        if (opts.failUrls?.some((u) => src.includes(u))) {
          queueMicrotask(() => (el.onerror as () => void)?.())
          return
        }
        const m = src.match(/plugins\/([^/]+)\//)
        const pkg = m?.[1] ?? 'unknown'
        win['MiniCanvasPlugin' + pkg] = { name: pkg, apply() {} }
        queueMicrotask(() => (el.onload as () => void)?.())
      },
    },
  } as unknown as Document
  return document
}

function boot(opts: { catalog: unknown; failUrls?: string[]; savedInstalled?: string[] }) {
  const ctx = new Context()
  const host = fakeHost()
  const { kv, save } = fakeSave()
  if (opts.savedInstalled !== undefined) kv.set(INSTALLED_KEY, opts.savedInstalled)
  ctx.inject('pluginManager', host.manager)
  ctx.inject('save', save)
  const win: Record<string, unknown> = {}
  const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => opts.catalog })) as unknown as typeof fetch
  const svc = createPluginManagerService(ctx, {
    catalogUrl: 'http://127.0.0.1:5320/catalog.json',
    fetchImpl,
    document: fakeDom(win, { failUrls: opts.failUrls ?? [] }),
    win,
  })
  return { ctx, svc, host, kv }
}

const CATALOG = {
  ok: true,
  plugins: [
    { id: 'plugin-a', name: 'a', title: 'A', url: '/plugins/plugin-a/a.js' },
    { id: 'plugin-b', name: 'b', title: 'B', url: '/plugins/plugin-b/b.js' },
  ],
}

// 带后台半的清单（测成对安装用）
const CATALOG_WITH_SERVER = {
  ok: true,
  plugins: [
    {
      id: 'plugin-srv',
      name: 'srv',
      title: 'srv-plugin',
      url: '/plugins/plugin-srv/srv.js',
      server: { url: '/plugins/plugin-srv/server.js', sha256: 'abc' },
    },
  ],
}

describe('plugin-manager 服务：装 / 卸 / 重装 / 默认全装', () => {
  it('首次（没有存档）→ 默认全部装上（用户要求）', async () => {
    const { svc, host, kv } = boot({ catalog: CATALOG })
    await svc.refresh()
    expect(host.installed.has('plugin-a')).toBe(true)
    expect(host.installed.has('plugin-b')).toBe(true)
    expect(svc.state.rows.every((r) => r.installed)).toBe(true)
    // 存档写回（下次照旧）
    expect(kv.get(INSTALLED_KEY)).toEqual(['plugin-a', 'plugin-b'])
  })

  it('有存档 → 只装存档里、此刻未装的（用户卸过的不自动回来）', async () => {
    const { svc, host } = boot({
      catalog: CATALOG,
      savedInstalled: ['plugin-a'],
    })
    await svc.refresh()
    expect(host.installed.has('plugin-a')).toBe(true)
    expect(host.installed.has('plugin-b')).toBe(false)
  })

  it('卸载 → 内核里消失，存档更新', async () => {
    const { svc, host, kv } = boot({ catalog: CATALOG })
    await svc.refresh()
    await svc.uninstall('plugin-a')
    expect(host.installed.has('plugin-a')).toBe(false)
    expect(kv.get(INSTALLED_KEY)).toEqual(['plugin-b'])
    expect(svc.state.rows.find((r) => r.entry.id === 'plugin-a')?.installed).toBe(false)
  })

  it('重装 → 先卸再按（破缓存的）地址重新装上', async () => {
    const { svc, host } = boot({ catalog: CATALOG })
    await svc.refresh()
    await svc.reinstall('plugin-a')
    expect(host.installed.has('plugin-a')).toBe(true)
    expect(svc.state.rows.find((r) => r.entry.id === 'plugin-a')?.installed).toBe(true)
  })

  it('拉清单失败 → state.error 有说明、ready=false（界面能显示，不静默）', async () => {
    const ctx = new Context()
    ctx.inject('pluginManager', fakeHost().manager)
    ctx.inject('save', fakeSave().save)
    const svc = createPluginManagerService(ctx, {
      fetchImpl: (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch,
      document: fakeDom({}, {}),
      win: {},
    })
    await svc.refresh()
    expect(svc.state.ready).toBe(false)
    expect(svc.state.error).toContain('500')
  })

  it('宿主没有 pluginManager 服务 → 行上给出清晰错误（不静默装死）', async () => {
    const ctx = new Context()
    ctx.inject('save', fakeSave().save)
    const svc = createPluginManagerService(ctx, {
      fetchImpl: (async () => ({ ok: true, status: 200, json: async () => CATALOG })) as unknown as typeof fetch,
      document: fakeDom({}, {}),
      win: {},
    })
    await svc.refresh()
    const row = svc.state.rows.find((r) => r.entry.id === 'plugin-a')
    expect(row?.error).toContain('pluginManager')
  })

  it('并发 refresh 只跑一趟（后一次复用前一次的 Promise，不把 rows 换成孤儿）', async () => {
    const { svc, host } = boot({ catalog: CATALOG })
    // 同时发起两次：若各建一批 rows，先发起那次写在孤儿行上 → 有的插件永远「未装」
    await Promise.all([svc.refresh(), svc.refresh()])
    expect(host.installed.has('plugin-a')).toBe(true)
    expect(host.installed.has('plugin-b')).toBe(true)
    expect(svc.state.rows.every((r) => r.installed)).toBe(true)
  })

  it('默认全装时某条装失败 → 意图仍记着它（下次启动补装，不会永远丢）', async () => {
    // 让 plugin-b 的脚本加载失败
    const { svc, host, kv } = boot({ catalog: CATALOG, failUrls: ['plugin-b'] })
    await svc.refresh()
    expect(host.installed.has('plugin-a')).toBe(true)
    expect(host.installed.has('plugin-b')).toBe(false)
    // 关键：存档记的是「意图」（两个都想要），不是「结果」（只装上了一个）
    expect(kv.get(INSTALLED_KEY)).toEqual(['plugin-a', 'plugin-b'])
    expect(svc.state.rows.find((r) => r.entry.id === 'plugin-b')?.error).toBeTruthy()
  })

  it('配置后端从本地切云端后自动重读安装名单（否则刷新后插件全掉、配置跟着丢）', async () => {
    // 真实 save：本地后端里存着一份**过期的**名单（空）；云端存着真正的名单。
    // 这正是用户场景：插件管理的"读"发生在云插件把 config 切到云端之前。
    const local = new MemoryStorageAdapter()
    await local.set('config:' + INSTALLED_KEY, [])
    const cloud = new MemoryStorageAdapter()
    await cloud.set('config:' + INSTALLED_KEY, ['plugin-a'])

    const ctx = new Context()
    const host = fakeHost()
    ctx.inject('pluginManager', host.manager)
    const save = new SaveServiceImpl(local)
    ctx.inject('save', save)
    const win: Record<string, unknown> = {}
    const svc = createPluginManagerService(ctx, {
      catalogUrl: 'http://127.0.0.1:5320/catalog.json',
      fetchImpl: (async () => ({ ok: true, status: 200, json: async () => CATALOG })) as unknown as typeof fetch,
      document: fakeDom(win),
      win,
    })

    await svc.refresh()
    // 本地名单是空的 → 此刻什么都不该装（还没切云端）
    expect(host.installed.has('plugin-a')).toBe(false)

    // 云插件把 config 域切到云端 → 服务**自己**重读，装上云端名单里的 plugin-a。
    // 这里故意不再手动 refresh()：要验的正是「切后端这件事本身触发重读」。
    save.useAdapter('config', cloud)
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(host.installed.has('plugin-a')).toBe(true)
  })
})

describe('地址归一', () => {
  it('baseOfCatalogUrl 取源', () => {
    expect(baseOfCatalogUrl('http://127.0.0.1:5320/catalog.json')).toBe('http://127.0.0.1:5320')
  })
  it('absolutize 把相对地址补成绝对；已是绝对则不变', () => {
    expect(absolutize('/plugins/a/a.js', 'http://h:5320')).toBe('http://h:5320/plugins/a/a.js')
    expect(absolutize('https://cdn/x.js', 'http://h')).toBe('https://cdn/x.js')
  })
})

describe('plugin-manager 服务：NPM 市场（Task 5）', () => {
  /** boot 的 NPM 变体：fetch 按 URL 路由分发（catalog / npm 各回各的假响应） */
  function bootNpm(handlers: Record<string, { body: unknown; status?: number }>) {
    const ctx = new Context()
    const host = fakeHost()
    const { save } = fakeSave()
    ctx.inject('pluginManager', host.manager)
    ctx.inject('save', save)
    const win: Record<string, unknown> = {}
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      for (const [match, h] of Object.entries(handlers)) {
        if (u.includes(match)) {
          return { ok: (h.status ?? 200) === 200, status: h.status ?? 200, json: async () => h.body, text: async () => JSON.stringify(h.body) } as Response
        }
      }
      // 默认：catalog（refresh 会调）
      return { ok: true, status: 200, json: async () => CATALOG, text: async () => '' } as Response
    }) as unknown as typeof fetch
    const svc = createPluginManagerService(ctx, {
      catalogUrl: 'http://127.0.0.1:5320/catalog.json',
      fetchImpl,
      document: fakeDom(win),
      win,
    })
    return { svc }
  }

  it('searchNpmPlugins 走服务端搜索端点并返回结果', async () => {
    const results = [{ pkg: '@mini-canvas/plugin-demo', title: 'Demo', description: '', version: '1.0.0', date: '', hasServer: true }]
    const { svc } = bootNpm({
      '/api/npm-plugins/search': { body: { ok: true, results } },
    })
    const out = await svc.searchNpmPlugins('demo')
    expect(out).toEqual(results)
  })

  it('installFromNpm 带 serverConfirm 发 confirm；失败抛出后端错误', async () => {
    const { svc } = bootNpm({
      '/api/npm-plugins/install': { body: { ok: false, error: '需要 confirm: true' }, status: 400 },
    })
    await expect(svc.installFromNpm('@mini-canvas/plugin-demo', { serverConfirm: false })).rejects.toThrow('需要 confirm: true')
  })

  it('updateFromNpm 返回 updated/to；listNpmInstalled 返回记录', async () => {
    const { svc } = bootNpm({
      '/api/npm-plugins/update': { body: { ok: true, updated: true, to: '1.1.0' } },
      '/api/npm-plugins/installed': { body: { ok: true, plugins: [{ pkg: '@mini-canvas/plugin-demo', version: '1.1.0', installedAt: 't' }] } },
    })
    const r = await svc.updateFromNpm('@mini-canvas/plugin-demo')
    expect(r).toEqual({ updated: true, to: '1.1.0' })
    const list = await svc.listNpmInstalled()
    expect(list[0].version).toBe('1.1.0')
  })

  it('未确认时不请求后台安装（避免假故障红字）；确认后才发请求', async () => {
    const ctx = new Context()
    const host = fakeHost()
    const { save } = fakeSave()
    ctx.inject('pluginManager', host.manager)
    ctx.inject('save', save)
    const win: Record<string, unknown> = {}
    const calls: string[] = []
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url)
      calls.push(u)
      if (u.includes('/api/server-plugins/install')) {
        const b = JSON.parse(String(init?.body ?? '{}')) as { confirm?: boolean }
        return b.confirm === true
          ? ({ ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' } as Response)
          : ({ ok: false, status: 400, json: async () => ({ ok: false, error: 'need confirm' }), text: async () => '' } as Response)
      }
      if (u.includes('/api/server-plugins')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, plugins: [], loaded: [] }), text: async () => '' } as Response
      }
      return { ok: true, status: 200, json: async () => CATALOG_WITH_SERVER, text: async () => '' } as Response
    }) as unknown as typeof fetch
    const svc = createPluginManagerService(ctx, {
      catalogUrl: 'http://127.0.0.1:5320/catalog.json',
      fetchImpl,
      document: fakeDom(win),
      win,
    })
    await svc.refresh()
    await svc.install('plugin-srv', { serverConfirm: false })
    expect(svc.state.rows.find((r) => r.entry.id === 'plugin-srv')?.serverError).toBeUndefined()
    expect(calls.some((u) => u.includes('/api/server-plugins/install'))).toBe(false)
    // 卸掉（前端半也卸），再以确认方式装一次：这次应发后台安装请求
    await svc.uninstall('plugin-srv')
    await svc.install('plugin-srv', { serverConfirm: true })
    expect(svc.state.rows.find((r) => r.entry.id === 'plugin-srv')?.serverError).toBeUndefined()
    expect(calls.some((u) => u.includes('/api/server-plugins/install'))).toBe(true)
  })

  it('installFromNpm 装完后把前端半自动装进内核（用户点一次就该活）', async () => {
    // catalog 里带 npm 装进来的那条（id = 包名去 @ 后 / 换 __）
    const catalogWithShowcase = {
      ok: true,
      plugins: [{ id: 'imohuan__plugin-showcase', name: 'showcase', title: '展示', url: '/plugins/imohuan__plugin-showcase/plugin-showcase.js' }],
    }
    const ctx = new Context()
    const host = fakeHost()
    const { save } = fakeSave()
    ctx.inject('pluginManager', host.manager)
    ctx.inject('save', save)
    const win: Record<string, unknown> = {}
    // 第一次 catalog 拉取（install 之前的 refresh）没有 showcase；install 之后才有 —— 用计数器模拟
    let catalogCalls = 0
    const fetchImpl = (async (url: string | URL) => {
      const u = String(url)
      if (u.includes('/api/npm-plugins/install')) return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' } as Response
      if (u.includes('/api/npm-plugins/installed')) return { ok: true, status: 200, json: async () => ({ ok: true, plugins: [] }), text: async () => '' } as Response
      // catalog：首次空、之后带 showcase
      catalogCalls += 1
      return { ok: true, status: 200, json: async () => (catalogCalls <= 1 ? { ok: true, plugins: [] } : catalogWithShowcase), text: async () => '' } as Response
    }) as unknown as typeof fetch
    const svc = createPluginManagerService(ctx, {
      catalogUrl: 'http://127.0.0.1:5320/catalog.json',
      fetchImpl,
      document: fakeDom(win),
      win,
    })
    await svc.refresh()
    await svc.installFromNpm('@imohuan/plugin-showcase', { serverConfirm: true })
    // 前端半确实进了内核（假宿主的键是 UMD 全局名推导出的模块名）
    expect([...host.installed.keys()].some((k) => /showcase/i.test(k))).toBe(true)
    expect(svc.state.rows.find((r) => r.entry.id === 'imohuan__plugin-showcase')?.installed).toBe(true)
  })
})
