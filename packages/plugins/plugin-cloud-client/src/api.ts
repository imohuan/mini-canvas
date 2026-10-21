/**
 * CloudApi —— 与 cloud-server 说话的唯一一处（HTTP + SSE）。
 *
 * 为什么所有请求都收在这里：服务地址要能现场改（设置面板里那项），
 * 散在各处的 fetch 会各自缓存一个旧地址 —— 一处收口，换地址时改一个变量就够。
 *
 * 零 import / 零 Vue：本插件要打成自包含单文件（见 vite.config.ts 的说明）。
 */
import {
  joinUrl,
  type ChangeEvent,
  type CloudApiOptions,
  type EventSourceLike,
  type FetchLike,
  type HistoryQueryInput,
  type ServerAction,
  type ServerHistoryPage,
  type ServerJob,
} from './apiTypes.js'

/**
 * 管理令牌的键名与头名（就地内联 —— 本插件产物必须零 import）。
 *
 * 与 `@mini-canvas/canvas-base` 的 ADMIN_TOKEN_KEY / ADMIN_TOKEN_HEADER 必须一致，
 * `constants.test` 会用那边的 setAdminToken 写一份、这里读到的必须是同一个值。
 */
const ADMIN_TOKEN_KEY = 'mc_admin_token'
const ADMIN_TOKEN_HEADER = 'x-admin-token'

/** 读本机浏览器里存的管理令牌；没有/读不到就返回 undefined（与 canvas-base 同口径） */
function readAdminToken(): string | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined
    const token = (localStorage.getItem(ADMIN_TOKEN_KEY) ?? '').trim()
    return token || undefined
  } catch {
    return undefined
  }
}

/**
 * 403 时的人话。
 *
 * 为什么需要：后台给写入口加了管理令牌，而令牌要用户自己去「设置 → 插件」填一次。
 * 没填时后台只回一句 `需要管理令牌（x-admin-token）`，云插件这边再包一层就只剩
 * `[cloud-client] 写节点失败 403` —— 用户看到的是节点上「执行失败 / 刷新后任务已中断」，
 * 完全猜不到是没填令牌（真实踩到过）。
 *
 * 所以凡是 403，都换成这句能照着做的提示；其它状态码保持原样。
 */
const TOKEN_HINT =
  '后台要求管理令牌。请打开「设置 → 插件 → 管理令牌」，粘贴后台启动日志或 <数据目录>/admin-token 里的那串，再重试。'

/** 把「HTTP 状态」翻译成能照着做的错误（只有 403 需要翻译，别的原样） */
function httpError(what: string, status: number): Error {
  if (status === 403) return new Error('[cloud-client] ' + what + '被拒绝（403）：' + TOKEN_HINT)
  return new Error('[cloud-client] ' + what + '失败 ' + status)
}

export class CloudApi {
  private baseUrl: string
  private readonly doFetch: FetchLike

  constructor(private readonly opts: CloudApiOptions = {}) {
    this.baseUrl = opts.baseUrl ?? ''
    const rawFetch = opts.fetchImpl ?? ((url, init) => fetch(url, init))
    // 唯一请求出口：所有 HTTP 方法都在这里补令牌（一处覆盖画布写 / 资源 / 任务）。
    // SSE 不走这里（EventSource 不能带头），见 subscribeChanges。
    this.doFetch = (url, init) => {
      const token = readAdminToken()
      if (!token) return rawFetch(url, init)
      const headers = new Headers(init?.headers)
      headers.set(ADMIN_TOKEN_HEADER, token)
      return rawFetch(url, { ...init, headers })
    }
  }

