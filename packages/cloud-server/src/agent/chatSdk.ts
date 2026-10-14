/**
 * 把 SDK 的裸模型接上单轮对话路由（**只有这里 import SDK**）。
 *
 * 为什么单独一个文件：路由与纯逻辑（chatCompletion.ts）都不该依赖 SDK ——
 * 那样单测得装一整套模型，而"重试 / 归一化 / 摊平"这些规则其实与 SDK 无关。
 * 这一层只做"读 SDK 的配置 + new 一个裸模型 + 把 SDK 的消息构造器接进 CompleteDeps"。
 *
 * ## 用哪个 SDK 类
 *
 * `GenerativeModel`（SDK 内部的 `createBareLLM()` 就是用它）：
 *   · `tools: []` + `thinkingLevel: 'none'` —— 不给工具、不思考（这就是"单轮对话"的定位）
 *   · 它是**纯内存对象**：没有 agentDir / session / trace，跑完什么都不留
 *   · 凭据来自 `config.resolveModel()`（用户已配好的 provider）
 */
import type { AgentConfigService } from './config.js'
import type { BareLLMFactory } from './chatCompletion.js'

/** 真跑一轮要用到的 SDK 片段（按需加载，没配模型时启动照常成功） */
type Sdk = typeof import('@prismshadow/penguin-core')

export interface SdkBareLLM {
  factory: BareLLMFactory
  /** 摊平后的消息 → SDK 的消息数组（userText / imageUrlMessage） */
  buildMessages: (turn: { systemPrompt: string; userText: string; images: string[] }) => unknown[]
  /** 从 SDK 的消息里读 usage（认不出就 undefined） */
  readUsage: (msg: unknown) => unknown
}

/** 把 SDK 包成一层的三件东西（用它的构造器，不自己拼协议对象） */
export function sdkBareLLM(sdk: Sdk): SdkBareLLM {
  const factory: BareLLMFactory = (cfg) =>
    new sdk.GenerativeModel({
      modelId: cfg.modelId,
      ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
      ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
      ...(cfg.clientType ? { clientType: cfg.clientType } : {}),
      // ★ 这两条就是"单轮对话"的定义：不给工具、不思考
      tools: [],
      thinkingLevel: 'none',
      ...(cfg.systemPrompt ? { systemPrompt: cfg.systemPrompt } : {}),
      ...(cfg.contextWindow === undefined ? {} : { contextWindow: cfg.contextWindow }),
      ...(cfg.maxTokens === undefined ? {} : { maxTokens: cfg.maxTokens }),
      // 生成为止最多等 5 分钟（一次请求的空闲预算，SDK 的语义是"等下一个事件的最长时间"）
      requestTimeoutMs: 300_000,
    }) as unknown as ReturnType<BareLLMFactory>

  return {
    factory,
    buildMessages: (turn) => {
      const out: unknown[] = []
      if (turn.userText) out.push(sdk.userText(turn.userText))
      // 图片走 imageUrlMessage（data URL 或同源地址都认）——
      // 为什么放用户文本后面：SDK 会把它并进同一条 user 消息（一次请求只发一条 user）
      for (const url of turn.images) out.push(sdk.imageUrlMessage(url))
      // 一条都没有也要给个空 user（否则请求里没有新消息，上游会拒）
      if (out.length === 0) out.push(sdk.userText(''))
      return out
    },
    readUsage: (msg) => {
      // 用量帧：外层 event_msg + payload.type=token_usage，值在 payload.request（本次请求）
      const m = msg as { type?: unknown; payload?: { type?: unknown; request?: unknown; session?: unknown } } | undefined
      if (m?.payload?.type !== 'token_usage') return undefined
      return m.payload.request ?? m.payload.session
    },
  }
}

/**
 * 造一个"真跑一轮"的实现（给路由用）。
 *
 * SDK 是**按需加载**的：没配模型 / 没装 SDK 时，这个工厂返回的 runner 会明确报错，
 * 而服务本身照常启动。
 */
export function createSdkChatRunner(deps: {
  config: AgentConfigService
  loadSdk: () => Promise<Sdk>
}): {
  run: (
    input: { messages: Parameters<typeof import('./chatCompletion.js').flattenTurn>[0]; provider?: string; model?: string; maxTokens?: number },
    hooks: { signal?: AbortSignal; onDelta?: (text: string) => void; onRetry?: (i: { attempt: number; waitMs: number; errorMessage?: string }) => void },
  ) => Promise<import('./chatCompletion.js').CompleteOnceResult>
} {
  return {
    run: async (input, hooks) => {
      let sdk: Sdk
      try {
        sdk = await deps.loadSdk()
      } catch (err) {
        return {
          text: '',
          status: 'fatal',
          errorMessage: '这个部署没有装 Agent SDK（' + (err instanceof Error ? err.message : String(err)) + '）',
          attempts: 0,
        }
      }
      const bare = sdkBareLLM(sdk)
      const { completeOnce } = await import('./chatCompletion.js')
      return completeOnce(input, {
        config: deps.config as unknown as Pick<AgentConfigService, 'resolveModel'>,
        makeLLM: bare.factory,
        buildMessages: bare.buildMessages,
        readUsage: bare.readUsage,
        ...(hooks.signal ? { signal: hooks.signal } : {}),
        ...(hooks.onRetry ? { onRetry: hooks.onRetry } : {}),
        ...(hooks.onDelta ? { onDelta: hooks.onDelta } : {}),
      })
    },
  }
}

