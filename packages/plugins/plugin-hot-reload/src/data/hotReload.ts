/**
 * hotReload —— 「热重载」的**数据层**（无 Vue、无 DOM 以外的依赖；可单测）。
 *
 * ## 它解决什么
 *
 * 开发期想"改完插件就能在浏览器里看到"，本质上要做一件事：
 * **某个地址上的产物变了 → 把对应的插件重装一遍**。
 *
 * 但地址不止一种，来源也不止一处：
 * - cloud-server 的 **SSE**（`/api/plugin-events`）：它盯着本机插件目录，产物一变就推一条。
 * - **vite dev server** 的 HMR（`/@vite/client`）：插件单独起 dev 时，它自带"有文件变了"的通知。
 *
 * 所以本模块把"来源"抽象成两种，各自能接，且**可以同时接多条**（地址不同源也行）：
 *
 *   type: 'sse'    → 连一条 SSE，收到 plugin-changed 就重装那个插件
 *   type: 'vite'   → 连 vite 的 HMR ws，收到 update/full-reload 就重装**整源的所有模块**
 *                    （vite 的 dev 地址天然支持一个源下多个插件/组件：一次连接覆盖全部）
 *
 * ## 为什么不需要手填"要重装哪个插件"
 *
 * - SSE：事件里直接带 `id / name`，照着重装即可。
 * - vite：HMR 只说"某个模块变了"，不说"那是哪个插件"。做法是**按 dev 地址反查清单** ——
 *   清单里的产物地址若落在同一个 origin 上，就是"这个源里的插件"，全重装一遍。
 *   于是"一个 vite 源支持多个插件"是自然的（一次连接、全源重载）。
 *
 * ## 与 window.MiniCanvasPlugin.reload 的关系
 *
 * 本模块**不重复实现重装**，只调用已有的 `window.MiniCanvasPlugin.reload`。
 * 这样"怎么卸旧装新 / 怎么查清单 / 怎么纠错"只有一份实现。
 */

/** 一个热重载源的配置 */
export interface HotReloadSource {
  /** 稳定 id（增删改用它定位；自增分配） */
  id: number
  /** 可读名字（如"本机 cloud-server"、"文本节点 dev"） */
  label: string
  /**
   * 要连的地址：
   * - type='sse'  → SSE 端点（如 `http://127.0.0.1:8865/api/plugin-events`）
   * - type='vite' → vite dev 的**根地址**（如 `http://localhost:5311`），内部会连它的 /@vite/client
   */
  url: string
  /** 来源类型 */
  type: 'sse' | 'vite'
  /** 是否启用 */
  enabled: boolean
}

/** 一条运行记录（给界面看"最近发生了什么"） */
export interface HotReloadLogEntry {
  at: number
  sourceId: number
  sourceLabel: string
  /** 做了什么 */
  action: 'connected' | 'disconnected' | 'reload' | 'error'
  /** 细节（重装了哪个插件 / 什么错） */
  detail: string
}

export interface HotReloadState {
  sources: HotReloadSource[]
  logs: HotReloadLogEntry[]
  /** 自动重装时用哪个 reload 函数（缺省 window.MiniCanvasPlugin.reload） */
  ready: boolean
}

export interface HotReload {
  readonly state: HotReloadState
  /** 加一条源；返回它的 id */
  addSource(input: Omit<HotReloadSource, 'id'> & { id?: number }): number
  /** 删一条源（要停止它的连接） */
  removeSource(id: number): void
  /** 改一条源（地址/名字/类型/开关） */
  updateSource(id: number, patch: Partial<Omit<HotReloadSource, 'id'>>): void
  /** 手动重装一个插件（转发给 window.MiniCanvasPlugin.reload） */
  reload(target: string): Promise<void>
  /** 立刻 (重)连接所有已启用的源；改完地址调它 */
  reconnect(): void
  /** 全停 */
  stopAll(): void
  /** 清日志 */
  clearLogs(): void
  /**
   * 同步「插件声明源」（自动登记/摘除）。
   * 启动时调一次 + 可定时重扫（服务起了/停了，地址出现/消失就跟着变）。
   * 返回本轮新增/摘除的插件名（供日志/测试断言）。
   */
  syncPluginSources(): Promise<{ added: string[]; removed: string[] }>
}

/** 取"路径名"（去协议/主机/查询/哈希）——用于跨形态比较同一个产物（与 pluginReload 同口径） */
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

/** 取 origin（sse 比较 / vite 反查清单都用它） */
export function originOf(url: string): string {
  try {
    return new URL(url, 'http://localhost').origin
  } catch {
    return ''
  }
}

