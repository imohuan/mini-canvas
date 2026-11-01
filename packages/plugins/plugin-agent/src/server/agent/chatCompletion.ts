/**
 * agentChat —— **单轮对话**（就是那个「中转」接口，形状照抄 OpenAI 的 /v1/chat/completions）。
 *
 * ## 它是什么
 *
 * 给 messages，回一段回答。**不建会话、不建文件夹、不写任何记录、不进会话列表。**
 * 这就是用户要的"一次对话"——像调一个模型 API，而不是跟一个 Agent 聊天。
 *
 * ## 为什么用 SDK 的裸模型（GenerativeModel）而不是 Agent/Session
 *
 * 走 Agent 那条路，每一轮都会在磁盘上多出一个会话目录（配置、转录、trace 一整套），
 * 而这里要的只是"问一句、答一句"。SDK 自己也有这个用法 —— 它内部的 `createBareLLM()`
 * 就是 `new GenerativeModel({ tools: [], thinkingLevel: "none", … })`，
 * 用来干"不需要工具的轻活"。我们照这个形状来：
 *
 *   · **tools: []**        —— 不给任何工具（要工具的场景走 Agent 那条链）
 *   · **thinkingLevel: none** —— 不思考，最快
 *   · 模型对象是**纯内存**的：没有 agentDir / session / trace
 *
 * 凭据从**用户已经配好的 provider** 里取（`agentConfig.resolveModel`），
 * 所以不用为它单独建一份配置，也不用建会话文件夹。
 *
 * ## 重试：SDK 给状态，重连是我们的活
 *
 * SDK 的流式生成是**单次尝试、内部不重试**，跑完把终态作为返回值交出来
 * （`LLMOutcome.status`）：`completed` / `aborted` / `retryable` / `fatal`。
 * 所以退避重连得这里做，判据就是它给的那套 —— 不自己猜：
 *
 *   · `retryable`（网络断、超时、408/429/5xx、流截断、以及它认不出的错）→ 退避后重试
 *   · `fatal`（provider 4xx、密钥错、参数非法）→ **不重试**，直接把错误交出去
 *     （同样的请求重试一百次也不会成功，只会把可读的报错拖成超时）
 *
 * ## 支持哪些参数
 *
 * 按用户的说法：「它这边支持的一些参数，你这边也就支持」——
 * 所以 request 形状直接对着 OpenAI 那份抄：`messages` / `model` / `stream` /
 * `temperature` / `max_tokens`（含 camelCase 写法）。
 * **不支持**的（`tools` / `n` / `stop` / `logprobs` 之类）**明确报错**，不静默忽略 ——
 * 静默忽略的坏处是调用方以为参数生效了。
 */
import type { AgentConfigService } from './config.js'

/** 一条消息（OpenAI 形状的子集：system / user / assistant，内容可以是字符串或分片数组） */
export interface ChatMessageInput {
  role: string
  content: string | Array<{ type?: string; text?: string; image_url?: { url?: string } | string }>
}

/** 本模块要用的模型客户端形状（SDK 的 GenerativeModel 满足它；这样单测能注入假的） */
export interface BareLLM {
  streamGenerate(parameters: {
    newMessages: unknown[]
    signal?: AbortSignal
    thinkingLevel?: string
  }): AsyncGenerator<unknown, { status: string; errorMessage?: string }, void>
}

/** 建一个裸模型（真的实现里 new SDK 的 GenerativeModel；单测里给假的） */
export type BareLLMFactory = (cfg: {
  modelId: string
  apiKey?: string
  baseUrl?: string
  clientType?: string
  contextWindow?: number
  systemPrompt?: string
  maxTokens?: number
}) => BareLLM

/** 一次单轮对话的入参（已归一化；见 normalizeChatRequest） */
export interface ChatCompletionInput {
  messages: ChatMessageInput[]
  /** 要哪个模型（provider 可选，不传就按模型名找；都不传用项目默认） */
  provider?: string
  model?: string
  stream: boolean
  maxTokens?: number
  /** 幂等/排查用，会回显在响应里（OpenAI 也有这个字段） */
  user?: string
}

/** 归一化的结果：要么能用，要么给一句能照做的错 */
export type NormalizeResult =
  | { ok: true; value: ChatCompletionInput }
  | { ok: false; error: string; param?: string }

