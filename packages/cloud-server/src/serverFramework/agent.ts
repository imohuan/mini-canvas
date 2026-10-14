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
 * 注册场名：**Agent 系统提示词小节**（插件往 Agent 的提示词里加内容）。
 *
 * 为什么单独一张表而不是继续用 `server/agent-mw` 的 sys 条目：那张表的语义是「拦一次轮次」——
 * 条目是函数、要按轮次跑；而提示词小节是**静态文本**（或一个取当前值的函数），只在
 * **建会话**那一刻被读一次。两者生命周期与消费点都不同，混在一张表里既难懂也难做界面
 * （设置页要列出「谁往你的提示词里加了什么」——那需要 title / source，mw 那张表里没有）。
 */
export const AGENT_PROMPT_FIELD = 'server/agent-prompt'

/** 一条系统提示词小节（注册时的形状） */
export interface AgentPromptSection {
  /** 设置页列出来的名字 */
  title: string
  /**
   * 正文。
   *
   * 给**函数** = 每次建会话时现读 —— 地址、端口、当前画布这类会变的值必须用它，
   * 写死成字符串就会把旧值冻在提示词里（正是「换了端口还发旧地址」那个坑）。
   */
  text: string | (() => string)
  /** 排序：小的在前（与注册场其它表同口径） */
  order: number
}

/** `ctx.agent.systemPrompt` 的可选项 */
export interface AgentPromptOptions {
  /**
   * 稳定 id：设置页靠它认人（开关、预览）。
   *
   * 同一个 id 再注册 = **顶替**那一条（热重载 / 改文案时不会越堆越多）。
   * 缺省 = 插件名 + 序号。
   */
  id?: string
  /** 显示名；缺省用插件名 */
  title?: string
  order?: number
}

/** 一条小节的**读**形态（多了 id / source，给界面用） */
export interface AgentPromptSectionView {
  id: string
  title: string
  /** 谁放的（插件名）——设置页显示它，用户才知道该去关哪个插件 */
  source: string
  order: number
  /** 当前正文（函数形式已求值）；取不到值时是空串 */
  text: string
}

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
  /** 谁注册的（插件名）——出错时能指名道姓（见 runAgentMiddleware 的报错） */
  source?: string
}

/** `ctx.agent` 的形状 */
export interface AgentRegistrar {
  /** 加一个中间件（order 小者在外层，与前端注册场一致） */
  use(mw: AgentMiddleware, opts?: { order?: number }): void
  /**
   * 往 Agent 的**系统提示词**里加一段内容（不是往用户消息里塞字）。
   *
   * 消费点：建会话时读一遍全部小节，按 order 拼进系统提示词。所以：
   *   - `text` 给**函数**就能跟运行期变化（后台地址 / 端口 / 当前画布）；
   *   - 卸载插件 → 它加的小节自动消失（走注册场回收）；
   *   - 设置页能列出「谁加了什么」（见 listAgentPromptSections）。
   */
  systemPrompt(text: string | (() => string), opts?: AgentPromptOptions): void
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
  const promptField = ctx.registryOf<AgentPromptSection>(AGENT_PROMPT_FIELD)
  let seq = 0
  // 提示词小节单独一个计数：中间件注册多少条都不影响小节的缺省 id ——
  // 共用 seq 的话，往插件前面加一个中间件就会把小节的 id 整体挪位，
  // 热重载时旧条目顶替不掉、越堆越多。
  let promptSeq = 0
  return {
    use(mw, opts) {
      seq += 1
      field.add('mw', { mw, order: opts?.order ?? DEFAULT_ORDER, source: scopeName }, { id: scopeName + '#' + seq })
    },
    systemPrompt(text, opts) {
      promptSeq += 1
      // 登记成**系统提示词小节**（不是往用户消息里塞文字 —— 那是加入本能力之前的老行为，
      // 语义错了：模型会把那段当成用户说的话）。
      // id 缺省 = 插件名 + 序号；同一个 id 再注册 = 顶替（热重载 / 改文案不会越堆越多）。
      promptField.add(
        'section',
        { title: opts?.title ?? scopeName, text, order: opts?.order ?? DEFAULT_ORDER },
        { id: opts?.id ?? scopeName + '-prompt#' + promptSeq },
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
    .map((e) => e.value)
    .sort((a, b) => a.order - b.order)

  if (entries.length === 0) return {}

  let i = -1
  /** 上一个真正执行过的中间件是谁注册的（越界报错时指名道姓要用它） */
  let lastSource = '未知'
  const dispatch = async (idx: number): Promise<AgentTurnResult> => {
    // 报错要说清**是谁**调错的：插件作者看到 `[agent] next() 被调用了多次` 时，
    // 既不知道是哪个插件，也不知道该怎么改（真机探针实测：界面上只剩 500 + 堆栈）。
    if (idx <= i) {
      throw new Error(
        '插件「' + lastSource + '」调了两次 next()：' +
          '一个中间件里 next() 只能调一次（想放行就 return next()，想拦截就别调）。' +
          '被拦下的消息不会进模型，这一轮会直接报错。',
      )
    }
    i = idx
    const entry = entries[idx]
    if (!entry) return {}
    if (entry.source) lastSource = entry.source
    return entry.mw(turn, () => dispatch(idx + 1))
  }
  return dispatch(0)
}

/**
 * 取当前全部「插件加的系统提示词小节」（按 order 排好）。
 *
 * 两处消费：
 *   - 建会话：拼进系统提示词（见 agent/runtime.ts）；
 *   - 设置页：列出来，让用户看到「谁往我的提示词里加了什么」。
 *
 * 求值失败（函数抛错）**不拖垮其它小节**：留一条空正文并在返回值里带 `error`，
 * 让界面能告诉用户是哪个插件坏了 —— 比整块提示词挂掉好排查得多。
 */
export function listAgentPromptSections(ctx: {
  registryOf<T>(k: string): Registry<T>
}): AgentPromptSectionView[] {
  const field = ctx.registryOf<AgentPromptSection>(AGENT_PROMPT_FIELD)
  const out: AgentPromptSectionView[] = []
  for (const e of field.list('section')) {
    const s = e.value
    let text = ''
    try {
      text = typeof s.text === 'function' ? s.text() : s.text
    } catch {
      // 求值失败：这一条留空，其余照常（坏的是那个插件，不该让整份提示词全废）
      text = ''
    }
    out.push({ id: e.id, title: s.title, source: e.source, order: s.order, text })
  }
  return out.sort((a, b) => a.order - b.order)
}

