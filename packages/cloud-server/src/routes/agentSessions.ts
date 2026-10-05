/**
 * agentSessions 路由 —— 某个画布下的会话与对话流（含审批的推与解）。
 *
 * 与 agent.ts（全局配置）分开住的原因就是「归属不同」：这份 URL 里带着 canvasId。
 *
 * 流式为什么用 SSE：与 /api/kv/events 同一条理由 —— 数据天生单向（服务器推、浏览器收），
 * 而用户的下一条消息本来就有现成的 POST。用 WebSocket 只会多背一套重连与粘包。
 *
 * 审批为什么也在同一条流上：同意/拒绝这两个动作是**服务器**在等（approve 回调），
 * 所以卡片只能由服务器推给界面、再由界面 POST 回来解开。
 */
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { isSafeCanvasId } from '../store/canvasPaths.js'
import { isSafeSessionId } from '../agent/agentPaths.js'
import type { AgentSessionStore } from '../agent/sessionStore.js'
import type { AgentRuntime, SessionPrefs } from '../agent/runtime.js'
import type { AgentChatEvent } from '../agent/translate.js'
import type { AgentConfigService } from '../agent/config.js'
import { safeJson } from './agent.js'

/**
 * pre-turn 钩子：在调 `runtime.run` **之前**跑一遍（Agent 中间件链就挂在这里）。
 * 返回 `blocked` 为真时不进模型，直接把 `response` 推给前端。
 *
 * 为什么用回调参数而不是直接 import 中间件运行器：这条路由不该认识"插件系统"——
 * 它只管"跑 Agent"。谁在 pre-turn 做什么，由宿主（server.ts）注入。
 */
export type AgentPreTurn = (turn: {
  canvasId: string
  input: { canvasId: string; sessionId: string; text: string; images?: string[]; prefs?: SessionPrefs }
  abortSignal: AbortSignal
}) => Promise<{ blocked?: true; response?: unknown }>

