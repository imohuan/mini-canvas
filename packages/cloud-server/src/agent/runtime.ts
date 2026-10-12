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
import { buildReferenceGuidance, namesOfKind, stripMarkupToPlain, REFERENCE_MARKUP_GUIDE } from './referenceMarkup.js'

/**
 * 会话的**即时名**（首轮首句剥标记后截 24 字）—— 这份公式全仓只有这一份。
 *
 * 为什么必须单份：落盘名用 maybeAutoTitle、AI 起名的「是否已被用户改过」判定用
 * spawnBackgroundTitle，两处比对的是同一个字符串。公式各写一份的话，改了一处忘另一处，
 * 判定永假 → 会话永远不被 AI 改名（审查发现的隐患）。
 */
function immediateTitleOf(firstText: string): string {
  return stripMarkupToPlain(firstText).trim().replace(/\s+/g, ' ').slice(0, 24)
}

export interface AgentSessionLike {
  readonly sessionId: string
  readonly provider?: string
  readonly modelId?: string
  run(messages: unknown[], opts?: Record<string, unknown>): AsyncIterable<unknown>
  steer?(messages: unknown[]): boolean
  /**
   * 跑命名 hook 包的 user_prompt 命令（SDK 的目标启动入口）。
   * 可选：老测试的假会话没有它；只有真 SDK 会话才提供。
   * 返回 null = 包没装 / 没这条命令（宿主据此拒绝启动目标）。
   */
  runUserPromptHook?(name: string, prompt: string, extras?: Record<string, string | number | boolean>): Promise<{ context?: string } | null>
  /**
   * 用户主动压缩上下文（「压缩」命令；SDK 的 Session.compact()）。
   *
   * 返回 generator：串出成对的 compaction_begin / compaction_end 事件（可能有多次重试）。
   * 可选：老测试的假会话没有它 —— 没它时宿主要如实说「这条会话不支持压缩」，
   * 不要静默什么都不做（用户点了按钮却毫无反应）。
   */
  compact?(opts?: { signal?: AbortSignal }): AsyncGenerator<unknown>
  /**
   * 现在能不能压缩，不能时给出原因。
   *
   * SDK 的原话：不是 ok 时 compact() 是 no-op、一条消息都不产出 —— 所以调用方必须先问它，
   * 否则用户看到的是「点了没反应」。可选：老假会话没有它就按 ok 处理。
   */
  compactability?(): 'ok' | 'unsupported' | 'empty' | 'just_compacted'
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
  /**
   * 这条审批对应的工具调用 id（SDK 的 `tool_call_id`）。
   *
   * 界面靠它把「审批卡片」和它的那条工具调用对上（不再按工具名猜 —— 同一轮里
   * 可能有好几个同名工具，按名字找会标错那条）。刷新后补渲染也用它落点。
   */
  toolCallId?: string
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
  /**
   * 造一条**宿主注入**的用户消息（SDK 的 userText(text, 'harness')）。
   *
   * 为什么必须单独一个口子：SDK 用 sender:'harness' 这个戳划**轮次边界**
   * （goal 的 stop hook 靠它算「这一轮用了多少 token、有没有被中止」）。
   * 目标的协议文本必须这样发，否则 stop hook 会把整份 trace 当一轮扫 ——
   * 扫到历史上任何一次 abort 就判 aborted，目标于是永远停在第 1 轮（真机实测）。
   * 不注入 = 老测试的假宿主，退化成「拼进正文」（仅够跑通，不起目标循环）。
   */
  makeHarnessMessage?(text: string): unknown
  /**
   * 每会话常驻事件通道（设计 §3.2）。给了它 = 开启「后台对话」托管模式：
   * 一轮在后台跑到底、事件进 hub，HTTP 只是订阅。不给 = 旧行为（跑在响应里）。
   */
  hub?: AgentHub
  /** 读/写 system_config.yaml（按本次选择过滤 MCP） */
  filterMcp?(names: string[]): Promise<() => Promise<void>>
  /** 技能名 → SKILL.md 全文（拼进 [use_skills] 块） */
  readSkill?(name: string): Promise<string | undefined>
  /** 临时把 AGENTS.md 换成这段文本，返回还原函数（模式系统提示词用） */
  withSystemPrompt?(text: string): Promise<() => Promise<void>>
  /**
   * 给一段对话**用模型起个标题**（宿主注入：走「会话标题模型」配置的模型）。
   * 返回 null = 没配 / 起名失败，调用方回落「首句截断」。
   */
  generateTitle?(plainFirstText: string): Promise<string | null>
  /**
   * 一轮结束的回调（队列调度用；设计 §3.3.2 的触发点之一）。
   *
   * 为什么用回调而不是 runtime 直接调调度器：runtime 只管"跑一轮"，
   * 谁在这一轮之后决定发下一条由宿主接线（与 preTurn / onQueueChanged 同一风格）。
   */
  onRunFinished?(canvasId: string, sessionId: string): void
  /**
   * 目标的一轮结束（stop hook 触发）。runtime 只在整轮 run 结束时才有 onRunFinished；
   * 目标是一次 run 里连跑多轮的，所以它需要**每轮**都能被通知到（否则界面轮次/已用跳号）。
   * 宿主借此读一次 GOAL.json 并推 goal_state。
   */
  onGoalRound?(canvasId: string, sessionId: string): void
  log?: (message: string, extra?: unknown) => void
}

