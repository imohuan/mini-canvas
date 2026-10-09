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
}

/** 持久化 key */
export const SOURCES_KEY = 'hot-reload:sources'

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
        .then(() => log({ sourceId: source.id, sourceLabel: source.label, action: 'reload', detail: target }))
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

  return {
    state,
    addSource,
    removeSource,
    updateSource,
    reload: reloadOne,
    reconnect,
    stopAll,
    clearLogs,
  }
}

