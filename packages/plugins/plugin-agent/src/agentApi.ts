/**
 * agentApi —— 后端的 HTTP 面（fetch + SSE 解析）。零 Vue，可单测。
 *
 * baseUrl 缺省空串 = 与画布同源（cloud-server 托管界面时就是这样）。
 */
export type ChatEvent =
  | { type: 'session'; sessionId: string; title: string }
  | { type: 'text'; delta?: string; text?: string; partial?: boolean; final?: boolean }
  | { type: 'thinking'; delta?: string; text?: string; partial?: boolean; final?: boolean }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'tool_output'; id: string; output: string }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string }
  | { type: 'usage'; usedTokens: number; limitTokens: number | null }
  | { type: 'approval_request'; approval: { id: string; toolName: string; arguments: string; createdAt: number } }
  | { type: 'approval_result'; id: string; decision: 'allow' | 'deny' }
  | { type: 'done' }

export interface SessionMetaView {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  preview?: string
  provider?: string
  modelId?: string
}

export interface TurnView {
  role: 'user' | 'assistant' | 'thinking' | 'tool'
  text: string
  /** role='tool' 时的结构化信息（回放用来还原「卡片还是一行、跑完没跑完」） */
  tool?: { id: string; name: string; arguments: string; output?: string; card?: boolean }
  /** 这一轮结束时打的完成标记 */
  done?: boolean
  /** 用户消息带的图片（data URL）；服务端落盘后回放时原样带回来 */
  images?: string[]
  ts: number
}

export interface SessionRecordView extends SessionMetaView {
  turns: TurnView[]
}

export interface SendOptions {
  provider?: string
  modelId?: string
  mcpServers?: string[]
  skills?: string[]
  /**
   * 这一轮用的**模式系统提示词**（全能创作 / 剧本创编各一套）。
   *
   * 后端在建会话时临时用它替换 AGENTS.md（见 AgentRuntime.ensureSession），
   * 于是同一个会话的后续轮次会自动沿用这套提示词（SDK 记在 session_meta 里）。
   */
  systemPrompt?: string
  /** 随这条消息一起发出去的图片（data URL；服务端转给 SDK 的 imageUrlMessage） */
  images?: string[]
}

export interface AgentApiOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
}

export class AgentApi {
  private readonly base: string
  private readonly f: typeof fetch

  constructor(opts: AgentApiOptions = {}) {
    this.base = (opts.baseUrl ?? '').replace(/\/+$/, '')
    this.f = opts.fetchImpl ?? ((...args) => fetch(...args))
  }

  private async json<T>(p: string, init?: RequestInit): Promise<T> {
    const res = await this.f(this.base + p, {
      ...init,
      headers: init?.body
        ? { 'content-type': 'application/json', ...(init.headers ?? {}) }
        : init?.headers,
    })
    if (!res.ok) throw new Error(await readError(res))
    return (await res.json()) as T
  }

  config(): Promise<Record<string, unknown>> {
    return this.json('/api/agent/config')
  }

  saveModel(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.json('/api/agent/models', { method: 'POST', body: JSON.stringify(body) })
  }

  /**
   * 批量写一个渠道的模型（「编辑 Provider」用）。
   *
   * 与逐个 saveModel 的区别：一次请求里同时做掉「新增/更新」与「取消勾选的要删掉」，
   * 不会因为中途失败留下半个渠道（详见后端 upsertModels 的注释）。
   */
  saveModelsBulk(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.json('/api/agent/models/bulk', { method: 'PUT', body: JSON.stringify(body) })
  }

  deleteModel(provider: string, modelId: string): Promise<unknown> {
    return this.json('/api/agent/models', { method: 'DELETE', body: JSON.stringify({ provider, modelId }) })
  }

  setDefaultModel(provider: string, modelId: string): Promise<unknown> {
    return this.json('/api/agent/models/default', { method: 'POST', body: JSON.stringify({ provider, modelId }) })
  }

  setVisionModel(provider: string, modelId: string): Promise<unknown> {
    return this.json('/api/agent/models/vision', { method: 'POST', body: JSON.stringify({ provider, modelId }) })
  }

  importSkill(dir: string): Promise<Record<string, unknown>> {
    return this.json('/api/agent/skills/import', { method: 'POST', body: JSON.stringify({ dir }) })
  }

  /** 上游可用模型清单（GET {baseUrl}/models；凭据用已存的那个模型，密钥不出服务端） */
  upstreamModels(body: {
    provider?: string
    modelId?: string
    baseUrl?: string
    apiKey?: string
  }): Promise<{ ok?: boolean; models?: string[]; error?: string }> {
    return this.json('/api/agent/models/available', { method: 'POST', body: JSON.stringify(body) })
  }

  /** 写 Agent 的系统提示词 */
  saveSystemPrompt(text: string): Promise<{ text?: string }> {
    return this.json('/api/agent/system-prompt', { method: 'PUT', body: JSON.stringify({ text }) })
  }

  /** 读模式提示词清单（住后台 KV） */
  prompts(): Promise<{ prompts?: unknown[] }> {
    return this.json('/api/agent/prompts')
  }

