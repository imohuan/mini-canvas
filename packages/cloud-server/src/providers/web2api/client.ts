/**
 * web2api 的 MCP 客户端（Streamable HTTP，JSON-RPC 2.0）—— 最小实现。
 *
 * 只做三件事：建会话、调工具、查任务。协议细节（实测）：
 * - `initialize` 响应头带 `mcp-session-id`，之后每个请求都要带，否则回 -32002；
 * - `Accept: application/json` + `Content-Type: application/json` 是硬要求；
 * - 异步操作先返回 `structuredContent.taskId`，再轮 `system/get-task` 取产物。
 *
 * 与前端那份（plugin-web2api-tools 里的 mcpClient）是同一个协议的两次实现 ——
 * 那边在浏览器里跑要处理 CORS（拿不到会话头就得让服务端 exposeHeaders），
 * 这边在服务端跑，那些跨域麻烦**根本不存在**。
 *
 * 就地写（不引工作区包）：cloud-server 要能独立 npx 跑。
 */

export interface McpToolCallResult {
  content?: Array<{ type?: string; text?: string; resource?: { uri?: string; text?: string; mimeType?: string } }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

export interface McpTaskDetail {
  status?: string
  progress?: number
  message?: string
  result?: unknown
  resources?: unknown
  urls?: unknown
}

export interface Web2ApiClientOptions {
  /** MCP 端点，如 http://localhost:8033/mcp */
  endpoint: string
  /** 注入 fetch（测试用） */
  fetchImpl?: typeof fetch
}

/** 网络/协议错误 → 人话（用户看到的就这一句，要说清下一步做什么） */
function describeError(err: unknown, endpoint: string): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (/fetch failed|ECONNREFUSED|Failed to fetch|NetworkError/i.test(msg)) {
    return '连不上 web2api（' + endpoint + '）。请先启动它，或用 --web2api 指定地址'
  }
  return msg || 'web2api 调用失败'
}

export class Web2ApiClient {
  private sessionId: string | null = null
  /** 同一时刻的并发 initialize 只跑一次（多个动作同时提交） */
  private connecting: Promise<void> | null = null
  private seq = 1

  constructor(private readonly opts: Web2ApiClientOptions) {}

  private doFetch(): typeof fetch {
    return this.opts.fetchImpl ?? ((...args) => fetch(...args))
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
    if (this.sessionId) h['mcp-session-id'] = this.sessionId
    return h
  }

  /** 服务端 origin（取消任务走它的 HTTP 接口，不在 MCP 里） */
  origin(): string {
    try {
      return new URL(this.opts.endpoint).origin
    } catch {
      return ''
    }
  }

  private async rpc(req: Record<string, unknown>): Promise<unknown> {
    const res = await this.doFetch()(this.opts.endpoint, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(req),
    })
    if (!res.ok && res.status !== 400) throw new Error('web2api HTTP ' + res.status)
    const body = (await res.json()) as { result?: unknown; error?: { code: number; message: string } }
    if (body?.error) throw new Error('web2api 错误 ' + body.error.code + '：' + body.error.message)
    return body?.result
  }

  /** 建会话（幂等；失败不留半截会话） */
  async connect(force = false): Promise<void> {
    if (this.sessionId && !force) return
    if (this.connecting) return this.connecting
    const run = async (): Promise<void> => {
      const res = await this.doFetch()(this.opts.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: this.seq++,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'mini-canvas-cloud', version: '1.0.0' },
          },
        }),
      })
      if (!res.ok) throw new Error('web2api HTTP ' + res.status)
      const sid = res.headers.get('mcp-session-id')
      if (!sid) throw new Error('拿不到 web2api 的会话 id（Mcp-Session-Id 响应头）')
      this.sessionId = sid
      // 规范要求握手后发一条 initialized 通知（无响应）
      try {
        await this.doFetch()(this.opts.endpoint, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        })
      } catch {
        /* 通知失败不影响后续调用 */
      }
    }
    this.connecting = run().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  /**
   * 调一个工具。会话失效（-32002）时**自动重连一次**再试
   * （web2api 重启后旧会话全失效，不重试的话会报莫名的"未初始化"）。
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.connect(attempt > 0)
        const result = (await this.rpc({
          jsonrpc: '2.0',
          id: this.seq++,
          method: 'tools/call',
          params: { name, arguments: args },
        })) as McpToolCallResult
        return result ?? {}
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (attempt === 0 && /-32002|Session|session/.test(msg)) {
          this.sessionId = null
          continue
        }
        throw new Error(describeError(err, this.opts.endpoint))
      }
    }
    throw new Error('web2api 会话建立失败')
  }

  /** 查任务（system/get-task） */
  async getTask(taskId: string): Promise<McpTaskDetail> {
    const result = await this.callTool('system/get-task', { taskId })
    if (result.isError) {
      const text = (result.content ?? []).map((c) => c.text ?? '').join(' ').trim()
      throw new Error(text.replace(/^错误：/, '') || '任务查询失败')
    }
    return (result.structuredContent ?? {}) as McpTaskDetail
  }

  /**
   * 取消一个服务端任务。
   *
   * 走 web2api 的 **HTTP 接口** `POST /api/tasks/:id/cancel` —— MCP 只暴露了
   * list-tasks / get-task / get-accounts 三个 system 工具，**没有取消**。
   * 幂等：任务已是终态时服务端回 400/404，当成"已经不跑了"吞掉。
   */
  async cancelTask(taskId: string): Promise<void> {
    const origin = this.origin()
    if (!origin) throw new Error('拿不到 web2api 服务地址，无法取消任务')
    const res = await this.doFetch()(origin + '/api/tasks/' + encodeURIComponent(taskId) + '/cancel', {
      method: 'POST',
      headers: { Accept: 'application/json' },
    })
    if (res.ok || res.status === 400 || res.status === 404) return
    throw new Error('取消任务失败（HTTP ' + res.status + '）')
  }
}

