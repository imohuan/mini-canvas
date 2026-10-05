/**
 * AgentRuntime —— 会话生命周期（建 / 续 / 跑 / 打断）+ 审批。
 *
 * 围绕「一个画布下多个会话」这条口径：
 * 1. ensureSession：磁盘上有转录就 resumeSession 续上下文，没有就 createSession
 *    （带**本画布**的 workspaceDir，并按本次选择只连指定的 MCP）；
 * 2. run：跑完一轮，产出前端事件，同时把可读的那几类追加进转录（partial 不落）；
 * 3. 审批：命中规则的工具会**挂起**等用户点允许/拒绝（挂起项经 SSE 推给界面）；
 * 4. abort / forget / disposeAll：中止一轮、删会话、进程退出时放掉内存态。
 *
 * 依赖全部经构造参数注入（agent 工厂 / 配置面 / 策略），单测不需要真模型、真网络。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AgentChatEvent } from './translate.js'
import { createTranslateState, translateMessage, contextLeftPercent, type TranslateState } from './translate.js'
import { decideTool, normalizePolicy, type ApprovalPolicy } from './approval.js'
import { AGENT_ID, AGENT_PROJECT_ID, agentRoot, canvasWorkspaceDir } from './agentPaths.js'
import type { AgentSessionStore } from './sessionStore.js'
import { buildReferenceGuidance, namesOfKind, stripMarkupToPlain } from './referenceMarkup.js'

export interface AgentSessionLike {
  readonly sessionId: string
  readonly provider?: string
  readonly modelId?: string
  run(messages: unknown[], opts?: Record<string, unknown>): AsyncIterable<unknown>
  steer?(messages: unknown[]): boolean
  dispose?(): void
}

export interface AgentLike {
  createSession(opts?: Record<string, unknown>): Promise<AgentSessionLike>
  resumeSession(opts: { sessionId: string }): Promise<AgentSessionLike>
}

/** 一次审批请求（挂起时推给界面；用户点选后按 id 解开） */
export interface PendingApproval {
  id: string
  toolName: string
  arguments: string
  createdAt: number
}

export interface SessionPrefs {
  provider?: string
  modelId?: string
  /** 本次要连的 MCP 服务名（不传 = 全部已配置的） */
  mcpServers?: string[]
  /** 本次要引用的技能名（进 [use_skills] 前缀块） */
  skills?: string[]
  /**
   * 本次要用的**模式系统提示词**（「全能创作 / 剧本创编」各一套）。
   *
   * 做法与 mcpServers 同款：SDK 在**建会话时**读一次 agent_state/AGENTS.md，
   * 所以临场把它换成这段文本、建完还原，这一条会话的系统提示词就是它。
   * 不传则用 AGENTS.md 里原有的内容（保持旧行为）。
   */
  systemPrompt?: string
  /** 规则列表里的审批开关（随会话走；不传用运行时当前策略） */
  policy?: ApprovalPolicy
  /** 这个模型的上下文窗口（算「剩余百分比」的分母；缺省则退回 session_meta 里的值） */
  contextWindow?: number
}

export interface AgentRuntimeDeps {
  root: string
  store: AgentSessionStore
  agent(): Promise<AgentLike>
  makeUserMessage(text: string, images?: string[]): unknown | unknown[]
  /** 读/写 system_config.yaml（按本次选择过滤 MCP） */
  filterMcp?(names: string[]): Promise<() => Promise<void>>
  /** 技能名 → SKILL.md 全文（拼进 [use_skills] 块） */
  readSkill?(name: string): Promise<string | undefined>
  /** 临时把 AGENTS.md 换成这段文本，返回还原函数（模式系统提示词用） */
  withSystemPrompt?(text: string): Promise<() => Promise<void>>
  log?: (message: string, extra?: unknown) => void
}

export interface StartRunInput {
  canvasId: string
  sessionId?: string
  text: string
  images?: string[]
  prefs?: SessionPrefs
}

interface LiveSession {
  id: string
  session: AgentSessionLike
  state: TranslateState
  running: boolean
  abort?: AbortController
  /** 挂起的审批：id → 解开回调 */
  pending: Map<string, (decision: 'allow' | 'deny') => void>
  /** 挂起项的快照（推给界面） */
  pendingInfo: Map<string, PendingApproval>
  policy: ApprovalPolicy
  /** 这条会话有没有被显式指定过策略（没指定就跟着运行时的实时策略走） */
  policyOverridden: boolean
  notify: (event: AgentChatEvent) => void
  contextLeft: number | null
}

