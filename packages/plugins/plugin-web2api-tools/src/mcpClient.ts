/**
 * mcpClient —— web2api 的 MCP 客户端（Streamable HTTP，JSON-RPC 2.0）。
 *
 * 只做三件事：initialize 拿会话、`tools/call` 执行、`system/get-task` 查任务。
 * 协议细节（实测）：
 * - `initialize` 响应头带 `mcp-session-id`，**之后每个请求都要带**，否则服务端回 -32002；
 * - `Accept: application/json` + `Content-Type: application/json` 是硬要求（不满足直接 400）；
 * - 异步操作先返回 `structuredContent.taskId`，再轮 `system/get-task` 取 resources。
 *
 * 设计取舍：**会话丢失就重连一次**（服务重启后旧 id 全失效）。
 * 所有网络异常都收敛成可读的中文错误（发给底栏显示），不抛出、不静默。
 */
import type { McpToolCallResult, McpTaskDetail } from './mcpParse'

/** 一次 JSON-RPC 请求的最小形状 */
interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

/** 注入点：默认用全局 fetch；测试可换成假货（不需起服务） */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface McpClientOptions {
  /** 服务地址，如 http://localhost:8033/mcp */
  endpoint: string
  /** 自定义 fetch（测试注入） */
  fetchImpl?: FetchLike
  /** 协议版本（与 web2api 对齐） */
  protocolVersion?: string
}

/** 一次调用的结果 */
export interface McpCallOutcome<T> {
  ok: boolean
  data?: T
  error?: string
}

/** 网络/协议错误 → 中文可读错误（用户看到的就这一句，要能指出"下一步做什么"） */
function describeError(err: unknown, endpoint: string): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (/fetch failed|ECONNREFUSED|Failed to fetch|NetworkError/i.test(msg)) {
    return '连不上 web2api（' + endpoint + '）。请先启动服务：cd web2api/server && npx tsx src/app.ts'
  }
  return msg || 'web2api 调用失败'
}

export class McpClient {
  private sessionId: string | null = null
  /** 同一直连的并发 initialize 只跑一次（多个动作同时点） */
  private connecting: Promise<void> | null = null
  private seq = 1

  constructor(private opts: McpClientOptions) {}

  /** tools/list 拿到的服务端 origin（相对资源地址补全用）；拿不到就空 */
  baseUrl = ''

  /**
   * 资源地址补全用的 origin。
   *
   * 优先用 `tools/list` 的 `_meta.baseUrl`（服务端自报，反代场景最准）；
   * 没调过 `tools/list` 时从 endpoint 现推 —— 资源路由（/api/mcp/resources）与 MCP 端点
   * 同源，这个兜底对绝大多数部署都成立，且不必为了一个 origin 白跑一次握手往返。
   */
  effectiveOrigin(): string {
    if (this.baseUrl) return this.baseUrl
    try {
      return new URL(this.opts.endpoint).origin
    } catch {
      return ''
    }
  }

  private fetchImpl(): FetchLike {
    if (this.opts.fetchImpl) return this.opts.fetchImpl
    return (url, init) => fetch(url, init)
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
    if (this.sessionId) h['mcp-session-id'] = this.sessionId
    return h
  }

