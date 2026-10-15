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
  /** 出错。scope 'compact' = 压缩失败（不是某一轮对话失败，见后端注释） */
  | { type: 'error'; message: string; scope?: 'compact' }
  | { type: 'usage'; usedTokens: number; limitTokens: number | null; spent?: number }
  | {
      type: 'approval_request'
      approval: { id: string; toolName: string; arguments: string; createdAt: number; toolCallId?: string }
    }
  | { type: 'approval_result'; id: string; decision: 'allow' | 'deny' }
  | { type: 'done' }
  /** 这条会话有没有一轮在跑（托管模式由后端广播；空闲时队列自动起轮也靠它） */
  | { type: 'run_state'; running: boolean }
  /** 队列变化快照（加/删/改/暂停后推；界面据此刷新输入框上方的列表） */
  | { type: 'queue'; queue: QueueStateView }
  /** 队列全部发完且会话空闲（"队列已跑完"的通知时机） */
  | { type: 'queue_idle' }
  /** 一轮结束（每轮的通知时机） */
  | { type: 'round_done' }
  /** 这一轮喂给模型的用户消息（队列自动发的那条前端没参与，靠它补气泡） */
  | { type: 'user_message'; text: string; images?: string[]; steered?: boolean }
  /** 目标状态更新（后端读 GOAL.json 后推；界面显示「第 N 轮 · 已用 / 预算」） */
  | { type: 'goal_state'; goal: GoalStateView | null }
  /**
   * 上下文压缩的边界（成对：begin → … → end）。
   *
   * 为什么单独一条而不是复用 notice：压缩是**长动作**（跑一次模型把历史总结成摘要），
   * 界面需要一个"正在压缩"的常驻位置；跑完还要说明成功还是放弃。
   * 复用 notice 会落进那条被隐藏的"过程提示"通道，用户就再也看不见压缩跑没跑成。
   */
  | {
      type: 'compact'
      phase: 'begin' | 'end'
      reason: string
      mode: string
      /** 只有 end 有：completed = 压成功；其它 = 放弃（原上下文保留） */
      status?: string
      context?: number
      error?: string
    }

/** 队列条目（与后端 sessionStore 的 QueueItem 同形；前后端各一份类型，字段名钉死） */
export interface QueueItemView {
  id: string
  text: string
  images?: string[]
  goal?: { objective: string; budget: number }
  /** queued 等着发 / editing 正在编辑（阻塞队列）/ sending 已认领正在发 */
  /** queued 等着发 / editing 正在编辑（阻塞队列）/ sending 已认领正在发 / sent 已送达（留一拍） */
  state: 'queued' | 'editing' | 'sending' | 'sent'
  createdAt: number
  sentAt?: number
  /** 界面本地标记：引导过（显示小标用） */
  steered?: boolean
}

/** 一个会话的待发队列（暂停开关 + 条目） */
export interface QueueStateView {
  paused: boolean
  items: QueueItemView[]
}

/** 目标状态（读 GOAL.json 来；界面显示「第 N 轮 · 已用 / 预算」） */
export interface GoalStateView {
  objective: string
  status: string
  budget: number
  round: number
  tokensUsed: number
  ended?: boolean
}

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
  /**
   * 模型分段（换过模型的会话才有）：从第 N 个用户消息起换成了哪个模型。
   *
   * 界面据此在消息流里画分割线并标注模型名（用户口径 2026-10-11）。
   */
  modelSegments?: Array<{ fromUser: number; provider: string; modelId: string }>
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
  /**
   * 以**目标模式**发这一条（设计 §3.4.2）：
   * 后端先写 GOAL.json、把官方 start.mjs 的协议文本接在正文后面，再起第 1 轮。
   */
  goal?: { objective: string; budget: number }
}

export interface AgentApiOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
}

/**
 * 提示词模板的体检结果（后端 `templateMissing` 的产物）。
 *
 * `missing` 里每一条都是模板缺的记号；空了就健康。
 * 最要紧的那条是 `{{AGENTS_MD}}` —— 少了它，设置里写的提示词一个字都进不了模型。
 */
export interface TemplateHealthView {
  ok: boolean
  missing: string[]
  template?: string
}

/**
 * 后台自动附加的一段系统提示词内容（后端 agent-prompt 注册场的读形态）。
 *
 * 给设置页列出来：用户能看到「我的提示词里到底多了什么」，而不是靠猜。
 */
export interface PromptSectionView {
  id: string
  title: string
  /** 谁加的（插件名 / 'canvas-agent-prompt' 这类宿主件） */
  source: string
  /** 当前正文长度（界面只报字数，不贴全文 —— 那是模型看的东西，不是用户要读的） */
  text: string
}