  /** 换服务地址（设置改了立刻生效，不用重装插件） */
  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl
  }

  get base(): string {
    return this.baseUrl
  }

  /** 相对地址补成完整地址（画布内引用由调用方按当前画布先解析） */
  absolute(pathOrUrl: string): string {
    if (/^https?:/i.test(pathOrUrl)) return pathOrUrl
    return joinUrl(this.baseUrl, pathOrUrl)
  }

  // ==================== 动作清单 ====================

  /**
   * 拉动作清单。
   *
   * 带上上次的版本号：没变就只回版本号（changed:false），省掉整份清单的搬运 ——
   * 所以这个口子可以放心地每隔几秒问一次。
   */
  async fetchActions(ifVersion?: number): Promise<{ version: number; changed: boolean; actions: ServerAction[] }> {
    const qs = ifVersion === undefined ? '' : '?ifVersion=' + encodeURIComponent(String(ifVersion))
    const res = await this.doFetch(this.absolute('/api/actions' + qs), { headers: { accept: 'application/json' } })
    if (!res.ok) throw httpError('拉动作清单', res.status)
    const body = (await res.json()) as { version?: number; changed?: boolean; actions?: ServerAction[] }
    return {
      version: typeof body.version === 'number' ? body.version : 0,
      changed: body.changed !== false,
      actions: Array.isArray(body.actions) ? body.actions : [],
    }
  }

  // ==================== 任务 ====================

  /** 下单 → jobId */
  async createJob(input: {
    canvasId: string
    nodeId: string
    actionId: string
    prompt?: string
    values?: Record<string, unknown>
    resources?: Array<{ kind: string; url?: string; value?: string }>
  }): Promise<string> {
    const res = await this.doFetch(this.absolute('/api/jobs'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; jobId?: string; error?: string }
    // 403 优先翻译成「去填令牌」（后台原文太抽象，用户看不出要做什么）
    if (!res.ok || !body.jobId) throw res.status === 403 ? httpError('下单', 403) : new Error(body.error ?? '[cloud-client] 下单失败 ' + res.status)
    return body.jobId
  }

  /** 查任务（底栏轮询的兜底用） */
  async getJob(jobId: string): Promise<ServerJob | undefined> {
    const res = await this.doFetch(this.absolute('/api/jobs/' + encodeURIComponent(jobId)), {
      headers: { accept: 'application/json' },
    })
    if (res.status === 404) return undefined
    if (!res.ok) throw httpError('查任务', res.status)
    const body = (await res.json()) as { job?: ServerJob }
    return body.job
  }

  /** 查某节点当前有没有在跑的任务（前端据此禁用「发送」，挡住连点重复下单） */
  async activeJob(canvasId: string, nodeId: string): Promise<{ jobId: string; progress?: number } | null> {
    const res = await this.doFetch(
      this.absolute('/api/jobs/active?canvasId=' + encodeURIComponent(canvasId) + '&nodeId=' + encodeURIComponent(nodeId)),
      { headers: { accept: 'application/json' } },
    )
    if (!res.ok) return null
    const body = (await res.json()) as { active?: { jobId: string; progress?: number } | null }
    return body.active ?? null
  }

  /** 取消任务（进后台 → 后台再去服务端真取消） */
  async cancelJob(jobId: string): Promise<void> {
    await this.doFetch(this.absolute('/api/jobs/' + encodeURIComponent(jobId) + '/cancel'), { method: 'POST' })
  }

  // ==================== 历史 ====================

  async fetchHistory(q: HistoryQueryInput = {}): Promise<ServerHistoryPage> {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(q)) {
      if (v !== undefined && v !== '') params.set(k, String(v))
    }
    const qs = params.toString()
    const res = await this.doFetch(this.absolute('/api/history' + (qs ? '?' + qs : '')), {
      headers: { accept: 'application/json' },
    })
    if (!res.ok) throw httpError('拉历史', res.status)
    const body = (await res.json()) as Partial<ServerHistoryPage>
    return {
      items: body.items ?? [],
      total: body.total ?? 0,
      page: body.page ?? 1,
      pageSize: body.pageSize ?? 20,
      summary: body.summary ?? { total: 0, byKind: {} },
    }
  }

  // ==================== 画布 ====================

  /** 读画布（节点 + 边 + 视口） */
  async readCanvas(canvasId: string): Promise<{ nodes: unknown[]; edges: unknown[]; view: unknown }> {
    const res = await this.doFetch(this.absolute('/api/canvases/' + encodeURIComponent(canvasId)), {
      headers: { accept: 'application/json' },
    })
    if (!res.ok) throw httpError('读画布', res.status)
    const body = (await res.json()) as { nodes?: unknown[]; edges?: unknown[]; view?: unknown }
    return { nodes: body.nodes ?? [], edges: body.edges ?? [], view: body.view ?? null }
  }

  /**
   * 上传一个资源（原始字节）→ 拿到画布内资源地址。
   *
   * 关键字段是 `hashName`：调用方据此拼**逻辑 ID** `<canvasId>/<hashName>`（见 cloudResourceAdapter），
   * 地址只是 resolve 时现拼的产物，不进节点。
   */
  async uploadResource(canvasId: string, bytes: Blob, name: string): Promise<{ hashName: string; url: string }> {
    const url =
      '/api/canvases/' + encodeURIComponent(canvasId) + '/resources?name=' + encodeURIComponent(name)
    return await this.postResource(url, bytes, canvasId)
  }

  /**
   * 传一个**固定名**资源（服务端的"槽位"口）：同名原地覆盖，地址可推算。
   *
   * 用于缩略图 / 视频帧图这类"名字由源和参数决定"的资源 ——
   * 只有地址可推算，才能"先查有没有、没有才生成"（见 cloudResourceAdapter.putResource）。
   */
  async uploadResourceToSlot(
    canvasId: string,
    bytes: Blob,
    slot: string,
    name: string,
  ): Promise<{ hashName: string; url: string }> {
    const url =
      '/api/canvases/' +
      encodeURIComponent(canvasId) +
      '/resources?slot=' +
      encodeURIComponent(slot) +
      '&name=' +
      encodeURIComponent(name)
    return await this.postResource(url, bytes, canvasId)
  }

  /** 上传资源这一步两个入口共用（差别只在查询串） */
  private async postResource(
    url: string,
    bytes: Blob,
    canvasId: string,
  ): Promise<{ hashName: string; url: string }> {
    const res = await this.doFetch(this.absolute(url), {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes as unknown as BodyInit,
    })
    if (!res.ok) throw httpError('上传资源', res.status)
    const body = (await res.json()) as { hashName?: string }
    if (!body.hashName) throw new Error('[cloud-client] 上传资源返回异常')
    return {
      hashName: body.hashName,
      url: '/api/canvases/' + canvasId + '/resources/' + body.hashName,
    }
  }

  /**
   * 这个资源地址**存在吗**（HEAD 探测）。
   *
   * 用途：派生资源（缩略图/帧图）用裸引用记名，要知道"之前生成过没有"只能问服务端。
   * 不抛错：网络异常一律当"不存在"（调用方会重新生成一次，功能不受影响）。
   */
  async resourceExists(pathOrUrl: string): Promise<boolean> {
    try {
      const res = await this.doFetch(this.absolute(pathOrUrl), { method: 'HEAD' })
      return res.ok
    } catch {
      return false
    }
  }

  /** 增量写节点（后台与网页两个写方共用同一个口子，谁都不会盖掉谁）；带画布 id，多画布各写各的 */
  async patchNodes(canvasId: string, body: { add?: unknown[]; delete?: string[]; update?: unknown[] }): Promise<void> {
    const res = await this.doFetch(this.absolute('/api/canvases/' + encodeURIComponent(canvasId) + '/nodes'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw httpError('写节点', res.status)
  }

  /** 增量写边（同上） */
  async patchEdges(canvasId: string, body: { add?: unknown[]; delete?: string[]; update?: unknown[] }): Promise<void> {
    const res = await this.doFetch(this.absolute('/api/canvases/' + encodeURIComponent(canvasId) + '/edges'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw httpError('写连线', res.status)
  }

  /** 写视口 */
  async putView(canvasId: string, view: unknown): Promise<void> {
    const res = await this.doFetch(this.absolute('/api/canvases/' + encodeURIComponent(canvasId) + '/view'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(view),
    })
    if (!res.ok) throw httpError('写视口', res.status)
  }

  /** 整包写画布（"以这份为准"：首次上云时把本地推上去） */
  async replaceCanvas(canvasId: string, nodes: unknown[], edges: unknown[]): Promise<void> {
    const res = await this.doFetch(this.absolute('/api/canvases/' + encodeURIComponent(canvasId)), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodes, edges }),
    })
    if (!res.ok) throw httpError('写画布', res.status)
  }

  // ==================== 实时通道 ====================

  /**
   * 订阅"哪个 (type,key) 变了"。
   *
   * 有意**不带 type 过滤**：一条连接要同时听画布（canvas 域）与清单/历史（config 域）——
   * 事件接口只支持按域过滤，不合并就得开好几条连接。
   */
  subscribeChanges(onChange: (e: ChangeEvent) => void, onError?: (msg: string) => void): () => void {
    const factory = this.opts.createEventSource
    const url = this.absolute('/api/kv/events')

    // 先复用宿主（@mini-canvas/ui）挂在全局上的**共享连接**：本应用里首页 / 画布 /
    // 本插件都在订阅同一条 /api/kv/events，各开各的会让一个页面上出现好几条
    // **永不关闭**的长连接。浏览器对单个域名的并发上限是 6 条，占满之后页面里
    // 所有普通请求只能排队（用户报的"网页卡住、请求停在待处理"）。
    //
    // 只在没有自定义 SSE 工厂时走这条路：工厂是测试/宿主注入的确定性替身，
    // 绕过它会让那些用例失去意义。
    const shared = factory ? undefined : sharedKvEvents()
    if (shared) {
      try {
        return shared.subscribe(url, (e) => {
          if (e && typeof e.key === 'string' && typeof e.type === 'string') onChange(e)
        })
      } catch (err) {
        onError?.('无法订阅实时通道：' + (err instanceof Error ? err.message : String(err)))
        return () => {}
      }
    }

    if (!factory && typeof EventSource === 'undefined') return () => {}

    const create =
      factory ?? ((url: string) => new EventSource(url) as unknown as EventSourceLike)

    let source: EventSourceLike | null = null
    try {
      source = create(url)
      source.addEventListener('message', (e) => {
        // 事件内容只用来判断"哪个 (type,key) 变了"；真数据一律现读（服务器只报 key，不带值）
        try {
          const parsed = JSON.parse(String(e?.data ?? '')) as ChangeEvent
          if (parsed && typeof parsed.key === 'string' && typeof parsed.type === 'string') onChange(parsed)
        } catch {
          /* 解析不了就当没收到：宁可漏一次通知，也不要因为坏帧把订阅打断 */
        }
      })
      // 断线交给 EventSource 自己重连（浏览器内置，带退避）
      source.onerror = () => onError?.('实时通道断开，浏览器会自动重连')
    } catch (err) {
      onError?.('无法订阅实时通道：' + (err instanceof Error ? err.message : String(err)))
      return () => {}
    }
    return () => {
      source?.close()
      source = null
    }
  }
}

/**
 * 宿主提供的共享 KV 实时通道（见 ui 的 composables/kvEvents）。
 *
 * 本插件是**独立打包**的（产物自包含、零 import），拿不到 ui 的模块导出，
 * 所以约定走全局键。取不到（别的宿主 / 单测 / 纯 Node）就返回 undefined，
 * 调用方退回自己开一条 —— 行为不因缺这个全局而坏掉。
 */
const KV_EVENTS_GLOBAL_KEY = '__miniCanvasKvEvents'

interface SharedKvEvents {
  subscribe(path: string, onEvent: (e: ChangeEvent) => void): () => void
}

function sharedKvEvents(): SharedKvEvents | undefined {
  const bag = globalThis as unknown as Record<string, unknown>
  const v = bag[KV_EVENTS_GLOBAL_KEY]
  if (!v || typeof v !== 'object') return undefined
  const subscribe = (v as { subscribe?: unknown }).subscribe
  if (typeof subscribe !== 'function') return undefined
  return v as SharedKvEvents
}