/** 明确不支持的参数（静默忽略比报错更坏：调用方会以为生效了） */
const UNSUPPORTED = [
  'tools',
  'tool_choice',
  'functions',
  'function_call',
  'n',
  'stop',
  'logprobs',
  'top_logprobs',
  // temperature：SDK 的 GenerativeModelConfig **没有这一项**（不给每次请求的温度开关）。
  // 「它支持我就支持」⇒ 它不支持我就**明说**，而不是收下参数却什么都不做 ——
  // 那是最坏的一种：调用方以为温度生效了，排查半天。
  'temperature',
]

/**
 * 把请求体归一化成 ChatCompletionInput。
 *
 * 三条：
 * 1. 形状不对（没有 messages / 空数组 / role 不认识）→ 明确报错；
 * 2. **不支持 OpenRouter/OpenAI 的高级参数就明说**，别假装支持；
 * 3. temperature / max_tokens 两种写法都认（snake 与 camel，OpenAI 自己也是 snake）。
 */
export function normalizeChatRequest(body: unknown): NormalizeResult {
  if (!body || typeof body !== 'object') return { ok: false, error: '请求体必须是 JSON 对象' }
  const b = body as Record<string, unknown>

  for (const key of UNSUPPORTED) {
    if (b[key] !== undefined) {
      return { ok: false, error: '不支持参数 "' + key + '"（这个接口是单轮对话，不带工具）', param: key }
    }
  }

  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    return { ok: false, error: '缺少 messages（至少要有一条）', param: 'messages' }
  }
  const messages: ChatMessageInput[] = []
  for (const raw of b.messages) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'messages 里有一条不是对象', param: 'messages' }
    const m = raw as Record<string, unknown>
    const role = typeof m.role === 'string' ? m.role : ''
    if (!['system', 'user', 'assistant'].includes(role)) {
      return { ok: false, error: '不认识的 role：' + JSON.stringify(role) + '（只认 system / user / assistant）', param: 'messages' }
    }
    const content = m.content
    if (typeof content !== 'string' && !Array.isArray(content)) {
      return { ok: false, error: 'messages[' + messages.length + '].content 必须是字符串或分片数组', param: 'messages' }
    }
    messages.push({ role, content: content as ChatMessageInput['content'] })
  }

  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const maxTokens = num(b.max_tokens) ?? num(b.maxTokens)

  return {
    ok: true,
    value: {
      messages,
      ...(typeof b.provider === 'string' && b.provider ? { provider: b.provider } : {}),
      ...(typeof b.model === 'string' && b.model ? { model: b.model } : {}),
      // OpenAI 的默认是**非流式**（stream 不给就不流）—— 保持一致
      stream: b.stream === true,
      ...(maxTokens === undefined ? {} : { maxTokens }),
      ...(typeof b.user === 'string' && b.user ? { user: b.user } : {}),
    },
  }
}

/** 从消息里把"要发的内容"摊平成 SDK 认的形态（纯数据；SDK 的消息构造器由调用方注入） */
export interface FlattenedTurn {
  /** system 提示词（多条 system 用换行拼） */
  systemPrompt: string
  /** 用户文本（多段拼成一段 —— 裸模型一次只发一条 user 消息） */
  userText: string
  /** 图片地址（data URL 或同源地址） */
  images: string[]
}

/**
 * 摊平消息。
 *
 * 为什么"多轮"也要摊平：这个接口是**单轮**——它不维护历史。
 * 调用方把历史一起发过来，我们把它拼成**一段文本**交给模型（system 单独给），
 * 这样"带上下文问一句"也能用，而服务端**不存任何东西**。
 */
export function flattenTurn(messages: ChatMessageInput[]): FlattenedTurn {
  const systems: string[] = []
  const parts: string[] = []
  const images: string[] = []
  const textOf = (content: ChatMessageInput['content']): string => {
    if (typeof content === 'string') return content
    let out = ''
    for (const seg of content) {
      if (!seg || typeof seg !== 'object') continue
      if (typeof seg.text === 'string') out += seg.text
      const url = typeof seg.image_url === 'string' ? seg.image_url : seg.image_url?.url
      if (typeof url === 'string' && url) images.push(url)
    }
    return out
  }
  for (const m of messages) {
    const text = textOf(m.content)
    if (m.role === 'system') systems.push(text)
    else if (m.role === 'user') parts.push(text)
    else parts.push('[助手] ' + text)   // assistant 的历史片段：标一下，别和用户的话混在一起
  }
  return { systemPrompt: systems.join('\n\n'), userText: parts.join('\n\n'), images }
}

