/**
 * hostFetch —— 宿主代发（视觉节点的沙箱 iframe 不再自己请求后台）。
 *
 * 沙箱页住在 `sandbox="allow-scripts"` 的 iframe 里，是不透明源（`Origin: null`）。
 * commit 4 的请求边界会拒绝这种请求，而且让沙箱页自己带管理令牌也不安全。
 * 所以这里把「发请求」搬到宿主：同源页面带令牌发，沙箱页只通过 postMessage 收结果。
 *
 * 这个文件只做「拼 URL / 带令牌 / 读回包 / 转发 SSE」，不碰 Vue，也不碰 DOM。
 * UiContent.vue 负责把消息接进来、把结果 postMessage 回去。
 */
import { ADMIN_TOKEN_HEADER, withAdminToken } from '@mini-canvas/canvas-base'

/** 沙箱页能交上来的产物字节（三种都能结构化克隆；Blob 保留 type） */
export type SavePayload = Blob | Uint8Array | ArrayBuffer

/**
 * 判断一个来自 iframe 的值是不是可上传的字节。
 *
 * 不能只写 `instanceof`：Blob / ArrayBuffer 都是跨 realm 传过来的，宿主 realm 的
 * 构造函数未必认得出对面那个对象。这里按形状认（Blob 有 arrayBuffer+type，
 * ArrayBuffer / TypedArray 有 byteLength）。
 */
export function isSavePayload(value: unknown): value is SavePayload {
  if (!value || typeof value !== 'object') return false
  const v = value as { arrayBuffer?: unknown; byteLength?: unknown; type?: unknown }
  if (typeof v.arrayBuffer === 'function' && typeof v.type === 'string') return true
  return typeof v.byteLength === 'number'
}

export interface HostProxyOptions {
  /** 测试注入用；不传就用全局 fetch */
  fetchImpl?: typeof fetch
  /** 后台绝对地址（末尾斜杠可有可无） */
  baseUrl: string
  canvasId: string
  nodeId: string
  /** 测试注入用；不传就按当前 localStorage 里的管理令牌走 withAdminToken */
  token?: string
}

export interface TaskRequest {
  name: string
  methods: string
  args?: unknown[]
  /** 后台等结束时才回包（原有语义） */
  wait?: boolean
  /** 沙箱页是否要日志 / 进度（要的话宿主订阅 SSE） */
  events?: boolean
}

export type TaskEvent =
  | { type: 'log'; line: string }
  | { type: 'progress'; value: number }
  | { type: 'done'; result: unknown }
  | { type: 'error'; message: string }
  | { type: 'cancelled' }

export interface TaskResult {
  ok: boolean
  runId?: string
  state?: string
  result?: unknown
  error?: string
  message?: string
  [key: string]: unknown
}

export interface HostProxy {
  save(payload: SavePayload, name: string): Promise<{ url: string }>
  task(body: TaskRequest, onEvent?: (event: TaskEvent) => void): Promise<TaskResult>
  cancel(runId: string): Promise<TaskResult>
  debugPoll(session: string): Promise<unknown>
  debugResult(body: unknown): Promise<unknown>
}

/** 后台各类错误统一成一句能看懂的话（403 必须带上后台原文） */
async function httpError(res: Response, what: string): Promise<Error> {
  let detail = ''
  try {
    const text = await res.text()
    try {
      const j = JSON.parse(text) as { error?: unknown }
      detail = typeof j?.error === 'string' ? j.error : text
    } catch {
      detail = text
    }
  } catch {
    /* 读不到正文就只报状态码 */
  }
  const tail = detail.trim() ? '：' + detail.trim().slice(0, 300) : ''
  if (res.status === 403) return new Error('后台拒绝（403）' + tail + '。请检查管理令牌。')
  return new Error(what + '失败（' + res.status + '）' + tail)
}

