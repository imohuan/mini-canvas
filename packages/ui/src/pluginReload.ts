/**
 * pluginReload —— 把「改完插件 → 重新装进运行中的画布」封装成一个 window 函数。
 *
 * ## 它解决的重复
 *
 * 开发期改一个插件后，让改动生效原本要在控制台手敲四步：
 * ```js
 * uninstallPlugin('style-library')                       // 卸旧
 * const s = document.createElement('script')             // 重新拉产物
 * s.src = '/plugins/plugin-style-library/plugin-style-library.js?t=' + Date.now()  // 破缓存
 * document.head.appendChild(s)
 * ctx.installPlugin(window.MiniCanvasPluginStyleLibrary)  // 装新
 * ```
 * 每一步都要人记住插件 id、产物路径、全局名 —— 现在收成一个调用：
 * ```js
 * await window.MiniCanvasPlugin.reload('style-library')
 * window.MiniCanvasPlugin.reload('style-library', { then: 'style-library:open' })  // 装完顺手打开面板
 * ```
 *
 * ## 为什么 id → 地址要查清单
 *
 * 插件 id（目录名 `plugin-style-library`）、运行时名（`style-library`）、产物地址
 * （`/plugins/plugin-style-library/plugin-style-library.js`）、UMD 全局名
 * （`MiniCanvasPluginStyleLibrary`）**四者都不一样**，写死在脚本里必然漂移。
 * 清单（cloud-server 的 `/plugin-catalog.json`）已经把这份对应关系列好，所以按 id/名字
 * 现查即可；清单本身带缓存，且可 `?t=` 主动刷新。
 *
 * ## 为什么走 UMD 加载器而不是 manager.reload({url})
 *
 * `manager.install({ url })` 会把产物当 **ESM** 用 `import(data:text/javascript,…)` 执行；
 * 而仓库里可装卸的插件打的是 **UMD**（靠 window 全局取 Vue / MiniCanvas*），那样加载必炸。
 * 所以这里复用「插件管理」同一个 UMD 加载器（`createUmdLoader` + `pickPluginModule`）——
 * 它跟插件管理页装插件是**同一条路**，行为一致。
 *
 * ## 边界
 *
 * - 核心插件（`core: true`）不可热替换：`reloadPlugin` 会明确抛错，这里原样透出。
 * - 只做「重装」这一件事，不碰清单之外的插件；不联网、不写入任何文件。
 */

/** 清单里的一项（只用得上这几个字段；其余忽略） */
export interface CatalogEntryLike {
  id: string
  name: string
  url: string
  globalName?: string
}

/** 清单形状（cloud-server 的 `/plugin-catalog.json`） */
export interface CatalogLike {
  ok?: boolean
  plugins?: CatalogEntryLike[]
}

/** UMD 加载器加载出来的插件模块（与插件管理的 LoadedPluginModule 同形） */
export interface LoadedPluginLike {
  name: string
  apply?: unknown
  setup?: unknown
}

/** 宿主插件门面（window.MiniCanvasUI 的最小用面） */
export interface PluginFacadeLike {
  reloadPlugin(name: string, nextMod?: unknown): void
  /** 取宿主 ctx；get 用**非泛型**签名 —— 泛型方法会让注入假依赖的测试类型不兼容 */
  getContext(): { get(name: string): unknown }
}

export interface ReloadOptions {
  /** 直接指定产物地址（覆盖按 id 查清单）；给了它就不查清单 */
  url?: string
  /** UMD 全局名（清单里有则自动带；手填 url 时可一起给，取件更稳） */
  globalName?: string
  /**
   * 明确要卸的旧插件名（给了它就不按 target 反查名字）。
   *
   * 为什么需要：watch 上报的地址可能**不在清单里**（插件在别处构建），
   * 这时 target 只是地址，没法知道旧实现的运行名。调用方（热重载插件）从 key 里已经知道名字，
   * 直接传进来最准。
   */
  name?: string
  /** 装完之后要执行的命令 id（可选）。例：`'style-library:open'` = 重装并打开面板 */
  then?: string
}

