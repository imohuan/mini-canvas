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
  /**
   * **调试插件清单**（设置页用）：读 watch 上报的记录 + 核对内核真实状态。
   *
   * 不读插件管理页的名单 —— 两个插件各自独立，是否已装只看内核里有没有这个唯一名字。
   */
  listDebugPlugins(): Promise<DebugPluginRow[]>
  /** 重装一个调试插件：按它上报的地址卸旧装新（前端）；后台有产物时按路径装 */
  reinstallDebugPlugin(name: string): Promise<void>
  /** 卸载一个调试插件：内核卸载 + 后台卸载 + 删掉它的上报记录 */
  uninstallDebugPlugin(name: string): Promise<void>
  /**
   * 订阅「调试监听状态变了」（在线 / 掉线 / 暂停），返回取消函数。
   *
   * 为什么还要这个：SSE 在页面隐藏、断网时会漏；所以除了订阅，页面重新可见时
   * 也必须自己再拉一次快照（见 HotReloadPage 的 visibilitychange）。
   */
  watchDebugPresence(onChange: () => void): () => void
}

/** 调试插件清单里的一行 */
export interface DebugPluginRow {
  /** 插件唯一名字（内核按它索引，也是上报 key 的后半段） */
  name: string
  /** 已装进内核（唯一判据，来自内核自己的插件表） */
  installed: boolean
  /** 运行态（active / pending / failed…）；未装为 undefined */
  state?: string
  /** 前端产物地址（上报值里的 front） */
  front?: string
  /** 后台产物路径（上报值里的 server） */
  server?: string
  /** 上报时间（毫秒时间戳） */
  at?: number
  /**
   * **调试监听**此刻的状态（与「插件装没装」是两件事）。
   *
   * - `unknown`：查不到（旧版 watch 没心跳 / 后台没开在场通道 / 请求失败）—— 不能当作在线；
   * - `stopped`：收到了正常告别；
   * - `stale`：心跳超时（多半是 watch 被关掉或崩了）。
   */
  presence?: DebugPresenceStatus
  /** 心跳状态原文（watching / building / paused / failed），便于排查 */
  presenceState?: string
  /** 距上次心跳多久（毫秒） */
  presenceAgeMs?: number
  /** 同一插件有几个 watch 实例（>1 要在界面上 warning） */
  presenceInstances?: number
  /** 监听失败时的一句话原因 */
  presenceMessage?: string
}

/** 调试听的对在线判定（画布侧） */
export type DebugPresenceStatus = 'online' | 'building' | 'paused' | 'failed' | 'stale' | 'stopped' | 'unknown'

/** 后台 GET /api/plugin-presence 的元素（与 cloud-server 的协议同形） */
export interface PresenceRowLike {
  name: string
  instance: string
  state: 'watching' | 'building' | 'paused' | 'failed' | 'stopped'
  front?: string
  server?: string
  message?: string
  lastSeenAt: number
  ageMs: number
  stale: boolean
  instances: number
  multiple: boolean
}

export interface PresenceSnapshot {
  ok: true
  staleAfterMs: number
  now: number
  plugins: PresenceRowLike[]
}

/**
 * 把后台快照里的一行翻译成界面状态。
 *
 * 注意 `unknown` 的两种情况必须分开看：
 * - 快照里根本没有这个插件 → 旧版 watch（没心跳）或还没上报过；
 * - 整个快照取不到 → 后台没开调试通道 / 连不上。
 * 两者都不能显示成「在线」。
 */
