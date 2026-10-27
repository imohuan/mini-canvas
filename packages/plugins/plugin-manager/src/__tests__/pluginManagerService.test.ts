import { afterEach, describe, it, expect } from 'vitest'
import { Context, SaveServiceImpl, MemoryStorageAdapter, LocalStorageAdapter } from '@mini-canvas/canvas-data'
import { createPluginManagerService, INSTALLED_KEY, absolutize, baseOfCatalogUrl } from '../pluginManagerService'
import { ADMIN_TOKEN_HEADER, setAdminToken, type PluginModule } from '@mini-canvas/canvas-base'

/** 最小的 localStorage 替身（Node 里没有 DOM；令牌读写走全局 localStorage） */
class MemoryStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
}

afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage })

/** 假宿主：记着装过哪些插件，支持 install/uninstall/reload/list（与 canvas-render 的 PluginManager 同子集） */
function fakeHost() {
  const installed = new Map<string, { name: string; state: string; missingDeps: string[] }>()
  /** 记下每次安装收到的**来源形态**：umd 走模块对象、esm 走 { url } */
  const sources: Array<{ kind: 'module' | 'url'; value: string }> = []
  return {
    installed,
    sources,
    manager: {
      async install(source: PluginModule | { url: string }) {
        if (typeof (source as { url?: unknown }).url === 'string') {
          const url = (source as { url: string }).url
          sources.push({ kind: 'url', value: url })
          // 真实宿主会把 URL 模块 import 进来并用它 export 的 name 注册；这里按 URL 末段模拟一个名字
          const name = url.split('/').pop()!.replace(/\.js$/, '')
          installed.set(name, { name, state: 'active', missingDeps: [] })
          return name
        }
        const mod = source as PluginModule
        sources.push({ kind: 'module', value: mod.name })
        installed.set(mod.name, { name: mod.name, state: 'active', missingDeps: [] })
        return mod.name
      },
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

describe('plugin-manager 服务：装 / 卸 / 重装 / 默认策略', () => {
  it('调试入口已装同名插件 → 管理页不再装第二遍（内核按名字唯一）', async () => {
    const { ctx, svc, host } = boot({ catalog: CATALOG, savedInstalled: [] })
    // 模拟：先用调试入口装了运行时名 a（清单里的 plugin-a 与它同名）
    await host.manager.install({ name: 'a', apply() {} } as PluginModule)
    await svc.refresh()
    const before = host.sources.length
    await svc.install('plugin-a')
    const row = svc.state.rows.find((r) => r.entry.id === 'plugin-a')!
    expect(row.installed, '内核里已有同名 → 显示已安装').toBe(true)
    expect(host.sources.length, '不该再装载第二份').toBe(before)
    ctx.stop()
  })

  it('首次（没有存档）→ 一个都不自动装（用户要求：全部由我在面板里自己挑）', async () => {
    const { svc, host } = boot({ catalog: CATALOG })
    await svc.refresh()
    expect(host.installed.size).toBe(0)
    expect(svc.state.rows.every((r) => !r.installed)).toBe(true)
    // 清单照样拉到（面板要能列出它们，用户才好挑）
    expect(svc.state.rows.map((r) => r.entry.id)).toEqual(['plugin-a', 'plugin-b'])
  })

  it('作者显式声明 defaultInstalled: true 的才自动装（opt-in）', async () => {
    const catalog = {
      ok: true,
      plugins: [
        { id: 'plugin-a', name: 'a', title: 'A', url: '/plugins/plugin-a/a.js', defaultInstalled: true },
        { id: 'plugin-b', name: 'b', title: 'B', url: '/plugins/plugin-b/b.js' },
      ],
    }
    const { svc, host } = boot({ catalog })
    await svc.refresh()
    expect(host.installed.has('plugin-a')).toBe(true)
    expect(host.installed.has('plugin-b')).toBe(false)
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
    // 先显式装上两个（新策略下首次不自动装，故用"存档 = 已装"表达用户此前装过它们）
    const { svc, host, kv } = boot({ catalog: CATALOG, savedInstalled: ['plugin-a', 'plugin-b'] })
    await svc.refresh()
    expect(host.installed.has('plugin-a')).toBe(true)
    await svc.uninstall('plugin-a')
    expect(host.installed.has('plugin-a')).toBe(false)
    expect(kv.get(INSTALLED_KEY)).toEqual(['plugin-b'])
    expect(svc.state.rows.find((r) => r.entry.id === 'plugin-a')?.installed).toBe(false)
  })

  it('重装 → 先卸再按（破缓存的）地址重新装上', async () => {
    const { svc, host } = boot({ catalog: CATALOG, savedInstalled: ['plugin-a'] })
    await svc.refresh()
    await svc.reinstall('plugin-a')
    expect(host.installed.has('plugin-a')).toBe(true)
    expect(svc.state.rows.find((r) => r.entry.id === 'plugin-a')?.installed).toBe(true)
  })

  it('面板手动装一个（用户点击「安装」）→ 装进内核并记进存档', async () => {
    const { svc, host, kv } = boot({ catalog: CATALOG })
    await svc.refresh()
    expect(host.installed.size).toBe(0)
    await svc.install('plugin-a')
    expect(host.installed.has('plugin-a')).toBe(true)
    expect(kv.get(INSTALLED_KEY)).toEqual(['plugin-a'])
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
    // 新策略下首次不自动装 → 必须显式点安装才会去要宿主句柄，故这里手动触发一次
    await svc.install('plugin-a')
    const row = svc.state.rows.find((r) => r.entry.id === 'plugin-a')
    expect(row?.error).toContain('pluginManager')
  })

  it('并发 refresh 只跑一趟（后一次复用前一次的 Promise，不把 rows 换成孤儿）', async () => {
    const { svc, host } = boot({ catalog: CATALOG, savedInstalled: ['plugin-a', 'plugin-b'] })
    // 同时发起两次：若各建一批 rows，先发起那次写在孤儿行上 → 有的插件永远「未装」
    await Promise.all([svc.refresh(), svc.refresh()])
    expect(host.installed.has('plugin-a')).toBe(true)
    expect(host.installed.has('plugin-b')).toBe(true)
    expect(svc.state.rows.every((r) => r.installed)).toBe(true)
  })

  it('补装时某条装失败 → 意图仍记着它（下次启动补装，不会永远丢）', async () => {
    // 让 plugin-b 的脚本加载失败
    const { svc, host, kv } = boot({ catalog: CATALOG, failUrls: ['plugin-b'], savedInstalled: ['plugin-a', 'plugin-b'] })
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

  it('format=esm 的插件走宿主 install({ url })（不走 <script>）—— 面板才能装云端客户端那种自包含 ESM', async () => {
    const catalog = {
      ok: true,
      plugins: [
        { id: 'plugin-cloud-client', name: 'cloud-client', title: '云端连接', url: '/plugins/plugin-cloud-client/plugin-cloud-client.js', format: 'esm' },
      ],
    }
    const { svc, host } = boot({ catalog })
    await svc.refresh()
    await svc.install('plugin-cloud-client')
    // 关键：交给宿主的是 **URL 来源**（宿主内部 import(data:) 加载），不是 UMD 模块对象
    expect(host.sources).toEqual([{ kind: 'url', value: 'http://127.0.0.1:5320/plugins/plugin-cloud-client/plugin-cloud-client.js' }])
    expect(svc.state.rows.find((r) => r.entry.id === 'plugin-cloud-client')?.installed).toBe(true)
  })

  it('format 缺省的插件仍走 UMD（<script>）—— 既有插件行为不变', async () => {
    const { svc, host } = boot({ catalog: CATALOG })
    await svc.refresh()
    await svc.install('plugin-a')
    expect(host.sources).toEqual([{ kind: 'module', value: 'plugin-a' }])
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

describe('plugin-manager 服务：config 后端切换时的安装名单对齐（用户实测的数据丢失 bug）', () => {
  /** 造一个能手动触发 onAdapterChange 的假 save */
  function fakeSaveWithAdapter() {
    const kv = new Map<string, unknown>()
    const listeners = new Set<(t: string) => void>()
    const save = {
      async get<T>(k: string) {
        return kv.get(k) as T | undefined
      },
      set(k: string, v: unknown) {
        kv.set(k, v)
      },
      onAdapterChange(cb: (t: string) => void) {
        listeners.add(cb)
        return { dispose: () => { listeners.delete(cb) } }
      },
    }
    return { save, kv, fire: (t: string) => { for (const cb of [...listeners]) cb(t) } }
  }

  it('清单还没拉完就切后端：不会用空名单覆盖后端、也不会把插件判成未装', async () => {
    const ctx = new Context()
    const host = fakeHost()
    const { save, kv, fire } = fakeSaveWithAdapter()
    // 用户上一轮已经装过 plugin-a（后端里有名单）
    kv.set(INSTALLED_KEY, ['plugin-a'])
    ctx.inject('pluginManager', host.manager)
    ctx.inject('save', save)
    const win: Record<string, unknown> = {}
    const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => CATALOG, text: async () => '' })) as unknown as typeof fetch
    const svc = createPluginManagerService(ctx, {
      catalogUrl: 'http://127.0.0.1:5320/catalog.json',
      fetchImpl,
      document: fakeDom(win),
      win,
    })
    // 关键：**不先 refresh**，直接触发 adapter 切换（模拟切换瞬间清单还没拉完）
    fire('config')
    await new Promise((r) => setTimeout(r, 50))
    expect(kv.get(INSTALLED_KEY), '后端名单不能被清空').toEqual(['plugin-a'])
    expect(host.installed.has('plugin-a')).toBe(true)
  })

  it('装云端连接后名单只进了云端 → 刷新（本地没有名单、云端连接也不在本地）仍应恢复已装插件', async () => {
    // 用户实测场景：ui dev 起本地；装「云端连接」后 config 后端切到云端，安装名单被写进云端。
    // 刷新时本地名单是空的（从未写过），而 cloud-client 自己不作为本地自带件启动
    // —— 于是没人把云端名单读回来，用户看到「装好的插件全没了」。
    // 期望：插件管理必须把名单在**本地留一份备份**，刷新先用它恢复。
    const storage = new MemoryStorage()
    ;(globalThis as { localStorage?: unknown }).localStorage = storage
    const local = new LocalStorageAdapter(storage as unknown as Storage)
    const cloud = new MemoryStorageAdapter()
    // 第一次打开：用户先装好 plugin-a；随后装云端连接，config 切到云端。
    // 云端里此刻只有旧名单（不含刚装的 plugin-b）—— 模拟真实时序。
    await local.set('config:' + INSTALLED_KEY, ['plugin-a'])
    await cloud.set('config:' + INSTALLED_KEY, ['plugin-a'])

    // 第一轮：装 plugin-b，并把 config 切到云端（此时应把名单备份到本地）
    {
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
      await svc.install('plugin-b')
      save.useAdapter('config', cloud)
      await save.flush()
      ctx.stop()
    }
    expect(await local.get<string[]>('config:' + INSTALLED_KEY), '本地应留一份名单备份').toEqual(['plugin-a', 'plugin-b'])

    // 第二轮：刷新页面（本地后端），cloud-client 不在启动清单里 → 只能靠本地备份恢复
    {
      const ctx = new Context()
      const host = fakeHost()
      ctx.inject('pluginManager', host.manager)
      ctx.inject('save', new SaveServiceImpl(local))
      const win: Record<string, unknown> = {}
      const svc = createPluginManagerService(ctx, {
        catalogUrl: 'http://127.0.0.1:5320/catalog.json',
        fetchImpl: (async () => ({ ok: true, status: 200, json: async () => CATALOG })) as unknown as typeof fetch,
        document: fakeDom(win),
        win,
      })
      await svc.refresh()
      expect(host.installed.has('plugin-a'), '刷新后 plugin-a 应被重新装上').toBe(true)
      expect(host.installed.has('plugin-b'), '刷新后 plugin-b 也应被重新装上').toBe(true)
      ctx.stop()
    }
  })

  it('卸载 → 刷新：本地备份跟着更新，不会把卸掉的插件又装回来', async () => {
    const storage = new MemoryStorage()
    ;(globalThis as { localStorage?: unknown }).localStorage = storage
    const local = new LocalStorageAdapter(storage as unknown as Storage)

    // 第一轮：名单 = a、b，然后用户卸掉 b
    {
      const ctx = new Context()
      const host = fakeHost()
      ctx.inject('pluginManager', host.manager)
      ctx.inject('save', new SaveServiceImpl(local))
      const win: Record<string, unknown> = {}
      const svc = createPluginManagerService(ctx, {
        catalogUrl: 'http://127.0.0.1:5320/catalog.json',
        fetchImpl: (async () => ({ ok: true, status: 200, json: async () => CATALOG })) as unknown as typeof fetch,
        document: fakeDom(win),
        win,
      })
      await svc.refresh()
      await svc.install('plugin-a')
      await svc.install('plugin-b')
      await svc.uninstall('plugin-b')
      ctx.stop()
    }

    // 第二轮：刷新 —— 只该装回 a
    {
      const ctx = new Context()
      const host = fakeHost()
      ctx.inject('pluginManager', host.manager)
      ctx.inject('save', new SaveServiceImpl(local))
      const win: Record<string, unknown> = {}
      const svc = createPluginManagerService(ctx, {
        catalogUrl: 'http://127.0.0.1:5320/catalog.json',
        fetchImpl: (async () => ({ ok: true, status: 200, json: async () => CATALOG })) as unknown as typeof fetch,
        document: fakeDom(win),
        win,
      })
      await svc.refresh()
      expect(host.installed.has('plugin-a')).toBe(true)
      expect(host.installed.has('plugin-b'), '用户卸掉的插件不该被备份装回来').toBe(false)
      ctx.stop()
    }
  })

  it('云端暂时读失败 → 用本地备份先恢复（不会把已装插件判成没装）', async () => {
    const storage = new MemoryStorage()
    ;(globalThis as { localStorage?: unknown }).localStorage = storage
    // 本地备份里有 a；当前后端读的时候直接抛（模拟云端断网）
    storage.setItem('config:' + INSTALLED_KEY, JSON.stringify(['plugin-a']))
    const ctx = new Context()
    const host = fakeHost()
    const { save } = fakeSave()
    const flaky = {
      ...save,
      async get<T>(k: string) {
        if (k === INSTALLED_KEY) throw new Error('网络暂时不可用')
        return save.get<T>(k)
      },
    }
    ctx.inject('pluginManager', host.manager)
    ctx.inject('save', flaky)
    const win: Record<string, unknown> = {}
    const svc = createPluginManagerService(ctx, {
      catalogUrl: 'http://127.0.0.1:5320/catalog.json',
      fetchImpl: (async () => ({ ok: true, status: 200, json: async () => CATALOG })) as unknown as typeof fetch,
      document: fakeDom(win),
      win,
    })
    await svc.refresh()
    expect(host.installed.has('plugin-a')).toBe(true)
    ctx.stop()
  })
})

describe('plugin-manager 服务：从 NPM 卸载只调一次后台卸载（用户实测的多余 404）', () => {
  it('uninstallFromNpm 不再重复调 /api/server-plugins/uninstall', async () => {
    const ctx = new Context()
    const host = fakeHost()
    const { save } = fakeSave()
    ctx.inject('pluginManager', host.manager)
    ctx.inject('save', save)
    const win: Record<string, unknown> = {}
    const calls: string[] = []
    // catalog 里有一条带后台半的插件（前端半已装）
    const catalogWithServer = {
      ok: true,
      plugins: [
        {
          id: 'mini-canvas-plugin-demo',
          name: 'demo',
          title: 'Demo',
          url: '/plugins/mini-canvas-plugin-demo/demo.js',
          server: { url: '/plugins/mini-canvas-plugin-demo/server.js', sha256: 'abc' },
        },
      ],
    }
    const fetchImpl = (async (url: string | URL) => {
      const u = String(url)
      calls.push(u)
      if (u.includes('/api/npm-plugins/uninstall')) return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' } as Response
      // 后台卸载：这里**不该**被调到（NPM 卸载已删过），真被调到就让它 404 —— 暴露 bug
      if (u.includes('/api/server-plugins/uninstall')) return { ok: false, status: 404, json: async () => ({ ok: false, error: '插件不存在' }), text: async () => '' } as Response
      if (u.includes('/api/server-plugins')) return { ok: true, status: 200, json: async () => ({ ok: true, plugins: [], loaded: [] }), text: async () => '' } as Response
      return { ok: true, status: 200, json: async () => catalogWithServer, text: async () => '' } as Response
    }) as unknown as typeof fetch
    const svc = createPluginManagerService(ctx, {
      catalogUrl: 'http://127.0.0.1:5320/catalog.json',
      fetchImpl,
      document: fakeDom(win),
      win,
    })
    await svc.refresh()
    await svc.install('mini-canvas-plugin-demo', { serverConfirm: true })
    calls.length = 0 // 只看卸载阶段的请求
    await svc.uninstallFromNpm('mini-canvas-plugin-demo')
    const serverUninstallCalls = calls.filter((u) => u.includes('/api/server-plugins/uninstall'))
    expect(serverUninstallCalls, '不该再调 /api/server-plugins/uninstall（NPM 卸载已删过后台文件）').toEqual([])
    expect(calls.some((u) => u.includes('/api/npm-plugins/uninstall'))).toBe(true)
  })
})

describe('plugin-manager 服务：从 NPM 安装只调一次后台安装（与卸载同型的重复调用）', () => {
  it('checkNpmUpdates：只报"最新版 != 已装版"的包', async () => {
    const ctx = new Context()
    const host = fakeHost()
    const { save } = fakeSave()
    ctx.inject('pluginManager', host.manager)
    ctx.inject('save', save)
    const win: Record<string, unknown> = {}
    const fetchImpl = (async (url: string | URL) => {
      const u = String(url)
      // browse：返回 pkg-a 最新 2.0.0、pkg-b 最新 1.0.0
      if (u.includes('/api/npm-plugins/browse')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, results: [
          { pkg: 'pkg-a', title: 'A', description: '', version: '2.0.0', date: '', hasServer: false },
          { pkg: 'pkg-b', title: 'B', description: '', version: '1.0.0', date: '', hasServer: false },
        ] }), text: async () => '' } as Response
      }
      // installed：pkg-a 装的是 1.0.0、pkg-b 装的是 1.0.0
      if (u.includes('/api/npm-plugins/installed')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, plugins: [
          { pkg: 'pkg-a', version: '1.0.0', installedAt: 't' },
          { pkg: 'pkg-b', version: '1.0.0', installedAt: 't' },
        ] }), text: async () => '' } as Response
      }
      return { ok: true, status: 200, json: async () => CATALOG, text: async () => '' } as Response
    }) as unknown as typeof fetch
    const svc = createPluginManagerService(ctx, {
      catalogUrl: 'http://127.0.0.1:5320/catalog.json',
      fetchImpl,
      document: fakeDom(win),
      win,
    })
    const updates = await svc.checkNpmUpdates()
    expect(updates, '只报有新版的那个').toEqual({ 'pkg-a': '2.0.0' })
  })

  it('installFromNpm 不再重复调 /api/server-plugins/install', async () => {
    const ctx = new Context()
    const host = fakeHost()
    const { save } = fakeSave()
    // 存档为空 = 不做"首次默认全装"，让安装只由 NPM 那条路触发（否则 refresh 时行已装好，测不到）
    save.set(INSTALLED_KEY, [])
    ctx.inject('pluginManager', host.manager)
    ctx.inject('save', save)
    const win: Record<string, unknown> = {}
    const calls: string[] = []
    const catalogWithServer = {
      ok: true,
      plugins: [
        {
          id: 'mini-canvas-plugin-demo',
          name: 'demo',
          title: 'Demo',
          url: '/plugins/mini-canvas-plugin-demo/demo.js',
          server: { url: '/plugins/mini-canvas-plugin-demo/server.js', sha256: 'abc' },
        },
      ],
    }
    const fetchImpl = (async (url: string | URL) => {
      const u = String(url)
      calls.push(u)
      if (u.includes('/api/npm-plugins/install')) return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' } as Response
      if (u.includes('/api/npm-plugins/installed')) return { ok: true, status: 200, json: async () => ({ ok: true, plugins: [] }), text: async () => '' } as Response
      if (u.includes('/api/server-plugins')) return { ok: true, status: 200, json: async () => ({ ok: true, plugins: [], loaded: [] }), text: async () => '' } as Response
      return { ok: true, status: 200, json: async () => catalogWithServer, text: async () => '' } as Response
    }) as unknown as typeof fetch
    const svc = createPluginManagerService(ctx, {
      catalogUrl: 'http://127.0.0.1:5320/catalog.json',
      fetchImpl,
      document: fakeDom(win),
      win,
    })
    await svc.refresh()
    calls.length = 0 // 只看安装阶段的请求
    await svc.installFromNpm('mini-canvas-plugin-demo', { serverConfirm: true })
    const serverInstallCalls = calls.filter((u) => u.includes('/api/server-plugins/install'))
    expect(serverInstallCalls, '不该再调 /api/server-plugins/install（NPM 安装已装过后台半）').toEqual([])
    expect(calls.some((u) => u.includes('/api/npm-plugins/install'))).toBe(true)
  })
})

