/**
 * agentService —— 会话状态 + 全部动作（这就是「组件的 API」）。
 *
 * 为什么方法放在服务上而不是组件上：
 * 1. 组件没挂载时也要能调（键盘快捷键 / 底栏按钮要让 Agent「新建对话」，那时面板可能没渲染）；
 * 2. 同一块内容摆两处（左抽屉 + 右悬浮）会变成两份状态 —— 挂在服务上就只有一份。
 *
 * 任何布局都能这样拿它：`useAgent()`（渲染子树内）或 `ctx.get('agent')`（插件里）。
 */
import { computed, reactive, type ComputedRef } from 'vue'
import { AgentApi, type ChatEvent, type SessionMetaView, type SendOptions } from './agentApi.js'
import { ChatModel, type AgentTurnView } from './sessionModel.js'

export const CANVAS_ID = 'default'

export interface McpRow {
  name: string
  config: Record<string, unknown>
  permission?: string
  invalid?: string
}

/** 「主动检查 MCP」的结果：每个服务连没连上 + 真正拿到了哪些工具 */
export interface McpProbeResult {
  ok: boolean
  servers: Array<{ name: string; transport: string; status: string; tools: number; error?: string; durationMs: number }>
  tools: Array<{ name: string; server: string; description: string; fullName: string }>
  warnings: string[]
  /** 传输层的错误（网络失败等），与 servers 里的连接失败区分开 */
  error?: string
}

export interface SkillRow {
  name: string
  description: string
  size?: number
  fileCount?: number
}

export interface ModelRow {
  provider: string
  modelId: string
  hasKey: boolean
  /** 密钥掩码预览（如 `sk-0…6390`）；明文永不回传。用于编辑渠道时回显「已配置」 */
  apiKeyMask?: string
  baseUrl?: string
  /** 该模型用的客户端协议（编辑渠道时要回填到表单） */
  clientType?: string
  isDefault: boolean
  isVision: boolean
  contextWindow?: number
  displayName?: string
}

export interface ProviderRow {
  provider: string
  label: string
  known: boolean
}

export interface ApprovalRuleRow {
  id: string
  pattern: string
  ask: boolean
  label?: string
}

export interface ApprovalPolicyView {
  enabled: boolean
  rules: ApprovalRuleRow[]
}

export interface AgentServiceState {
  /** 面板可见性（悬浮外壳用；只放内容的布局可以忽略） */
  open: boolean
  /** 是否停靠（外壳用） */
  docked: boolean
  /** 面板宽度（外壳用） */
  width: number

  /** 当前会话 */
  sessionId: string | null
  title: string
  running: boolean
  turns: AgentTurnView[]
  /** 会话列表（历史下拉 / 侧边列表） */
  sessions: SessionMetaView[]

  /** 全局配置（设置页与输入区下拉共用） */
  models: ModelRow[]
  providers: ProviderRow[]
  skills: SkillRow[]
  mcpServers: McpRow[]
  catalog: Array<{ provider: string; modelId: string; displayName: string; contextWindow?: number }>

  /** 本轮选中项（随会话走） */
  model: { provider: string; modelId: string } | null
  activeSkills: string[]
  activeMcp: string[]
  /** 规则列表（审批用） */
  policy: ApprovalPolicyView

  /** 界面状态 */
  needsModel: boolean
  offline: boolean
  error: string
  contextLeft: number | null
  /** 可导入的技能候选（扫来源目录；技能页用） */
  skillCandidates: Array<{ name: string; description: string; dir: string; installed: boolean }>
  /** 上游可用模型 id（问 GET {baseUrl}/models 拿到的；模型页下拉用） */
  upstreamModels: string[]
  /** SDK 支持的客户端协议清单（从后台读，不在界面里写死） */
  clientTypes: string[]
  /** Agent 的系统提示词（agent_state/AGENTS.md） */
  systemPrompt: string

  /** 后端地址（排查用） */
  baseUrl: string
}

