/**
 * agentChatRoutes —— 单轮对话的 HTTP 面（**形状照抄 OpenAI 的 /v1/chat/completions**）。
 *
 *   POST /api/agent/chat/completion
 *     { model?, provider?, messages: [{role, content}], stream?, max_tokens? }
 *     · stream 不给 / false → 一次性回 {`{ ... }`}（OpenAI 那个非流式形状）
 *     · stream: true      → SSE，一帧一个 `data: {...}`（chat.completion.chunk 形状），
 *                            最后一帧后跟 `data: [DONE]`
 *
 * ## 路径为什么是 /api/agent/...（单数）
 *
 * 与旁边那族**统一用单数**（用户 2026-10-13 口径：统一用 `/api/agent`）。
 * 那一族是**配置与会话**（模型、技能、MCP、会话、队列…），
 * 这条是"模型直连"——**不建会话、不进列表、不留痕迹**。
 * 怎么一眼分辨：看路径里有没有 `/sessions/` —— 有会话的是多轮，这条没有。
 *
 * ## 为什么不复用 Agent/Session
 *
 * 走 Agent 每一轮都会在磁盘上多出一个会话目录（配置 + 转录 + trace）。而这个接口的语义是
 * "问一句、答一句"，那些记录纯属多余 —— 见 chatCompletion.ts 文件头的说明。
 */
import { Hono } from 'hono'
import type { AgentConfigService } from '../agent/config.js'
import {
  completeOnce,
  flattenTurn,
  normalizeChatRequest,
  type ChatMessageInput,
  type CompleteOnceResult,
  type RetryPolicy,
} from '../agent/chatCompletion.js'

/** 一次请求的 id（回显给调用方，便于对日志；OpenAI 也有这个字段） */
function requestId(): string {
  const bytes = globalThis.crypto?.getRandomValues?.(new Uint8Array(12))
  const hex = bytes ? Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') : String(Date.now())
  return 'chatcmpl-' + hex
}

/** 把 SDK 的 usage 形状翻成 OpenAI 那三个数（认不出就给 0，不编） */
function usageOf(u: unknown): { prompt_tokens: number; completion_tokens: number; total_tokens: number } {
  const o = (u ?? {}) as Record<string, unknown>
  const pick = (...keys: string[]): number => {
    for (const k of keys) if (typeof o[k] === 'number' && Number.isFinite(o[k])) return o[k] as number
    return 0
  }
  // 名字照真 SDK 打出来的抄（别再猜）：{ cache_read, cache_write, output, total }
  // —— 没有单独的"输入"字段，所以输入 = total - output 反推（反推不出来就 0）。
  const completion = pick('output', 'outputTokens', 'output_tokens', 'completion_tokens', 'completionTokens')
  const total = pick('total', 'totalTokens', 'total_tokens') || completion
  const explicitInput = pick('inputTokens', 'input_tokens', 'prompt_tokens', 'promptTokens')
  const prompt = explicitInput || Math.max(0, total - completion)
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total || prompt + completion }
}

/** 一次调用的上下文（真实实现注入 SDK；单测注入假的） */
export interface ChatRunner {
  (
    input: { messages: ChatMessageInput[]; provider?: string; model?: string; maxTokens?: number },
    hooks: { signal?: AbortSignal; onDelta?: (text: string) => void; onRetry?: (info: { attempt: number; waitMs: number; errorMessage?: string }) => void },
  ): Promise<CompleteOnceResult>
}

export interface AgentChatRoutesOptions {
  config: AgentConfigService
  /** 真跑一轮的实现（生产：SDK 裸模型；单测：假的） */
  run: ChatRunner
  /** 重试策略（不给用默认：3 次 / 指数退避） */
  policy?: RetryPolicy
  /** 用户没传 model 时，回显哪个模型名（读一次项目默认；没有就省略） */
  defaultModel?: () => string | undefined
}