describe('plugin-manager 服务：管理令牌', () => {
  /** 记录每个请求的 URL / 方法 / 值头（Headers 或普通对象都归一成对象） */
  function tokenProbe(token?: string) {
    ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
    if (token !== undefined) setAdminToken(token)
    const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = []
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const headers: Record<string, string> = {}
      new Headers(init?.headers).forEach((v, k) => { headers[k] = v })
      calls.push({ url: String(url), method: init?.method ?? 'GET', headers })
      const u = String(url)
      if (u.endsWith('/catalog.json')) {
        return { ok: true, status: 200, json: async () => CATALOG_WITH_SERVER, text: async () => '' } as Response
      }
      if (u.includes('/api/server-plugins/install')) {
        return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' } as Response
      }
      if (u.includes('/api/server-plugins')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, plugins: [], loaded: [] }), text: async () => '' } as Response
      }
      if (u.includes('/api/npm-plugins/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, results: [], plugins: [], updated: false }),
          text: async () => '',
        } as Response
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' } as Response
    }) as unknown as typeof fetch
    return { calls, fetchImpl }
  }

  function bootProbe(fetchImpl: typeof fetch) {
    const ctx = new Context()
    const host = fakeHost()
    const { save } = fakeSave()
    ctx.inject('pluginManager', host.manager)
    ctx.inject('save', save)
    const win: Record<string, unknown> = {}
    const svc = createPluginManagerService(ctx, {
      catalogUrl: 'http://127.0.0.1:5320/catalog.json',
      fetchImpl,
      document: fakeDom(win),
      win,
    })
    return { svc, host }
  }

  it('server-plugins install / uninstall 与 npm-plugins install / update / uninstall 都带令牌', async () => {
    const { calls, fetchImpl } = tokenProbe('tok-123')
    const { svc } = bootProbe(fetchImpl)
    await svc.refresh()
    await svc.install('plugin-srv', { serverConfirm: true })
    await svc.uninstall('plugin-srv')
    await svc.installFromNpm('@mini-canvas/plugin-demo', { serverConfirm: true })
    await svc.updateFromNpm('@mini-canvas/plugin-demo')
    await svc.uninstallFromNpm('@mini-canvas/plugin-demo')

    const protectedPaths = [
      '/api/server-plugins/install',
      '/api/server-plugins/uninstall',
      '/api/npm-plugins/install',
      '/api/npm-plugins/update',
      '/api/npm-plugins/uninstall',
    ]
    for (const path of protectedPaths) {
      const hit = calls.filter((c) => c.url.endsWith(path))
      expect(hit.length, path + ' 应至少发一次').toBeGreaterThan(0)
      expect(hit.every((c) => c.headers[ADMIN_TOKEN_HEADER] === 'tok-123'), path + ' 每个请求都要带令牌').toBe(true)
    }
    // GET 类（清单 / 服务端实况 / NPM 列表浏览搜索）不需要令牌，即使本机已经存了一份
    expect(calls.filter((c) => c.method === 'GET').every((c) => !(ADMIN_TOKEN_HEADER in c.headers))).toBe(true)
  })

  it('没有令牌时不带该头（不是空串头）；GET 类列表 / 浏览 / 搜索 / 已装也不带', async () => {
    const { calls, fetchImpl } = tokenProbe(undefined)
    const { svc } = bootProbe(fetchImpl)
    await svc.refresh()
    await svc.installFromNpm('@mini-canvas/plugin-demo', { serverConfirm: true })
    await svc.searchNpmPlugins('demo')
    await svc.browseNpmPlugins()
    await svc.listNpmInstalled()

    expect(calls.filter((c) => c.method === 'POST').length).toBeGreaterThan(0)
    expect(calls.every((c) => !(ADMIN_TOKEN_HEADER in c.headers)), '没令牌时任何请求都不该出现该头').toBe(true)
  })

  it('403 时错误里出现可读提示，同时保留服务端原文', async () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
    const fetchImpl = (async (url: string | URL) => {
      const u = String(url)
      if (u.endsWith('/catalog.json')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, plugins: [] }), text: async () => '' } as Response
      }
      if (u.includes('/api/npm-plugins/install')) {
        return { ok: false, status: 403, json: async () => ({ ok: false, error: '需要管理令牌' }), text: async () => '' } as Response
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, plugins: [], loaded: [] }), text: async () => '' } as Response
    }) as unknown as typeof fetch
    const { svc } = bootProbe(fetchImpl)
    await expect(svc.installFromNpm('@mini-canvas/plugin-demo')).rejects.toThrow(/设置 → 插件里填写管理令牌.*需要管理令牌/)
  })
})