export interface AgentService {
  state: AgentServiceState
  turns: ComputedRef<AgentTurnView[]>
  /** 面板开合（外壳用） */
  toggle(): void
  show(): void
  hide(): void
  /** 拉一次全局配置 + 会话列表（打开面板 / 进设置页时调） */
  refresh(): Promise<void>
  /** 拉一次技能候选（技能页打开时调） */
  loadSkillCandidates(): Promise<void>
  /** 拉上游可用模型清单（模型页的「模型 ID」下拉用） */
  loadUpstreamModels(body?: {
    provider?: string
    modelId?: string
    baseUrl?: string
    apiKey?: string
  }): Promise<{ ok: boolean; models: string[]; error?: string }>
  /** 保存系统提示词 */
  saveSystemPrompt(text: string): Promise<void>
  /** 新建一个会话（清空消息区，不是删旧的） */
  newSession(): Promise<void>
  listSessions(): Promise<void>
  openSession(id: string): Promise<void>
  renameSession(id: string, title: string): Promise<void>
  deleteSession(id: string): Promise<void>
  send(text: string, images?: string[]): Promise<void>
  stop(): void
  retry(): Promise<void>
  setModel(provider: string, modelId: string): void
  toggleSkill(name: string): void
  toggleMcp(name: string): void
  /**
   * 输入框正文变了：按正文里出现的 @ 标签（技能 / MCP 的内联 chip）**重算**本轮引用。
   *
   * 为什么是重算而不是「翻一下开关」：标签是可删的 —— 用户把 chip 删掉，引用就该立刻失效。
   * 拿「是否出现过」做一次纯函数映射，增删两侧自然都对；不必再维护两份状态。
   */
  syncRefsFromText(text: string): void
  /** 审批：用户点允许 / 拒绝 */
  decide(approvalId: string, decision: 'allow' | 'deny'): Promise<void>
  savePolicy(policy: ApprovalPolicyView): Promise<void>
  /** 设置页用的动作 */
  importSkill(dir: string): Promise<void>
  removeSkill(name: string): Promise<void>
  addMcp(body: Record<string, unknown>): Promise<void>
  removeMcp(name: string): Promise<void>
  /** 主动连一次 MCP 并列出可用工具（「检查连接」按钮） */
  probeMcp(names?: string[]): Promise<McpProbeResult>
  /**
   * 让当前会话**丢掉旧的 MCP 连接**，下一句重新连一次。
   *
   * 场景：外部把 MCP 关了又开，那条会话手里的连接已经废了，SDK 不会自己重连 ——
   * 点「检测」时顺带调它，会话就恢复成「能连上」的状态。
   */
  reconnectMcp(): Promise<boolean>
  saveModel(body: Record<string, unknown>): Promise<void>
  /** 批量写一个渠道的模型 + 删掉取消勾选的（「编辑 Provider」用） */
  saveModelsBulk(body: Record<string, unknown>): Promise<void>
  deleteModel(provider: string, modelId: string): Promise<void>
  setDefaultModel(provider: string, modelId: string): Promise<void>
}