/** 非 2xx / 非 JSON 都抛错；成功返回解析后的 JSON */
async function readJson(res: Response, what: string): Promise<Record<string, unknown>> {
  if (!res.ok) throw await httpError(res, what)
  const text = await res.text()
  if (!text.trim()) return {}
  try {
    const j = JSON.parse(text) as unknown
    return j && typeof j === 'object' ? (j as Record<string, unknown>) : {}
  } catch {
    throw new Error(what + '失败：后台回的不是 JSON')
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 把 SSE 的一段正文解成一条事件（只认 `data:` 行；`: ping` 直接忽略） */
function frameEvent(frame: string): TaskEvent | undefined {
  const lines = frame.split(/\r?\n/)
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  if (!data) return undefined
  try {
    const parsed = JSON.parse(data) as TaskEvent
    return parsed && typeof parsed === 'object' && typeof parsed.type === 'string' ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * 建一个宿主代发器。
 *
 * 令牌读取放在每次请求时做（而不是建对象时）：用户在设置面板里刚填的令牌，
 * 下一个动作就该生效，不必刷新页面。
 */
export function createHostProxy(options: HostProxyOptions): HostProxy {
  const base = options.baseUrl.replace(/\/+$/, '')
  const fetchImpl = options.fetchImpl ?? fetch

  function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const headers = withAdminToken(extra)
    // 测试 / 特殊调用方可以显式给一个；显式值覆盖 localStorage 里的旧值。
    if (options.token) headers[ADMIN_TOKEN_HEADER] = options.token
    return headers
  }

  async function task(body: TaskRequest, onEvent?: (event: TaskEvent) => void): Promise<TaskResult> {
    const res = await fetchImpl(base + '/api/task/call', {
      method: 'POST',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        type: 'call',
        name: String(body.name),
        methods: String(body.methods),
        args: body.args ?? [],
        canvasId: options.canvasId,
        nodeId: options.nodeId,
        wait: body.wait === true,
      }),
    })
    const json = (await readJson(res, '起脚本')) as TaskResult
    if (!json.ok) throw new Error(json.error || '起不了这个脚本')

    // wait:true 由后台等到结束（POST 才回包），语义与改动前一致。
    if (body.wait === true) return json
    if (!json.runId || body.events !== true) return json
    return watchRun(String(json.runId), onEvent)
  }

  /** 订阅任务 SSE，日志/进度经 onEvent 转出去，终局作为 Promise 的结果 */
  async function watchRun(runId: string, onEvent?: (event: TaskEvent) => void): Promise<TaskResult> {
    const res = await fetchImpl(base + '/api/task/events?runId=' + encodeURIComponent(runId), {
      headers: authHeaders(),
    })
    if (!res.ok) throw await httpError(res, '订阅任务输出')
    if (!res.body) throw new Error('订阅任务输出失败：后台没有返回数据流')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let terminal: TaskResult | undefined

    const handle = (frame: string): void => {
      const event = frameEvent(frame)
      if (!event) return
      if (event.type === 'log' || event.type === 'progress') {
        onEvent?.(event)
        return
      }
      if (event.type === 'done') {
        terminal = { ok: true, runId, state: 'done', result: event.result }
        return
      }
      if (event.type === 'cancelled') {
        terminal = { ok: false, runId, state: 'cancelled' }
        return
      }
      if (event.type === 'error') {
        terminal = { ok: false, runId, state: 'error', error: event.message }
      }
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let at = buffer.indexOf('\n\n')
      while (at >= 0) {
        const frame = buffer.slice(0, at)
        buffer = buffer.slice(at + 2)
        handle(frame)
        at = buffer.indexOf('\n\n')
      }
      if (terminal) {
        // 后台在终局事件后就会收尾；这里主动断开，避免等一个已经不用的连接。
        try {
          await reader.cancel()
        } catch {
          /* 已经关了 */
        }
        break
      }
    }
    if (buffer.trim()) handle(buffer)
    return terminal ?? { ok: false, runId, state: 'error', error: '输出通道断了' }
  }

  return {
    async save(payload: SavePayload, name: string): Promise<{ url: string }> {
      const fname = String(name || 'out.png')
      const withExt = /\.[a-z0-9]+$/i.test(fname) ? fname : fname + '.png'
      const url =
        base +
        '/api/canvases/' +
        encodeURIComponent(options.canvasId) +
        '/resources?slot=' +
        encodeURIComponent(options.nodeId) +
        '&name=' +
        encodeURIComponent(withExt)
      const type = isSavePayload(payload) && typeof (payload as Blob).type === 'string' ? (payload as Blob).type : 'application/octet-stream'
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: authHeaders({ 'content-type': type || 'application/octet-stream' }),
        body: payload as BodyInit,
      })
      const json = await readJson(res, '保存产物')
      if (json.ok !== true || typeof json.url !== 'string' || !json.url) {
        throw new Error(typeof json.error === 'string' ? json.error : '保存产物失败')
      }
      return { url: json.url }
    },

    task,

    async cancel(runId: string): Promise<TaskResult> {
      const res = await fetchImpl(base + '/api/task/cancel', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ runId }),
      })
      return (await readJson(res, '取消任务')) as TaskResult
    },

    async debugPoll(session: string): Promise<unknown> {
      const res = await fetchImpl(base + '/api/node-ui/debug-poll?session=' + encodeURIComponent(session), {
        headers: authHeaders(),
      })
      return readJson(res, '调试下行')
    },

    async debugResult(body: unknown): Promise<unknown> {
      const res = await fetchImpl(base + '/api/node-ui/debug-result', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify(body),
      })
      return readJson(res, '调试回包')
    },
  }
}

export { errText }
