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
  | { type: 'usage'; usedTokens: number; limitTokens: number | null }
  | { type: 'approval_request'; approval: { id: string; toolName: string; arguments: string; createdAt: number } }
  | { type: 'approval_result'; id: string; decision: 'allow' | 'deny' }
  | { type: 'done' }

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
      const window = state.contextWindow
      // 模型窗口不知道时用压缩阈值兜底：含义仍是「到 0% 正好触发压缩」，
      // 比整个不显示更有用（用户点名要这个指示器）。
      const limit = Math.min(window ?? COMPACTION_MAX_CONTEXT_LENGTH, COMPACTION_MAX_CONTEXT_LENGTH)
      if (!Number.isFinite(used) || used <= 0) return []
      return [{ type: 'usage', usedTokens: used, limitTokens: limit }]
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