/**
 * 从 SDK 的一帧里取出 payload。
 *
 * ⚠️ **真实形状**（2026-10-13 拿真 SDK 打出来的，别再猜）：
 *   { timestamp, type: 'model_msg', payload: { type: 'partial_text', role: 'assistant',
 *     event_type: 'start' | 'delta' | 'stop', text: '…', stop_reason: 'completed' } }
 * **role 在 payload 里，不在外层** —— 第一版在外层找 role，于是永远取到空串；
 * 表现为"接口 200 了、回答是空的"（真机实测）。当时的测试用了个**编的形状**，所以没照到。
 */
function payloadOf(msg: unknown): Record<string, unknown> | undefined {
  if (!msg || typeof msg !== 'object') return undefined
  const m = msg as { type?: unknown; payload?: unknown }
  // ⚠️ 外层有两类：`model_msg`（正文/思考，在流里）与 `event_msg`（请求边界、**用量**等）。
  //    第一版只认 model_msg，于是**用量帧被整条跳过**（表现为 usage 全 0；
  //    2026-10-13 拿真 SDK 打出来才看见它是 event_msg）。
  if (m.type !== 'model_msg' && m.type !== 'event_msg') return undefined
  const p = m.payload
  return p && typeof p === 'object' ? (p as Record<string, unknown>) : undefined
}

/** 一帧里的**增量**文本（流式靠它才有"字一个个蹦"的效果） */
export function deltaOfMessage(msg: unknown): string {
  const p = payloadOf(msg)
  if (!p) return ''
  if (p.type !== 'partial_text' || p.event_type !== 'delta') return ''
  return typeof p.text === 'string' ? p.text : ''
}

/** 一帧里的**完整**正文（收尾帧；拿到了就以它为准，别再拼增量） */
export function finalTextOfMessage(msg: unknown): string | undefined {
  const p = payloadOf(msg)
  if (!p) return undefined
  if (p.type !== 'text') return undefined
  return typeof p.text === 'string' ? p.text : undefined
}

/**
 * 一帧里的 token 用量（SDK 单独推一帧；认不出就 undefined）。
 *
 * ⚠️ 名字也是拿真 SDK 打出来的：那帧是 `type: 'token_usage'`，用量在
 * `payload.request`（**本次请求**）与 `payload.session`（本会话累计）里 ——
 * 第一版猜的是 `payload.usage`，所以永远取到 undefined（表现为 usage 全 0）。
 */
export function usageOfMessage(msg: unknown): unknown {
  const p = payloadOf(msg)
  if (!p) return undefined
  if (p.type !== 'token_usage') return undefined
  return p.request ?? p.session ?? undefined
}

/** 重试策略：SDK 只给状态，退避由这层决定 */
export interface RetryPolicy {
  /** 最多试几次（含第一次） */
  attempts: number
  /** 退避基数（毫秒）：第 n 次失败后等 base * 2^(n-1) */
  baseMs: number
  /** 单次退避上限 */
  maxMs: number
}
export const DEFAULT_RETRY: RetryPolicy = { attempts: 3, baseMs: 600, maxMs: 8000 }

/** 第 n 次（1 基）失败后该等多久 */
export function backoffMs(attempt: number, policy: RetryPolicy = DEFAULT_RETRY): number {
  return Math.min(policy.maxMs, policy.baseMs * Math.pow(2, Math.max(0, attempt - 1)))
}

/** 跑一轮的结果 */
export interface CompleteOnceResult {
  text: string
  usage?: unknown
  status: string
  errorMessage?: string
  /** 实际试了几次（1 = 一次就成） */
  attempts: number
}

/** 依赖注入（单测用它塞假的模型与假时钟） */
export interface CompleteDeps {
  config: Pick<AgentConfigService, 'resolveModel'>
  makeLLM: BareLLMFactory
  /** 造 SDK 的消息（userText / imageUrlMessage）—— 由调用方注入，保持本模块零 SDK 依赖 */
  buildMessages: (turn: FlattenedTurn) => unknown[]
  /** 读 usage（从 SDK 的消息里） */
  readUsage?: (msg: unknown) => unknown
  policy?: RetryPolicy
  sleep?: (ms: number) => Promise<void>
  /** 每次失败叫一下（流式那条路用它把"正在重试"推给客户端） */
  onRetry?: (info: { attempt: number; waitMs: number; errorMessage?: string }) => void
  /** 每个增量叫一下（流式那条路用它把字推给客户端） */
  onDelta?: (text: string) => void
  signal?: AbortSignal
}