/**
 * 判一个标识符是不是"js 产物地址"（而不是插件 id / 名字）。
 *
 * 为什么要这条：用户手上通常就有清单里那个地址（`/plugins/plugin-x/plugin-x.js`），
 * 直接把它喂进来是最自然的用法。判据保守 —— 带扩展名 `.js/.mjs` / 以 `/` 开头 /
 * 带协议 / 带查询串，任一命中即当地址；纯 `style-library` 这种没有点的词仍按 id/名字查清单。
 */
export function looksLikeUrl(target: string): boolean {
  return /\.m?js($|[?#])/i.test(target) || /^https?:\/\//i.test(target) || target.includes('/') || target.includes('?')
}

/**
 * 取地址的"路径名"（去掉协议 + 主机 + 查询串 + 哈希），用于**跨形态比较同一个产物**。
 *
 * 为什么不能直接字符串比：清单里存的是相对地址 `/plugins/x/x.js`，而用户可能传
 * 完整地址 `http://host:8865/plugins/x/x.js?v=1`。两者指的是同一个文件，直接比会不相等，
 * 于是反查不到全局名 → 加载器只能扫 window 猜 → **可能挑到别的插件**（实测踩过：
 * 传 style-library 的完整地址，结果把 align-arrange 重装了）。按路径名比才稳。
 */
export function pathOf(url: string): string {
  let s = url.split('#')[0]!.split('?')[0]!
  const scheme = s.indexOf('://')
  if (scheme >= 0) {
    const rest = s.slice(scheme + 3)
    const slash = rest.indexOf('/')
    s = slash >= 0 ? rest.slice(slash) : '/'
  }
  return s.startsWith('/') ? s : '/' + s
}

export interface PluginReloader {
  /**
   * 重装一个插件：卸旧 → 拉最新产物 → 装新。
   * @param target 插件 id（目录名，如 plugin-style-library）/ 运行时名（如 style-library）/
   *   **js 产物地址**（如 /plugins/plugin-style-library/plugin-style-library.js）—— 三种都认
   * @returns 实际装上的插件名与用到的地址
   */
  reload(target: string, opts?: ReloadOptions): Promise<{ name: string; url: string }>
  /** 列出清单里可重装的插件（id / 名字 / 地址 / 当前是否装着） */
  list(): Promise<Array<{ id: string; name: string; url: string; installed: boolean }>>
  /** 拉一份最新清单（带缓存；传 true 强制刷新） */
  catalog(force?: boolean): Promise<CatalogEntryLike[]>
  /**
   * 开始监听后台的插件变更（SSE），产物一变就自动重装。
   *
   * 后台是 cloud-server 的 `/api/plugin-events`：它盯插件目录，产物一变就推一条
   * `{ id, name }`。这里收到就调 reload(id) —— 于是「改代码 → pnpm build → 浏览器自动更新」。
   *
   * @returns 停止监听（关掉 EventSource）
   */
  watch(options?: WatchOptions): () => void
}

export interface WatchOptions {
  /** SSE 地址（缺省同源 `/api/plugin-events`）。**不需要手填** —— 同源就够；跨源才给完整地址 */
  url?: string
  /** 变更回调（重装前后各一次；便于面板显示"正在重载 xxx"） */
  onEvent?: (e: PluginWatchEvent, phase: 'before' | 'after') => void
  /** 只对这些插件自动重装（缺省：全都重装）。例：\`['style-library']\` 只盯风格库 */
  only?: string[]
}

/** 后台推来的变更事件（与 cloud-server pluginWatch.ts 的 PluginChangeEvent 同形） */
export interface PluginWatchEvent {
  type: 'plugin-changed'
  id: string
  name: string
}

export interface ReloaderDeps {
  /** 拉清单（缺省 fetch /plugin-catalog.json，带缓存） */
  fetchCatalog?: (force: boolean) => Promise<CatalogEntryLike[]>
  /** 按 URL 加载 UMD 产物成插件模块（缺省用「插件管理」的 UMD 加载器） */
  loadUmd?: (url: string, globalName?: string) => Promise<LoadedPluginLike>
  /** 取宿主插件门面（缺省读 window[windowKey]，调用时现取，兼容"挂函数时宿主还没就绪"） */
  facade?: () => PluginFacadeLike | undefined
}

/** 清单缓存时长（ms）：够短以便改完立刻看到，够长以免每次 reload 都打一次网络 */
const CATALOG_TTL = 5000

/** 默认清单地址（与「插件管理」同源同路径） */
export const DEFAULT_CATALOG_URL = '/plugin-catalog.json'

/** 默认挂到 window 的 key */
export const DEFAULT_RELOADER_KEY = 'MiniCanvasPlugin'

/** 默认的插件变更 SSE 端点（同源 cloud-server；见 cloud-server 的 pluginWatch.ts） */
export const DEFAULT_WATCH_URL = '/api/plugin-events'

/** 按 id 或运行时名找出清单项（两者都认；id 优先） */
export function findEntry(
  entries: CatalogEntryLike[],
  target: string,
): CatalogEntryLike | undefined {
  return entries.find((e) => e.id === target) ?? entries.find((e) => e.name === target)
}

/**
 * 建一个重装器。真实跑用默认依赖；测试注入假依赖（不碰网络与 DOM）。
 */
export function createPluginReloader(deps: ReloaderDeps = {}): PluginReloader {
  let cache: { at: number; entries: CatalogEntryLike[] } | undefined

  const fetchCatalog = deps.fetchCatalog ?? (async (force: boolean) => {
    if (!force && cache && Date.now() - cache.at < CATALOG_TTL) return cache.entries
    const res = await fetch(DEFAULT_CATALOG_URL, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error('[plugin-reload] 拉清单失败：HTTP ' + res.status)
    const body = (await res.json()) as CatalogLike
    const entries = Array.isArray(body.plugins) ? body.plugins : []
    cache = { at: Date.now(), entries }
    return entries
  })

  async function catalog(force = false): Promise<CatalogEntryLike[]> {
    return fetchCatalog(force)
  }

  function facadeOf(): PluginFacadeLike | undefined {
    if (deps.facade) return deps.facade()
    const w = globalThis as Record<string, unknown>
    return w.MiniCanvasUI as PluginFacadeLike | undefined
  }

  async function reload(target: string, opts: ReloadOptions = {}): Promise<{ name: string; url: string }> {
    const facade = facadeOf()
    if (!facade) throw new Error('[plugin-reload] 宿主还没就绪（window.MiniCanvasUI 不在）')

    // ① 定地址，三种入参都认（优先级从高到低）：
    //    · opts.url 显式指定
    //    · target 本身就是产物地址（如 /plugins/x/x.js）→ 直接当地址用
    //    · 否则把 target 当 id / 运行时名去清单里查
    let url = opts.url
    let globalName = opts.globalName
    /** 从清单里对上的那一条（按地址反查 / 按名字查都填它；用于纠错兜底） */
    let matched: CatalogEntryLike | undefined
    if (!url && looksLikeUrl(target)) {
      url = target
    }
    if (!url) {
      const entry = findEntry(await catalog(true), target)
      if (!entry) throw new Error('[plugin-reload] 清单里找不到插件：' + target)
      url = entry.url
      globalName = globalName ?? entry.globalName
      matched = entry
    }
    if (!url) throw new Error('[plugin-reload] 插件没有可加载的产物地址：' + target)

    // 只给了地址、没给全局名 → 拿地址去清单里**反查**全局名。
    // 为什么必要：UMD 加载器没有全局名提示时会"扫 window 上所有 MiniCanvasPlugin*"，
    // 多个插件并存时可能挑到别的那个（挑错 = 卸错了插件）。反查能拿到就不走那条兜底。
    if (!globalName) {
      try {
        // 按**路径名**比（相对地址 / 完整地址 / 带查询串 都算同一个产物），见 pathOf 说明
        const want = pathOf(url)
        const hit = (await catalog()).find((e) => e.url && pathOf(e.url) === want)
        if (hit) {
          matched = hit
          if (hit.globalName) globalName = hit.globalName
        }
      } catch {
        /* 清单取不到不影响重装：退化成加载器自己的兜底取件 */
      }
    }

    // 兜底推导：热重载走 KV 上报地址（不在清单里）时没有全局名提示。
    // UMD 全局名有稳定约定 MiniCanvasPlugin<PascalCase(插件名)>，按 opts.name（卸旧依据，
    // 上报方给出，最权威）推导。有提示时加载器按名取件，绝不会扫 window 挑错
    // （实测踩过：重装 bottom-bar 时扫到 align-guide → 卸旧装新 → Duplicate plugin name）。
    if (!globalName && opts.name) {
      globalName =
        'MiniCanvasPlugin' +
        opts.name
          .split(/[-_]/)
          .filter(Boolean)
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
          .join('')
    }

    // ② 加载最新产物（破缓存由加载器内部加 ?t= 完成）
    const loadUmd = deps.loadUmd ?? defaultLoadUmd
    const mod = await loadUmd(url, globalName)

    /**
     * 纠错兜底（无清单提示的路径）：加载器没拿到全局名时会扫 window 猜，
     * 多个插件并存时可能挑到别的那个（实测踩过：重装 bottom-bar 挑到 align-guide，
     * 卸旧装新 → "[core] Duplicate plugin name: align-guide"）。
     * UMD 全局名有稳定约定 MiniCanvasPlugin<PascalCase(插件名)> —— 按加载出的 mod.name
     * 推导真名再 load 一次，对得上才替换，对不上保留首次结果。
     */
    if (!globalName && mod?.name) {
      const pascal = mod.name
        .split(/[-_]/)
        .filter(Boolean)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join('')
      const guessed = 'MiniCanvasPlugin' + pascal
      if (guessed !== 'MiniCanvasPlugin') {
        try {
          const retry = await loadUmd(url, guessed)
          if (retry && retry.name === mod.name) {
            mod.name = retry.name
            if (typeof retry.apply === 'function') mod.apply = retry.apply
            if (typeof retry.setup === 'function') mod.setup = retry.setup
          }
        } catch {
          /* 重加载失败：保留首次结果 */
        }
      }
    }

    // 纠错兜底：加载器在**没有全局名提示**时会扫 window 猜，可能挑到别的插件。
    // 若对上的清单项说这个地址的插件名是 A、而实际加载出来的是 B，说明挑错了 ——
    // 按清单里的全局名**重加载一次**，避免"以为重装了 X，其实把 Y 卸了重装"（实测踩过）。
    if (matched && matched.name && mod.name !== matched.name && matched.globalName) {
      try {
        const retry = await loadUmd(url, matched.globalName)
        if (retry && retry.name === matched.name) {
          mod.name = retry.name
          if (typeof retry.apply === 'function') mod.apply = retry.apply
          if (typeof retry.setup === 'function') mod.setup = retry.setup
        }
      } catch {
        /* 重加载失败：保留首次结果，至少不会更糟 */
      }
    }

    // ③ 卸旧 + 装新（reloadPlugin 内部就是这两步；核心插件会明确抛错，原样透出）
    //
    // 旧实现的名字优先用调用方显式给的（opts.name）。为什么：按地址装（watch 上报 front）时，
    // 地址可能不在清单里，no url 反查只能得到加载出来的 mod.name；若新旧实现名字不同（改名/换包），
    // 旧的那个就卸不掉。由上报方从 key 带来的名字是最权威的卸旧依据。
    facade.reloadPlugin(opts.name || mod.name, mod)

    // ④ 可选：装完顺手跑一条命令（如打开该插件的面板）
    if (opts.then) {
      const cmd = facade.getContext().get('command') as { execute(id: string): unknown } | undefined
      cmd?.execute(opts.then)
    }
    return { name: mod.name, url }
  }

  async function list(): Promise<Array<{ id: string; name: string; url: string; installed: boolean }>> {
    const entries = await catalog()
    const installed = new Set<string>(
      (() => {
        const facade = facadeOf()
        const ctx = facade?.getContext()
        const svc = ctx?.get('pluginManager') as
          | { list(): Array<{ name: string }> }
          | undefined
        return svc?.list?.().map((p: { name: string }) => p.name) ?? []
      })(),
    )
    return entries
      .filter((e) => !!e.url)
      .map((e) => ({ id: e.id, name: e.name, url: e.url, installed: installed.has(e.name) }))
  }

  /**
   * 监听后台插件变更（SSE）→ 自动重装。
   *
   * 为什么地址不用手填：后台就是同源的 cloud-server（托管这个页面的那台），
   * 端点固定 `/api/plugin-events`。同源用相对路径最省事、也最不易错（换端口/换机都不怕）。
   * 真要跨源（比如把界面单独 dev、连别的 cloud-server）再传 \`{ url: 'http://…/api/plugin-events' }\`。
   *
   * 重装是**串行排队**的（一条队列 + 一个在跑就等它完）：产物连着变好几次时不会并发重装同一个插件。
   */
  function watch(options: WatchOptions = {}): () => void {
    if (typeof EventSource === 'undefined') {
      console.warn('[plugin-reload] 当前环境没有 EventSource，无法监听插件变更')
      return () => {}
    }
    const url = options.url ?? DEFAULT_WATCH_URL
    const es = new EventSource(url)
    let closed = false
    // 串行队列：保证同一插件的重装不并发（产物连续变化时排队，不互相打断）
    let chain: Promise<void> = Promise.resolve()

    es.onmessage = (ev: MessageEvent<string>) => {
      if (closed) return
      let e: PluginWatchEvent
      try {
        e = JSON.parse(ev.data) as PluginWatchEvent
      } catch {
        return // 非 JSON（理论上是保活注释，不会被 onmessage 收到）：忽略
      }
      if (!e || e.type !== 'plugin-changed') return
      if (options.only && !options.only.includes(e.name) && !options.only.includes(e.id)) return
      chain = chain.then(async () => {
        if (closed) return
        options.onEvent?.(e, 'before')
        try {
          await reload(e.name)
          options.onEvent?.(e, 'after')
        } catch (err) {
          console.warn('[plugin-reload] 自动重装失败：' + e.name, err)
        }
      })
    }
    // 断线由 EventSource 自己重连（SSE 内建）；这里只在彻底关闭时动手
    return () => {
      closed = true
      es.close()
    }
  }

  return { reload, list, catalog, watch }
}

/**
 * 默认 UMD 加载器：复用「插件管理」的实现（`createUmdLoader` + `bustCache`）。
 *
 * 为什么延迟 import：这个模块可能被 Node（单测）直接加载，而 UMD 加载器要 document/window。
 * 真正调 reload 时才取，避免顶层 import 就把浏览器依赖拉进来。
 */
async function defaultLoadUmd(url: string, globalName?: string): Promise<LoadedPluginLike> {
  const { createUmdLoader, bustCache } = await import('@mini-canvas/plugin-manager')
  const loader = createUmdLoader({
    document,
    win: globalThis as unknown as Record<string, unknown>,
  })
  const mod = await loader(bustCache(url, Date.now()), globalName)
  return mod as unknown as LoadedPluginLike
}

/**
 * 把重装器挂到 window（幂等：已有就不重复挂）。
 *
 * 在 `main.ts` 里于应用启动前调用一次即可。函数内部**调用时才**去取 window.MiniCanvasUI，
 * 所以"挂函数的时刻宿主还没就绪"完全没问题。
 */
export function exposePluginReloader(
  key: string = DEFAULT_RELOADER_KEY,
  deps: ReloaderDeps = {},
): PluginReloader {
  const reloader = createPluginReloader(deps)
  const w = globalThis as Record<string, unknown>
  if (w[key] === undefined) w[key] = reloader
  // 未构建（vite build）不含本模块；dev 下自动挂上 watch 便捷入口（真正连不连由使用者决定）
  return reloader
}