export function agentChatRoutes(opts: AgentChatRoutesOptions): Hono {
  const app = new Hono()

  app.post('/api/agent/chat/completion', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: { message: '请求体不是合法 JSON', type: 'invalid_request_error' } }, 400)
    }
    const norm = normalizeChatRequest(body)
    if (!norm.ok) {
      return c.json(
        { error: { message: norm.error, type: 'invalid_request_error', ...(norm.param ? { param: norm.param } : {}) } },
        400,
      )
    }
    const input = norm.value
    // 回显的模型名：用户没指定就回默认那个（OpenAI 也回显 model；空串会让调用方以为没生效）
    const shownModel = input.model ?? opts.defaultModel?.() ?? ''
    const id = requestId()
    const created = Math.floor(Date.now() / 1000)

    // 客户端断开 → 把信号传下去（SDK 会在流里收摊）
    const ac = new AbortController()
    c.req.raw?.signal?.addEventListener?.('abort', () => ac.abort(), { once: true })

    // ── 非流式：等完整结果，回 OpenAI 那个对象 ──
    if (!input.stream) {
      const r = await opts.run(input, { signal: ac.signal })
      if (r.status !== 'completed') {
        const code = r.status === 'fatal' ? 400 : 502
        return c.json(
          {
            error: {
              message: r.errorMessage || '对话失败',
              type: r.status === 'fatal' ? 'invalid_request_error' : 'upstream_error',
              attempts: r.attempts,
            },
          },
          code,
        )
      }
      return c.json({
        id,
        object: 'chat.completion',
        created,
        model: shownModel,
        choices: [{ index: 0, message: { role: 'assistant', content: r.text }, finish_reason: 'stop' }],
        usage: usageOf(r.usage),
        // 本实现自己的三个旁支信息（OpenAI 没有；放顶层不干扰标准字段）
        ...(r.attempts > 1 ? { attempts: r.attempts } : {}),
        ...(input.user ? { user: input.user } : {}),
      })
    }

    // ── 流式：一帧一个 delta，最后一帧 finish_reason + [DONE] ──
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder()
        let closed = false
        const push = (text: string): void => {
          if (closed) return
          try {
            controller.enqueue(enc.encode(text))
          } catch {
            closed = true
          }
        }
        const chunk = (delta: Record<string, unknown>, finish: string | null): void => {
          push(
            'data: ' +
              JSON.stringify({
                id,
                object: 'chat.completion.chunk',
                created,
                model: shownModel,
                choices: [{ index: 0, delta, finish_reason: finish }],
              }) +
              '\n\n',
          )
        }
        void (async () => {
          try {
            // 先回一帧 role（与 OpenAI 的首帧一致，客户端据此开始拼）
            chunk({ role: 'assistant' }, null)
            const r = await opts.run(input, {
              signal: ac.signal,
              onDelta: (text) => chunk({ content: text }, null),
              onRetry: (info) => {
                // 重试也当一帧发出去：客户端能显示"正在重试"，而不是干等
                push(
                  'data: ' +
                    JSON.stringify({ id, object: 'chat.completion.chunk', created, model: shownModel, retry: info }) +
                    '\n\n',
                )
              },
            })
            if (r.status !== 'completed') {
              push(
                'data: ' +
                  JSON.stringify({ id, object: 'chat.completion.chunk', created, error: { message: r.errorMessage || '对话失败', attempts: r.attempts } }) +
                  '\n\n',
              )
            } else {
              chunk({}, 'stop')
            }
            push('data: [DONE]\n\n')
          } catch (err) {
            push(
              'data: ' +
                JSON.stringify({ id, error: { message: err instanceof Error ? err.message : String(err) } }) +
                '\n\n',
            )
          } finally {
            closed = true
            try {
              controller.close()
            } catch {
              /* 已关 */
            }
          }
        })()
      },
    })

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store, no-cache, must-revalidate',
        connection: 'keep-alive',
      },
    })
  })

  return app
}

/** 单测与"没有 SDK"时的方便入口：直接用注入的 run 就行 */
export { completeOnce, flattenTurn }