export function agentSessionRoutes(
  store: AgentSessionStore,
  runtime: AgentRuntime,
  config: AgentConfigService,
  preTurn?: AgentPreTurn,
): Hono {
  const app = new Hono()

  /** 校验路径两段；不合法时回一个 400 响应 */
  function guardParams(c: { req: { param: (k: string) => string | undefined } }):
    | { ok: true; canvasId: string; sessionId?: string }
    | { ok: false; res: Response } {
    const canvasId = c.req.param('canvasId') ?? ''
    if (!isSafeCanvasId(canvasId)) {
      return { ok: false, res: Response.json({ ok: false, error: '非法画布 id' }, { status: 400 }) }
    }
    const sessionId = c.req.param('sessionId')
    if (sessionId !== undefined && !isSafeSessionId(sessionId)) {
      return { ok: false, res: Response.json({ ok: false, error: '非法会话 id' }, { status: 400 }) }
    }
    return sessionId === undefined ? { ok: true, canvasId } : { ok: true, canvasId, sessionId }
  }

  /**
   * 从 body 里取本次的会话偏好（模型 / MCP / 技能）。
   *
   * 顺手把「这个模型的上下文窗口」带上：界面算上下文剩余百分比要用它，
   * 而 session_meta 只写进 trace、不从 run() 里出来（实测），所以只能从配置里查。
   */
  async function readPrefs(body: Record<string, unknown> | undefined): Promise<SessionPrefs | undefined> {
    if (!body) return undefined
    const prefs: SessionPrefs = {}
    if (typeof body.provider === 'string' && body.provider) prefs.provider = body.provider
    if (typeof body.modelId === 'string' && body.modelId) prefs.modelId = body.modelId
    if (Array.isArray(body.mcpServers)) prefs.mcpServers = body.mcpServers.map(String)
    if (Array.isArray(body.skills)) prefs.skills = body.skills.map(String)
    // 模式系统提示词（全能创作 / 剧本创编各一套）：随这一轮传给运行时，
    // 它在建会话时临时替换 AGENTS.md（见 AgentRuntime.ensureSession）。
    if (typeof body.systemPrompt === 'string' && body.systemPrompt.trim()) prefs.systemPrompt = body.systemPrompt
    const window = await config.modelContextWindow(prefs.provider, prefs.modelId)
    if (window) prefs.contextWindow = window
    return Object.keys(prefs).length ? prefs : undefined
  }

  app.get('/api/agent/canvases/:canvasId/sessions', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    return c.json({ ok: true, sessions: await store.list(p.canvasId) })
  })

  app.post('/api/agent/canvases/:canvasId/sessions', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    let body: Record<string, unknown> = {}
    try {
      body = ((await c.req.json()) ?? {}) as Record<string, unknown>
    } catch {
      /* 空 body 是允许的：新建一个默认会话 */
    }
    const title = typeof body.title === 'string' ? body.title : undefined
    try {
      const prefs = await readPrefs(body)
      const r = await runtime.ensureSession(p.canvasId, {
        ...(title ? { title } : {}),
        ...(prefs ? { prefs } : {}),
      })
      const session = await store.get(p.canvasId, r.id)
      return c.json({ ok: true, id: r.id, resumed: r.resumed, session })
    } catch (err) {
      // 最常见的失败是「还没配模型」：这是用户能自己处理的事，回 503 并说清怎么修
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 503)
    }
  })

  app.get('/api/agent/canvases/:canvasId/sessions/:sessionId', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    const session = await store.get(p.canvasId, p.sessionId!)
    if (!session) return c.json({ ok: false, error: '会话不存在' }, 404)
    return c.json({
      ok: true,
      session,
      running: runtime.isRunning(p.canvasId, p.sessionId!),
      approvals: runtime.pendingApprovals(p.canvasId, p.sessionId!),
    })
  })

  app.patch('/api/agent/canvases/:canvasId/sessions/:sessionId', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    const body = await safeJson(c)
    if (!body || typeof body.title !== 'string' || !body.title.trim()) {
      return c.json({ ok: false, error: '需要 title' }, 400)
    }
    const done = await store.rename(p.canvasId, p.sessionId!, body.title.trim())
    if (!done) return c.json({ ok: false, error: '会话不存在' }, 404)
    return c.json({ ok: true })
  })

  app.delete('/api/agent/canvases/:canvasId/sessions/:sessionId', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    // 先放掉内存态（否则那条会话对象会一直挂着、甚至继续跑）
    runtime.forget(p.canvasId, p.sessionId!)
    const removed = await store.remove(p.canvasId, p.sessionId!)
    return c.json({ ok: true, removed })
  })

  app.post('/api/agent/canvases/:canvasId/sessions/:sessionId/abort', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    runtime.abort(p.canvasId, p.sessionId!)
    return c.json({ ok: true })
  })

  /**
   * 让这条会话重连 MCP（用户点「检测」时顺带调）。
   *
   * 背景：SDK 的 MCP 连接**只在每条会话第一次 run 时建立、之后一直复用**。
   * 外部把 MCP 关掉再开，那条旧连接已经废了，SDK 不会自己重连 ——
   * 于是会话卡在「工具被跳过」的状态。这里丢一次会话内存态，
   * 下一句走 resumeSession 重建 Environment，MCP 就重新连上了（转录不丢，在磁盘上）。
   */
  app.post('/api/agent/canvases/:canvasId/sessions/:sessionId/mcp/reconnect', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    const released = runtime.reconnectMcp(p.canvasId, p.sessionId!)
    return c.json({ ok: true, released })
  })

  /** 用户点了允许 / 拒绝：解开这一轮挂起的审批 */
  app.post('/api/agent/canvases/:canvasId/sessions/:sessionId/approvals/:approvalId', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    const approvalId = c.req.param('approvalId') ?? ''
    const body = await safeJson(c)
    const decision = body?.decision === 'deny' ? 'deny' : 'allow'
    const ok = runtime.resolveApproval(p.canvasId, p.sessionId!, approvalId, decision)
    if (!ok) return c.json({ ok: false, error: '这条审批已失效（可能这一轮已经结束）' }, 404)
    return c.json({ ok: true, decision })
  })

  app.post('/api/agent/canvases/:canvasId/sessions/:sessionId/messages', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    const body = await safeJson(c)
    if (!body) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    const text = String(body.text ?? '').trim()
    const images = Array.isArray(body.images) ? body.images.map(String) : undefined
    // 允许**只发图不打字**（用户常直接丢一张图问"这是什么"）：
    // 只要文字或图片有一个就算一条合法消息。
    if (!text && !images?.length) return c.json({ ok: false, error: '消息不能为空' }, 400)
    const prefs = await readPrefs(body)

    const ac = new AbortController()
    return streamSSE(c, async (stream) => {
      // 浏览器关页面 / 断网：立刻中止这一轮，别让模型白跑
      stream.onAbort(() => ac.abort())
      // 直通通道：审批卡片是服务器在等，只能从这里推（生成器里 yield 不出去）
      const notify = (event: AgentChatEvent): void => {
        void stream.writeSSE({ data: JSON.stringify(event) })
      }
      // 这一轮的可变入参（pre-turn 中间件改它 / 拦它）
      const input = {
        canvasId: p.canvasId,
        sessionId: p.sessionId!,
        text,
        ...(images ? { images } : {}),
        ...(prefs ? { prefs } : {}),
      }
      try {
        // ★ pre-turn：Agent 中间件链在这里跑（空链 = 零开销、直接返回 {}）。
        //   插件可改写 input.text / 拦截整轮；拦截时不进模型。
        if (preTurn) {
          const verdict = await preTurn({ canvasId: p.canvasId, input, abortSignal: ac.signal })
          if (verdict.blocked) {
            await stream.writeSSE({
              data: JSON.stringify(
                verdict.response ?? { type: 'notice', message: '本轮已被插件拦截' },
              ),
            })
            await stream.writeSSE({ data: JSON.stringify({ type: 'done' }) })
            return
          }
        }
        for await (const ev of runtime.run(p.canvasId, input, ac.signal, notify)) {
          await stream.writeSSE({ data: JSON.stringify(ev) })
        }
      } catch (err) {
        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : String(err) }),
        })
      }
    })
  })

  return app
}