/** 一个可插入提示词正文的占位符（后端 agentContextPlaceholders 的产物） */
export interface ContextPlaceholderView {
  token: string
  /** 当前值；空串 = 这行的值每轮不同（界面只显示说明） */
  value: string
  description: string
  /** mini-canvas = 本服务自己展开的；harness = SDK 自带的（交给 SDK） */
  source: 'mini-canvas' | 'harness'
}

/** 运行环境上下文（后台地址 + 目录 + 可用占位符） */
export interface AgentContextView {
  baseUrl: string
  dirs: Array<{ label: string; path: string }>
  placeholders: ContextPlaceholderView[]
}

/**
 * SSE 帧级回调（可选）：`acceptSeq` 返回 false = 这条 seq 已经应用过，跳过；
 * `onSeq` 收到**刚应用**的 seq（推进重连水位用）。
 */
export interface SseFrameSink {
  acceptSeq?: (seq: number) => boolean
  onSeq?: (seq: number) => void
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

  /**
   * 把提示词模板恢复成 SDK 出厂模板。
   *
   * 什么时候用：模板被覆盖成了纯文本（{{AGENTS_MD}} 没了），此时用户在设置里写什么
   * 提示词都进不去模型 —— 体检结果在 `config()` 的 `template` 字段里（见 AgentConfigView）。
   */
  restoreTemplate(): Promise<{ ok?: boolean; template?: TemplateHealthView }> {
    return this.json('/api/agent/template/restore', { method: 'POST' })
  }

  /** 读模式提示词清单（住后台 KV） */
  prompts(): Promise<{ prompts?: unknown[] }> {
    return this.json('/api/agent/prompts')
  }

  /** 整包写回模式提示词清单（后端会保证内置项不被删） */
  savePrompts(prompts: unknown[]): Promise<{ prompts?: unknown[] }> {
    return this.json('/api/agent/prompts', { method: 'PUT', body: JSON.stringify({ prompts }) })
  }

  /** 读「会话标题模型」配置（空 = 用会话默认模型） */
  titleModel(): Promise<{ provider?: string; modelId?: string }> {
    return this.json('/api/agent/title-model')
  }