  /** 整包写回模式提示词清单（后端会保证内置项不被删） */
  savePrompts(prompts: unknown[]): Promise<{ prompts?: unknown[] }> {
    return this.json('/api/agent/prompts', { method: 'PUT', body: JSON.stringify({ prompts }) })
  }

  skillSources(): Promise<Record<string, unknown>> {
    return this.json('/api/agent/skills/sources')
  }

  removeSkill(name: string): Promise<Record<string, unknown>> {
    return this.json('/api/agent/skills/' + encodeURIComponent(name), { method: 'DELETE' })
  }

  addMcp(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.json('/api/agent/mcp', { method: 'POST', body: JSON.stringify(body) })
  }

  removeMcp(name: string): Promise<Record<string, unknown>> {
    return this.json('/api/agent/mcp', { method: 'DELETE', body: JSON.stringify({ name }) })
  }

  /** 主动连一次 MCP 并列出可用工具（不必先发一句话） */
  probeMcp(names?: string[]): Promise<Record<string, unknown>> {
    return this.json('/api/agent/mcp/probe', {
      method: 'POST',
      body: JSON.stringify(names?.length ? { names } : {}),
    })
  }

  getPolicy(): Promise<Record<string, unknown>> {
    return this.json('/api/agent/policy')
  }

  putPolicy(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.json('/api/agent/policy', { method: 'PUT', body: JSON.stringify(body) })
  }

  async listSessions(canvasId: string): Promise<SessionMetaView[]> {
    const r = await this.json<{ sessions: SessionMetaView[] }>(this.sessionsPath(canvasId))
    return r.sessions ?? []
  }

  async getSession(canvasId: string, sessionId: string): Promise<SessionRecordView> {
    const r = await this.json<{ session: SessionRecordView }>(this.sessionPath(canvasId, sessionId))
    return r.session
  }

  createSession(canvasId: string, body: Record<string, unknown> = {}): Promise<{ id: string; resumed: boolean }> {
    return this.json(this.sessionsPath(canvasId), { method: 'POST', body: JSON.stringify(body) })
  }

  renameSession(canvasId: string, sessionId: string, title: string): Promise<unknown> {
    return this.json(this.sessionPath(canvasId, sessionId), {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    })
  }

  deleteSession(canvasId: string, sessionId: string): Promise<unknown> {
    return this.json(this.sessionPath(canvasId, sessionId), { method: 'DELETE' })
  }

  abort(canvasId: string, sessionId: string): Promise<unknown> {
    return this.json(this.sessionPath(canvasId, sessionId) + '/abort', { method: 'POST', body: '{}' })
  }

  /** 让这条会话丢掉旧的 MCP 连接（下一句会重新连） */
  reconnectMcp(canvasId: string, sessionId: string): Promise<Record<string, unknown>> {
    return this.json(this.sessionPath(canvasId, sessionId) + '/mcp/reconnect', { method: 'POST', body: '{}' })
  }

  approve(
    canvasId: string,
    sessionId: string,
    approvalId: string,
    decision: 'allow' | 'deny',
  ): Promise<unknown> {
    return this.json(this.sessionPath(canvasId, sessionId) + '/approvals/' + encodeURIComponent(approvalId), {
      method: 'POST',
      body: JSON.stringify({ decision }),
    })
  }

  private sessionsPath(canvasId: string): string {
    return '/api/agent/canvases/' + encodeURIComponent(canvasId) + '/sessions'
  }

  private sessionPath(canvasId: string, sessionId: string): string {
    return this.sessionsPath(canvasId) + '/' + encodeURIComponent(sessionId)
  }

  /**
   * 发一句并消费 SSE 流。
   *
   * 事件体是逐帧的 data: {...}，以空行分隔；只认 data: 前缀，保活注释帧（: ping）忽略。
   * 半个帧（分片切在中间）留在 buffer 里等下一片 —— SSE 客户端最容易写错的一处。
   */
  async sendMessage(
    canvasId: string,
    sessionId: string,
    text: string,
    opts: SendOptions,
    onEvent: (e: ChatEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const payload: Record<string, unknown> = { text }
    if (opts.provider) payload.provider = opts.provider
    if (opts.modelId) payload.modelId = opts.modelId
    if (opts.mcpServers?.length) payload.mcpServers = opts.mcpServers
    if (opts.skills?.length) payload.skills = opts.skills
    if (opts.systemPrompt) payload.systemPrompt = opts.systemPrompt
    if (opts.images?.length) payload.images = opts.images
    const res = await this.f(this.sessionPath(canvasId, sessionId) + '/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      ...(signal ? { signal } : {}),
    })
    if (!res.ok) throw new Error(await readError(res))
    if (!res.body) throw new Error('响应没有内容')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split(String.fromCharCode(10, 10))
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const line = frame.split(String.fromCharCode(10)).find((l) => l.startsWith('data: '))
        if (!line) continue
        try {
          onEvent(JSON.parse(line.slice(6)) as ChatEvent)
        } catch {
          /* 坏帧跳过，不因一帧解析失败杀掉整条流 */
        }
      }
    }
  }
}

/** 错误响应里优先用服务端给的文案（能直接告诉用户哪里要改） */
async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string }
    if (data.error) return data.error
  } catch {
    /* 非 JSON 错误体：退回状态码 */
  }
  return '请求失败（' + res.status + '）'
}
