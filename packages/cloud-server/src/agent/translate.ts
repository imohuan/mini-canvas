/**
 * translate —— 把 SDK 的 OmniMessage 翻成前端能懂的事件（纯函数，可单测）。
 *
 * 三条从参考项目学来的口径：
 * 1. request_end.status === 'completed' 是成功，不该产出事件 —— 曾把 completed 当失败，
 *    于是每次正常回答后面都跟一条红字。
 * 2. partial_* 的 delta 是增量，完整块（text / thinking）是整块；两者都发，
 *    由前端按块去重（前端见 sessionModel）。
 * 3. 没见过的类型要出声（log），不能静默丢 —— 一条什么都不产出的流最难查。
 */
export type AgentChatEvent =
  | { type: 'session'; sessionId: string; title: string }
  | { type: 'text'; delta?: string; text?: string; partial?: boolean; final?: boolean }
  | { type: 'thinking'; delta?: string; text?: string; partial?: boolean; final?: boolean }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'tool_output'; id: string; output: string }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string }
  | {
      type: 'usage'
      /** 当前上下文用量（request.total）—— 顶部那个「剩余百分比」用它 */
      usedTokens: number
      limitTokens: number | null
      /**
       * **这次请求**花掉的 token（uncached input + output）。
       *
       * 为什么单独给（用户口径 2026-10-11）：目标的「已用」原先只在**每轮结束**由插件
       * 累加一次（写进 GOAL.json），所以一轮里发了多次请求数字也纹丝不动。
       * 带上每次请求的花费，界面就能实时往上加，轮末再由插件的记账对齐。
       * 公式与插件 lib.mjs 的 uncachedTokens 一致（total − cache_read），两边才对得上。
       */
      spent?: number
    }
  | {
      type: 'approval_request'
      /** toolCallId = SDK 的 tool_call_id（界面据此把卡片和它的工具调用对上） */
      approval: { id: string; toolName: string; arguments: string; createdAt: number; toolCallId?: string }
    }
  | { type: 'approval_result'; id: string; decision: 'allow' | 'deny' }
  | { type: 'done' }
  /**
   * 这条会话有没有一轮正在跑（托管模式专有，由 SessionHub 广播）。
   *
   * 为什么单独一个事件：队列在空闲时也会自动起轮，界面需要"什么时候开始"的权威信号；
   * 从 text/tool 事件推断会在"一轮还没产出任何内容"的窗口里失准。
   */
  | { type: 'run_state'; running: boolean }
  /** 队列变化快照（加/删/改/暂停后广播；界面据此刷新输入框上方的列表） */
  | { type: 'queue'; queue: unknown }
  /** 队列全部发完且会话空闲（通知用："队列已跑完"） */
  | { type: 'queue_idle' }
  /** 目标状态更新（每次读 GOAL.json 后推；界面显示「第 N 轮 · 已用 / 预算」） */
  | { type: 'goal_state'; goal: unknown }
  /** 一轮结束（通知时机之一；由 server 的 onRunFinished 广播） */
  | { type: 'round_done' }
  /**
   * 「目标轮次边界」信号（目标插件 stop hook 刚跑完）。
   * 为什么需要它：目标是在**一次 SDK run() 里连跑多轮**的（stop hook 循环），
   * 我们此前只在整轮 run 结束时读一次 GOAL.json ⇒ 中间几轮全被跳过（真机：从第 3 轮直接跳到第 7 轮）。
   * 这个标记由 translate 从 SDK 的 hook 事件里翻出来，runtime 收到后读一次 GOAL.json 推 goal_state。
   */
  | { type: 'goal_round' }
  /**
   * 这一轮喂给模型的**用户消息**（正文 + 可选的图 + 是否引导）。
   *
   * 为什么必须单独推一条（真机实测的洞）：用户自己点发送时，前端会先在本地造一个用户气泡；
   * 但**队列自动发的那一条**前端完全没参与 —— 后端只把它写进转录、不推事件，
   * 于是界面从头到尾没有这条消息的气泡，用户看到的是"AI 对着空气回答"
   * （用户实测截图：消息跑到了助手那一侧）。
   * 前端收到它时按"如果本地已有同文本的末条用户消息就不重复造"去重。
   */
  | { type: 'user_message'; text: string; images?: string[]; steered?: boolean }