  /** 发一次 JSON-RPC，返回解析后的 `result`（错误响应抛 Error） */
  private async rpc(req: JsonRpcRequest): Promise<unknown> {
    const res = await this.fetchImpl()(this.opts.endpoint, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(req),
    })
    if (!res.ok && res.status !== 400) {
      throw new Error('web2api HTTP ' + res.status)
    }
    const body = (await res.json()) as { result?: unknown; error?: { code: number; message: string } }
    if (body?.error) throw new Error('web2api 错误 ' + body.error.code + '：' + body.error.message)
    return body?.result
  }

  /** 建会话（幂等：已有会话直接返回；失败不留半截会话） */
  async connect(force = false): Promise<void> {
    if (this.sessionId && !force) return
    if (this.connecting) return this.connecting
    const run = async (): Promise<void> => {
      const res = await this.fetchImpl()(this.opts.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: this.seq++,
          method: 'initialize',
          params: {
            protocolVersion: this.opts.protocolVersion ?? '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'mini-canvas', version: '1.0.0' },
          },
        }),
      })
      if (!res.ok) throw new Error('web2api HTTP ' + res.status)
      const sid = res.headers.get('mcp-session-id')
      if (!sid) {
        // 最常见的两种原因分开放，用户看一眼就知道该改哪边：
        // ① 服务端没发这个头；② 服务端发了但 CORS 没 exposeHeaders —— 浏览器读不到自定义响应头。
        throw new Error(
          '拿不到 web2api 的会话 id（Mcp-Session-Id 响应头）。' +
            '若服务端确实下发了该头，则是跨域读取被拦：web2api 的 CORS 需要 exposeHeaders: [\'Mcp-Session-Id\']。',
        )
      }
      this.sessionId = sid
      // 规范要求握手后发一条 initialized 通知（无响应）
      try {
        await this.fetchImpl()(this.opts.endpoint, {
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

  /** 取工具清单（顺带记下服务端 origin，供相对资源地址补全） */
  async listTools(): Promise<McpCallOutcome<Array<{ name: string; description?: string }>>> {
    try {
      await this.connect()
      const result = (await this.rpc({ jsonrpc: '2.0', id: this.seq++, method: 'tools/list', params: {} })) as {
        tools?: Array<{ name: string; description?: string }>
        _meta?: { baseUrl?: string }
      }
      if (typeof result?._meta?.baseUrl === 'string') this.baseUrl = result._meta.baseUrl
      return { ok: true, data: result?.tools ?? [] }
    } catch (err) {
      return { ok: false, error: describeError(err, this.opts.endpoint) }
    }
  }

  /**
   * 调一个工具。会话失效（-32002）时**自动重连一次**再试
   * （web2api 重启后旧会话全失效，不重试的话用户会看到莫名的"未初始化"）。
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallOutcome<McpToolCallResult>> {
    // 不传 cookieId：服务端按账号状态/积分**自动选号**（失败自动换号），与 HTTP POST /api/tasks
    // 同一语义。自动选号是 web2api 既有的能力，这里不重复实现、也不要求用户填账号。
    const payload = { ...args }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.connect(attempt > 0)
        const result = (await this.rpc({
          jsonrpc: '2.0',
          id: this.seq++,
          method: 'tools/call',
          params: { name, arguments: payload },
        })) as McpToolCallResult
        return { ok: true, data: result }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // 会话问题：断开会话再试一次
        if (attempt === 0 && /-32002|Session|session/.test(msg)) {
          this.sessionId = null
          continue
        }
        return { ok: false, error: describeError(err, this.opts.endpoint) }
      }
    }
    return { ok: false, error: 'web2api 会话建立失败' }
  }

  /** 查任务（system/get-task）；不需要 cookieId */
  async getTask(taskId: string): Promise<McpCallOutcome<McpTaskDetail>> {
    try {
      await this.connect()
      const result = (await this.rpc({
        jsonrpc: '2.0',
        id: this.seq++,
        method: 'tools/call',
        params: { name: 'system/get-task', arguments: { taskId } },
      })) as McpToolCallResult
      if (result?.isError) {
        const text = (result.content ?? []).map((c) => c.text ?? '').join(' ').trim()
        return { ok: false, error: text.replace(/^错误：/, '') || '任务查询失败' }
      }
      const detail = (result?.structuredContent ?? {}) as McpTaskDetail
      return { ok: true, data: detail }
    } catch (err) {
      return { ok: false, error: describeError(err, this.opts.endpoint) }
    }
  }

  /**
   * 取消一个服务端任务。
   *
   * 走的是 web2api 的 **HTTP 接口** `POST /api/tasks/:id/cancel`，不是 MCP ——
   * MCP 只暴露了 list-tasks / get-task / get-accounts 三个 system 工具，**没有取消**。
   * （所以只调 MCP 的话，点"取消"只会让客户端不再等，服务端那个任务还在跑。）
   *
   * 幂等：任务已经是终态时服务端回 400「状态不允许取消」，这里当成"已经不跑了"吞掉，
   * 不当错误往外抛 —— 用户点了取消，界面上就该是取消。
   */
  async cancelTask(taskId: string): Promise<McpCallOutcome<{ cancelled: boolean }>> {
    try {
      const origin = this.effectiveOrigin()
      if (!origin) return { ok: false, error: '拿不到 web2api 服务地址，无法取消任务' }
      const res = await this.fetchImpl()(origin + '/api/tasks/' + encodeURIComponent(taskId) + '/cancel', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      })
      if (res.ok) return { ok: true, data: { cancelled: true } }
      // 400/404：任务不在"可取消"状态（已完成/已失败/已取消）→ 目的已达到，不算失败
      if (res.status === 400 || res.status === 404) return { ok: true, data: { cancelled: false } }
      return { ok: false, error: '取消任务失败（HTTP ' + res.status + '）' }
    } catch (err) {
      return { ok: false, error: describeError(err, this.opts.endpoint) }
    }
  }
}