export class AgentRuntime {
  private readonly live = new Map<string, LiveSession>()
  private policy: ApprovalPolicy = normalizePolicy(undefined)

  constructor(private readonly deps: AgentRuntimeDeps) {}

  /** 规则列表（界面读它渲染、点开关改它） */
  getPolicy(): ApprovalPolicy {
    return { enabled: this.policy.enabled, rules: this.policy.rules.map((r) => ({ ...r })) }
  }

  setPolicy(next: ApprovalPolicy): void {
    this.policy = normalizePolicy(next)
  }

  private key(canvasId: string, sessionId: string): string {
    return canvasId + '/' + sessionId
  }

  private log(message: string, extra?: unknown): void {
    this.deps.log?.(message, extra)
  }

  /** 拿一个可用的会话：内存里有就复用，没有就续或建 */
  async ensureSession(
    canvasId: string,
    opts: { sessionId?: string; title?: string; prefs?: SessionPrefs } = {},
  ): Promise<{ id: string; resumed: boolean }> {
    const prefs = opts.prefs ?? {}
    if (opts.sessionId) {
      const cached = this.live.get(this.key(canvasId, opts.sessionId))
      if (cached) return { id: cached.id, resumed: true }
      // 磁盘上有转录 = 这个会话以前建过 → 用 resumeSession 把模型上下文接回来
      const record = await this.deps.store.get(canvasId, opts.sessionId)
      if (record) {
        const agent = await this.deps.agent()
        const session = await agent.resumeSession({ sessionId: opts.sessionId })
        this.attach(canvasId, session, prefs)
        return { id: opts.sessionId, resumed: true }
      }
      // 磁盘上也没有 → 不当成错误，退回新建（界面传来的旧 id 可能已被删）
    }
    await fs.mkdir(canvasWorkspaceDir(this.deps.root, canvasId), { recursive: true })
    const restore = await this.applyMcpFilter(prefs.mcpServers)
    // 模式系统提示词：与 MCP 一样，卡在「建会话前换、建会话后还原」这一小段里。
    const restorePrompt =
      prefs.systemPrompt && this.deps.withSystemPrompt
        ? await this.deps.withSystemPrompt(prefs.systemPrompt)
        : async () => undefined
    const agent = await this.deps.agent()
    let session: AgentSessionLike
    try {
      session = await agent.createSession({
        // 工作目录钉在本画布目录下，Agent 的文件类工具便出不去
        workspaceDir: canvasWorkspaceDir(this.deps.root, canvasId),
        ...(prefs.provider && prefs.modelId ? { provider: prefs.provider, modelId: prefs.modelId } : {}),
      })
    } finally {
      await restore()
      await restorePrompt()
    }
    const id = session.sessionId
    await this.deps.store.ensure(canvasId, {
      id,
      title: opts.title?.trim() || '新会话',
      createdAt: Date.now(),
      provider: session.provider ?? prefs.provider ?? 'default',
      modelId: session.modelId ?? prefs.modelId ?? 'default',
    })
    this.attach(canvasId, session, prefs)
    return { id, resumed: false }
  }

  /** 把会话挂进内存态 */
  private attach(canvasId: string, session: AgentSessionLike, prefs: SessionPrefs): void {
    const state = createTranslateState()
    // 优先用配置里那个模型的窗口：session_meta 只写进 trace、不从 run() 里出来（实测），
    // 单靠它会让「剩余百分比」永远算不出来。
    if (prefs.contextWindow) state.contextWindow = prefs.contextWindow
    this.live.set(this.key(canvasId, session.sessionId), {
      id: session.sessionId,
      session,
      state,
      running: false,
      pending: new Map(),
      pendingInfo: new Map(),
      policy: prefs.policy ? normalizePolicy(prefs.policy) : this.policy,
      policyOverridden: !!prefs.policy,
      notify: () => undefined,
      contextLeft: null,
    })
  }

  /**
   * 只连本次选中的 MCP。
   *
   * 做法是临时把 system_config.yaml 的 mcpServers 换成子集，建完会话再还原 ——
   * SDK 在会话第一次 run 时才读这份配置去连，所以「建会话前换、建完还原」正好卡在中间。
   */
  private applyMcpFilter(names: string[] | undefined): Promise<() => Promise<void>> {
    if (!names || !names.length || !this.deps.filterMcp) return Promise.resolve(async () => undefined)
    return this.deps.filterMcp(names)
  }