/**
 * 跑一轮（含退避重试）。
 *
 * 返回**最终状态**：`completed` 才算成功；`fatal` / 用完次数后的 `retryable` 都原样交出去，
 * 由路由层翻成 HTTP 错误码 —— 这里不吞错。
 */
export async function completeOnce(
  input: { messages: ChatMessageInput[]; provider?: string; model?: string; maxTokens?: number },
  deps: CompleteDeps,
): Promise<CompleteOnceResult> {
  const policy = deps.policy ?? DEFAULT_RETRY
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  const resolved = await deps.config.resolveModel(input.provider, input.model)
  // ★ 点了名、但配置里没有这个模型 → **报错，别偷偷用默认的**。
  //   resolveModel 的口径是"没指定就用默认"，于是"指定了但找不到"会掉到默认那条，
  //   表现成"传个不存在的模型名也能答，只是答的不是那个模型"（2026-10-13 真机踩到：
  //   回显的是用户写的名字、实际用的是默认）。这种静默换模型最难查，所以挡住它。
  if (input.model && resolved.configured && resolved.modelId && resolved.modelId !== input.model) {
    return {
      text: '',
      status: 'fatal',
      errorMessage:
        '配置里没有模型 "' + input.model + '"（现在配的是 ' + resolved.modelId + '）。' +
        '去 「设置 → Agent → 模型」里加上它，或者把 model 换成已配好的。',
      attempts: 0,
    }
  }
  if (!resolved.configured) {
    return {
      text: '',
      status: 'fatal',
      errorMessage:
        '这个模型还没配好凭据（' + (resolved.provider ?? '?') + ' / ' + (resolved.modelId ?? '?') + '）。' +
        '去 「设置 → Agent → 模型」里填好 API Key，或者换一个已配好的模型。',
      attempts: 0,
    }
  }

  const turn = flattenTurn(input.messages)
  const llm = deps.makeLLM({
    modelId: resolved.modelId ?? '',
    ...(resolved.apiKey ? { apiKey: resolved.apiKey } : {}),
    ...(resolved.baseUrl ? { baseUrl: resolved.baseUrl } : {}),
    // ★ 协议一定要带上：别名模型（如 deepseek-auto）SDK 猜不出协议，会直接抛
    //   "xxx is not supported. Supported client types: …"（2026-10-13 真机踩到）
    ...(resolved.clientType ? { clientType: resolved.clientType } : {}),
    ...(resolved.contextWindow ? { contextWindow: resolved.contextWindow } : {}),
    ...(turn.systemPrompt ? { systemPrompt: turn.systemPrompt } : {}),
    ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
  })
  const newMessages = deps.buildMessages(turn)

  let last: CompleteOnceResult = { text: '', status: 'retryable', attempts: 0 }
  for (let attempt = 1; attempt <= policy.attempts; attempt++) {
    let text = ''
    let usage: unknown
    try {
      const gen = llm.streamGenerate({
        newMessages,
        ...(deps.signal ? { signal: deps.signal } : {}),
      })
      for (;;) {
        const step = await gen.next()
        if (step.done) {
          const outcome = step.value as { status?: string; errorMessage?: string } | undefined
          last = {
            text,
            ...(usage === undefined ? {} : { usage }),
            status: outcome?.status ?? 'completed',
            ...(outcome?.errorMessage ? { errorMessage: outcome.errorMessage } : {}),
            attempts: attempt,
          }
          break
        }
        // 增量帧拼出"边跑边看"的效果；**收尾那帧给的是完整正文**，用它把拼接结果覆盖掉
        // （两条路都可能有，信完整那一条；只拼增量会在某些 provider 上重复或漏字）
        text += deltaOfMessage(step.value)
        const u = deps.readUsage?.(step.value)
        if (u !== undefined) usage = u
        const final = finalTextOfMessage(step.value)
        if (final !== undefined) {
          text = final
        }
        deps.onDelta?.(deltaOfMessage(step.value))
      }
    } catch (err) {
      // 抛出来的（网络/解析）：按"可重试"处理 —— 与 SDK 对未归类错误的处置一致
      last = { text, status: 'retryable', errorMessage: err instanceof Error ? err.message : String(err), attempts: attempt }
    }

    if (last.status === 'completed' || last.status === 'aborted' || last.status === 'fatal') return last
    if (attempt >= policy.attempts) return last
    const waitMs = backoffMs(attempt, policy)
    deps.onRetry?.({ attempt, waitMs, ...(last.errorMessage ? { errorMessage: last.errorMessage } : {}) })
    await sleep(waitMs)
  }
  return last
}

