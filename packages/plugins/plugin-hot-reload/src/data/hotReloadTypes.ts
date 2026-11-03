/**
 * hotReload 的数据契约与纯工具（无事件订阅、无网络、无状态）。
 */

/** 一个热重载源的配置 */
export interface HotReloadSource {
  /** 稳定 id（增删改用它定位；自增分配） */
  id: number
  /** 可读名字（如"本机 cloud-server"、"文本节点 dev"） */
  label: string
  /**
   * 要连的地址：
   * - type='sse' → SSE 端点（如 `http://127.0.0.1:8865/api/plugin-events`）
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
   * 缺省只写 console（数据层不依赖任何通知库）；宿主在装配时注入
   * 真正要用的通知方式（画布宿主接默认主题的 notify 服务）。
   *
   * 为什么只提示"自动重装"：手动点"重装"按钮时用户自己就在屏幕前按着按钮，
   * 结果直接写在按钮上（重装中/完成）与日志里，再弹通知是噪音。
   */
  onReloaded?: (info: { plugin: string; sourceLabel: string }) => void
  /** 自动重装**失败**时的提示（与 onReloaded 对称；缺省只写 console） */
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