  /** 会话当前是否在跑（界面据此把发送按钮换成停止） */
  isRunning(canvasId: string, sessionId: string): boolean {
    return this.live.get(this.key(canvasId, sessionId))?.running ?? false
  }

  /** 当前挂起的审批（界面渲染审批卡片用） */
  pendingApprovals(canvasId: string, sessionId: string): PendingApproval[] {
    const entry = this.live.get(this.key(canvasId, sessionId))
    return entry ? [...entry.pendingInfo.values()] : []
  }

  /** 用户点了允许 / 拒绝：解开挂起的那次审批 */
  resolveApproval(canvasId: string, sessionId: string, id: string, decision: 'allow' | 'deny'): boolean {
    const entry = this.live.get(this.key(canvasId, sessionId))
    const resolve = entry?.pending.get(id)
    if (!entry || !resolve) return false
    entry.pending.delete(id)
    entry.pendingInfo.delete(id)
    resolve(decision)
    return true
  }

  /** 跑一轮。产出事件；转录只落「能读」的那几类 */
  /**
   * 跑一轮。产出事件；转录只落「能读」的那几类。
   *
   * `notify` 是**直通通道**：审批卡片是在 approve 回调里产生的，而那个回调是 SDK
   * 在 await 中途调用我们的，没法从生成器里 yield 出去（yield 不能在嵌套函数里用）。
   * 所以审批类事件经 notify 直接写到调用方的响应流上，其余事件走生成器。
   */
  async *run(
    canvasId: string,
    input: StartRunInput,
    signal: AbortSignal,
    notify?: (event: AgentChatEvent) => void,
  ): AsyncGenerator<AgentChatEvent> {
    const { id } = await this.ensureSession(canvasId, {
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      title: input.text,
      // 从正文标记里现算这次要连的 MCP（删掉标记即不再连），与显式 prefs 合并去重。
      prefs: mergeMarkupPrefs(input.prefs, input.text),
    })
    const entry = this.live.get(this.key(canvasId, id))!
    const userMessages: unknown[] = await this.buildUserMessages(input.text, input.images)

    // 已经有会话在跑：这一句当 steering 送进去，不并发开第二个 run
    if (entry.running) {
      const steered = entry.session.steer?.(userMessages) ?? false
      this.log('steered into running task', { session: id, steered })
      yield { type: 'notice', message: steered ? '已作为补充指令发送给进行中的任务' : '任务正在执行中' }
      yield { type: 'done' }
      return
    }

    entry.running = true
    entry.abort = new AbortController()
    const own = entry.abort
    signal.addEventListener('abort', () => own.abort(), { once: true })
    const started = Date.now()
    let assistantText = ''
    try {
      yield { type: 'session', sessionId: id, title: '' }
      await this.deps.store.appendTurn(canvasId, id, {
        role: 'user',
        // 转录里存**可读文本**（标记降级成 `@名字`）：历史回放与普通展示都不该看到机器串。
        // 模型真正拿到的是上面 buildUserMessages 拼好的引导块，与这里无关。
        text: stripMarkupToPlain(input.text),
        // 图一起落转录：否则刷新 / 切会话后只剩一句文字，用户以为图丢了
        ...(input.images?.length ? { images: input.images } : {}),
        ts: Date.now(),
      })

      const approve = async (toolCall: unknown): Promise<'allow' | 'deny'> => {
        const payload = (toolCall as { payload?: Record<string, unknown> })?.payload ?? {}
        const name = String(payload.name ?? '')
        // 用**实时**策略：用户在设置里改了规则列表，应当下一句就生效，
        // 而不是等新会话（规则列表页的名字就叫「监听并设置哪些工具需要审批」）。
        const decision = decideTool(entry.policyOverridden ? entry.policy : this.policy, name)
        this.log('tool decision', { tool: name, decision })
        if (decision !== 'ask') return 'allow'
        // 需要询问：挂起，把卡片推给界面，等用户点允许 / 拒绝
        const approvalId = 'ap-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
        const info: PendingApproval = {
          id: approvalId,
          toolName: name,
          arguments: typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments ?? null),
          createdAt: Date.now(),
        }
        entry.pendingInfo.set(approvalId, info)
        const answer = new Promise<'allow' | 'deny'>((resolve) => entry.pending.set(approvalId, resolve))
        // 命中审批的工具在界面里是**卡片**（不是紧凑一行）。这个标记也要落盘，
        // 否则刷新后它会缩成一行，与刚才看到的样子不一致。
        const callId = String((payload as { id?: unknown }).id ?? '')
        if (callId) await this.deps.store.patchTool(canvasId, id, callId, { card: true }).catch(() => undefined)
        notify?.({ type: 'approval_request', approval: info })
        const result = await answer
        notify?.({ type: 'approval_result', id: approvalId, decision: result })
        return result
      }

      for await (const msg of entry.session.run(userMessages, { signal: own.signal, approve })) {
        for (const ev of translateMessage(msg, entry.state, (m, extra) => this.log(m, extra))) {
          if (ev.type === 'usage') {
            entry.contextLeft = contextLeftPercent(ev.usedTokens, ev.limitTokens)
            yield ev
            continue
          }
          if (ev.type === 'text' && ev.final && typeof ev.text === 'string') {
            assistantText += ev.text
            await this.deps.store.appendTurn(canvasId, id, { role: 'assistant', text: ev.text, ts: Date.now() })
          } else if (ev.type === 'thinking' && ev.final && typeof ev.text === 'string') {
            await this.deps.store.appendTurn(canvasId, id, { role: 'thinking', text: ev.text, ts: Date.now() })
          } else if (ev.type === 'tool_call') {
            await this.deps.store.appendTurn(canvasId, id, {
              role: 'tool',
              text: ev.name + '(' + ev.arguments + ')',
              // 结构化存一份：回放时才能还原成「卡片还是紧凑一行、跑完没跑完」
              // （只靠上面那行 text 分不出来，刷新后全变成转圈的卡片）。
              tool: { id: ev.id, name: ev.name, arguments: ev.arguments },
              ts: Date.now(),
            })
          } else if (ev.type === 'tool_output') {
            // 结果补写到**同一条**工具记录上（按 id 找到它），不是新开一条 ——
            // 新开一条会让回放里出现「一个没结果的调用 + 一条孤立的结果」。
            await this.deps.store.patchTool(canvasId, id, ev.id, { output: ev.output })
          }
          yield ev
        }
      }
      await this.maybeAutoTitle(canvasId, id, input.text)
      // 这一轮结束：把工具记录统一标成已完成，避免刷新后还挂着「正在执行」的转圈
      await this.deps.store.finishTools(canvasId, id)
      this.log('run done', { session: id, ms: Date.now() - started, chars: assistantText.length })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log('run failed', { session: id, message, ms: Date.now() - started })
      yield { type: 'error', message }
    } finally {
      entry.running = false
      entry.abort = undefined
      // 出错/中止也要收尾：否则半途挂掉的那条工具会一直显示成「正在执行」
      await this.deps.store.finishTools(canvasId, id).catch(() => undefined)
      // 挂起的审批随这一轮一起作废（别把 promise 悬在那儿）
      for (const [, resolve] of entry.pending) resolve('deny')
      entry.pending.clear()
      entry.pendingInfo.clear()
      yield { type: 'done' }
    }
  }

  /**
   * 组装这一次的用户消息：引用引导块 + 正文 + 图片。
   *
   * 口径（用户 2026-10-05）：引用**只给钥匙、不给内容** —— 技能不贴 SKILL.md 全文
   * （否则引用几次上下文就爆、内容完全重复），只说明它在哪、让模型按需 read_file；
   * 节点不贴内容，只给画布 id + 节点 id，引导模型用内置画布 MCP 自己去查。
   * MCP 不在这里（它靠 prefs.mcpServers 决定连哪几个）。
   */
  private async buildUserMessages(text: string, images: string[] | undefined): Promise<unknown[]> {
    const make = this.deps.makeUserMessage
    // 正文里的引用标记 → 引导块（技能给路径、节点给画布id+节点id）；没有标记则原样。
    const guided = buildReferenceGuidance(text)
    const raw = make(guided, images)
    return Array.isArray(raw) ? [...raw] : [raw]
  }

  /** 首轮之后把会话名从「新会话」改成首句（列表里看得懂） */
  private async maybeAutoTitle(canvasId: string, sessionId: string, firstText: string): Promise<void> {
    const record = await this.deps.store.get(canvasId, sessionId)
    if (!record || record.title !== '新会话') return
    const title = firstText.trim().replace(/\s+/g, ' ').slice(0, 24)
    if (title) await this.deps.store.rename(canvasId, sessionId, title)
  }

  /** 中止当前轮：会话本身留着（用户只是停下，不是删掉） */
  abort(canvasId: string, sessionId: string): void {
    this.live.get(this.key(canvasId, sessionId))?.abort?.abort()
  }

  /**
   * 让一条会话**丢掉它的 MCP 连接**，下一句重新连一次。
   *
   * 为什么必须这么做（用户问的"重新检查一下工具列表，对话中的工具能恢复吗"）：
   * SDK 的 MCP 连接是**跟着会话走的**（每条会话一个 Environment，第一次 run 时连上、之后一直复用）。
   * 如果外部把 MCP 服务关了，那条连接就废了；而 SDK 的连接结果只在**第一次** listTools() 时产生，
   * 之后不会自己重连 —— 所以那条会话会一直是「服务不可达、工具被跳过」的状态，
   * 哪怕 MCP 重新起来了也没用。
   *
   * SDK 没有暴露"让这条会话重连 MCP"的接口，所以这里用**丢会话**来等价达成：
   * 把内存态放掉，下一句走 resumeSession 重建 Environment → 重新连 MCP。
   * 转录在磁盘上（AgentSessionStore），所以对话内容一点不丢；丢的只是那条废连接。
   *
   * 返回是否真的放掉了（没有内存态时返回 false，调用方据此知道"本来就没连着"）。
   */
  reconnectMcp(canvasId: string, sessionId: string): boolean {
    const key = this.key(canvasId, sessionId)
    const entry = this.live.get(key)
    if (!entry) return false
    // 正在跑的别动：把会话从底下抽掉会让那一轮炸掉。让用户先停或等它跑完。
    if (entry.running) return false
    entry.abort?.abort()
    for (const [, resolve] of entry.pending) resolve('deny')
    entry.pending.clear()
    entry.pendingInfo.clear()
    entry.session.dispose?.()
    this.live.delete(key)
    this.log('mcp reconnect requested', { session: sessionId })
    return true
  }

  /** 删会话时放掉内存态（转录由 AgentSessionStore 删） */
  forget(canvasId: string, sessionId: string): void {
    const entry = this.live.get(this.key(canvasId, sessionId))
    if (!entry) return
    entry.abort?.abort()
    for (const [, resolve] of entry.pending) resolve('deny')
    entry.pending.clear()
    entry.session.dispose?.()
    this.live.delete(this.key(canvasId, sessionId))
  }

  disposeAll(): void {
    for (const entry of this.live.values()) {
      entry.abort?.abort()
      for (const [, resolve] of entry.pending) resolve('deny')
      entry.pending.clear()
      entry.session.dispose?.()
    }
    this.live.clear()
  }
}