/** 判一段文本像不像"地址"（保守：带协议 / 带斜杠 / 带扩展名 / 带查询串） */
export function looksLikeUrl(t: string): boolean {
  return /^https?:\/\//i.test(t) || t.includes('/') || /\.[a-z]{2,4}($|[?#])/i.test(t)
}

/** 由一段用户输入的地址，猜它该用哪种来源（给界面填默认值用） */
export function guessType(url: string): 'sse' | 'vite' {
  return /\/@vite\/client($|\?)/.test(url) || /:\d+\/?$/.test(url) ? 'vite' : 'sse'
}

/** 缺省注入点：真实跑用 window；测试注入假的 */
export interface HotReloadDeps {
  /** 建一个 EventSource（缺省用全局） */
  createEventSource?: (url: string) => {
    onmessage: ((ev: { data: string }) => void) | null
    onerror: (() => void) | null
    onopen: (() => void) | null
    close(): void
    readyState: number
  }
  /** 建一个 WebSocket（缺省用全局；vite HMR 走 ws） */
  createWebSocket?: (url: string) => {
    onmessage: ((ev: { data: unknown }) => void) | null
    onerror: (() => void) | null
    onopen: (() => void) | null
    close(): void
    readyState: number
  }
  /** 重装一个插件（缺省转发 window.MiniCanvasPlugin.reload） */
  reload?: (target: string) => Promise<void>
  /** 取清单里"某个 origin 上有哪些插件"（vite 反查用）。缺省查 /plugin-catalog.json */
  pluginsOnOrigin?: (origin: string) => Promise<string[]>
  /** 存/取持久化（缺省 localStorage；测试可给内存版） */
  storage?: { getItem(k: string): string | null; setItem(k: string, v: string): void }
  /**
   * 扫描「插件声明的热重载地址」并返回（自动登记用，见 syncPluginSources）。
   * 缺省实现：拉 /plugin-catalog.json → 对每个产物地址在**同源**下取
   * /plugins/<pkg>/hot-reload.json（构建时由 vite 插件 hotReloadManifest 生成）。
   * 测试注入假实现。
   */
  scanPluginSources?: () => Promise<Array<{ plugin: string; sse: string; label: string }>>
  /**
   * **重装提示**（视觉反馈）：某插件刚被自动重装了一遍就调它。
   *
   * 用户口径：「如果发生了热重载，希望能提供一个视觉上的提示，比如弹一个 notify」。
   * 缺省实现 = 右下角弹一条 vue-sonner 通知（不用设置面板的 toast —— showToast 已停用），
   * 但**注入了 onReloaded 就完全用注入的**（测试给假实现、宿主想换样式也从这里换）。
   *
   * 为什么只提示"自动重装"：手动点"重装"按钮时用户自己就在屏幕前按着按钮，
   * 结果直接写在按钮上（重装中/完成）与日志里，再弹通知是噪音。
   */
  onReloaded?: (info: { plugin: string; sourceLabel: string }) => void
}

/** 持久化 key */
export const SOURCES_KEY = 'hot-reload:sources'

/**
 * 「插件声明源」的来源标记（自动登记的源 label 前缀 / 摘除判据）。
 *
 * 为什么不和手填的混在一起：手填源是用户的选择，插件声明源跟着**清单**走 ——
 * 插件卸了/声明没了 → 自动摘除；插件又装回来/声明又出现 → 自动登记回来。
 * 用固定前缀识别"这类源是自动的"，同步时不碰用户手填的那些。
 */
export const AUTO_SOURCE_PREFIX = '插件声明'

/**
 * 建一个热重载管理器（单例语义：宿主只建一个、挂 window）。
 */
