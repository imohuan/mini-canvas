/**
 * agent —— `ctx.agent` 能力段的实现（后台插件系统的「用户点 2：Agent 中间件」）。
 *
 * 目标：插件能**拦截 / 改写**一次 Agent 对话轮次。典型用法：
 * - 进入前加工（脱敏、补上下文、按规则改写提示词）；
 * - 直接拦截（敏感词、配额用尽 → 不调模型、自己回一句）。
 *
 * ## 为什么中间件插在 `runtime.run()` **之前**，而不是生成器内部
 *
 * `AgentRuntime.run` 是 `async *run(canvasId, input, signal, notify)` —— 一个**异步生成器**，
 * 它一边跑一边 `yield` 事件。要在它内部插中间件有两个硬障碍：
 * 1. `yield` 不能在嵌套函数里用（runtime 自己的注释就写了这个坑）；
 * 2. 中间件需要 `await next()` 的"环绕"语义，而生成器只有单向产出。
 *
 * 所以正确位置是 **pre-turn**：HTTP 路由拿到 {canvasId, text, images, prefs} →
 * 先跑中间件链（可改写 `input` / 拦截）→ 再把手里的 `input` 交给 `runtime.run`。
 * 好处：与生成器彻底解耦、可单测、**空链时零开销**（直接返回、不改任何东西）。
 *
 * ## 归属与回收
 *
 * 中间件登记在内核注册场（`server/agent-mw`），条目归注册方插件，
 * 用 `ctx.registryOf` 的自动回收 → **卸载插件即摘掉它的中间件**（有测试锁）。
 */
import type { PluginScope, Registry } from '@mini-canvas/kernel'
import { MCP_TOOL_FIELD, type McpToolDef } from './mcp.js'

/** 注册场名：Agent 中间件 */
export const AGENT_MW_FIELD = 'server/agent-mw'

/**
 * 一次 Agent 轮次的**可变入参**（中间件改它即"进入前加工"）。
 * 形状对齐 `AgentRuntime.StartRunInput`，但只留中间件用得到的字段。
 */
export interface AgentTurn {
  canvasId: string
  input: {
    canvasId: string
    sessionId?: string
    text: string
    images?: string[]
    /** 会话偏好（形状由 agent 层定；中间件一般不碰，故用宽松类型避免耦合） */
    prefs?: unknown
  }
  /** 取消信号（中间件可读取它做短路判断） */
  abortSignal?: AbortSignal
}

/** 中间件链的返回：`blocked` 为真表示不再往下走（不进模型） */
export interface AgentTurnResult {
  /** true = 本次轮次被拦截，不该调 runtime.run */
  blocked?: true
  /** 拦截时给前端的响应（任意可 JSON 化的值） */
  response?: unknown
}

/** 一个中间件：`next()` 放行、不调即拦截（koa 风格） */
export type AgentMiddleware = (turn: AgentTurn, next: () => Promise<AgentTurnResult>) => Promise<AgentTurnResult>

/** 登记进注册场的条目 */
export interface AgentMwEntry {
  mw: AgentMiddleware
  order: number
}

/** `ctx.agent` 的形状 */
export interface AgentRegistrar {
  /** 加一个中间件（order 小者在外层，与前端注册场一致） */
  use(mw: AgentMiddleware, opts?: { order?: number }): void
  /** 追加一段系统提示（先做最简：收集成列表，供 agent 路由拼接） */
  systemPrompt(text: string): void
  /**
   * 给 Agent 加一个可调用的工具。
   *
   * 语义就是 MCP 工具：本项目里 Agent 拿工具的通道就是 MCP（见 mcp/server.ts），
   * 所以这里直接登记进同一张 server/mcp-tool 表 —— 不是另造一套。
   * Agent 只要（在它的 MCP 配置里）连上本服务的 /mcp，就能用到这些工具。
   * 与 ctx.mcp.tool 是同一个落点，区别只是从「Agent 视角」还是「MCP 视角」称呼。
   */
  tool(def: McpToolDef): void
}

const DEFAULT_ORDER = 0

export function createAgentRegistrar(ctx: PluginScope, scopeName: string): AgentRegistrar {
  const field = ctx.registryOf<AgentMwEntry>(AGENT_MW_FIELD)
  let seq = 0
  return {
    use(mw, opts) {
      seq += 1
      field.add('mw', { mw, order: opts?.order ?? DEFAULT_ORDER }, { id: scopeName + '#' + seq })
    },
    systemPrompt(text) {
      seq += 1
      // 复用同一个场、用一个标记条目：系统提示也是一段"要在轮次前生效的加工"，
      // 差别只是它被拼到提示词而非包住调用。
      field.add(
        'sys',
        { mw: (async (turn, next) => { turn.input.text = text + '\n' + turn.input.text; return next() }) as AgentMiddleware, order: DEFAULT_ORDER },
        { id: scopeName + '-sys#' + seq },
      )
    },
    tool(def) {
      // 与 ctx.mcp.tool 同一张表（Agent 的工具体系就是 MCP，见接口注释）。
      ctx.registryOf<McpToolDef>(MCP_TOOL_FIELD).add(def.name, def, { id: scopeName + '-agent' })
    },
  }
}

/**
 * 跑一遍中间件链（koa 式洋葱）。
 *
 * - 无中间件时**直接返回 `{}`**（零开销、行为与不加中间件一字不差）；
 * - 任一中间件返回 `{blocked:true}` 且不调 `next()` → 后面的都不跑；
 * - order 小者在外层（先执行、后收尾），与前端注册场栈序一致。
 */
export async function runAgentMiddleware(ctx: { registryOf<T>(k: string): Registry<T> }, turn: AgentTurn): Promise<AgentTurnResult> {
  const entries = ctx
    .registryOf<AgentMwEntry>(AGENT_MW_FIELD)
    .list('mw')
    .concat(ctx.registryOf<AgentMwEntry>(AGENT_MW_FIELD).list('sys'))
    .map((e) => e.value)
    .sort((a, b) => a.order - b.order)

  if (entries.length === 0) return {}

  let i = -1
  const dispatch = async (idx: number): Promise<AgentTurnResult> => {
    if (idx <= i) throw new Error('[agent] next() 被调用了多次')
    i = idx
    const entry = entries[idx]
    if (!entry) return {}
    return entry.mw(turn, () => dispatch(idx + 1))
  }
  return dispatch(0)
}