/**
 * 把正文标记里声明的 MCP 并进这次会话的 prefs。
 *
 * 为什么还要保留显式 prefs：老客户端 / 中间件仍可能直接传 mcpServers。
 * 两条来源合并去重 —— 标记是「这轮正文里写了什么」，prefs 是「调用方额外指定了什么」。
 * 都没有时返回原值（undefined 或空），让 ensureSession 走「全部已配置」的默认路径。
 */
function mergeMarkupPrefs(prefs: SessionPrefs | undefined, text: string): SessionPrefs | undefined {
  const fromMarkup = namesOfKind(text, 'mcp')
  if (!fromMarkup.length) return prefs
  const merged = [...new Set([...(prefs?.mcpServers ?? []), ...fromMarkup])]
  return { ...(prefs ?? {}), mcpServers: merged }
}

/** 与 agentRoot 一起导出，路由层建 agent 时要用 */
export { agentRoot, AGENT_ID, AGENT_PROJECT_ID }

/** 会话工作目录（路由层也会用到） */
export function sessionWorkspaceDir(root: string, canvasId: string): string {
  return canvasWorkspaceDir(root, canvasId)
}

/** 便于调用方判断路径归属 */
export function agentDataRoot(root: string): string {
  return agentRoot(root)
}

/** 供路由层拼技能路径 */
export function skillsRoot(root: string): string {
  return path.join(agentRoot(root), AGENT_PROJECT_ID, 'agents', AGENT_ID, 'agent_state', 'skills')
}