export function createHotReload(deps: HotReloadDeps = {}): HotReload {
  const storage = deps.storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)

  /** 运行时状态（这里不依赖 Vue；界面用 reactive 包一层即可） */
  const state: HotReloadState = {
    sources: loadSources(),
    logs: [],
    ready: typeof window !== 'undefined',
  }

  let seq = state.sources.reduce((m, s) => Math.max(m, s.id), 0)
  /** id → 已建的连接（便于 reconnect/stop 时精确关掉） */
  const live = new Map<number, () => void>()

  function loadSources(): HotReloadSource[] {
    try {
      const raw = storage?.getItem(SOURCES_KEY)
      const arr = raw ? (JSON.parse(raw) as unknown) : []
      if (!Array.isArray(arr)) return []
      return arr
        .filter((x): x is HotReloadSource => !!x && typeof (x as HotReloadSource).url === 'string')
        .map((x, i) => ({
          id: typeof x.id === 'number' ? x.id : i + 1,
          label: typeof x.label === 'string' ? x.label : '',
          url: x.url,
          type: x.type === 'vite' ? 'vite' : 'sse',
          enabled: x.enabled !== false,
        }))
    } catch {
      return []
    }
  }
  function persist(): void {
    try {
      storage?.setItem(SOURCES_KEY, JSON.stringify(state.sources))
    } catch {
      /* 配额/隐私模式：本次会话仍生效 */
    }
  }

  function log(entry: Omit<HotReloadLogEntry, 'at'>): void {
    state.logs = [{ at: Date.now(), ...entry }, ...state.logs].slice(0, 200)
  }

  /** 默认重装：转发 window.MiniCanvasPlugin.reload */
  async function defaultReload(target: string): Promise<void> {
    const w = globalThis as unknown as { MiniCanvasPlugin?: { reload(t: string): Promise<unknown> } }
    if (!w.MiniCanvasPlugin?.reload) throw new Error('window.MiniCanvasPlugin 不在（宿主未挂热重载器）')
    await w.MiniCanvasPlugin.reload(target)
  }
  function reloadOne(target: string): Promise<void> {
    return (deps.reload ?? defaultReload)(target)
  }

  /** 自动重装成功后的视觉提示（注入优先；缺省右下角 vue-sonner 通知） */
  function notifyReloaded(plugin: string, sourceLabel: string): void {
    if (deps.onReloaded) {
      deps.onReloaded({ plugin, sourceLabel })
      return
    }
    // 缺省实现：vue-sonner 弹一条（延迟 import：Node 单测没有 DOM，不能在模块顶层引入）。
    try {
      void import('vue-sonner').then(({ toast }) => {
        toast.success('热重载完成：' + plugin, { description: '来源：' + (sourceLabel || '未知来源') })
      })
    } catch {
      /* 通知弹不出来不影响重装本身（比如 Node 环境） */
    }
  }

  /** 默认反查：从 /plugin-catalog.json 里挑出"产物地址落在该 origin"的插件名 */
  async function defaultPluginsOnOrigin(origin: string): Promise<string[]> {
    const res = await fetch('/plugin-catalog.json', { headers: { accept: 'application/json' } })
    if (!res.ok) return []
    const body = (await res.json()) as { plugins?: Array<{ name?: string; url?: string }> }
    return (body.plugins ?? [])
      .filter((p) => typeof p.url === 'string' && p.url && originOf(p.url) === origin)
      .map((p) => p.name ?? '')
      .filter(Boolean)
  }

  /** 连一条源；返回停止函数 */
  function connect(source: HotReloadSource): () => void {
    if (source.type === 'vite') return connectVite(source)
    return connectSse(source)
  }

  /** SSE：收到 plugin-changed 就重装那个插件（事件自带 id/name） */
  function connectSse(source: HotReloadSource): () => void {
    const create =
      deps.createEventSource ??
      ((url: string) => new EventSource(url) as unknown as ReturnType<NonNullable<HotReloadDeps['createEventSource']>>)
    let es: ReturnType<NonNullable<HotReloadDeps['createEventSource']>>
    try {
      es = create(source.url)
    } catch (err) {
      log({ sourceId: source.id, sourceLabel: source.label, action: 'error', detail: String(err) })
      return () => {}
    }
    let closed = false
    let retry: ReturnType<typeof setTimeout> | null = null
    es.onopen = () => log({ sourceId: source.id, sourceLabel: source.label, action: 'connected', detail: source.url })
    es.onmessage = (ev: { data: string }) => {
      let e: { type?: string; id?: string; name?: string }
      try {
        e = JSON.parse(ev.data)
      } catch {
        return
      }
      if (e?.type !== 'plugin-changed') return
      const target = e.name || e.id || ''
      if (!target) return
      void reloadOne(target)
        .then(() => {
          log({ sourceId: source.id, sourceLabel: source.label, action: 'reload', detail: target })
          notifyReloaded(target, source.label)
        })
        .catch((err) => log({ sourceId: source.id, sourceLabel: source.label, action: 'error', detail: String(err) }))
    }
    es.onerror = () => {
      if (closed) return
      if (es.readyState === 2 /* CLOSED */) {
        log({ sourceId: source.id, sourceLabel: source.label, action: 'disconnected', detail: source.url })
        if (retry) clearTimeout(retry)
        retry = setTimeout(() => {
          if (!closed) {
            const next = connectSse(source)
            live.set(source.id, () => {
              next()
              closed = true
            })
          }
        }, 3000)
      }
    }
    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      try {
        es.close()
      } catch {
        /* 忽略 */
      }
    }
  }

  /**
   * vite：连 dev server 的 HMR ws，收到"有更新"就把该源上的插件全重装。
   *
   * 为什么全重装而不是精确到某个：vite 的 HMR 消息只说"某模块变了"，不说插件名；
   * 而"一个 vite 源 = 一个开发中的插件（或一组）"，全重装一遍最简单可靠，
   * 也正好满足"一个源支持多个插件/组件"。
   */
  function connectVite(source: HotReloadSource): () => void {
    const origin = originOf(source.url)
    // vite 的 HMR 客户端连的是 ws://host:port（vite 自己握手时带 token，浏览器端用它的 client 就自动带）
    const wsUrl = origin.replace(/^http/i, 'ws') + '/'
    const create =
      deps.createWebSocket ?? ((url: string) => new WebSocket(url) as unknown as ReturnType<NonNullable<HotReloadDeps['createWebSocket']>>)
    let ws: ReturnType<NonNullable<HotReloadDeps['createWebSocket']>>
    try {
      ws = create(wsUrl)
    } catch (err) {
      log({ sourceId: source.id, sourceLabel: source.label, action: 'error', detail: String(err) })
      return () => {}
    }
    let closed = false
    let debounce: ReturnType<typeof setTimeout> | null = null
    ws.onopen = () => log({ sourceId: source.id, sourceLabel: source.label, action: 'connected', detail: wsUrl })
    ws.onmessage = (ev: { data: unknown }) => {
      // vite HMR 消息形如 {"type":"update","updates":[…]} / {"type":"full-reload"}
      let msg: { type?: string }
      try {
        msg = typeof ev.data === 'string' ? JSON.parse(ev.data) : (ev.data as { type?: string })
      } catch {
        return
      }
      if (msg?.type !== 'update' && msg?.type !== 'full-reload') return
      // 去抖：一次保存会连发好几条 update，等 250ms 一起处理，避免连着重装好几遍
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => {
        if (closed) return
        void reloadAllOnOrigin(source)
      }, 250)
    }
    ws.onerror = () => {
      if (!closed) log({ sourceId: source.id, sourceLabel: source.label, action: 'error', detail: 'vite HMR 连接失败：' + wsUrl })
    }
    return () => {
      closed = true
      if (debounce) clearTimeout(debounce)
      try {
        ws.close()
      } catch {
        /* 忽略 */
      }
    }
  }

  /** 重装某个源（该 origin）上的全部插件 */
  async function reloadAllOnOrigin(source: HotReloadSource): Promise<void> {
    let names: string[] = []
    try {
      names = await (deps.pluginsOnOrigin ?? defaultPluginsOnOrigin)(originOf(source.url))
    } catch (err) {
      log({ sourceId: source.id, sourceLabel: source.label, action: 'error', detail: '查清单失败：' + String(err) })
      return
    }
    if (!names.length) {
      log({ sourceId: source.id, sourceLabel: source.label, action: 'error', detail: '该地址上没有可重装的插件（清单里找不到）' })
      return
    }
    for (const n of names) {
      try {
        await reloadOne(n)
        log({ sourceId: source.id, sourceLabel: source.label, action: 'reload', detail: n })
        notifyReloaded(n, source.label)
      } catch (err) {
        log({ sourceId: source.id, sourceLabel: source.label, action: 'error', detail: n + '：' + String(err) })
      }
    }
  }

  // ===== 公开动作 =====

  function stopSource(id: number): void {
    const stop = live.get(id)
    if (stop) {
      stop()
      live.delete(id)
    }
  }

  function startSource(source: HotReloadSource): void {
    stopSource(source.id)
    if (!source.enabled || !source.url || !looksLikeUrl(source.url)) return
    live.set(source.id, connect(source))
  }

  function addSource(input: Omit<HotReloadSource, 'id'> & { id?: number }): number {
    seq += 1
    const src: HotReloadSource = {
      id: input.id ?? seq,
      label: input.label ?? '',
      url: input.url ?? '',
      type: input.type ?? guessType(input.url ?? ''),
      enabled: input.enabled !== false,
    }
    state.sources = [...state.sources, src]
    persist()
    startSource(src)
    return src.id
  }

  function removeSource(id: number): void {
    stopSource(id)
    state.sources = state.sources.filter((s) => s.id !== id)
    persist()
  }

  function updateSource(id: number, patch: Partial<Omit<HotReloadSource, 'id'>>): void {
    state.sources = state.sources.map((s) => (s.id === id ? { ...s, ...patch } : s))
    persist()
    const next = state.sources.find((s) => s.id === id)
    if (next) startSource(next) // 地址/开关变了就重连
  }

  function reconnect(): void {
    for (const s of state.sources) startSource(s)
  }

  function stopAll(): void {
    for (const id of [...live.keys()]) stopSource(id)
  }

  function clearLogs(): void {
    state.logs = []
  }

  /**
   * 默认扫描：拉清单，对每个产物地址取同源的 dist/hot-reload.json。
   *
   * 为什么在热重载管理器里做而不是服务端清单加字段：服务端 /plugins/** 的解析规则
   * 强拼 dist/（安全设计），声明文件放 dist/ 里构建时生成（vite 插件 hotReloadManifest），
   * 服务端**零改动**；且"逐个取声明"让没跑 watch 服务的插件天然没有这条源（404 → 跳过）。
   */
  async function defaultScanPluginSources() {
    const res = await fetch('/plugin-catalog.json', { headers: { accept: 'application/json' } })
    if (!res.ok) return []
    const body = (await res.json()) as { plugins?: Array<{ id?: string; name?: string; url?: string }> }
    const found: Array<{ plugin: string; sse: string; label: string }> = []
    for (const p of body.plugins ?? []) {
      if (!p.id || !p.url) continue
      // 声明文件与产物同目录（dist/）→ 产物地址同源同目录取 hot-reload.json
      const url = new URL(p.url, location.origin)
      const manifestUrl = url.origin + url.pathname.replace(/[^/]+\.js$/i, 'hot-reload.json')
      try {
        const mRes = await fetch(manifestUrl, { headers: { accept: 'application/json' } })
        if (!mRes.ok) continue
        const decl = (await mRes.json()) as { sse?: unknown }
        if (typeof decl.sse !== 'string' || !decl.sse) continue
        // 相对地址按清单同源补全（dev :5288 连 watch :5333 就是这种）
        const sse = new URL(decl.sse, url.origin).href
        found.push({ plugin: p.name ?? p.id, sse, label: AUTO_SOURCE_PREFIX + ' · ' + (p.name ?? p.id) })
      } catch {
        /* 单个插件取声明失败不影响其它（可能没跑 watch / 没构建） */
      }
    }
    return found
  }

  /** 本轮同步已登记的自动源 id（摘除时用） */
  let autoSourceIds = new Set<number>()

  /**
   **自动登记/摘除**（用户口径：服务启动自动加进监听，服务结束自动移除）。
   *
   * 同步语义（只动带 AUTO_SOURCE_PREFIX 的源，用户手填的不碰）：
   * - 声明里有、现在没登记 → 登记（地址变了就更新）；
   * - 声明里没有、但之前是自动登记的 → 摘除（插件卸了 / 服务没跑了）。
   */
  async function syncPluginSources(): Promise<{ added: string[]; removed: string[] }> {
    const scan = deps.scanPluginSources ?? defaultScanPluginSources
    let declared: Array<{ plugin: string; sse: string; label: string }>
    try {
      declared = await scan()
    } catch {
      return { added: [], removed: [] } // 清单拉不到：不动现有状态
    }
    const added: string[] = []
    const removed: string[] = []

    // 现有的自动源（按 url 对齐，label 只是展示）
    const auto = state.sources.filter((s) => s.label.startsWith(AUTO_SOURCE_PREFIX))
    const autoByUrl = new Map(auto.map((s) => [s.url, s]))
    const wantedUrls = new Set(declared.map((d) => d.sse))

    // ① 声明里有 → 补登记 / 更新
    for (const d of declared) {
      const existing = autoByUrl.get(d.sse)
      if (existing) {
        if (existing.label !== d.label) updateSource(existing.id, { label: d.label })
      } else {
        addSource({ url: d.sse, label: d.label, type: 'sse', enabled: true })
        added.push(d.plugin)
      }
    }
    // ② 声明里没有的自动源 → 摘除
    for (const s of auto) {
      if (!wantedUrls.has(s.url)) {
        removeSource(s.id)
        removed.push(s.label)
      }
    }

    autoSourceIds = new Set(state.sources.filter((s) => s.label.startsWith(AUTO_SOURCE_PREFIX)).map((s) => s.id))
    return { added, removed }
  }

  return {
    state,
    addSource,
    removeSource,
    updateSource,
    reload: reloadOne,
    reconnect,
    stopAll,
    clearLogs,
    syncPluginSources,
  }
}

