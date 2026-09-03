/**
 * Web2apiClient —— mcp-server 出站连接真实生成后台 web2api 的 MCP 客户端单例。
 *
 * mcp-server 本身是 MCP server；此客户端同进程作为 MCP client 连 web2api(localhost:8033 /mcp)。
 * 与本地 server transport 互不冲突（纯出站 HTTP）。
 * 提供 callTool（生成）与 getTask（查询进度）两个高频操作。
 *
 * 说明：web2api 各生成工具执行后通常返回一个 taskId；随后用 system/get-task 轮询。
 * 具体响应字段以 web2api 实际 schema 为准（web2api 未运行时无法探测，故本层做防御性解析，
 * 并集中在此文件方便日后对齐）。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

let instance: Web2apiClient | null = null

export interface Web2apiClientOptions {
  /** web2api MCP 端点，如 http://localhost:8033/mcp */
  url?: string
}

interface RawTask {
  id?: string
  taskId?: string
  status?: string
  progress?: number
  progressText?: string
  progressDetail?: string
  result?: unknown
  output?: unknown
  error?: string
  errMsg?: string
  message?: string
}

export class Web2apiClient {
  private url: string
  private client: Client | null = null
  private transport: StreamableHTTPClientTransport | null = null

  constructor(url: string) {
    this.url = url
  }

  get configured(): boolean {
    return !!this.url
  }

  async ensureConnected(): Promise<Client> {
    if (this.client) return this.client
    this.transport = new StreamableHTTPClientTransport(new URL(this.url))
    const client = new Client({ name: 'mini-canvas-backend', version: '1.0.0' })
    await client.connect(this.transport)
    this.client = client
    return client
  }

  async close(): Promise<void> {
    if (this.client) {
      try { await this.client.close() } catch { /* ignore */ }
      this.client = null
      this.transport = null
    }
  }

  /** 列出 web2api 可用工具（只读，诊断用） */
  async listTools(): Promise<{ name: string }[]> {
    const c = await this.ensureConnected()
    const { tools } = await c.listTools()
    return tools.map((t) => ({ name: t.name }))
  }

  /**
   * 调用 web2api 生成工具。
   * @param toolName 如 apimart/generate-image
   * @param args 工具入参（prompt/ratio/resolution/model/referenceImages 等，按工具 schema）
   * @returns 工具原始响应文本
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    const c = await this.ensureConnected()
    const res = await c.callTool({ name: toolName, arguments: args })
    const blocks = (res.content ?? []) as { type?: string; text?: string }[]
    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n') ?? ''
    return text
  }

  /**
   * 从一次工具调用响应文本中尽力提取 taskId（web2api 通用形态，防御性解析）。
   */
  parseTaskId(text: string): string | null {
    if (!text) return null
    try {
      const j = JSON.parse(text)
      const id = j?.taskId ?? j?.task?.id ?? j?.data?.taskId ?? j?.id
      if (typeof id === 'string') return id
    } catch { /* 非 JSON，尝试正则 */ }
    const m = text.match(/"?task[_ ]?id"?\s*[:=]\s*"?([A-Za-z0-9_-]+)"?/i)
    return m ? m[1] : null
  }

  /**
   * 查询任务进度（web2api system/get-task）。返回归一化后的进度/结果，供 PollFn 映射。
   */
  async getTask(taskId: string): Promise<{ progress?: number; message?: string; done: boolean; error?: string; resultText?: string }> {
    const text = await this.callTool('system/get-task', { taskId })
    const t = this.parseTaskObject(text)
    const done = /done|success|succeed|completed|finished|结果/i.test(`${t.status ?? ''} ${t.result !== undefined ? 'has-result' : ''}`)
    const failed = /fail|error|errmsg/i.test(`${t.status ?? ''} ${t.error ?? ''} ${t.errMsg ?? ''}`)
    return {
      progress: typeof t.progress === 'number' ? t.progress : undefined,
      message: t.progressText || t.progressDetail || t.message,
      done,
      error: failed ? (t.error ?? t.errMsg) : undefined,
      resultText: typeof t.result === 'string' ? t.result : text,
    }
  }

  /** 从 get-task 响应文本解析任务对象（防御性） */
  private parseTaskObject(text: string): RawTask {
    if (!text) return {}
    try {
      const j = JSON.parse(text)
      const inner = j?.task ?? j?.data ?? j
      return inner as RawTask
    } catch {
      return { result: text }
    }
  }
}

/** 取全局单例；url 为空则返回 null（表示未配置 web2api） */
export function getWeb2apiClient(url?: string): Web2apiClient | null {
  if (!url) return null
  if (!instance || instance.configured !== true) {
    instance = new Web2apiClient(url)
  }
  return instance
}

export function resetWeb2apiClient(): void {
  if (instance) void instance.close()
  instance = null
}
