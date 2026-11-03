/**
 * AgentRuntime 的公开类型与内部会话状态。
 *
 * 从 runtime.ts 原样搬出；只含类型与常量，不含运行逻辑。
 */
import type { AgentChatEvent } from './translate.js'
import type { TranslateState } from './translate.js'
import type { ApprovalPolicy } from './approval.js'
import type { AgentSessionStore } from './sessionStore.js'

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
   * 取当前全部「插件加的系统提示词小节」（见 serverFramework/agent.ts）。
   *
   * 为什么是函数而不是快照：插件可以随时热装热卸，建会话那一刻现读才是最新的。
   * 不注入 = 老宿主 / 单测，退化成「没有插件小节」（行为与从前一致）。
   */
  promptSections?(): Array<{ title: string; text: string }>
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

export interface LiveSession {
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

