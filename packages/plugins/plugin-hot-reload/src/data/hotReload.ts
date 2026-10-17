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
   * **监听 KV 通知通道**（热重载的主驱动，用户口径的最终形态）：
   * 复用宿主共享的 /api/kv/events SSE，看到 `key` 以 `plugin-watch:` 开头就
   * HEAD 对比该插件产物 —— 变了才拉新产物重装（防误报，也防旧通知覆盖新通知）。
   *
   * 返回停止函数（页面卸载时调；内部幂等，重复调用安全）。
   */
  watchPluginChanges(): () => void
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
 * KV 通知 key 的约定前缀（watch 工具 PUT 的 key 必须用它开头）。
 * key 其余部分 = 插件运行名（如 plugin-watch:hot-reload-demo）。
 * 事件形状 = { type:'config', key:'plugin-watch:<名>' }（服务端 routes/events.ts 现成推送）。
 */
export const PLUGIN_WATCH_PREFIX = 'plugin-watch:'

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

  // ==================== 插件产物变更监听（KV 通知通道，最终形态） ====================
  //
  // 用户口径的完整链路（已实测可行）：
  //   watch 工具：盯 src → 变了 build → build 成功后 PUT /api/kv/config/plugin-watch:<插件名>
  //   后台：      kv 写 → /api/kv/events 推 {type:'config', key:'plugin-watch:<名>'}（现成，零改动）
  //   画布：      这里监听该前缀 → HEAD 对比产物 Last-Modified（防误报/防旧通知）→ 变了才拉新重装
  //
  // 为什么不直接信通知：同一个 watch 进程的多次构建可能乱序到达（SSE 无序保证），
  // HEAD 的 Last-Modified 是权威顺序 —— 旧通知到达时对比发现"没变"就静默丢弃。
  // 为什么 value 不看：服务端事件**有意不带值**（见 routes/events.ts），key 本身已含全部信息
  // （哪个插件变了），新内容在产物文件里，reload 时现拉。

  /** 产物 HEAD 对比用的 Last-Modified 缓存：插件名 → 上次见到的值 */
  const lastModifiedBy = new Map<string, string>()

  /** 从清单按名字/目录名找产物地址（reload 的 target 可能是运行名，产物地址在清单里） */
  async function catalogUrlOf(target: string): Promise<string | undefined> {
    try {
      const res = await fetch('/plugin-catalog.json', { headers: { accept: 'application/json' } })
      if (!res.ok) return undefined
      const body = (await res.json()) as { plugins?: Array<{ id?: string; name?: string; url?: string }> }
      const hit = (body.plugins ?? []).find((p) => p.name === target || p.id === target)
      return hit?.url || undefined
    } catch {
      return undefined
    }
  }

  /**
   * 收到某插件的变更通知：HEAD 对比 → 真变了才 reload。
   * 对比基准是上次**自己拉的**那次（不是通知里的时间戳 —— SSE 无序，通知里的值不可信）。
   */
  async function handlePluginWatchEvent(pluginName: string): Promise<void> {
    const url = await catalogUrlOf(pluginName)
    if (!url) {
      log({ sourceId: 0, sourceLabel: 'kv-plugin-watch', action: 'error', detail: pluginName + '：清单里找不到产物地址' })
      return
    }
    try {
      const head = await fetch(url, { method: 'HEAD', cache: 'no-store' })
      const lm = head.headers.get('last-modified') ?? String(head.headers.get('content-length') ?? '')
      const prev = lastModifiedBy.get(pluginName)
      if (prev !== undefined && prev === lm) return // 旧通知（乱序/重复）：产物没变，静默丢弃
      lastModifiedBy.set(pluginName, lm) // 记住这次见到的；reload 拉的就是这份
    } catch (err) {
      log({ sourceId: 0, sourceLabel: 'kv-plugin-watch', action: 'error', detail: pluginName + '：HEAD 失败 ' + String(err) })
      return
    }
    try {
      await reloadOne(pluginName)
      log({ sourceId: 0, sourceLabel: 'kv-plugin-watch', action: 'reload', detail: pluginName })
      notifyReloaded(pluginName, 'kv-plugin-watch')
    } catch (err) {
      log({ sourceId: 0, sourceLabel: 'kv-plugin-watch', action: 'error', detail: pluginName + '：' + String(err) })
    }
  }

  /** KV 通知监听状态（幂等：多次 watchPluginChanges 只连一条） */
  let kvWatchStarted = false
  let kvWatchStop: (() => void) | null = null

  function watchPluginChanges(): () => void {
    if (kvWatchStarted && kvWatchStop) return kvWatchStop
    kvWatchStarted = true
    const w = globalThis as unknown as {
      __miniCanvasKvEvents?: { subscribe(path: string, onEvent: (e: { type: string; key: string }) => void): () => void }
    }
    const shared = w.__miniCanvasKvEvents
    const KEY_PREFIX = 'plugin-watch:'
    const onEvent = (e: { type: string; key: string }): void => {
      if (e.type !== 'config') return
      if (!e.key.startsWith(KEY_PREFIX)) return
      const pluginName = e.key.slice(KEY_PREFIX.length)
      if (pluginName) void handlePluginWatchEvent(pluginName)
    }
    if (shared && typeof shared.subscribe === 'function') {
      // 复用宿主共享连接（cloud-client 同款做法，防连接爆表）
      kvWatchStop = shared.subscribe('/api/kv/events', onEvent)
      log({ sourceId: 0, sourceLabel: 'kv-plugin-watch', action: 'connected', detail: '共享 KV 通道' })
    } else if (typeof EventSource !== 'undefined') {
      // 没有共享宿主（独立使用）→ 自己开一条
      const es = new EventSource('/api/kv/events')
      es.onmessage = (ev) => {
        try {
          const e = JSON.parse((ev as MessageEvent).data) as { type?: string; key?: string }
          if (e?.type && e?.key) onEvent(e as { type: string; key: string })
        } catch { /* 坏帧忽略 */ }
      }
      kvWatchStop = () => es.close()
      log({ sourceId: 0, sourceLabel: 'kv-plugin-watch', action: 'connected', detail: '/api/kv/events' })
    } else {
      kvWatchStop = () => {} // Node 测试环境：no-op
    }
    return kvWatchStop
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
    watchPluginChanges,
  }
}