export function presenceStatusOf(row: PresenceRowLike | undefined): DebugPresenceStatus {
  if (!row) return 'unknown'
  if (row.state === 'stopped') return 'stopped'
  // 超时优先于原文状态：进程崩了时最后一条可能还是 watching
  if (row.stale) return 'stale'
  if (row.state === 'building') return 'building'
  if (row.state === 'paused') return 'paused'
  if (row.state === 'failed') return 'failed'
  return 'online'
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
  /**
   * 按**产物地址**重装一个插件（缺省转发 window.MiniCanvasPlugin.reload(target, { url })）。
   *
   * 为什么需要它：watch 上报的 value 里已经带了前端产物地址，直接照这个地址拉新产物，
   * 不必再去清单里按名字猜位置 —— 插件放在哪个目录、从哪个后台构建，都由上报方说了算。
   */
  reloadByUrl?: (name: string, url: string) => Promise<void>
  /**
   * 内核当前已装插件名（缺省读 window.MiniCanvasUI.listPlugins）。
   *
   * 这是「是否已安装」的唯一判据：**按插件自己的唯一名字**，不看插件管理页的名单。
   * 两个插件各自独立，谁也不读谁的记录。
   */
  listInstalled?: () => string[]
  /** 从内核卸载一个插件（缺省 window.MiniCanvasUI.uninstallPlugin）；返回是否卸到 */
  uninstall?: (name: string) => boolean
  /** 拉调试插件清单（缺省读 /api/kv/config?values=1 里 plugin-watch: 前缀的项） */
  fetchJson?: (url: string, init?: RequestInit) => Promise<unknown>
  /**
   * 调试这一侧的后台地址（缺省 = 画布同源）。
   *
   * 只影响读取/清理 watch 上报记录与「按路径装后台半」，与插件管理那边的清单地址无关。
   */
  backendUrl?: string
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
  /** 自动重装**失败**时的提示（与 onReloaded 对称；缺省弹错误 toast） */
  onReloadFailed?: (info: { plugin: string; sourceLabel: string; error: string }) => void
}

/** 持久化 key */
export const SOURCES_KEY = 'hot-reload:sources'

/**
 * KV 通知 key 的约定前缀（watch 工具 PUT 的 key 必须用它开头）。
 * key 其余部分 = 插件运行名（如 plugin-watch:hot-reload-demo）。
 * 事件形状 = { type:'config', key:'plugin-watch:<名>' }（服务端 routes/events.ts 现成推送）。
 *
 * **值里带地址**（用户口径：地址由上报方给出，读取方不再猜）：
 *
 *   PUT /api/kv/config/plugin-watch:my-plugin
 *   { "value": { "t": 1760000000000,
 *                "front":  "http://127.0.0.1:8865/plugins/my-plugin/my-plugin.js",
 *                "server": "D:\\work\\my-plugin\\dist\\server.js" } }
 *
 * 事件本身**只带 key**（见 routes/events.ts），所以收到通知后再 GET 这个 key 读值。
 * `front` 是浏览器能直接请求的地址，用来重装前端半；`server` 是后台能读的磁盘路径，
 * 由后台的调试安装入口消费（见 routes/serverPlugins.ts 的 `/install-from-path`）。
 * 老格式（只有 `t`）继续可用：那时退回清单反查，行为与以前一致。
 */
export const PLUGIN_WATCH_PREFIX = 'plugin-watch:'

/**
 * 在场变化广播用的 KV key（与 cloud-server 的 routes/pluginPresenceRoute.ts 一致）。
 * 值里带 name；订阅方收到就现拉一次快照。
 */
export const PRESENCE_KEY = 'plugin-presence'

/**
 * 给受保护的写请求补管理令牌（与 canvas-base 的同名工具同一份约定）。
 *
 * 为什么不直接 import 那一份：热重载插件要保持对 canvas-base 零依赖（可能被别的宿主单独装），
 * 而令牌的存储键与请求头在仓库里是**定死的契约**（mc_admin_token / x-admin-token）。
 * 名字保持一致，好让「管理令牌覆盖」那条守卫能追溯到这里。
 */
export function withAdminToken(headers: Record<string, string> = {}): Record<string, string> {
  let token = ''
  try {
    token = (typeof localStorage !== 'undefined' ? localStorage.getItem('mc_admin_token') : '')?.trim() ?? ''
  } catch {
    token = ''
  }
  return token ? { ...headers, 'x-admin-token': token } : headers
}

