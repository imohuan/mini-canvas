/**
 * useAgentChat —— 底栏「按选中的模型发一句给 Agent」的请求链路。
 *
 * 用户口径（2026-11-07）：
 * 「这个地方就相当于是发送 AI Agent 的请求，你可以把我的 Agent 配置里提供的这些模型，
 *   作为下拉菜单进行显示」。
 *
 * 与底栏原有的「AI 按钮」（翻译 / 提示词优化）共用同一套约定：
 * - 地址取 Agent 配置（resolveAgentBaseUrl），不另存一份；
 * - 走 `POST /api/agent/chat/completion`，OpenAI chunk 形状；
 * - 流式增量写回输入框，思考内容过滤掉；
 * - 失败退避重试，4xx 一次判死。
 *
 * 差别只有一个：这里**显式带 provider / model**，用用户在底栏选的那个模型，
 * 而不是后台的默认模型。
 */
import { ref, type Ref } from 'vue'
import { resolveAgentBaseUrl, DEFAULT_RETRY_ROUNDS, type AiRequestResult } from '../aiActions'
import { withAdminToken } from '@mini-canvas/canvas-base'
import { readAgentModels } from './modelPickerBridge'

export interface AgentChatDeps {
  ctx: { tryGet<T>(name: string): T | undefined }
  /** 输入框里的正文 */
  prompt: Ref<string>
  /** 写回正文（流式：每段增量调用一次） */
  onDelta: (text: string) => void
  /** 结束（成功或失败）后刷新一次节点数据 */
  onDone?: () => void
}

/** 底栏记住的模型选择（存进节点 data，跟着作品走） */
export interface BarModelChoice {
  provider: string
  modelId: string
}

/** 从节点 data 里读回上次选的模型（脏数据一律当作没选） */
export function readBarModelChoice(data: Record<string, unknown> | undefined): BarModelChoice | null {
  const raw = data?.barModel
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  const provider = typeof rec.provider === 'string' ? rec.provider.trim() : ''
  const modelId = typeof rec.modelId === 'string' ? rec.modelId.trim() : ''
  return provider && modelId ? { provider, modelId } : null
}

/** 选中的模型还在 Agent 的清单里吗（被删掉时回退到默认，别一直报错） */
export function choiceStillValid(choice: BarModelChoice | null, models: Array<{ provider: string; modelId: string }>): boolean {
  if (!choice) return false
  return models.some((m) => m.provider === choice.provider && m.modelId === choice.modelId)
}

/** 一次请求的选项 */
export interface AgentChatOptions {
  baseUrl?: string
  provider: string
  model: string
  /** 重试轮数（含第一次；缺省 3） */
  retryRounds?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  onDelta?: (delta: string) => void
  sleep?: (ms: number) => Promise<void>
}

const RETRY_BASE_MS = 400
const RETRY_MAX_MS = 4000

/** 服务端错误体 → 人话 */
async function readErrorBody(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string } | string }
    if (typeof data.error === 'string') return data.error
    if (data.error?.message) return data.error.message
  } catch {
    /* 非 JSON：退回状态码 */
  }
  return '请求失败（HTTP ' + res.status + '）'
}

/** 消费 SSE：只留正文，`reasoning_content`（思考）整段丢弃 */
async function consumeStream(
  body: ReadableStream<Uint8Array>,
  onDelta: ((delta: string) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let streamError = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data: '))
      if (!line) continue
      const payload = line.slice(6).trim()
      if (!payload || payload === '[DONE]') continue
      let parsed: {
        error?: { message?: string } | string
        choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown } }>
      }
      try {
        parsed = JSON.parse(payload)
      } catch {
        continue
      }
      if (parsed?.error) {
        streamError = typeof parsed.error === 'string' ? parsed.error : parsed.error.message ?? 'AI 返回错误'
        continue
      }
      const delta = parsed?.choices?.[0]?.delta
      if (!delta) continue
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) continue
      const piece = typeof delta.content === 'string' ? delta.content : ''
      if (!piece) continue
      full += piece
      onDelta?.(piece)
    }
    if (signal?.aborted) break
  }
  if (streamError) return { ok: false, error: streamError }
  if (!full.trim()) return { ok: false, error: '模型没有返回内容' }
  return { ok: true, text: full }
}