type Log = (message: string, extra?: unknown) => void

export interface TranslateState {
  /** 该会话模型的上下文窗口（session_meta.model_context_window；拿不到时 null） */
  contextWindow: number | null
}

/** 造一份翻译状态（每个会话一份：窗口大小随会话固定） */
export function createTranslateState(): TranslateState {
  return { contextWindow: null }
}

/** 判断是不是模型消息（SDK 的 isModelMessage 等效实现；不 import 是为了可独立单测） */
function isModel(msg: unknown): boolean {
  return (msg as { type?: string } | undefined)?.type === 'model_msg'
}

/** 把 model_context_window 归一成数字（SDK 给的是 number | string） */
export function normalizeContextWindow(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  if (typeof raw === 'string') {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

/** 翻译一条 SDK 消息 */
export function translateMessage(msg: unknown, state: TranslateState, log?: Log): AgentChatEvent[] {
  const m = msg as { type?: string; payload?: Record<string, unknown> }
  const payload = (m?.payload ?? {}) as Record<string, unknown>

  if (m?.type === 'session_meta') {
    const sessionId = String(payload.session_id ?? '')
    state.contextWindow = normalizeContextWindow(payload.model_context_window)
    return sessionId ? [{ type: 'session', sessionId, title: '' }] : []
  }

  if (!isModel(msg)) return eventNotice(payload, state, log)

  const p = payload
  switch (p.type) {
    case 'partial_text':
      return p.event_type === 'delta' ? [{ type: 'text', delta: String(p.text ?? ''), partial: true }] : []
    case 'partial_thinking':
      return p.event_type === 'delta'
        ? [{ type: 'thinking', delta: String(p.thinking ?? ''), partial: true }]
        : []
    case 'text':
      // 非人类来源的用户文本（harness / server / parent_agent 注入）**不是助手说的话**：
      // 目标模式的协议文本就带 sender:'harness'，原样翻成助手 text 会让转录和界面里
      // 夹进一长串「This message was sent automatically by goal mode…」（真机实测）。
      // 这类消息模型照样读得到（它在 SDK 的上下文里），只是不该进对话流给用户看。
      if (p.role === 'user' && p.sender !== undefined) return []
      return [{ type: 'text', text: String(p.text ?? ''), final: true }]
    case 'thinking':
      return [{ type: 'thinking', text: String(p.thinking ?? ''), final: true }]
    case 'tool_call':
      return [
        {
          type: 'tool_call',
          id: String(p.tool_call_id ?? ''),
          name: String(p.name ?? ''),
          arguments: typeof p.arguments === 'string' ? p.arguments : JSON.stringify(p.arguments ?? null),
        },
      ]
    case 'tool_call_output':
      return [{ type: 'tool_output', id: String(p.tool_call_id ?? ''), output: String(p.output ?? '') }]
    case 'partial_tool_call':
    case 'partial_tool_call_output':
      return []
    default:
      // 不静默：没见过的模型消息类型要留下痕迹
      log?.('unhandled model payload type', { type: p.type })
      return []
  }
}

/**
 * 把 SDK 的事件消息翻成给用户看的提示 / 用量。
 *
 * request_end.status 用共享的 StopReason 词表（completed | aborted | retryable | fatal）；
 * completed 是成功、aborted 是用户按了停止 —— 两者都不必说话。
 */
function eventNotice(p: Record<string, unknown>, state: TranslateState, log?: Log): AgentChatEvent[] {
  switch (p.type) {
    case 'token_usage': {
      // 当前上下文用量就在 request.total（SDK 注释原话：current context usage figure）。
      // 分母取「模型窗口」与「压缩阈值」里的小者：压缩一到旧内容就被摘要，
      // 所以到 0% 正好是它要压缩的那一刻，对用户比模型窗口更有意义。
      const request = (p.request ?? {}) as Record<string, unknown>
      const used = Number(request.total ?? 0)
      /**
       * 这次请求的**实际花费**：与 goal 插件 lib.mjs 的 uncachedTokens 同一公式
       *（total − cache_read）—— 两边同口径，「界面实时加的数」与「插件轮末记的数」才一致。
       */
      const spentRaw = used - Number(request.cache_read ?? 0)
      const spent = Number.isFinite(spentRaw) && spentRaw > 0 ? Math.round(spentRaw) : 0
      const window = state.contextWindow
      // 模型窗口不知道时用压缩阈值兜底：含义仍是「到 0% 正好触发压缩」，
      // 比整个不显示更有用（用户点名要这个指示器）。
      const limit = Math.min(window ?? COMPACTION_MAX_CONTEXT_LENGTH, COMPACTION_MAX_CONTEXT_LENGTH)
      if (!Number.isFinite(used) || used <= 0) return []
      return [{ type: 'usage', usedTokens: used, limitTokens: limit, spent }]
    }
    case 'mcp_connect_end': {
      const results = Array.isArray(p.results) ? (p.results as Array<Record<string, unknown>>) : []
      const failed = results.filter((r) => String(r.status) !== 'completed')
      if (failed.length) {
        return [
          {
            type: 'error',
            message:
              'MCP 连接失败：' +
              failed.map((r) => String(r.server ?? '') + ' — ' + String(r.error ?? r.status ?? '')).join('；'),
          },
        ]
      }
      const ok = results.map((r) => String(r.server ?? '') + '(' + String(r.tools ?? 0) + ' 个工具)').join('、')
      return ok ? [{ type: 'notice', message: '已连接 MCP：' + ok }] : []
    }
    case 'request_end': {
      const status = String(p.status ?? '')
      if (status === 'completed' || status === 'aborted') return []
      const code = String(p.error_code ?? '')
      const detail = String(p.error_message ?? '')
      if (code === 'network' && /Invalid URL/i.test(detail)) {
        return [
          {
            type: 'error',
            message:
              '模型请求的地址无效（Invalid URL）。多半是模型设置里的 Base URL 填错了 —— ' +
              '它必须是完整地址（例如 http://127.0.0.1:3000/v1），而不是模型名。',
          },
        ]
      }
      return [
        {
          type: status === 'fatal' ? 'error' : 'notice',
          message:
            status === 'fatal'
              ? '模型请求失败：' + (detail || code || status) + '（不会重试，需要先改配置）'
              : '模型请求失败：' + (detail || code || status),
        },
      ]
    }
    case 'abort':
      return []
    case 'hook': {
      // 目标插件的 stop hook 每轮结束都会跑一次 —— 这是**轮次边界**。
      // 原生翻成 goal_round（不带数据）：runtime 收到后读 GOAL.json 推 goal_state（见类型注释）。
      if (p.hook === 'stop' && p.name === 'goal') return [{ type: 'goal_round' }]
      return []
    }
    default:
      log?.('non-model message', { type: p.type })
      return []
  }
}

/** 压缩阈值默认值（SDK 的 compaction.max_context_length 默认 256000） */
export const COMPACTION_MAX_CONTEXT_LENGTH = 256_000

/** 由用量与上限算剩余百分比（0-100）；算不出来返回 null（界面就不显示这一项） */
export function contextLeftPercent(used: number, limit: number | null): number | null {
  if (limit === null || !Number.isFinite(limit) || limit <= 0) return null
  const left = Math.round((1 - used / limit) * 100)
  return Math.max(0, Math.min(100, left))
}