/** watch 上报的值（键可缺省；缺了就退回老路径） */
export interface PluginWatchReport {
  /** 上报时间戳（只用于诊断/日志，不用于判断先后） */
  t?: number
  /** 前端产物地址（浏览器可直接请求；可以是绝对地址或同源相对地址） */
  front?: string
  /** 后台产物路径（后台机器上的绝对路径；只对同一台机器有意义） */
  server?: string
}

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

  /** 调试这一侧的后台基地址（空 = 同源）；拼路径时去掉尾斜杠 */
  function backend(path: string): string {
    const base = (deps.backendUrl ?? '').trim().replace(/\/+$/, '')
    return base ? base + path : path
  }

  /** 默认重装：转发 window.MiniCanvasPlugin.reload */
  async function defaultReload(target: string): Promise<void> {
    const w = globalThis as unknown as { MiniCanvasPlugin?: { reload(t: string): Promise<unknown> } }
    if (!w.MiniCanvasPlugin?.reload) throw new Error('window.MiniCanvasPlugin 不在（宿主未挂热重载器）')
    await w.MiniCanvasPlugin.reload(target)
  }

  /** 内核里当前装了哪些插件（唯一名字）。缺省读宿主门面。 */
  function installedList(): string[] {
    if (deps.listInstalled) return deps.listInstalled()
    const w = globalThis as unknown as { MiniCanvasUI?: { listPlugins?(): string[] } }
    try {
      return w.MiniCanvasUI?.listPlugins?.() ?? []
    } catch {
      return []
    }
  }

  /** 内核运行态（active / pending / failed） */
  function runtimeStateOf(name: string): string | undefined {
    const w = globalThis as unknown as {
      MiniCanvasUI?: { inspectPlugins?(): Array<{ name: string; state?: string }> }
    }
    try {
      return w.MiniCanvasUI?.inspectPlugins?.().find((p) => p.name === name)?.state
    } catch {
      return undefined
    }
  }

  /** 从内核卸一个插件；缺省走宿主门面（核心插件会抛错，原样透出） */
  function uninstallOne(name: string): boolean {
    if (deps.uninstall) return deps.uninstall(name)
    const w = globalThis as unknown as { MiniCanvasUI?: { uninstallPlugin?(n: string): boolean } }
    if (!w.MiniCanvasUI?.uninstallPlugin) throw new Error('window.MiniCanvasUI 不在（宿主未就绪）')
    return w.MiniCanvasUI.uninstallPlugin(name)
  }

  /**
   * 默认「按地址重装」：把地址交给宿主的 reload，让加载器直接照它拉产物。
   *
   * 为什么要按名字 + 地址分开传：宿主需要知道**卸哪个**（name）与**从哪装**（url）。
   * 只传地址时，宿主也能从产物里读出名字，但那份清单反查就绕回来了 —— 名字由 key 已经给出，没必要。
     * 老宿主不认识这个选项时退回"把地址当 target"的旧用法（它本来就支持按地址重装）。
   */
  async function defaultReloadByUrl(name: string, url: string): Promise<void> {
    const w = globalThis as unknown as {
      MiniCanvasPlugin?: {
        reload(t: string, opts?: { url?: string; name?: string }): Promise<unknown>
      }
    }
    if (!w.MiniCanvasPlugin?.reload) throw new Error('window.MiniCanvasPlugin 不在（宿主未挂热重载器）')
    // 名字 + 地址一起给：名字用来卸旧（内核按名字索引），地址用来拿新产物。
    await w.MiniCanvasPlugin.reload(url, { url, name })
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

  /** 自动重装失败后的提示（注入优先；缺省右下角错误通知） */
  function notifyFailed(plugin: string, error: string, sourceLabel = 'watch'): void {
    if (deps.onReloadFailed) {
      deps.onReloadFailed({ plugin, sourceLabel, error })
      return
    }
    try {
      void import('vue-sonner').then(({ toast }) => {
        toast.error('热重载失败：' + plugin, { description: error.slice(0, 200) })
      })
    } catch {
      /* Node 环境没有 toast：忽略 */
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
  //             值 = { t, front, server }（**地址由上报方给出**，见 PLUGIN_WATCH_PREFIX）
  //   后台：      kv 写 → /api/kv/events 推 {type:'config', key:'plugin-watch:<名>'}（现成，零改动）
  //   画布：      这里监听该前缀 → GET 该 key 读值 → 有 front 就按它重装（不再查清单）
  //
  // 为什么不直接信通知：同一个 watch 进程的多次构建可能乱序到达（SSE 无序保证），
  // HEAD 的 Last-Modified 是权威顺序 —— 旧通知到达时对比发现"没变"就静默丢弃。
  // 为什么先 GET 再判断：事件**有意不带值**（见 routes/events.ts，避免大 payload 在通道里搬），
  // 所以地址只能收到通知后现读一次。读回来的值里既有地址也有 t。

  /** 产物签名缓存：插件名 → 上次见到的值（内容哈希，见 signatureOf） */
  const lastModifiedBy = new Map<string, string>()

  /**
   * 产物签名：**内容哈希**（FNV-1a）。
   *
   * 为什么不用 Content-Length：等长修改（v14→v15、改文案不增减字数）长度完全不变，
   * 会被当成「没变」静默跳过 —— 真机表现为「有时有通知有时没有」（用户实测）。
   * 内容哈希对任何字节变化都敏感。成本：只在收到通知时拉一次全文（~百 KB），可接受。
   */
  function signatureOf(text: string): string {
    let h = 0x811c9dc5
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0).toString(36) + ':' + text.length.toString(36)
  }

  /**
   * 读 watch 上报的那条记录（key = plugin-watch:<插件名>）。
   *
   * 返回 undefined 表示读不到（未保存 / 网络失败）。值里的 front/server 可能是缺省的
   * —— 老版本 watch 只写 t，这里必须能继续跑。
   */
  async function readWatchReport(pluginName: string): Promise<PluginWatchReport | undefined> {
    try {
      const res = await fetch('/api/kv/config/' + encodeURIComponent(PLUGIN_WATCH_PREFIX + pluginName), {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      if (!res.ok) return undefined
      const body = (await res.json()) as { value?: unknown }
      const v = body?.value
      if (!v || typeof v !== 'object') return undefined
      const r = v as PluginWatchReport
      const front = typeof r.front === 'string' ? r.front : undefined
      const server = typeof r.server === 'string' ? r.server : undefined
      return {
        ...(typeof r.t === 'number' ? { t: r.t } : {}),
        ...(front ? { front } : {}),
        ...(server ? { server } : {}),
      }
    } catch {
      return undefined
    }
  }

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
   * 收到某插件的变更通知：先读上报值，再决定按哪个地址重装。
   *
   * 优先级：值里的 `front`（上报方声明的地址）> 清单反查（老格式兼容）。
   * 对比基准是上次**自己拉的**那次（不是通知里的时间戳 —— SSE 无序，通知里的值不可信）。
   */
  async function handlePluginWatchEvent(pluginName: string): Promise<void> {
    const report = await readWatchReport(pluginName)
    const declared = report?.front?.trim()
    // 有上报地址就用它；没有（老格式 / 读取失败）才退回清单 —— 老插件不受影响。
    const url = declared || (await catalogUrlOf(pluginName))
    if (!url) {
      log({
        sourceId: 0,
        sourceLabel: 'kv-plugin-watch',
        action: 'error',
        detail: pluginName + '：通知里没有地址，清单里也找不到产物地址',
      })
      return
    }
    // 产物签名：**拉全文算内容哈希**。
    // 曾经用 Content-Length 比对，等长修改（v14→v15、改文案不增减字数）会被当成「没变」
    // 静默丢弃 —— 真机表现就是「有时有通知、有时没有」。内容哈希对任何字节变化都敏感。
    // 拿不到内容时**不跳过**：宁可多重装一次，也不要静默吞掉用户的修改。
    try {
      const probe = await fetch(url, { cache: 'no-store' })
      if (probe.ok) {
        const sig = signatureOf(await probe.text())
        const prev = lastModifiedBy.get(pluginName)
        if (prev !== undefined && prev === sig) return // 真的重复通知（没变）：静默丢弃
        lastModifiedBy.set(pluginName, sig)
      }
    } catch (err) {
      // 探测失败不等于产物没变：继续往下重装（加载器自己会报明确的错）
      log({ sourceId: 0, sourceLabel: 'kv-plugin-watch', action: 'error', detail: pluginName + '：探测失败，仍尝试重装 ' + String(err) })
    }
    try {
      // 有上报地址 → 直接照它拉新产物（不看清单、不看名字对应的目录）
      if (declared) {
        if (deps.reloadByUrl) await deps.reloadByUrl(pluginName, declared)
        else if (deps.reload) await reloadOne(declared)
        else await defaultReloadByUrl(pluginName, declared)
      } else {
        await reloadOne(pluginName)
      }
      log({
        sourceId: 0,
        sourceLabel: 'kv-plugin-watch',
        action: 'reload',
        detail: pluginName + (declared ? '（按上报地址）' : '（清单反查）'),
      })
      notifyReloaded(pluginName, declared ? 'watch 上报地址' : 'kv-plugin-watch')
    } catch (err) {
      const msg = String(err)
      log({ sourceId: 0, sourceLabel: 'kv-plugin-watch', action: 'error', detail: pluginName + '：' + msg })
      // 失败也要让用户看见：静默失败 = 以为热重载坏了却不知道原因
      notifyFailed(pluginName, msg)
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

  // ==================== 调试插件清单（设置页） ====================
  //
  // 两个插件各自独立：本清单只看两件事 ——
  //   ① watch 上报了哪些插件（key = plugin-watch:<名字>，值里带地址）；
  //   ② 内核里此刻有没有这个**唯一名字**的插件。
  // 不读插件管理页的名单，也不往那边写。

  /** 拉一份上报记录（缺省读 KV 批量接口；失败返回空，不假装有） */
  async function readWatchReports(): Promise<Array<{ name: string; report: PluginWatchReport }>> {
    try {
      const raw = deps.fetchJson
        ? await deps.fetchJson(backend('/api/kv/config?values=1'))
        : await (await fetch(backend('/api/kv/config?values=1'), { cache: 'no-store' })).json()
      const body = raw as { values?: Record<string, unknown> }
      const values = body?.values ?? {}
      const out: Array<{ name: string; report: PluginWatchReport }> = []
      for (const [key, v] of Object.entries(values)) {
        if (!key.startsWith(PLUGIN_WATCH_PREFIX)) continue
        const name = key.slice(PLUGIN_WATCH_PREFIX.length)
        if (!name || !v || typeof v !== 'object') continue
        const r = v as PluginWatchReport
        out.push({
          name,
          report: {
            ...(typeof r.t === 'number' ? { t: r.t } : {}),
            ...(typeof r.front === 'string' && r.front ? { front: r.front } : {}),
            ...(typeof r.server === 'string' && r.server ? { server: r.server } : {}),
          },
        })
      }
      return out
    } catch {
      return []
    }
  }

  /** 后台在场快照（调试监听接口；没开 / 旧版后台 / 请求失败 → undefined） */
  async function readPresence(): Promise<PresenceSnapshot | undefined> {
    try {
      const raw = deps.fetchJson
        ? await deps.fetchJson(backend('/api/plugin-presence'))
        : await (await fetch(backend('/api/plugin-presence'), { cache: 'no-store' })).json()
      const body = raw as Partial<PresenceSnapshot>
      if (!body || body.ok !== true || !Array.isArray(body.plugins)) return undefined
      return body as PresenceSnapshot
    } catch {
      // 后台没开调试通道 / 连不上：界面显示「未知」，不能假装在线
      return undefined
    }
  }

  async function listDebugPlugins(): Promise<DebugPluginRow[]> {
    const installed = new Set(installedList())
    const [reports, presence] = await Promise.all([readWatchReports(), readPresence()])
    return reports
      .map(({ name, report }) => {
        const live = presence?.plugins.find((p) => p.name === name)
        return {
          name,
          installed: installed.has(name),
          ...(runtimeStateOf(name) ? { state: runtimeStateOf(name) } : {}),
          // 地址优先用「在场快照」（最新）里的，再退回产物记录 —— 两边都可能是空的
          ...(live?.front || report.front ? { front: live?.front || report.front } : {}),
          ...(live?.server || report.server ? { server: live?.server || report.server } : {}),
          ...(report.t ? { at: report.t } : {}),
          presence: presenceStatusOf(live),
          ...(live ? { presenceState: live.state, presenceAgeMs: live.ageMs } : {}),
          ...(live && live.instances > 1 ? { presenceInstances: live.instances } : {}),
          ...(live?.message ? { presenceMessage: live.message } : {}),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  function watchDebugPresence(onChange: () => void): () => void {
    const w = globalThis as unknown as {
      __miniCanvasKvEvents?: { subscribe(path: string, onEvent: (e: { type: string; key: string }) => void): () => void }
    }
    const KEY = PRESENCE_KEY
    const onEvent = (e: { type: string; key: string }): void => {
      if (e.type !== 'config' || e.key !== KEY) return
      onChange()
    }
    const shared = w.__miniCanvasKvEvents
    // 订阅地址必须跟「读快照」用同一个后台（配置了调试服务地址就跨源，不能还连页面同源）
    const eventsPath = backend('/api/kv/events')
    if (shared && typeof shared.subscribe === 'function') {
      return shared.subscribe(eventsPath, onEvent)
    }
    if (typeof EventSource === 'undefined') return () => {}
    const es = new EventSource(eventsPath)
    es.onmessage = (ev): void => {
      try {
        const e = JSON.parse((ev as MessageEvent).data) as { type?: string; key?: string }
        if (e?.type && e?.key) onEvent(e as { type: string; key: string })
      } catch {
        /* 坏帧忽略 */
      }
    }
    return () => es.close()
  }

  /** 删掉某个插件的上报记录（卸载时顺手清；失败不致命） */
  async function deleteWatchReport(name: string): Promise<void> {
    try {
      const url = '/api/kv/config/' + encodeURIComponent(PLUGIN_WATCH_PREFIX + name)
      if (deps.fetchJson) await deps.fetchJson(backend(url), { method: 'DELETE' })
      else await fetch(backend(url), { method: 'DELETE' })
    } catch {
      /* 记录删不掉不影响卸载本身 */
    }
  }

  /**
   * 重装一个调试插件。
   *
   * 名字来自上报 key（内核按它索引），地址来自上报值（不从清单猜）。
   * 后台有 server 路径时交给后台的调试安装入口；它没开 → 明确记一条错误，不假装成功。
   */
  async function reinstallDebugPlugin(name: string): Promise<void> {
    const reports = await readWatchReports()
    const hit = reports.find((r) => r.name === name)
    if (!hit) throw new Error('没有这个插件的上报记录：' + name)
    const { front, server } = hit.report
    if (!front) throw new Error(name + '：上报里没有前端地址（front），无法重装')
    // 同名只该有一份：内核里已经有这个**唯一名字**，重装就是「卸旧 → 装新」，
    // 不会出现两份并存（内核按名字索引，第二份会被拒）。
    try {
      if (deps.reloadByUrl) await deps.reloadByUrl(name, front)
      else if (deps.reload) await reloadOne(front)
      else await defaultReloadByUrl(name, front)
      log({ sourceId: 0, sourceLabel: '调试插件', action: 'reload', detail: name + '（按上报地址）' })
      notifyReloaded(name, '调试插件 · 手动重装')
    } catch (err) {
      log({ sourceId: 0, sourceLabel: '调试插件', action: 'error', detail: name + '：' + String(err) })
      throw err
    }
    if (server) await installServerFromPath(name, server)
  }

  /**
   * 按路径装后台半（调试入口）。
   *
   * 失败不抛给前端重装流程（前端已经装好了），但**必须记日志**：
   * 后台没开调试安装时，这里会明确告诉你原因，而不是静默成功。
   */
  async function installServerFromPath(id: string, serverPath: string): Promise<void> {
    try {
      // 管理令牌走仓库统一出口 withAdminToken（守卫测试要求可追溯，别手拼头）。
      const headers = withAdminToken({ 'content-type': 'application/json' })
      const body = { id, path: serverPath, confirm: true }
      const res = deps.fetchJson
        ? (await deps.fetchJson(backend('/api/server-plugins/install-from-path'), {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          })) as { ok?: boolean; error?: string; note?: string }
        : ((await (
            await fetch(backend('/api/server-plugins/install-from-path'), {
              method: 'POST',
              headers,
              body: JSON.stringify(body),
            })
          ).json()) as { ok?: boolean; error?: string; note?: string })
      if (body && res?.ok !== true) {
        log({
          sourceId: 0,
          sourceLabel: '调试插件',
          action: 'error',
          detail: id + '：后台半未装上（' + (res?.error ?? '未知原因') + '）',
        })
        return
      }
      log({ sourceId: 0, sourceLabel: '调试插件', action: 'reload', detail: id + '：后台半已按路径安装' })
    } catch (err) {
      log({
        sourceId: 0,
        sourceLabel: '调试插件',
        action: 'error',
        detail: id + '：后台半安装请求失败 ' + String(err),
      })
    }
  }

  /**
   * 卸载一个调试插件。
   *
   * 顺序：前端（内核按唯一名字卸）→ 后台（有 server 路径才卸）→ 删上报记录。
   * 前端都没装时不算失败（可能刚被别处卸过），最后照样清记录。
   */
  async function uninstallDebugPlugin(name: string): Promise<void> {
    const installed = new Set(installedList())
    if (installed.has(name)) {
      try {
        uninstallOne(name)
        log({ sourceId: 0, sourceLabel: '调试插件', action: 'disconnected', detail: name + '：已从内核卸载' })
      } catch (err) {
        // 核心插件等不允许卸：明确记错误并停止（不能把记录删了、插件还在）
        log({ sourceId: 0, sourceLabel: '调试插件', action: 'error', detail: name + '：卸载失败 ' + String(err) })
        throw err
      }
    }
    const reports = await readWatchReports()
    if (reports.find((r) => r.name === name)?.report.server) {
      await uninstallServerHalf(name)
    }
    await deleteWatchReport(name)
  }

  /** 卸后台半（按 id；后台没有这个 id 也算成功，因为目标状态已经达成） */
  async function uninstallServerHalf(id: string): Promise<void> {
    try {
      const headers = withAdminToken({ 'content-type': 'application/json' })
      const init: RequestInit = {
        method: 'POST',
        headers,
        body: JSON.stringify({ id }),
      }
      const res = deps.fetchJson
        ? ((await deps.fetchJson(backend('/api/server-plugins/uninstall'), init)) as { ok?: boolean; error?: string })
        : ((await (await fetch(backend('/api/server-plugins/uninstall'), init)).json()) as {
            ok?: boolean
            error?: string
          })
      if (res?.ok !== true) {
        log({ sourceId: 0, sourceLabel: '调试插件', action: 'error', detail: id + '：后台半未卸（' + (res?.error ?? '未知原因') + '）' })
        return
      }
      log({ sourceId: 0, sourceLabel: '调试插件', action: 'disconnected', detail: id + '：后台半已卸载' })
    } catch (err) {
      log({ sourceId: 0, sourceLabel: '调试插件', action: 'error', detail: id + '：后台半卸载失败 ' + String(err) })
    }
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
    watchDebugPresence,
    listDebugPlugins,
    reinstallDebugPlugin,
    uninstallDebugPlugin,
  }
}