/** 造一份服务（agentPlugin 在 apply 里调用一次） */
export function createAgentService(opts: { baseUrl?: string } = {}): AgentService {
  const api = new AgentApi({ baseUrl: opts.baseUrl ?? '' })
  const model = new ChatModel()
  let abort: AbortController | null = null
  let lastText = ''
  /** 上一轮的图片（retry 要连图一起重发，否则"重试"会把图丢了） */
  let lastImages: string[] | undefined

  const state: AgentServiceState = reactive({
    open: false,
    docked: false,
    width: 400,
    sessionId: null,
    title: '新会话',
    running: false,
    turns: [],
    sessions: [],
    models: [],
    providers: [],
    skills: [],
    mcpServers: [],
    catalog: [],
    model: null,
    activeSkills: [],
    activeMcp: [],
    policy: { enabled: true, rules: [] },
    needsModel: false,
    offline: false,
    error: '',
    contextLeft: null,
    skillCandidates: [],
    upstreamModels: [],
    clientTypes: ['openai-chat', 'deepseek-v4'],
    systemPrompt: '',
    baseUrl: opts.baseUrl ?? '',
  })

  /** 把 ChatModel 的内容同步到响应式 state（turns 是普通数组，靠整体替换触发更新） */
  function sync(): void {
    state.turns = model.turns.map((t) => ({
      ...t,
      tools: t.tools.map((x) => ({ ...x })),
      ...(t.approval ? { approval: { ...t.approval } } : {}),
    }))
  }

  function setError(message: string): void {
    state.error = message
  }

  function applyEvent(ev: ChatEvent): void {
    model.apply(ev)
    if (ev.type === 'usage') {
      const left =
        ev.limitTokens && ev.limitTokens > 0
          ? Math.max(0, Math.min(100, Math.round((1 - ev.usedTokens / ev.limitTokens) * 100)))
          : null
      state.contextLeft = left
    }
    sync()
  }

  async function refresh(): Promise<void> {
    try {
      const cfg = await api.config()
      state.models = (Array.isArray(cfg.models) ? cfg.models : []) as ModelRow[]
      state.providers = (Array.isArray(cfg.providers) ? cfg.providers : []) as ProviderRow[]
      state.skills = (Array.isArray(cfg.skills) ? cfg.skills : []) as SkillRow[]
      state.mcpServers = (Array.isArray(cfg.mcpServers) ? cfg.mcpServers : []) as McpRow[]
      state.catalog = (Array.isArray(cfg.catalog) ? cfg.catalog : []) as AgentServiceState['catalog']
      if (Array.isArray(cfg.clientTypes)) state.clientTypes = cfg.clientTypes.map(String)
      if (typeof cfg.systemPrompt === 'string') state.systemPrompt = cfg.systemPrompt
      // 只有「带密钥的模型」才算配好：SDK 预置了一份目录（几十个模型、全无密钥），
      // 拿 models.length 判断会让界面在真没配的时候也以为配好了。
      const usable = state.models.filter((m) => m.hasKey)
      state.needsModel = usable.length === 0
      const def = usable.find((m) => m.isDefault) ?? usable[0]
      if (!state.model && def) state.model = { provider: def.provider, modelId: def.modelId }
      state.offline = false
    } catch (err) {
      state.offline = true
      setError(err instanceof Error ? err.message : String(err))
    }
    try {
      const p = await api.getPolicy()
      const policy = p.policy as ApprovalPolicyView | undefined
      if (policy) state.policy = policy
    } catch {
      /* 规则列表拉不到不影响对话 */
    }
    await listSessions()
  }

  async function listSessions(): Promise<void> {
    try {
      state.sessions = await api.listSessions(CANVAS_ID)
      state.offline = false
    } catch (err) {
      state.offline = true
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function newSession(): Promise<void> {
    // 新建不等于删除：旧会话留在历史里。当前这一屏清空，下一句话才开始真的建。
    model.reset()
    sync()
    state.sessionId = null
    state.title = '新会话'
    state.error = ''
    state.contextLeft = null
    await listSessions()
  }

  async function openSession(id: string): Promise<void> {
    try {
      const rec = await api.getSession(CANVAS_ID, id)
      model.load(Array.isArray(rec.turns) ? rec.turns : [])
      sync()
      state.sessionId = id
      state.title = rec.title || '新会话'
      state.error = ''
      if (rec.provider && rec.modelId) state.model = { provider: rec.provider, modelId: rec.modelId }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function renameSession(id: string, title: string): Promise<void> {
    try {
      await api.renameSession(CANVAS_ID, id, title)
      if (state.sessionId === id) state.title = title
      await listSessions()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function deleteSession(id: string): Promise<void> {
    try {
      await api.deleteSession(CANVAS_ID, id)
      if (state.sessionId === id) await newSession()
      else await listSessions()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function ensureSession(): Promise<string | null> {
    if (state.sessionId) return state.sessionId
    if (state.needsModel) {
      setError('还没有配置模型：请到 设置 → Agent → 模型 里加一个带密钥的模型')
      return null
    }
    try {
      const opts: SendOptions = {}
      if (state.model) {
        opts.provider = state.model.provider
        opts.modelId = state.model.modelId
      }
      const created = await api.createSession(CANVAS_ID, { ...opts })
      state.sessionId = created.id
      await listSessions()
      return created.id
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    }
  }

  function sendOptions(): SendOptions {
    const opts: SendOptions = {}
    if (state.model) {
      opts.provider = state.model.provider
      opts.modelId = state.model.modelId
    }
    if (state.activeMcp.length) opts.mcpServers = [...state.activeMcp]
    if (state.activeSkills.length) opts.skills = [...state.activeSkills]
    return opts
  }

  async function send(text: string, images?: string[]): Promise<void> {
    const value = text.trim()
    const pics = (images ?? []).filter((u) => !!u)
    // 只有图、没有字也算一条合法消息（用户常直接丢图问"这是什么"）
    if ((!value && !pics.length) || state.running) return
    setError('')
    const id = await ensureSession()
    if (!id) return
    lastText = value
    lastImages = pics.length ? pics : undefined
    model.send(value, pics.length ? pics : undefined)
    sync()
    state.running = true
    const ac = new AbortController()
    abort = ac
    try {
      await api.sendMessage(
        CANVAS_ID,
        id,
        value,
        { ...sendOptions(), ...(pics.length ? { images: pics } : {}) },
        applyEvent,
        ac.signal,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // 主动中止不算错误（用户按了停止）
      if (ac.signal.aborted) applyEvent({ type: 'done' })
      else {
        setError(message)
        applyEvent({ type: 'error', message })
      }
    } finally {
      state.running = false
      abort = null
      applyEvent({ type: 'done' })
      await listSessions()
    }
  }

  function stop(): void {
    abort?.abort()
    if (state.sessionId) void api.abort(CANVAS_ID, state.sessionId)
    state.running = false
  }

  async function retry(): Promise<void> {
    if (lastText || lastImages?.length) await send(lastText, lastImages)
  }

  function setModel(provider: string, modelId: string): void {
    state.model = { provider, modelId }
  }

  function toggleSkill(name: string): void {
    state.activeSkills = state.activeSkills.includes(name)
      ? state.activeSkills.filter((s) => s !== name)
      : [...state.activeSkills, name]
  }

  function toggleMcp(name: string): void {
    state.activeMcp = state.activeMcp.includes(name)
      ? state.activeMcp.filter((s) => s !== name)
      : [...state.activeMcp, name]
  }

  function syncRefsFromText(text: string): void {
    const has = (name: string): boolean => text.includes('@' + name)
    state.activeSkills = state.skills.filter((sk) => has(sk.name)).map((sk) => sk.name)
    state.activeMcp = state.mcpServers.filter((m) => has(m.name)).map((m) => m.name)
  }

  async function decide(approvalId: string, decision: 'allow' | 'deny'): Promise<void> {
    if (!state.sessionId) return
    // 先把卡片点亮（用户立刻看到反馈），再发请求
    applyEvent({ type: 'approval_result', id: approvalId, decision })
    try {
      await api.approve(CANVAS_ID, state.sessionId, approvalId, decision)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function savePolicy(policy: ApprovalPolicyView): Promise<void> {
    try {
      const r = await api.putPolicy(policy as unknown as Record<string, unknown>)
      const next = r.policy as ApprovalPolicyView | undefined
      if (next) state.policy = next
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function importSkill(dir: string): Promise<void> {
    await api.importSkill(dir)
    await refresh()
  }

  async function loadSkillCandidates(): Promise<void> {
    try {
      const r = await api.skillSources()
      state.skillCandidates = (Array.isArray(r.candidates) ? r.candidates : []) as AgentServiceState['skillCandidates']
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * 问上游要模型清单（GET {baseUrl}/models）。
   *
   * 用户手里是自建网关，模型 ID 有一串，让他手打容易错 —— 拉回来做成下拉。
   * 失败不抛（可能还没配密钥）：把错误原样交给界面显示。
   */
  async function loadUpstreamModels(
    body: { provider?: string; modelId?: string; baseUrl?: string; apiKey?: string } = {},
  ): Promise<{ ok: boolean; models: string[]; error?: string }> {
    try {
      const r = await api.upstreamModels(body)
      const models = (Array.isArray(r.models) ? r.models : []).map(String)
      state.upstreamModels = models
      if (!r.ok && typeof r.error === 'string') setError(r.error)
      return { ok: r.ok === true, models, ...(typeof r.error === 'string' ? { error: r.error } : {}) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      return { ok: false, models: [], error: message }
    }
  }

  async function saveSystemPrompt(text: string): Promise<void> {
    const r = await api.saveSystemPrompt(text)
    state.systemPrompt = typeof r.text === 'string' ? r.text : text
  }

  async function removeSkill(name: string): Promise<void> {
    await api.removeSkill(name)
    state.activeSkills = state.activeSkills.filter((s) => s !== name)
    await refresh()
    await loadSkillCandidates()
  }

  async function addMcp(body: Record<string, unknown>): Promise<void> {
    await api.addMcp(body)
    await refresh()
  }

  async function removeMcp(name: string): Promise<void> {
    await api.removeMcp(name)
    state.activeMcp = state.activeMcp.filter((s) => s !== name)
    await refresh()
  }

  /**
   * 主动连一次 MCP，把「连了几个、有哪些工具」拿回来。
   *
   * 为什么不复用会话里的那份连接：那是 SDK 在第一次 run() 时自己起的，
   * 探它要碰会话生命周期（耦合重，而且没会话时还探不了）。这里独立探一次，
   * 探测完服务端会立刻关掉连接 —— 用户点一次「检查」就查一次，代价合理。
   */
  async function probeMcp(names?: string[]): Promise<McpProbeResult> {
    try {
      const r = await api.probeMcp(names)
      return {
        ok: r.ok === true,
        servers: (Array.isArray(r.servers) ? r.servers : []) as McpProbeResult['servers'],
        tools: (Array.isArray(r.tools) ? r.tools : []) as McpProbeResult['tools'],
        warnings: (Array.isArray(r.warnings) ? r.warnings : []).map(String),
        ...(typeof r.error === 'string' ? { error: r.error } : {}),
      }
    } catch (err) {
      return { ok: false, servers: [], tools: [], warnings: [], error: err instanceof Error ? err.message : String(err) }
    }
  }

  async function saveModel(body: Record<string, unknown>): Promise<void> {
    await api.saveModel(body)
    await refresh()
  }

  /**
   * 让当前会话丢掉旧的 MCP 连接（下一句重新连）。
   *
   * 没有会话时直接返回 false：还没开始聊，本来就不存在"旧连接"，
   * 下一句自然是一条新会话、会重新连。
   */
  async function reconnectMcp(): Promise<boolean> {
    if (!state.sessionId) return false
    try {
      const r = await api.reconnectMcp(CANVAS_ID, state.sessionId)
      return r.released === true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }

  /**
   * 编辑一个渠道：把「勾中的模型」一次写进去，并把该渠道下**取消勾选**的旧模型删掉。
   *
   * 为什么走一个批量接口而不是在界面里循环：见 agentApi.saveModelsBulk 的注释。
   * 成功后重新 refresh()，列表与下拉都拿服务端的真实结果（不在前端自己拼）。
   */
  async function saveModelsBulk(body: Record<string, unknown>): Promise<void> {
    await api.saveModelsBulk(body)
    await refresh()
  }

  async function deleteModel(provider: string, modelId: string): Promise<void> {
    await api.deleteModel(provider, modelId)
    await refresh()
  }

  async function setDefaultModel(provider: string, modelId: string): Promise<void> {
    await api.setDefaultModel(provider, modelId)
    state.model = { provider, modelId }
    await refresh()
  }

  return {
    state,
    turns: computed(() => state.turns),
    toggle: () => {
      state.open = !state.open
      if (state.open) void refresh()
    },
    show: () => {
      state.open = true
      void refresh()
    },
    hide: () => {
      state.open = false
    },
    refresh,
    newSession,
    listSessions,
    openSession,
    renameSession,
    deleteSession,
    send,
    stop,
    retry,
    setModel,
    toggleSkill,
    toggleMcp,
    syncRefsFromText,
    decide,
    savePolicy,
    importSkill,
    loadSkillCandidates,
    loadUpstreamModels,
    saveSystemPrompt,
    removeSkill,
    addMcp,
    removeMcp,
    probeMcp,
    reconnectMcp,
    saveModel,
    saveModelsBulk,
    deleteModel,
    setDefaultModel,
  }
}