/**
 * runtime 对 hub 的最小依赖面（只声明用到的部分）。
 *
 * 为什么用结构化类型而不是直接 import SessionHub：单测可以塞一个假 hub，
 * 不必起真的调度器；同时 runtime 不依赖 hub 的实现细节。
 */
export interface AgentHub {
  append(canvasId: string, sessionId: string, ev: AgentChatEvent): void
  start(
    canvasId: string,
    sessionId: string,
    opts: { run: (signal: AbortSignal) => AsyncGenerator<AgentChatEvent> },
  ): Promise<void>
  isRunning(canvasId: string, sessionId: string): boolean
  abort(canvasId: string, sessionId: string): boolean
}

/** hub.start 在"已经在跑"时抛的错误信息前缀（runtime 用它区分"重复触发"与真错误） */
export const HUB_ALREADY_RUNNING = '这一轮已经在跑了'

export interface StartRunInput {
  canvasId: string
  sessionId?: string
  text: string
  images?: string[]
  /**
   * 紧跟用户消息之后、由**宿主注入**的一段文本（目标模式的协议文本）。
   * 以 sender:'harness' 发送：模型看得到，但它在 SDK 眼里是一条独立输入
   * （轮次边界），不进用户气泡、也不进转录。
   */
  harnessText?: string
  prefs?: SessionPrefs
}

interface LiveSession {
  id: string
  session: AgentSessionLike
  state: TranslateState
  running: boolean
  abort?: AbortController
  /**
   * 轮到第几代（每次 run() 开始 +1）。
   *
   * 与 stoppedGen 配对使用：abort 只标记「**当时正在跑的那一代**已终止」，
   * 新的一代一开始 generation 就变大、不再等于 stoppedGen ⇒ 终止不会误伤下一轮
   * （真机窗口：上一轮刚被终止、下一轮已经在跑，此时所有审批不能一直被静默拒）。
   */
  generation: number
  /** 被终止的那一代（0 = 没终止过）。见 generation 的说明 */
  stoppedGen: number
  /** 挂起的审批：id → 解开回调 */
  pending: Map<string, (decision: 'allow' | 'deny') => void>
  /** 挂起项的快照（推给界面） */
  pendingInfo: Map<string, PendingApproval>
  policy: ApprovalPolicy
  /** 这条会话有没有被显式指定过策略（没指定就跟着运行时的实时策略走） */
  policyOverridden: boolean
  notify: (event: AgentChatEvent) => void
  contextLeft: number | null
  /**
   * 上一次把用量写盘的时刻（节流用，见 run() 里 usage 分支）。
   *
   * 为什么需要节流：token_usage 是**每次模型请求**都发一条（一轮里十几次），
   * 而每次写盘都是"读整个会话文件 → 改 → 整写"。中间值没有读者，只有最新那份有用。
   */
  lastUsageSavedAt: number
  /**
   * 压缩进行中（code review 2026-10-11 抓到的并发窗口）。
   *
   * SDK 的原话：compact 只能在 **Task 边界**调用 —— 压缩进行时再 run 一轮，
   * 两条模型请求会同时读写同一份上下文，结果不可预期。isRunning 不含 compact
   * （它只标记 run），所以单独记一位：compact() 开头置位、finally 清掉；
   * run() 与 switch-model 看到它就拒绝（「正在压缩」）。
   */
  compacting: boolean
}

export class AgentRuntime {
  private readonly live = new Map<string, LiveSession>()
  /**
   * 每会话的「终止世代号」。
   *
   * 为什么需要它：首次发送时 `ensureSession` 要先走 resumeSession（几百毫秒到几秒），
   * 而界面在按下发送那一刻就把按钮变成了停止。用户在这段窗口里点停止时，hub 还没有
   * running 条目、runtime 也还没挂 entry —— 没人接，这个「停」就丢了，装载完照跑到底。
   *
   * 用一个单调计数器当坐标：`startRun` 在装载前记下号，装载后再看一次，变了就不跑。
   * 比「每请求一个令牌」稳：并发多个请求各自记号，任何一次终止都能让它们全部看到变化
   *（令牌方案会在同一 key 上互相覆盖，把先到的那个的取消状态挤掉）。
   */
  private readonly abortEpoch = new Map<string, number>()

