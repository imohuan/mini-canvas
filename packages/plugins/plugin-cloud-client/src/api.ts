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

export class CloudApi {
  private baseUrl: string
  private readonly doFetch: FetchLike

  constructor(private readonly opts: CloudApiOptions = {}) {
    this.baseUrl = opts.baseUrl ?? ''
    this.doFetch = opts.fetchImpl ?? ((url, init) => fetch(url, init))
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
    if (!res.ok) throw new Error('[cloud-client] 拉动作清单失败 ' + res.status)
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
    if (!res.ok || !body.jobId) throw new Error(body.error ?? '[cloud-client] 下单失败 ' + res.status)
    return body.jobId
  }

  /** 查任务（底栏轮询的兜底用） */
  async getJob(jobId: string): Promise<ServerJob | undefined> {
    const res = await this.doFetch(this.absolute('/api/jobs/' + encodeURIComponent(jobId)), {
      headers: { accept: 'application/json' },
    })
    if (res.status === 404) return undefined
    if (!res.ok) throw new Error('[cloud-client] 查任务失败 ' + res.status)
    const body = (await res.json()) as { job?: ServerJob }
    return body.job
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
    if (!res.ok) throw new Error('[cloud-client] 拉历史失败 ' + res.status)
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
    if (!res.ok) throw new Error('[cloud-client] 读画布失败 ' + res.status)
    const body = (await res.json()) as { nodes?: unknown[]; edges?: unknown[]; view?: unknown }
    return { nodes: body.nodes ?? [], edges: body.edges ?? [], view: body.view ?? null }
  }

  /** 上传一个资源（原始字节）→ 拿到画布内引用 */
  async uploadResource(canvasId: string, bytes: Blob, name: string): Promise<{ ref: string; hashName: string; url: string }> {
    const url =
      '/api/canvases/' + encodeURIComponent(canvasId) + '/resources?name=' + encodeURIComponent(name)
    const res = await this.doFetch(this.absolute(url), {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes as unknown as BodyInit,
    })
    if (!res.ok) throw new Error('[cloud-client] 上传资源失败 ' + res.status)
    const body = (await res.json()) as { ref?: string; hashName?: string }
    if (!body.ref || !body.hashName) throw new Error('[cloud-client] 上传资源返回异常')
    return {
      ref: body.ref,
      hashName: body.hashName,
      url: '/api/canvases/' + canvasId + '/resources/' + body.hashName,
    }
  }

  /** 增量写节点（后台与网页两个写方共用同一个口子，谁都不会盖掉谁） */
  async patchNodes(body: { add?: unknown[]; delete?: string[]; update?: unknown[] }): Promise<void> {
    const res = await this.doFetch(this.absolute('/api/canvas/nodes'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error('[cloud-client] 写节点失败 ' + res.status)
  }

  /** 增量写边（同上） */
  async patchEdges(body: { add?: unknown[]; delete?: string[]; update?: unknown[] }): Promise<void> {
    const res = await this.doFetch(this.absolute('/api/canvas/edges'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error('[cloud-client] 写连线失败 ' + res.status)
  }

  /** 写视口 */
  async putView(canvasId: string, view: unknown): Promise<void> {
    const res = await this.doFetch(this.absolute('/api/canvases/' + encodeURIComponent(canvasId) + '/view'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(view),
    })
    if (!res.ok) throw new Error('[cloud-client] 写视口失败 ' + res.status)
  }

  /** 整包写画布（"以这份为准"：首次上云时把本地推上去） */
  async replaceCanvas(canvasId: string, nodes: unknown[], edges: unknown[]): Promise<void> {
    const res = await this.doFetch(this.absolute('/api/canvases/' + encodeURIComponent(canvasId)), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodes, edges }),
    })
    if (!res.ok) throw new Error('[cloud-client] 写画布失败 ' + res.status)
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
    if (!factory && typeof EventSource === 'undefined') return () => {}
    const create =
      factory ?? ((url: string) => new EventSource(url) as unknown as EventSourceLike)

    let source: EventSourceLike | null = null
    try {
      source = create(this.absolute('/api/kv/events'))
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