/** 从工具返回里尽力取出 taskId（不同工具的包装层数不一样） */
export function parseTaskId(result: McpToolCallResult): string | undefined {
  const sc = result.structuredContent as { taskId?: unknown } | undefined
  if (typeof sc?.taskId === 'string' && sc.taskId) return sc.taskId
  const text = (result.content ?? []).map((c) => c.text ?? '').join(' ')
  try {
    const j = JSON.parse(text) as { taskId?: unknown; data?: { taskId?: unknown } }
    if (typeof j?.taskId === 'string') return j.taskId
    if (typeof j?.data?.taskId === 'string') return j.data.taskId
  } catch {
    const m = text.match(/"taskId"\s*:\s*"([^"]+)"/)
    if (m) return m[1]
  }
  return undefined
}

/**
 * 把相对地址补成绝对地址（已经是 http(s)/data/blob 的原样返回）。
 *
 * MCP 返回的资源地址常是**服务端相对路径**（如 /api/resources/audios/doubao/x.ogg），
 * 前端要能直接加载就必须带上 web2api 的 origin —— 否则浏览器会把当前页面的域名当成它的。
 */
export function absolutizeUrl(u: string, origin: string): string {
  const s = (u ?? '').trim()
  if (!s) return ''
  if (/^(https?:|data:|blob:)/i.test(s)) return s
  if (!origin) return s
  return origin.replace(/\/+$/, '') + (s.startsWith('/') ? s : '/' + s)
}

/**
 * 从各种形态里尽力取出产物地址（防御性：形状随平台而异）。
 *
 * 兼容两类入参：
 * - `tools/call` 的同步返回（产物在 `content[].resource.uri` —— tts 这类同步工具走这条）；
 * - `system/get-task` 的任务详情（产物在 `resources[].downloadUrl`）。
 *
 * 认的字段：url / uri / src / urls / downloadUrl，外加递归 `resource` 与文本里内嵌的 JSON。
 * **入参为 undefined / 非对象时返回空数组**——同步工具没有 structuredContent，传它进来不该炸。
 */
export function extractUrls(detail: McpTaskDetail | McpToolCallResult | undefined | null): string[] {
  if (!detail || typeof detail !== 'object') return []
  const out: string[] = []
  const push = (v: unknown): void => {
    if (typeof v === 'string') { if (/^(https?:|data:|\/)/i.test(v)) out.push(v) }
    else if (Array.isArray(v)) for (const item of v) push(item)
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      push(o.url)
      push(o.uri)
      push(o.src)
      push(o.urls)
      push(o.downloadUrl)
      push(o.resource)
    }
  }
  push((detail as McpTaskDetail).urls)
  push((detail as McpTaskDetail).resources)
  push((detail as McpTaskDetail).result)
  push((detail as McpToolCallResult).content)
  return [...new Set(out)]
}