  private epochOf(key: string): number {
    return this.abortEpoch.get(key) ?? 0
  }

  /** 这一代的终止检查：终止标记打在当前 generation 上（见 LiveSession） */
  private stoppedNow(entry: LiveSession): boolean {
    return entry.stoppedGen !== 0 && entry.stoppedGen === entry.generation
  }
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
        try {
          const session = await agent.resumeSession({ sessionId: opts.sessionId })
          this.attach(canvasId, session, prefs)
          return { id: opts.sessionId, resumed: true }
        } catch (err) {
          // 有转录记录、但 SDK 侧没有对应的 Trace（会话从没真跑过一轮 —— 比如队列
          // 在第一条消息发出前就落了记录，或那一轮在 bootstrap 阶段就失败了）。
          // 这种 id 续不上上下文，**不当成错误**：往下走新建一条，让这一轮照常跑起来。
          this.log('resume failed, falling back to new session', {
            session: opts.sessionId,
            err: err instanceof Error ? err.message : String(err),
          })
        }
      }
      // 磁盘上也没有 → 不当成错误，退回新建（界面传来的旧 id 可能已被删）
    }
    await fs.mkdir(canvasWorkspaceDir(this.deps.root, canvasId), { recursive: true })
    const restore = await this.applyMcpFilter(prefs.mcpServers)
    // 模式系统提示词：与 MCP 一样，卡在「建会话前换、建会话后还原」这一小段里。
    // 系统提示词 = 模式提示词（若有）+ **引用标记说明**（恒有）。
    // 标记说明放这里的原因：后端不再翻译标记（用户口径：要能原样复制到本机 Agent），
    // 所以模型必须事先知道那套标记是什么意思 —— 一次说明，比每条消息翻译干净。
    const promptText = [prefs.systemPrompt, REFERENCE_MARKUP_GUIDE].filter(Boolean).join('\n\n')
    const restorePrompt = this.deps.withSystemPrompt
      ? await this.deps.withSystemPrompt(promptText)
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
      generation: 0,
      stoppedGen: 0,
      pending: new Map(),
      pendingInfo: new Map(),
      policy: prefs.policy ? normalizePolicy(prefs.policy) : this.policy,
      policyOverridden: !!prefs.policy,
      notify: () => undefined,
      contextLeft: null,
      lastUsageSavedAt: 0,
      compacting: false,
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
    // 托管模式下以 hub 为准（它是跨连接的唯一真相）；没有 hub 就走内存态
    if (this.deps.hub) return this.deps.hub.isRunning(canvasId, sessionId)
    return this.live.get(this.key(canvasId, sessionId))?.running ?? false
  }

  /** 现在能给这条会话插队吗（正在跑 + 会话对象在内存里才可能） */
  isSteerable(canvasId: string, sessionId: string): boolean {
    if (!this.isRunning(canvasId, sessionId)) return false
    const entry = this.live.get(this.key(canvasId, sessionId))
    return !!entry?.session.steer
  }

  /**
   * 经 SDK 会话跑命名 hook 包的 user_prompt 命令（目标启动的官方入口）。
   *
   * 返回 null = 会话不在内存 / 包没装（调用方据此拒绝启动目标）。
   * 注意：**不要求会话在跑** —— 目标第 1 轮发起前会话可能刚建好还没跑过。
   */
  async runUserPromptHook(
    canvasId: string,
    sessionId: string,
    name: string,
    prompt: string,
    extras?: Record<string, string | number | boolean>,
  ): Promise<{ context?: string } | null> {
    // 会话可能还没进内存（服务刚重启 / 这条会话从没在本次进程跑过）——
    // 先 ensureSession 把它装载起来，否则 hook 恒返回 null，
    // 目标只能靠宿主兜底文本「假装启动」，官方 start.mjs 的协议文本永远拿不到
    // （真机实测：重启后发目标，日志里一直是「hook 未产出协议文本」）。
    let entry = this.live.get(this.key(canvasId, sessionId))
    if (!entry) {
      try {
        const resolved = await this.ensureSession(canvasId, { sessionId })
        entry = this.live.get(this.key(canvasId, resolved.id))
      } catch (err) {
        this.log('runUserPromptHook: 装载会话失败', {
          session: sessionId,
          err: err instanceof Error ? err.message : String(err),
        })
        return null
      }
    }
    if (!entry?.session.runUserPromptHook) return null
    try {
      return await entry.session.runUserPromptHook(name, prompt, extras)
    } catch (err) {
      this.log('runUserPromptHook failed', {
        session: sessionId,
        hook: name,
        err: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  /**
   * 把一句话插进**正在跑**的那一轮（引导 / 插队；设计 §3.3.3）。
   *
   * 返回 true = 已进队（SDK 下一次请求组装时会投递给模型）。
   * 返回 false = 那一刻已经不在跑了（轮刚好结束）—— 调用方**必须保留**这条消息
   * （退回队列按序发），绝不要因为 false 就丢掉它（用户口径：不丢、不重复）。
   *
   * 落转录（带 steered 标记）也在这里做：引导是真实用户输入，刷新后必须还在界面上。
   */
  async steerInto(canvasId: string, sessionId: string, text: string, images?: string[]): Promise<boolean> {
    const entry = this.live.get(this.key(canvasId, sessionId))
    if (!entry?.running) return false
    const messages = await this.buildUserMessages(text, images)
    const steered = entry.session.steer?.(messages) ?? false
    this.log('steered into running task', { session: sessionId, steered })
    if (steered) {
      await this.deps.store.appendTurn(canvasId, sessionId, {
        role: 'user',
        text,
        ...(images?.length ? { images } : {}),
        steered: true,
        ts: Date.now(),
      })
    }
    return steered
  }

  /**
   * **托管开跑**（设计 §3.2）：把这一轮交给 hub 在后台跑到底，函数立刻返回。
   *
   * 与 run() 的分工：run() 是"这一轮的实现"（异步生成器，产出事件、写转录），
   * startRun() 是"把它托管出去"——HTTP 层调它之后只需订阅 hub 看事件。
   *
   * 返回 `{ started: false }` 的场景：这一轮的会话**已经在跑**（重复触发 / 并发请求）——
   * 调用方据此走 steer 或提示，绝不并发开第二个 run（防重复的地基）。
   */
  async startRun(canvasId: string, input: StartRunInput): Promise<{ started: boolean; sessionId?: string }> {
    const hub = this.deps.hub
    if (!hub) throw new Error('startRun 需要注入 hub（托管模式）；否则请用 run()')
    /**
     * 装载窗口的「停」要记住（真机实测的洞，代码审查复核）。
     *
     * 登记**请求里带的**会话 id（装载后 id 可能因 resume 兜底而变，见下面的搬移）；
     * 记下当时的终止世代号，装载完再比一次 —— 变了就说明这期间有人点过停止。
     * 没有 id（首条消息要新建会话）时登记不了：那种请求调用方自己也不知道 id，
     * 物理上没法在中途停它（前端 send 也总是先建好会话才把按钮变停止）。
     */
    const requestKey = input.sessionId ? this.key(canvasId, input.sessionId) : null
    const epochBefore = requestKey ? this.epochOf(requestKey) : 0
    // 先解析会话 id（与 run() 同一条路径：可能有 sessionId、也可能要新建）
    const probe = await this.ensureSession(canvasId, {
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      title: input.text,
      prefs: mergeMarkupPrefs(input.prefs, input.text),
    })
    /**
     * 装载期间有人点过停止 ⇒ 不跑（这一轮从未开始）。
     * 只比**请求里的那个 key**：客户端只认识它，abort 也只会把它推高
     *（会话 id 若因 resume 兜底换了，换代仍记在请求的这个 key 上）。
     */
    if (requestKey && this.epochOf(requestKey) !== epochBefore) return { started: false, sessionId: probe.id }
    if (hub.isRunning(canvasId, probe.id)) return { started: false, sessionId: probe.id }
    // 后台跑：hub.start 会消费生成器；这里不 await（HTTP 不等它）。
    /**
     * 「已经在跑」是并发发送（不是错误）：那一轮跑完由队列接手，不能通知调度器
     * 「刚跑完」—— 那会让调度器以为可以立刻发下一条，而其实还在跑。
     * 只有**真正开跑**的那一次才在结束时通知 onRunFinished。
     */
    const started = hub.start(canvasId, probe.id, {
      run: (signal) => this.run(canvasId, { ...input, sessionId: probe.id }, signal),
    })
    void started
      .then(() => {
        // 一轮彻底结束（hub 的 running 已清）之后才通知队列调度器 ——
        // 顺序至关重要：早一步通知，调度器会看到"还在跑"而拒绝发下一条（队列就卡住了）。
        try {
          this.deps.onRunFinished?.(canvasId, probe.id)
        } catch (err) {
          this.log('onRunFinished threw', { session: probe.id, err: err instanceof Error ? err.message : String(err) })
        }
      })
      .catch((err) => {
        this.log('managed run failed', { session: probe.id, err: err instanceof Error ? err.message : String(err) })
      })
    return { started: true, sessionId: probe.id }
  }

  /** 当前挂起的审批（界面渲染审批卡片用） */
  pendingApprovals(canvasId: string, sessionId: string): PendingApproval[] {
    const entry = this.live.get(this.key(canvasId, sessionId))
    return entry ? [...entry.pendingInfo.values()] : []
  }

  /** 压缩是否正在进行（switch-model 等需要 Task 边界的动作据此拒绝） */
  isCompactActive(canvasId: string, sessionId: string): boolean {
    return this.live.get(this.key(canvasId, sessionId))?.compacting ?? false
  }

  /**
   * 用户主动压缩上下文（「压缩」命令）。
   *
   * 三个前置条件，缺一条都**如实拒绝**（不静默 no-op）：
   *   1. 会话在内存里（先 ensureSession 装载 —— 服务重启后第一条命令也能用）；
   *   2. 现在没在跑（SDK 原话：只有 Task 边界能压；跑着时压会把正在写的一轮搅乱）；
   *   3. SDK 的 compactability() 说 ok（unsupported / empty / just_compacted 各有各的话说）。
   *
   * 返回的事件流由**调用方**（路由）转发给界面：它成对给出 compaction_begin / compaction_end。
   */
  async *compact(canvasId: string, sessionId: string, signal: AbortSignal): AsyncGenerator<AgentChatEvent> {
    if (this.isRunning(canvasId, sessionId)) {
      yield { type: 'error', message: '这一轮还在跑，等它结束再压缩' }
      return
    }
    let entry = this.live.get(this.key(canvasId, sessionId))
    if (!entry) {
      try {
        const resolved = await this.ensureSession(canvasId, { sessionId })
        entry = this.live.get(this.key(canvasId, resolved.id))
      } catch (err) {
        yield { type: 'error', message: '装载会话失败：' + (err instanceof Error ? err.message : String(err)) }
        return
      }
    }
    if (!entry?.session.compact) {
      yield { type: 'error', scope: 'compact', message: '这条会话不支持压缩' }
      return
    }
    /**
     * 从这里开始是**压缩窗口**：标记与 finally 必须成对，中间任何一条提前返回
     * 都不能把它漏掉 —— 漏了这条会话就永久拒绝 run()/切模型（code review 抓到的锁死）。
     * 所以「能不能压」的检查也放进 try 里，不再在标记之后裸 return。
     */
    entry.compacting = true
    try {
      const availability = entry.session.compactability?.() ?? 'ok'
      if (availability !== 'ok') {
        const why =
          availability === 'empty' ? '还没有对话内容，不用压缩'
          : availability === 'just_compacted' ? '刚压过（上下文已经干净），暂时不用再压'
          : '这条会话不支持压缩'
        yield { type: 'notice', message: why }
        return
      }
      for await (const msg of entry.session.compact({ signal })) {
        for (const ev of translateMessage(msg, entry.state, (m, extra) => this.log(m, extra))) {
          if (ev.type === 'usage') {
            // 压缩也是「这一轮的输出」：usage 里的上下文用量要更新缓存值，
            // 否则压缩刚把上下文清空、界面上的剩余百分比还停在压之前那个数。
            entry.contextLeft = contextLeftPercent(ev.usedTokens, ev.limitTokens)
            // 并且**落盘**：不落盘的话刷新后环又回到压缩前的旧值（code review 抓到）。
            entry.lastUsageSavedAt = Date.now()
            void this.deps.store
              .setLastUsage(canvasId, entry.id, { usedTokens: ev.usedTokens, limitTokens: ev.limitTokens })
              .catch(() => undefined)
          }
          yield ev
        }
      }
    } catch (err) {
      // scope:'compact' 让错误落在压缩那条提示上，而不是当成某一轮对话失败
      yield { type: 'error', scope: 'compact', message: '压缩失败：' + (err instanceof Error ? err.message : String(err)) }
    } finally {
      // 中途抛错 / 调用方 abort / 提前 return 都要走到这里
      entry.compacting = false
    }
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
    const userMessages: unknown[] = await this.buildTurnMessages(input.text, input.images, input.harnessText)
    /**
     * 审批的推送通道（真机实测的洞）：
     * - HTTP 直连模式：路由层传 notify（写到那条响应流）—— 原行为；
     * - **托管模式**：没有 notify（队列自动发的那一轮前端根本没参与这次 HTTP），
     *   审批请求必须经 **hub** 推，否则永远挂起等一个界面看不见的卡片 ——
     *   表现就是"队列发出去之后整个对话就死了"（用户实测）。
     *   页面只要有常驻订阅（attachStream）就能收到卡片、点允许/拒绝。
     */
    const emitApproval = (event: AgentChatEvent): void => {
      if (notify) notify(event)
      else this.deps.hub?.append(canvasId, id, event)
    }

    // 已经有会话在跑：这一句当 steering 送进去，不并发开第二个 run。
    // 压缩进行中**不能**当 steering 送：compact 只在 Task 边界合法（SDK 原话），
    // 这时再喂 steering 等于两条模型请求并发 —— 拒绝并把消息退还（调用方按失败处理）。
    if (entry.compacting) {
      yield { type: 'error', message: '正在压缩上下文，等它结束再发消息' }
      return
    }
    if (entry.running) {
      const steered = entry.session.steer?.(userMessages) ?? false
      this.log('steered into running task', { session: id, steered })
      // 引导是**真的用户输入**：落转录（否则刷新后界面上会消失 —— 用户实测的旧洞）。
      // 落盘用 steer 标记，界面据此画"引导"小标（与普通消息区分）。
      if (steered) {
        await this.deps.store.appendTurn(canvasId, id, {
          role: 'user',
          text: input.text,
          ...(input.images?.length ? { images: input.images } : {}),
          steered: true,
          ts: Date.now(),
        })
      }
      yield { type: 'notice', message: steered ? '已作为补充指令发送给进行中的任务' : '任务正在执行中' }
      yield { type: 'done' }
      return
    }

    entry.running = true
    // 新的一代开始：generation 变大后就不再等于 stoppedGen ⇒ 上一轮按过的终止
    // 不会误拒这一轮的审批（见 LiveSession.generation 的说明）
    entry.generation += 1
    entry.abort = new AbortController()
    const own = entry.abort
    signal.addEventListener('abort', () => own.abort(), { once: true })
    const started = Date.now()
    let assistantText = ''
    try {
      yield { type: 'session', sessionId: id, title: '' }
      /**
       * 把"这一轮的用户消息"推给界面（真机实测的洞）。
       *
       * 为什么：用户自己点发送时，前端在本地就造好了用户气泡；但**队列自动发的**那一条
       * 前端完全没有参与 —— 只写转录、不推事件的话，界面上从头到尾没有这条消息的
       * 用户气泡，看起来就是"AI 对着空气说话"（用户实测截图）。
       * 前端会做去重（本地已有同文本的末条用户消息就不重复造）。
       */
      // 没有人类正文、也没有图（目标 resume 时只发 harness 协议块）就不造气泡、
      // 不落用户回合 —— 否则转录与界面里会多出一条空白的用户消息。
      //
      // **纯图消息必须落盘**（回归审计发现的洞）：条件写成 `if (input.text)` 时，
      // 「只发图不打字」那一条整条不进转录 ⇒ ①刷新后用户消息凭空消失（界面只剩 AI
      // 的回答，等于把图丢了）；②队列里的纯图条目在对账时被判定「没送达」⇒ 退回 queued
      // ⇒ 再发一遍 ⇒ 跑完再退回 ⇒ **无限重发同一条**（见 queueScheduler 的 settleAsync）。
      if (input.text || input.images?.length) {
        yield {
          type: 'user_message',
          text: input.text,
          ...(input.images?.length ? { images: input.images } : {}),
        }
        await this.deps.store.appendTurn(canvasId, id, {
          role: 'user',
          // 转录里存 **XML 原文**（用户口径 2026-10-08：标记改用 <ref …>，字段自带完整信息）：
          // 「编辑回填」靠它把引用还原成输入框的 chip 标签（此前降级成 @名字，回填后标签就丢了）。
          // 气泡展示时由组件把它解析成 tag 段，不会把 XML 串直接显示出来。
          text: input.text,
          // 图一起落转录：否则刷新 / 切会话后只剩一句文字，用户以为图丢了
          ...(input.images?.length ? { images: input.images } : {}),
          ts: Date.now(),
        })
      }
      const approve = async (toolCall: unknown): Promise<'allow' | 'deny'> => {
        const payload = (toolCall as { payload?: Record<string, unknown> })?.payload ?? {}
        const name = String(payload.name ?? '')
        // 这一代已经被终止 ⇒ 一律拒（用户点了停止之后不该再有工具被放行开跑；
        // 见 LiveSession.generation 的说明）
        if (this.stoppedNow(entry)) return 'deny'
        // 用**实时**策略：用户在设置里改了规则列表，应当下一句就生效，
        // 而不是等新会话（规则列表页的名字就叫「监听并设置哪些工具需要审批」）。
        const decision = decideTool(entry.policyOverridden ? entry.policy : this.policy, name)
        this.log('tool decision', { tool: name, decision })
        if (decision !== 'ask') return 'allow'
        // 需要询问：挂起，把卡片推给界面，等用户点允许 / 拒绝
        const approvalId = 'ap-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
        // 工具调用 id 用 SDK 的**真字段** tool_call_id（此前读的是 payload.id —— 它不存在，
        // 于下面的 patchTool(card:true) 永远不执行：刷新后命中审批的工具会缩成一行，
        // 与刚才看到的卡片样式对不上）。translate.ts 用的也是这个字段。
        const callId = String((payload as { tool_call_id?: unknown }).tool_call_id ?? '')
        const info: PendingApproval = {
          id: approvalId,
          toolName: name,
          arguments: typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments ?? null),
          createdAt: Date.now(),
          ...(callId ? { toolCallId: callId } : {}),
        }
        entry.pendingInfo.set(approvalId, info)
        const answer = new Promise<'allow' | 'deny'>((resolve) => entry.pending.set(approvalId, resolve))
        /**
         * 这里**不再**给工具打 `card: true`（用户口径 2026-10-10）。
         *
         * 早先的用意是「要审批的工具显示成卡片、更显眼」，但它把底层工具（exec_command /
         * read_file 这类默认工具）从**折叠行**顶成了常驻展开的卡片：折叠箭头没了、输入输出
         * 一直摊着。而审批本来就有一套**独立的卡片 UI**（.ac-approval，等你点允许/拒绝），
         * 不需要再改底层工具的样子。用户口径：除了自带卡片的画布 MCP 工具与审批卡，
         * 其余一律走默认折叠行。
         *
         * callId 仍要留着：界面靠它把「审批卡片」与它那条工具调用对上（见 toolCallId）。
         */
        emitApproval({ type: 'approval_request', approval: info })
        const result = await answer
        /**
         * 等到用户答复之后再检查一次「已终止」：allow 可能与终止几乎同时到达，
         * 这一拍把它翻成 deny —— 缩小「点了终止、命令还是跑了一下」的窗口。
         */
        const final = this.stoppedNow(entry) ? 'deny' : result
        emitApproval({ type: 'approval_result', id: approvalId, decision: final })
        return final
      }

      for await (const msg of entry.session.run(userMessages, { signal: own.signal, approve })) {
        for (const ev of translateMessage(msg, entry.state, (m, extra) => this.log(m, extra))) {
          // 目标轮次边界（stop hook 每轮跑一次）：让 gooalRuntime 读一次 GOAL.json 推 goal_state，
          // 否则「第 N 轮 / 已用」只在整轮 run 结束时才更新（真机：3 → 7 跳号）。
          if (ev.type === 'goal_round') {
            this.deps.onGoalRound?.(canvasId, id)
            continue
          }
          if (ev.type === 'usage') {
            entry.contextLeft = contextLeftPercent(ev.usedTokens, ev.limitTokens)
            // 落盘（节流）：刷新 / 切会话后界面靠它把上下文指示器画回来 ——
            // usage 不在转录里、重连也不重放，不落盘就等于"一刷新就消失"（用户报的问题 1）。
            // 一轮里会来十几次，只写最新那份，2 秒内的重复写丢掉（代价可控、信息等价）。
            const now = Date.now()
            if (now - entry.lastUsageSavedAt > 2000) {
              entry.lastUsageSavedAt = now
              void this.deps.store
                .setLastUsage(canvasId, id, { usedTokens: ev.usedTokens, limitTokens: ev.limitTokens })
                .catch(() => undefined)
            }
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
      // 会话命名**全部放到后台异步**：起名（AI 调用可能要几秒）不该卡在响应流上 ——
      // 卡在流上会让前端在「生成完成」之后还多等一段（加载态被拉长，用户实测）。
      // 先落一个**即时**的「首句截断」名字（保证列表任何时候都可读），AI 起名在后台跑，
      // 跑完直接改名落盘 —— 前端下次拉会话列表自然看到新名字。
      await this.maybeAutoTitle(canvasId, id, input.text)
      this.spawnBackgroundTitle(canvasId, id, input.text)
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

  /**
   * 组装这一轮的完整输入：用户消息（+图）+ 可选的 **harness 注入块**。
   *
   * harness 块必须是一条**独立**的用户消息并带 sender 戳：SDK 的 goal stop hook
   * 以它划轮次边界（`isRoundInput`）。拼进用户正文里就没有边界，
   * 记账会退化成「整份 trace = 一轮」—— 历史里的 abort 会让目标每轮判 aborted
   * （真机实测：有历史 abort 的会话目标永远停在第 1 轮）。
   */
  private async buildTurnMessages(
    text: string,
    images: string[] | undefined,
    harnessText: string | undefined,
  ): Promise<unknown[]> {
    const messages = await this.buildUserMessages(text, images)
    if (harnessText && this.deps.makeHarnessMessage) messages.push(this.deps.makeHarnessMessage(harnessText))
    else if (harnessText) messages.push(harnessText) // 假宿主兜底：没注入构造器时退化成纯文本块
    return messages
  }

  /** 首轮之后把会话名从「新会话」改成首句（列表里看得懂） */
  private async maybeAutoTitle(canvasId: string, sessionId: string, firstText: string): Promise<void> {
    const record = await this.deps.store.get(canvasId, sessionId)
    if (!record || record.title !== '新会话') return
    // 标题要**人类可读**：先剥掉引用标记（`@[node:图片 4](画布#节点)` → `@图片 4`）再截断 ——
    // 直接截原文会把 `@[node:图片 4](430c8f1f00b…` 这种机器串截进标题里（历史列表一片机器码，用户实测）。
    // 截断公式**只有这一份**（immediateTitleOf）—— 落盘名与「是否已被用户改过」的判定必须恰等，
    // 两份公式一改一留，AI 起名的覆盖判定就永远不成立（审查发现）。
    const title = immediateTitleOf(firstText)
    if (title) await this.deps.store.rename(canvasId, sessionId, title)
  }

  /**
   * **后台自动起名**（纯后台服务，不占对话流）。
   *
   * 用户口径（2026-10-06）：AI 起名不要显示加载状态 —— 那几秒的模型调用不该让前端
   * 在对话完成后还转圈。做法：本轮响应结束、即时名字落盘之后，把 AI 起名丢进后台跑；
   * 跑完直接 rename 落盘。前端「生成中」的加载态只覆盖对话本身，**感知不到**这次改名。
   *
   * 只在「即时名还是首句截断」时才起名（用户手动改过名字就不覆盖）；
   * 失败静默（保留即时名）；异常兜住不留悬挂 Promise。
   */
  private spawnBackgroundTitle(canvasId: string, sessionId: string, firstText: string): void {
    void (async () => {
      try {
        const record = await this.deps.store.get(canvasId, sessionId)
        // 名字已被用户改过（不是即时名）→ 不覆盖
        if (!record) return
        const immediate = immediateTitleOf(firstText)
        if (record.title !== immediate) return
        const generated = await this.deps.generateTitle?.(immediate)
        if (!generated) return
        // 再查一次：起名的这几秒里用户可能改了名 / 开了新一轮
        const cur = await this.deps.store.get(canvasId, sessionId)
        if (!cur || cur.title !== immediate) return
        await this.deps.store.rename(canvasId, sessionId, generated)
        this.log('session renamed by title model', { session: sessionId, title: generated })
      } catch (err) {
        // 后台起名失败不算事：保留即时名
        this.log('background title failed', { session: sessionId, err: err instanceof Error ? err.message : String(err) })
      }
    })()
  }

  /** 中止当前轮：会话本身留着（用户只是停下，不是删掉） */
  abort(canvasId: string, sessionId: string): void {
    const key = this.key(canvasId, sessionId)
    // 装载还没完成就点了停止：hub 与 entry 都还没就位，谁都没法接这个「停」。
    // 把该会话的终止世代号推高 —— 正在装载的 startRun 装载完会比一次，看到变了就不跑
    //（不推的话那一轮装载完会照跑到底，真机实测的洞，见 startRun）。
    this.abortEpoch.set(key, this.epochOf(key) + 1)
    const entry = this.live.get(key)
    if (!entry) return
    /**
     * 标记「**当时正在跑的那一代**已终止」。approve 的回调进入与返回前各查一次，
     * 避免终止与允许撞车时还把工具放行（见 LiveSession.stoppedGen 的说明）。
     * 用 generation 而不是布尔位：新的一代一开跑 generation 就不再等于它，
     * 终止不会顺着流传到下一轮（否则「上一轮按过终止 ⇒ 下一轮审批全被静默拒」）。
     */
    entry.stoppedGen = entry.generation
    entry.abort?.abort()
    /**
     * 挂着的审批必须一起解开（真机实测的洞）。
     *
     * 审批是 SDK 在 await 中途回调我们、由**我们**握住的那个 promise（见 approve）。
     * 只 abort 信号，SDK 可能根本没在听（它正卡在等这张卡片），run() 的循环于是永远
     * 出不来，finally 也跑不到 —— 这一轮就"停不住"：刷新后 running 恒为 true、
     * 输入框右下角按钮永远显示停止（用户实测）。按「拒绝」把它放行，循环才能收尾。
     */
    for (const [, resolve] of entry.pending) resolve('deny')
    entry.pending.clear()
    entry.pendingInfo.clear()
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
    const key = this.key(canvasId, sessionId)
    // 世代号也一起清：这套 Map 是按会话记的，删了会话不清就是长跑泄漏
    this.abortEpoch.delete(key)
    const entry = this.live.get(key)
    if (!entry) return
    entry.abort?.abort()
    for (const [, resolve] of entry.pending) resolve('deny')
    entry.pending.clear()
    entry.session.dispose?.()
    this.live.delete(key)
  }

  disposeAll(): void {
    for (const entry of this.live.values()) {
      entry.abort?.abort()
      for (const [, resolve] of entry.pending) resolve('deny')
      entry.pending.clear()
      entry.session.dispose?.()
    }
    this.live.clear()
    this.abortEpoch.clear()
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