  /** 写「会话标题模型」配置（两个都空 = 清掉，回落会话默认模型） */
  saveTitleModel(body: { provider?: string; modelId?: string }): Promise<{ provider?: string; modelId?: string }> {
    return this.json('/api/agent/title-model', { method: 'PUT', body: JSON.stringify(body) })
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

  /** 会话列表 + 分支关系（child → parent）：历史列表聚合「一个对话一行」用 */
  async listSessionsWithParents(canvasId: string): Promise<{ sessions: SessionMetaView[]; parents: Record<string, string> }> {
    const r = await this.json<{ sessions: SessionMetaView[]; parents?: Record<string, string> }>(this.sessionsPath(canvasId))
    return { sessions: r.sessions ?? [], parents: r.parents ?? {} }
  }

  async getSession(canvasId: string, sessionId: string): Promise<SessionRecordView> {
    const r = await this.json<{ session: SessionRecordView }>(this.sessionPath(canvasId, sessionId))
    return r.session
  }

  /**
   * 会话全景（设计 §3.2 / §3.3）：转录之外的**运行态与队列**一次拿全。
   *
   * 刷新后靠这一条恢复：history 从 session.turns 来，队列/目标/暂停标记/流序号都在这。
   * opts.turnsLimit / opts.turnsBefore：转录分页（用户口径 2026-10-15，长对话不要一次全拉）。
   * 后端按用户消息边界切片，返回体带 turnsTotal / turnsHaveBefore。
   */
  async sessionState(
    canvasId: string,
    sessionId: string,
    opts?: { turnsLimit?: number; turnsBefore?: number },
  ): Promise<{
    session: SessionRecordView
    running: boolean
    /** 挂起中的审批（刷新后补渲染审批卡片用；没有时后端可能不返回这个字段） */
    approvals?: Array<{ id: string; toolName: string; arguments: string; createdAt: number }>
    queue: QueueStateView
    goal?: GoalStateView
  goalPaused?: boolean
  /** 目标的参考图（迷你预览用；随会话记录走） */
  goalImages?: string[]
  seq?: number
    lastSeq?: number
    /** 最近一次上下文用量（界面恢复会话时把上下文指示器画回来；见 store.lastUsage） */
    lastUsage?: { usedTokens: number; limitTokens: number | null }
    /** 转录总条数（带 turnsLimit 请求时才有意义；全量时与 session.turns.length 相同） */
    turnsTotal?: number
    /** 切片之前还有没有更早的转录（顶部哨兵显示与续拉的依据） */
    turnsHaveBefore?: boolean
  }> {
    const q = new URLSearchParams()
    if (opts && opts.turnsLimit && opts.turnsLimit > 0) q.set('turnsLimit', String(opts.turnsLimit))
    if (opts && opts.turnsBefore && opts.turnsBefore > 0) q.set('turnsBefore', String(opts.turnsBefore))
    const qs = q.toString()
    return this.json(this.sessionPath(canvasId, sessionId) + (qs ? '?' + qs : ''))
  }

  // ------------------------------------------------------------------ 队列

  /** 队列操作的总入口（add / update / remove / close / cancel-edit / pause / resume） */
  queueOp(
    canvasId: string,
    sessionId: string,
    body: {
      op: 'add' | 'update' | 'remove' | 'close' | 'cancel-edit' | 'pause' | 'resume'
      | 'edit' | 'reorder'
      itemId?: string
      text?: string
      images?: string[]
      goal?: { objective: string; budget: number }
      /** reorder 专用：全量条目 id 的新顺序 */
      order?: string[]
    },
  ): Promise<{ ok: boolean; queue?: QueueStateView; error?: string }> {
    return this.json(this.sessionPath(canvasId, sessionId) + '/queue', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  /** 读队列快照（GET）：steer 落空后拉一次，让界面立即看到条目还在 */
  getQueue(canvasId: string, sessionId: string): Promise<{ ok: boolean; queue?: QueueStateView; error?: string }> {
    return this.json(this.sessionPath(canvasId, sessionId) + '/queue')
  }

  /**
   * 引导（插队）：把这条送进**正在跑**的那一轮的下一次请求。
   * 返回 steered=false 表示那一刻没在跑 —— 条目会留在队列里按序发（不丢）。
   */
  steerQueueItem(
    canvasId: string,
    sessionId: string,
    itemId: string,
  ): Promise<{ ok: boolean; steered?: boolean; reason?: string }> {
    return this.json(this.sessionPath(canvasId, sessionId) + '/queue/' + encodeURIComponent(itemId) + '/steer', {
      method: 'POST',
      body: '{}',
    })
  }

  // ------------------------------------------------------------------ 目标

  /** 目标操作：改预算/目标（update）、暂停（pause）、启动（resume） */
  goalOp(
    canvasId: string,
    sessionId: string,
    body:
      | { op: 'update'; objective?: string; budget?: number; deltaBudget?: number; tokensUsed?: number }
      | { op: 'pause' }
      | { op: 'resume' }
      | { op: 'end' },
  ): Promise<{ ok: boolean; goal?: GoalStateView; paused?: boolean; error?: string }> {
    return this.json(this.sessionPath(canvasId, sessionId) + '/goal', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  /** 写当前目标的参考图（迷你预览用；空数组 = 清掉） */
  setGoalImages(canvasId: string, sessionId: string, images: string[]): Promise<{ ok: boolean }> {
    return this.json(this.sessionPath(canvasId, sessionId) + '/goal-images', {
      method: 'POST',
      body: JSON.stringify({ images }),
    })
  }

  createSession(canvasId: string, body: Record<string, unknown> = {}): Promise<{ id: string; resumed: boolean }> {
    return this.json(this.sessionsPath(canvasId), { method: 'POST', body: JSON.stringify(body) })
  }

  /** 分支（fork）：编辑某条旧消息重发 → 以它上面的内容为历史开新会话 */
  forkSession(canvasId: string, sessionId: string, afterText: string): Promise<{ sessionId: string; parentId: string; copied: number; title?: string }> {
    return this.json(this.sessionPath(canvasId, sessionId) + '/fork', {
      method: 'POST',
      body: JSON.stringify({ afterText }),
    })
  }

  /**
   * 切换模型：后端把整段历史接到**一条新会话**上（模型在建会话时钉死，换模型只能换会话），
   * 并在记录里补一条模型分段 —— 界面据此画分割线。
   */
  switchModel(
    canvasId: string,
    sessionId: string,
    provider: string,
    modelId: string,
  ): Promise<{
    ok: boolean
    sessionId?: string
    parentId?: string
    copied?: number
    provider?: string
    modelId?: string
    title?: string
    /** true = 当前已经是这个模型，什么都没做 */
    unchanged?: boolean
    modelSegments?: Array<{ fromUser: number; provider: string; modelId: string }>
  }> {
    return this.json(this.sessionPath(canvasId, sessionId) + '/switch-model', {
      method: 'POST',
      body: JSON.stringify({ provider, modelId }),
    })
  }

  /**
   * 主动压缩上下文（「压缩」命令）。
   *
   * 走 SSE：后端把 compaction_begin / 摘要 / compaction_end 一路推回来，
   * 与消息流同一套按 seq 去重的口径（同一条事件也可能从常驻流到一次）。
   */
  async compact(
    canvasId: string,
    sessionId: string,
    onEvent: (e: ChatEvent) => void,
    signal?: AbortSignal,
    sink?: SseFrameSink,
  ): Promise<void> {
    const res = await this.f(this.sessionPath(canvasId, sessionId) + '/compact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      ...(signal ? { signal } : {}),
    })
    if (!res.ok) throw new Error(await readError(res))
    if (!res.body) return
    await this.consumeSse(res.body, onEvent, sink)
  }

  /** 分支信息：本会话的分叉点 + 全画布分叉点全表（分页器用） */
  branchInfo(canvasId: string, sessionId: string): Promise<{ parentSessionId?: string; point?: string; points: Array<{ parentId: string; point: string; children: string[]; userOrdinal?: number }> }> {
    return this.json(this.sessionPath(canvasId, sessionId) + '/branch-info')
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
    /**
     * 帧级水位（可选）：send 响应与常驻流**同时**订阅着同一个 hub 通道
     *（设计如此：send 响应只是"订阅 + 保活"），同一条事件因此会到两次。
     * 带上 `acceptSeq`/`onSeq` 让调用方按 seq 去重，事件只被应用一次。
     */
    sink?: SseFrameSink,
  ): Promise<void> {
    const payload: Record<string, unknown> = { text }
    if (opts.provider) payload.provider = opts.provider
    if (opts.modelId) payload.modelId = opts.modelId
    if (opts.mcpServers?.length) payload.mcpServers = opts.mcpServers
    if (opts.skills?.length) payload.skills = opts.skills
    if (opts.systemPrompt) payload.systemPrompt = opts.systemPrompt
    if (opts.images?.length) payload.images = opts.images
    if (opts.goal) payload.goal = opts.goal
    const res = await this.f(this.sessionPath(canvasId, sessionId) + '/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      ...(signal ? { signal } : {}),
    })
    if (!res.ok) throw new Error(await readError(res))
    if (!res.body) throw new Error('响应没有内容')
    await this.consumeSse(res.body, onEvent, sink)
  }

  /**
   * 接回一条会话**正在跑**的那一轮（设计 §3.2 的重连端点）。
   *
   * 为什么需要它：托管模式下后台自己跑一轮，页面只是订阅者。刷新 / 重开面板后
   * 前端不知道后台在干什么，必须用这个端点从"转录已有的水位"（since）续上 ——
   * 传 0 会与转录里的内容重复显示，所以调用方应当传 sessionState() 回来的 seq。
   *
   * 一直读到这一轮结束（服务端在轮结束时收尾关流）。
   */
  async streamSession(
    canvasId: string,
    sessionId: string,
    since: number,
    onEvent: (e: ChatEvent) => void,
    signal?: AbortSignal,
    opts: { follow?: boolean } & SseFrameSink = {},
  ): Promise<void> {
    const res = await this.f(
      this.sessionPath(canvasId, sessionId) +
        '/stream?since=' +
        Math.max(0, Math.floor(since)) +
        (opts.follow ? '&follow=1' : ''),
      { ...(signal ? { signal } : {}) },
    )
    if (!res.ok) throw new Error(await readError(res))
    if (!res.body) return
    await this.consumeSse(res.body, onEvent, opts)
  }

  /**
   * 逐帧消费一条 SSE 流（sendMessage 与 streamSession 共用这一份解析）。
   *
   * `onSeq` 收每帧的 `id:`（后端 `hub.subscribe` 回放/续推时带的 seq）：常驻流用它把
   * 重连水位推到**最新**，否则断开重连只能从很旧的水位重放 —— 已应用过的事件再应用一遍，
   * 界面上就冒出重复的助手正文 / 工具卡片（真机可复现）。
   */
  private async consumeSse(
    body: ReadableStream<Uint8Array>,
    onEvent: (e: ChatEvent) => void,
    sink?: SseFrameSink,
  ): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split(String.fromCharCode(10, 10))
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const lines = frame.split(String.fromCharCode(10))
        const line = lines.find((l) => l.startsWith('data: '))
        if (!line) continue
        // id 行要**单独取**：它可能排在 data 行之前（`id: N\ndata: {…}`），
        // 用 find(data) 那一行取不到它（见 writeSSE 的输出顺序）。
        const idLine = lines.find((l) => l.startsWith('id: '))
        const seq = idLine ? Number(idLine.slice(4)) : NaN
        try {
          // 已应用过的 seq（重复投递 / 重连回放）直接跳过：不加这一步，助手正文与
          // 工具卡片会被应用两遍（真机实测：正文变 `AAABBBBBB`）。
          if (Number.isFinite(seq) && sink?.acceptSeq && !sink.acceptSeq(seq)) continue
          onEvent(JSON.parse(line.slice(6)) as ChatEvent)
          if (Number.isFinite(seq)) sink?.onSeq?.(seq)
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