/**
 * 用指定模型发一次对话（流式 + 退避重试）。
 *
 * 与 requestAiText 的区别：body 里**带 model / provider**，
 * 因此不会落到后台的默认模型 —— 用户选的是哪个就发哪个。
 */
export async function requestAgentChat(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  opts: AgentChatOptions,
): Promise<AiRequestResult> {
  const rounds = Math.max(1, Math.floor(opts.retryRounds ?? DEFAULT_RETRY_ROUNDS))
  const f = opts.fetchImpl ?? (typeof fetch === 'undefined' ? undefined : fetch)
  if (!f) return { ok: false, error: '当前环境没有可用的 fetch', attempts: 0 }
  const base = (opts.baseUrl ?? '').replace(/\/+$/, '')
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let lastError = ''
  let attempt = 0
  for (;;) {
    attempt += 1
    if (opts.signal?.aborted) return { ok: false, error: '已取消', attempts: attempt - 1 }
    try {
      const res = await f(base + '/api/agent/chat/completion', {
        method: 'POST',
        headers: withAdminToken({ 'content-type': 'application/json', accept: 'text/event-stream' }),
        body: JSON.stringify({
          stream: true,
          // 用户选的模型：底栏下拉里的那一项
          provider: opts.provider,
          model: opts.model,
          messages,
        }),
        ...(opts.signal ? { signal: opts.signal } : {}),
      })
      if (!res.ok) {
        lastError = await readErrorBody(res)
        if (res.status < 500 && res.status !== 429) break
      } else if (res.body) {
        const r = await consumeStream(res.body, opts.onDelta, opts.signal)
        if (r.ok) return { ok: true, text: r.text, attempts: attempt }
        lastError = r.error
      } else {
        lastError = '响应没有内容'
      }
    } catch (err) {
      if (opts.signal?.aborted) return { ok: false, error: '已取消', attempts: attempt }
      lastError = err instanceof Error ? err.message : String(err)
    }
    if (attempt >= rounds) break
    await sleep(Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempt - 1)))
  }
  return { ok: false, error: lastError || 'AI 请求失败', attempts: attempt }
}

/**
 * 底栏用的一层包装：模型选择 + 运行状态 + 流式写回。
 *
 * 为什么要这一层而不是各组件直接调 requestAgentChat：
 * 「有没有选模型 / 正在跑 / 上次的错误」这几样状态要在多个组件之间共享，
 * 收在一个 composable 里才不会各存一份。
 */
export function useAgentChat(deps: AgentChatDeps) {
  const running = ref(false)
  const error = ref('')
  const choice = ref<BarModelChoice | null>(null)
  let abort: AbortController | null = null

  /** 从上下文里取 Agent 的模型清单（Agent 没装时为空） */
  function availableModels() {
    return readAgentModels(deps.ctx).models
  }

  /** 选模型：只记住，不触发请求（请求在点发送时） */
  function pick(m: BarModelChoice): void {
    choice.value = { provider: m.provider, modelId: m.modelId }
    error.value = ''
  }

  /** 是否具备发送条件：选了模型 + 有正文 + 没在跑 */
  function canSend(): boolean {
    return Boolean(choice.value) && deps.prompt.value.trim() !== '' && !running.value
  }

  async function send(): Promise<AiRequestResult> {
    if (!canSend()) return { ok: false, error: '还没有选模型或输入为空', attempts: 0 }
    const picked = choice.value!
    const base = resolveAgentBaseUrl(deps.ctx as never)
    abort = new AbortController()
    running.value = true
    error.value = ''
    let acc = ''
    try {
      const res = await requestAgentChat(
        [{ role: 'user', content: deps.prompt.value }],
        {
          baseUrl: base,
          provider: picked.provider,
          model: picked.modelId,
          signal: abort.signal,
          onDelta: (piece) => {
            acc += piece
            deps.onDelta(acc)
          },
        },
      )
      if (!res.ok) error.value = res.error
      return res
    } finally {
      running.value = false
      abort = null
      deps.onDone?.()
    }
  }

  /** 中途停止：只断开客户端，不删会话（这里本来就没有会话） */
  function stop(): void {
    abort?.abort()
    abort = null
    running.value = false
  }

  return { running, error, choice, pick, canSend, send, stop, availableModels }
}

