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
import type { AgentSessionStore, QueueItem } from '../agent/sessionStore.js'
import { dedupeSegments } from '../agent/sessionStore.js'
import type { AgentRuntime, SessionPrefs } from '../agent/runtime.js'
import type { SessionHub } from '../agent/sessionHub.js'
import type { AgentChatEvent } from '../agent/translate.js'
import type { AgentConfigService } from '../agent/config.js'
import type { BranchStore } from '../agent/branchStore.js'
import { seedForkTrace } from '../agent/traceFork.js'
import { safeJson } from './agent.js'
import { readGoalState } from '../agent/goalState.js'
import { agentRoot, sessionScratchpadPath } from '../agent/agentPaths.js'

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

/**
 * 目标运行时（设计 §3.4.4）：改预算 / 暂停 / 启动。
 *
 * 为什么是接口而不是直接 import 实现：这条路由不该认识 goal 的文件协议，
 * 谁来实现（server.ts 接线）由宿主决定 —— 与 preTurn / onQueueChanged 同一风格。
 */
export interface GoalRuntimePort {
  /** 以目标模式起第 1 轮（写 GOAL.json + 官方协议文本 + 开跑） */
  beginGoal(
    canvasId: string,
    sessionId: string,
    objective: string,
    budget: number,
  ): Promise<{ started: boolean }>
  /** 改预算（总预算或"再跑多少"）或目标内容；没有进行中的目标返回 null */
  updateGoal(
    canvasId: string,
    sessionId: string,
    patch: { objective?: string; budget?: number; deltaBudget?: number; tokensUsed?: number },
  ): Promise<{ objective: string; status: string; budget: number; round: number; tokensUsed: number } | null>
  /** 暂停：把目标文件挪走 + 记宿主侧标记（当前轮跑完自然停住） */
  pauseGoal(canvasId: string, sessionId: string): Promise<boolean>
  /** 启动：文件放回 + 清标记 + 踢一脚（起下一轮） */
  resumeGoal(canvasId: string, sessionId: string): Promise<{ started: boolean }>
  /** 结束目标：删掉目标状态文件（与暂停不同，不可恢复） */
  endGoal(canvasId: string, sessionId: string): Promise<boolean>
}

export function agentSessionRoutes(
  store: AgentSessionStore,
  runtime: AgentRuntime,
  config: AgentConfigService,
  branches?: BranchStore,
  preTurn?: AgentPreTurn,
  hub?: SessionHub,
  /**
   * 队列发生变化时的回调（加/删/改/暂停/引导）。
   *
   * 为什么用回调而不是直接调调度器：这条路由不该认识"队列调度"——
   * 它只管把用户的操作落盘，谁在队列变化后决定发下一条由宿主（server.ts）注入。
   * 与 preTurn 同一套注入风格。
   */
  onQueueChanged?: (canvasId: string, sessionId: string) => void,
  /** 会话被删除（宿主借此清调度器的内存表：inflight / hadPending / lastFailureAt） */
  onSessionDeleted?: (canvasId: string, sessionId: string) => void,
  /** 目标运行时（不注入 = 目标端点回 503；单测与老宿主不受影响） */
  goalRuntime?: GoalRuntimePort,
): Hono {
  const app = new Hono()

  /**
   * 目标参考图的落盘上限（与界面 pickImages 的 4 张 × 4MB 同口径）。
   *
   * 为什么在路由层再设一道：图是 data URL，直接写进**会话文件**；而会话文件每次转录写入
   * 都是「整体读 → 改 → 整体写」——无上限时一次请求就能把文件撑大，之后每轮对话都在搬它。
   * 单张按 base64 后约 1.37 倍估算：4MB 原图 ≈ 5.6M 字符。
   */
  const MAX_GOAL_IMAGES = 4
  const MAX_GOAL_IMAGE_URL_CHARS = 6 * 1024 * 1024

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
    // 分支关系一起返回（child → parent）：历史列表据此把「一个对话的多个分支」聚成一行
    const parents = branches ? await branches.parentMap(p.canvasId) : {}
    return c.json({ ok: true, sessions: await store.list(p.canvasId), parents })
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
    // 队列 / 目标暂停标记 / 流序号一起给：界面刷新后靠这一条恢复全部状态
    const goal = await readGoalForSession(config, p.sessionId!)
    return c.json({
      ok: true,
      session,
      running: runtime.isRunning(p.canvasId, p.sessionId!),
      approvals: runtime.pendingApprovals(p.canvasId, p.sessionId!),
       queue: await store.getQueue(p.canvasId, p.sessionId!),
       ...(session.goalPaused ? { goalPaused: true } : {}),
       ...(goal ? { goal } : {}),
      // 目标参考图（迷你预览用；有目标才带，避免无谓字段）
      ...(goal && session.goalImages?.length ? { goalImages: session.goalImages } : {}),
       ...(hub ? { seq: hub.commitSeq(p.canvasId, p.sessionId!), lastSeq: hub.lastSeq(p.canvasId, p.sessionId!) } : {}),
       // 最近一次上下文用量：界面刷新 / 切会话后靠它把上下文指示器画回来。
       // 注意**不能用内存态**（runtime 那边）：服务重启后内存是空的，而磁盘上这份还在。
       ...(session.lastUsage ? { lastUsage: session.lastUsage } : {}),
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
    onSessionDeleted?.(p.canvasId, p.sessionId!)
    const removed = await store.remove(p.canvasId, p.sessionId!)
    // 分支登记表也要清：留着已删会话的引用，界面上会出现「点了没反应」的死分支
    if (removed && branches) await branches.unregister(p.canvasId, p.sessionId!)
    return c.json({ ok: true, removed })
  })

  app.post('/api/agent/canvases/:canvasId/sessions/:sessionId/abort', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    // 托管模式：hub 是"正在跑"的唯一真相，优先中它（runtime 的内存态在托管下不反映这一轮）
    const hitHub = hub?.abort(p.canvasId, p.sessionId!) ?? false
    runtime.abort(p.canvasId, p.sessionId!)
    // 用户口径：终止 = 停当前轮 + **自动暂停队列**（避免下一条立刻顶上，看起来像"没停住"）
    await store.updateQueue(p.canvasId, p.sessionId!, (q) => ({ ...q, paused: true }))
    return c.json({ ok: true, hub: hitHub })
  })

  /**
   * 接回正在跑的一轮（托管模式的重连端点，设计 §3.2 第 3 点）。
   *
   * 刷新后的流程：先 GET 会话拿转录（历史消息），再开这条流 —— since 传
   * "转录里已经有的最后一条对应的事件序号"（一般是 hub.commitSeq，见 GET 会话返回体），
   * 于是回放的就是「还没落转录的那部分」：正在写的半段文字、跑着的工具。
   *
   * gapDetected 为真 = since 太旧、中间被缓冲裁剪了 —— 前端应当重拉一次会话转录再续。
   */
  app.get('/api/agent/canvases/:canvasId/sessions/:sessionId/stream', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    if (!hub) return c.json({ ok: false, error: '托管未启用' }, 503)
    const since = Number(c.req.query('since') ?? 0) || 0
    /**
     * follow=1：**常驻订阅**（不因为"当前没在跑"就关流）。
     *
     * 会话页开着时用这个：后台空闲时队列可能**自动起一轮**，那时页面必须已经连着，
     * 才能收到 run_state / queue 事件（用户实测："任务结束但队列没反应"）。
     * 不传 follow 时保持原语义（跑到结束就关），单次重连用。
     */
    const follow = c.req.query('follow') === '1'
    return streamSSE(c, async (stream) => {
      const { gapDetected, droppedSeq, unsubscribe } = hub.subscribe(
        p.canvasId,
        p.sessionId!,
        since,
        (item) => {
          // 带 `id: <seq>`：客户端据此推进自己的重连水位（见按帧解析的 consumeSse）。
          // 没有它，客户端重连时只能拿一个**很旧**的水位，缓冲里已应用过的事件会被重放
          // （重复的助手正文 / 工具卡片 —— 真机可复现）。
          void stream.writeSSE({ id: String(item.seq), data: JSON.stringify(item.ev) })
        },
      )
      if (gapDetected) {
        await stream.writeSSE({
          data: JSON.stringify({ type: 'stream_gap', droppedSeq }),
        })
      }
      stream.onAbort(() => unsubscribe())
      if (follow) {
        // 常驻：挂到客户端主动断开为止（页面关掉 / 换会话）
        await new Promise<void>((resolve) => {
          stream.onAbort(() => resolve())
        })
        unsubscribe()
        return
      }
      // 挂住：正在跑就等它结束；没在跑（例如刚刷新完这一轮刚好结束）也短暂挂一下，
      // 让前端能收到"这一轮已结束"的状态。空闲满 1 秒即关，不长期占着连接。
      await new Promise<void>((resolve) => {
        let idle = 0
        const tick = setInterval(() => {
          if (hub.isRunning(p.canvasId, p.sessionId!)) {
            idle = 0
            return
          }
          idle += 1
          if (idle >= 8) {
            clearInterval(tick)
            resolve()
          }
        }, 120)
        stream.onAbort(() => {
          clearInterval(tick)
          resolve()
        })
      })
      unsubscribe()
    })
  })

  /** 会话的队列（界面刷新后恢复输入框上方那个列表） */
  app.get('/api/agent/canvases/:canvasId/sessions/:sessionId/queue', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    return c.json({ ok: true, queue: await store.getQueue(p.canvasId, p.sessionId!) })
  })

  /** 改队列：add / update / remove / close / cancel-edit / pause / resume（设计 §3.3） */
  app.post('/api/agent/canvases/:canvasId/sessions/:sessionId/queue', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    const body = await safeJson(c)
    if (!body) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    const op = String(body.op ?? '')
    const itemId = typeof body.itemId === 'string' ? body.itemId : ''
    const text = typeof body.text === 'string' ? body.text : ''
    const images = Array.isArray(body.images) ? body.images.map(String) : undefined
    // 这些 op 不需要正文（只有 add/update 要）—— 少列一个就会把合法操作挡成 400
    const opsWithoutText = new Set(['remove', 'close', 'cancel-edit', 'edit', 'pause', 'resume'])
    if (!text && !images?.length && !opsWithoutText.has(op)) {
      return c.json({ ok: false, error: '消息不能为空' }, 400)
    }

    const queue = await store.updateQueue(p.canvasId, p.sessionId!, (q) => {
      switch (op) {
        case 'add': {
          const item: QueueItem = {
            id: 'q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
            text,
            ...(images?.length ? { images } : {}),
            ...(body.goal && typeof body.goal === 'object'
              ? {
                  goal: {
                    objective: String((body.goal as Record<string, unknown>).objective ?? text),
                    budget: Number((body.goal as Record<string, unknown>).budget ?? -1) || -1,
                  },
                }
              : {}),
            state: 'queued',
            createdAt: Date.now(),
          }
          return { ...q, items: [...q.items, item] }
        }
        case 'update':
          // 原位替换（位置不变 —— 用户口径 G3）。images 的语义：
          // 显式传来（含空数组）= 用它替换；没传 = 保留原图。
          // 为什么要区分：界面上"删掉所有图只留文字"是合法编辑，但"没碰图"不该意外清空。
          return {
            ...q,
            items: q.items.map((it) =>
              it.id === itemId
                ? {
                    ...it,
                    text,
                    ...(Array.isArray(body.images) ? { images: images?.length ? images : undefined } : {}),
                    state: 'queued',
                  }
                : it,
            ),
          }
        case 'cancel-edit':
          // 不传 itemId = **清掉这条会话里所有 editing**（"放弃全部编辑"）。
          //
          // 为什么需要它（代码审查发现的洞）：`editing` 会**阻塞队列**（调度器只放行非
          // editing 的队头），而编辑态有一部分是发起编辑的**那个客户端**记的（界面本地
          // editingItems）。用户编辑到一半切走会话 / 关掉面板 / 刷新，服务端这条 editing
          // 就没人再取消它 —— 等它排到队头，队列就**永久卡住**、界面上连取消按钮都没有。
          // 所以切会话时由界面调一次「清空 editing」把它兜回来。
          if (!itemId) return { ...q, items: q.items.map((it) => (it.state === 'editing' ? { ...it, state: 'queued' } : it)) }
          return { ...q, items: q.items.map((it) => (it.id === itemId ? { ...it, state: 'queued' } : it)) }
        case 'edit':
          // 开始编辑某条：**只改状态**（内容不动）—— 队头变 editing 后调度器就停在那里等用户
          // 发送（设计 §3.3.4 的"编辑阻塞"）。改完由 update（原位替换 + 回 queued）接手。
          return {
            ...q,
            items: q.items.map((it) => (it.id === itemId ? { ...it, state: 'editing' as const } : it)),
          }
        case 'remove':
        case 'close':
          return { ...q, items: q.items.filter((it) => it.id !== itemId) }
        case 'pause':
          return { ...q, paused: true }
        case 'resume':
          return { ...q, paused: false }
        default:
          return null
      }
    })
    if (queue === null) return c.json({ ok: false, error: '未知操作: ' + op }, 400)
    // 广播给所有订阅者（多标签页同步 + 界面刷新列表）
    hub?.append(p.canvasId, p.sessionId!, { type: 'queue', queue })
    // 队列变更后给调度器一个"看看能不能发"的机会（阶段 2.3 接线；这里先留钩子）
    onQueueChanged?.(p.canvasId, p.sessionId!)
    return c.json({ ok: true, queue })
  })

  /**
   * 引导（插队）：把队列里某一条经 steer 送进**正在跑**的那一轮（设计 §3.3.3）。
   *
   * 三种情况都在这里裁决（界面无需知道细节）：
   * - 正在跑 ⇒ steer 进当前轮；从队列移除 + 落转录（带 steered 标记）；
   * - 刚好跑完（steer 返回 false）⇒ 什么也不做：条目留在队列里，由调度器按序发出
   *   （**不丢、不重复** —— steer 失败不删条目是关键）；
   * - 根本没在跑 ⇒ 退回 false 并把条目留在队列（调度器会立刻发它）。
   */
  app.post('/api/agent/canvases/:canvasId/sessions/:sessionId/queue/:itemId/steer', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    const itemId = c.req.param('itemId') ?? ''
    if (!runtime.isSteerable(p.canvasId, p.sessionId!)) {
      // 没在跑：留在队列，让调度器发（界面看到的就是"排到队首、正常发出"）
      onQueueChanged?.(p.canvasId, p.sessionId!)
      return c.json({ ok: true, steered: false, reason: 'idle' })
    }
    let item: QueueItem | undefined
    await store.updateQueue(p.canvasId, p.sessionId!, (q) => {
      item = q.items.find((it) => it.id === itemId)
      return q // 先读不改；真正删除在 steer 成功后
    })
    if (!item) return c.json({ ok: false, error: '这条排队消息不存在' }, 404)
    const steered = await runtime.steerInto(p.canvasId, p.sessionId!, item.text, item.images)
    if (!steered) {
      // 轮刚好结束：条目原样留在队列（调度器接手）
      onQueueChanged?.(p.canvasId, p.sessionId!)
      return c.json({ ok: true, steered: false, reason: 'finished' })
    }
    const queue = await store.updateQueue(p.canvasId, p.sessionId!, (q) => ({
      ...q,
      items: q.items.filter((it) => it.id !== itemId),
    }))
    hub?.append(p.canvasId, p.sessionId!, { type: 'queue', queue })
    onQueueChanged?.(p.canvasId, p.sessionId!)
    return c.json({ ok: true, steered: true })
  })

  /**
   * 目标操作（设计 §3.4.3 / §3.4.4）：
   * - `update`：改预算（总预算 / 再跑多少）或目标内容 —— **下一轮生效**（插件每轮重读文件）；
   * - `pause`：把 GOAL.json 挪走（官方自动连播在当前轮结束时自然停住）；
   * - `resume`：放回 + 清暂停标记 + 踢一脚（宿主执行官方 stop.mjs 拿 continue 文本起下一轮）。
   *
   * 依赖注入的 goalRuntime（server.ts 提供）；没注入时回 503（目标功能未启用）。
   */
  app.post('/api/agent/canvases/:canvasId/sessions/:sessionId/goal', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    if (!goalRuntime) return c.json({ ok: false, error: '目标功能未启用' }, 503)
    const body = await safeJson(c)
    const op = String(body?.op ?? '')
    try {
      if (op === 'update') {
        const patchBody: { objective?: string; budget?: number; deltaBudget?: number; tokensUsed?: number } = {}
        if (typeof body?.objective === 'string' && body.objective.trim()) patchBody.objective = body.objective.trim()
        if (typeof body?.budget === 'number' && Number.isFinite(body.budget)) patchBody.budget = body.budget
        // 「已用」也允许改（运行中 已用/总预算 左右各自可点着改，用户口径 2026-10-09）
        if (typeof body?.tokensUsed === 'number' && Number.isFinite(body.tokensUsed)) patchBody.tokensUsed = body.tokensUsed
        if (typeof body?.deltaBudget === 'number' && Number.isFinite(body.deltaBudget)) {
          patchBody.deltaBudget = body.deltaBudget
        }
        const goal = await goalRuntime.updateGoal(p.canvasId, p.sessionId!, patchBody)
        if (!goal) return c.json({ ok: false, error: '这条会话没有进行中的目标' }, 404)
        hub?.append(p.canvasId, p.sessionId!, { type: 'goal_state', goal })
        return c.json({ ok: true, goal })
      }
      if (op === 'pause') {
        await goalRuntime.pauseGoal(p.canvasId, p.sessionId!)
        return c.json({ ok: true, paused: true })
      }
      if (op === 'resume') {
        const r = await goalRuntime.resumeGoal(p.canvasId, p.sessionId!)
        return c.json({ ok: true, paused: false, started: r.started })
      }
      if (op === 'end') {
        const removed = await goalRuntime.endGoal(p.canvasId, p.sessionId!)
        return c.json({ ok: true, ended: true, removed })
      }
      return c.json({ ok: false, error: '未知操作: ' + op }, 400)
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  /**
   * 写当前目标的参考图（用户口径 2026-10-09：目标行也要迷你图预览）。
   * 放宿主记录（sessionStore.goalImages）—— GOAL.json 是 goal 插件的协议，不塞私有字段。
   * 目标已结束时也允许清空（配合「结束目标」把图一起收掉）。
   */
  app.post('/api/agent/canvases/:canvasId/sessions/:sessionId/goal-images', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    const body = await safeJson(c)
    const raw = Array.isArray(body?.images) ? (body!.images as unknown[]).map(String).filter(Boolean) : []
    /**
     * 上限（与界面的 4 张 / 单张 4MB 同口径）：这些是 data URL，直接落进**会话文件**，
     * 而会话文件每次转录写入都要整体读 + 整体写 —— 不设限的话，一次请求就能把文件撑到
     * 几十 MB，之后每一轮对话都在重复搬它（写入变慢、索引变大）。
     * 超限截断而不是报错：界面永远发不出超限的量，真超了多半是调用方写错，
     * 截断比让"写目标参考图"整个失败更不打扰用户（图本身是可选装饰）。
     */
    const images = raw.slice(0, MAX_GOAL_IMAGES).filter((u) => u.length <= MAX_GOAL_IMAGE_URL_CHARS)
    await store.setGoalImages(p.canvasId, p.sessionId!, images)
    return c.json({ ok: true })
  })

  /**
   * 分支（fork）：编辑某条旧消息重发 = 以它**上面的内容**为历史开一条新会话。
   *
   * body: { afterText: 被编辑的那条用户消息文本 }。后端拷贝它之前的回合到新会话、
   * 登记兄弟分支；前端拿到新 id 后走正常 sendMessage（SDK resume 语义按转录继续）。
   */
  app.post('/api/agent/canvases/:canvasId/sessions/:sessionId/fork', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    let body: Record<string, unknown> = {}
    try {
      body = ((await c.req.json()) ?? {}) as Record<string, unknown>
    } catch {
      /* body 解析失败按空处理，下面统一报 400 */
    }
    const afterText = typeof body.afterText === 'string' ? body.afterText : ''
    if (!afterText.trim()) return c.json({ ok: false, error: '需要 afterText（被编辑的那条消息文本）' }, 400)
    if (!branches) return c.json({ ok: false, error: '分支功能未启用' }, 503)
    try {
      const fork = await store.forkFrom(p.canvasId, p.sessionId!, afterText)
      // SDK 的 resume 读的是它自己的 Trace（不是上面的转录）：不种文件，下一句必抛
      // 「Session does not exist」。种失败要回滚转录，别留下「看得见却续不上」的半截分支。
      let parentRecord: Awaited<ReturnType<typeof store.get>> | undefined
      try {
        parentRecord = await store.get(p.canvasId, p.sessionId!)
        await seedForkTrace(config.dataDir, {
          parentSessionId: p.sessionId!,
          forkSessionId: fork.sessionId,
          canvasId: p.canvasId,
          turns: (await store.get(p.canvasId, fork.sessionId))?.turns ?? [],
          ...(parentRecord ? { provider: parentRecord.provider, modelId: parentRecord.modelId } : {}),
        })
      } catch (err) {
        await store.remove(p.canvasId, fork.sessionId).catch(() => undefined)
        throw new Error(
          '分支 Trace 种子写入失败（已回滚转录）: ' + (err instanceof Error ? err.message : String(err)),
        )
      }
      await branches.register(p.canvasId, p.sessionId!, fork.point, fork.sessionId)
      // 标题一并返回：后端起的名（带「· 分支:」标记）是唯一真相，前端不再自造一套
      const created = await store.get(p.canvasId, fork.sessionId)
      return c.json({
        ok: true,
        sessionId: fork.sessionId,
        parentId: fork.parentId,
        copied: fork.copied,
        ...(created ? { title: created.title } : {}),
      })
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  /**
   * 切换模型：把当前对话**整体接到一条新会话**上，模型换成新的。
   *
   * 为什么必须是新会话（SDK 侧的事实，用户已确认）：模型在会话创建时钉死（session_meta 里），
   * 之后改不了 —— 所以"切模型"在 SDK 眼里就是"开一条新对话"。
   *
   * 但我们不想让用户丢掉上下文，于是把整段转录拷过去（branchFromEnd，分叉点记在末尾），
   * 再补一条模型分段（"从这里起换成 X"）。界面上渲染成一条分割线 —— 与"编辑重发"
   * 出来的分支是同一套机制（同一个 branches.json 登记表 + 分页器）。
   */
  app.post('/api/agent/canvases/:canvasId/sessions/:sessionId/switch-model', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    const body = await safeJson(c)
    const provider = typeof body?.provider === 'string' ? body.provider : ''
    const modelId = typeof body?.modelId === 'string' ? body.modelId : ''
    if (!provider || !modelId) return c.json({ ok: false, error: '需要 provider 与 modelId（成对给出）' }, 400)
    if (runtime.isRunning(p.canvasId, p.sessionId!)) {
      return c.json({ ok: false, error: '这一轮还在跑，等它结束再切换模型' }, 409)
    }
    // 压缩进行中也不能切：切模型要开新会话 + 种 Trace，与压缩写同一份上下文会互相踩
    if (runtime.isCompactActive(p.canvasId, p.sessionId!)) {
      return c.json({ ok: false, error: '正在压缩上下文，等它结束再切换模型' }, 409)
    }
    if (!branches) return c.json({ ok: false, error: '分支功能未启用' }, 503)
    try {
      const parent = await store.get(p.canvasId, p.sessionId!)
      if (!parent) return c.json({ ok: false, error: '会话不存在' }, 404)
      // 已经是这个模型：不折腾（否则每点一次都长一条新会话）
      if (parent.provider === provider && parent.modelId === modelId) {
        return c.json({ ok: true, sessionId: p.sessionId!, unchanged: true })
      }
      // 新会话的历史 = 父的全部回合；分段 = 父的旧分段 + 这新的一段
      const userCount = parent.turns.filter((t) => t.role === 'user').length
      const segments = [
        ...(parent.modelSegments ?? []),
        { fromUser: userCount, provider, modelId },
      ]
      // 第一段的模型：父会话若没有分段记录，就用父当前的模型补一段（否则第一段没有标签）。
      // dedupeSegments 折掉同起点的重复（同一位置连切两次模型时，只留最后一次的选择）。
      const seeded = parent.modelSegments?.length
        ? segments
        : [{ fromUser: 0, provider: parent.provider, modelId: parent.modelId }, ...segments]
      const finalSegments = dedupeSegments(seeded)
      const branched = await store.branchFromEnd(p.canvasId, p.sessionId!, {
        title: parent.title,
        provider,
        modelId,
        modelSegments: finalSegments,
      })
      // SDK 侧：种一份 Trace（resume 才认这条会话）——与 fork 同一套，失败要回滚
      try {
        const created = await store.get(p.canvasId, branched.sessionId)
        await seedForkTrace(config.dataDir, {
          parentSessionId: p.sessionId!,
          forkSessionId: branched.sessionId,
          canvasId: p.canvasId,
          turns: created?.turns ?? [],
          provider,
          modelId,
        })
      } catch (err) {
        await store.remove(p.canvasId, branched.sessionId).catch(() => undefined)
        throw new Error(
          '切换模型的 Trace 种子写入失败（已回滚）: ' + (err instanceof Error ? err.message : String(err)),
        )
      }
      await branches.register(p.canvasId, p.sessionId!, branched.point, branched.sessionId)
      const created = await store.get(p.canvasId, branched.sessionId)
      return c.json({
        ok: true,
        sessionId: branched.sessionId,
        parentId: branched.parentId,
        copied: branched.copied,
        provider,
        modelId,
        ...(created ? { title: created.title, modelSegments: created.modelSegments ?? [] } : {}),
      })
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  /**
   * 分支信息：这条会话的分支点 + **整张画布的分叉点全表**。
   *
   * 为什么给全表而不只给兄弟：分页器需要「父 + 同点全部子会话」的完整视图
   * （前端按当前所在会话计算 1/N 位置），多个分叉点时也能一次取全、不再来回请求。
   */
  app.get('/api/agent/canvases/:canvasId/sessions/:sessionId/branch-info', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    if (!branches) return c.json({ ok: false, error: '分支功能未启用' }, 503)
    const origin = await branches.pointOf(p.canvasId, p.sessionId!)
    const points = await branches.allPoints(p.canvasId)
    // 给每个分叉点算 userOrdinal（该位置之前有几个用户消息，0 基）：
    // 分页器要内联渲染在对应消息的回复块之后（用户口径 2026-10-07），
    // 前端用这个数定位插入点。parent 已删时用任一子会话的前缀算（fork 拷贝保证等价）。
    const withOrdinal = await Promise.all(
      points.map(async (pt) => {
        const m = /^turn:(\d+)$/.exec(pt.point)
        if (!m) return pt
        const n = Number(m[1])
        const parent = await store.get(p.canvasId, pt.parentId)
        const fallback = parent ? undefined : pt.children.length ? await store.get(p.canvasId, pt.children[0]) : undefined
        const rec = parent ?? fallback
        if (!rec) return pt
        const userOrdinal = rec.turns.slice(0, n).filter((t) => t.role === 'user').length
        return { ...pt, userOrdinal }
      }),
    )
    return c.json({
      ok: true,
      ...(origin ? { parentSessionId: origin.parentSessionId, point: origin.point } : {}),
      points: withOrdinal,
    })
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

  /**
   * 「压缩」：用户主动把上下文压成摘要（SDK 的 Session.compact，reason=manual）。
   *
   * 为什么给一个**独立的 SSE 流**而不是走 send：压缩不是一轮对话（没有用户消息、
   * 不进转录），但它是长动作、要能看见进度（begin → 摘要 → end）。
   * 所以借与消息流同一套 SSE 形态：事件带 id、前端按 seq 去重 —— 页面订阅的常驻流
   * 同时也收得到（hub.append 广播给所有订阅者），不会出现"只有点按钮的那个标签页看得见"。
   */
  app.post('/api/agent/canvases/:canvasId/sessions/:sessionId/compact', async (c) => {
    const p = guardParams(c)
    if (!p.ok) return p.res
    if (!hub) {
      // 旧直连模式：没有常驻通道可广播，压完了界面也收不到 —— 如实拒绝，别装作成功。
      return c.json({ ok: false, error: '托管未启用，压缩不可用' }, 503)
    }
    const ac = new AbortController()
    const subscribeSince = hub.lastSeq(p.canvasId, p.sessionId!)
    return streamSSE(c, async (stream) => {
      stream.onAbort(() => ac.abort())
      // 与 messages 路由同款：这个响应只是订阅者，事件由 runtime 产出后进 hub。
      // 起点在**压缩开始之前**取（subscribeSince）：之后 append 的事件都 > 它，一条不漏。
      const { unsubscribe } = hub.subscribe(p.canvasId, p.sessionId!, subscribeSince, (item) => {
        void stream.writeSSE({ id: String(item.seq), data: JSON.stringify(item.ev) })
      })
      try {
        for await (const ev of runtime.compact(p.canvasId, p.sessionId!, ac.signal)) {
          // 只 append 一次，让 hub 广播（订阅者=就是本响应）——不要既 append 又自己写，
          // 那会让同一事件到两次（前端按 seq 去重，重复的那次会被丢掉，但白跑一趟）。
          hub.append(p.canvasId, p.sessionId!, ev)
        }
      } catch (err) {
        hub.append(p.canvasId, p.sessionId!, {
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
      } finally {
        // 一帧收尾：与前端的 SSE 解析口径一致（流结束 = 这次压缩结束）。
        hub.append(p.canvasId, p.sessionId!, { type: 'done' })
        unsubscribe()
      }
    })
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

    const input = {
      canvasId: p.canvasId,
      sessionId: p.sessionId!,
      text,
      ...(images ? { images } : {}),
      ...(prefs ? { prefs } : {}),
    }

    // ---------------------------------------------------------------- 托管模式
    //
    // 「后台对话」开启（hub 存在）时：这一轮交给后台跑到底，本响应只是**订阅**它。
    // 页面刷新 = 这条订阅断掉，但那一轮继续跑（用户口径 2026-10-08）；
    // 回来时用 GET .../stream?since=N 接上（见下面的 stream 路由）。
    if (hub) {
      /**
       * 这一轮 **专有**事件的起点。
       *
       * 为什么不是 `Number(c.req.query('since') ?? 0)`（真机实测的洞）：send 响应是
       * 「订阅这一会话的常驻通道」，而前端发消息时**不带 since** ⇒ 恒为 0 ⇒ 每次发消息
       * 都把通道缓冲里的**全部历史事件**重放一遍。后果：第 2 条消息就重放第 1 轮
       * （探针实测 11 帧 → 21 帧、正文变成「回复甲回复甲回复乙回复乙」），界面上冒出
       * 重复的用户气泡、`run_state` 还会中途闪回 false；而且缓冲越满重放越大（O(n²)）。
       *
       * 正确口径：起点 = **开跑之前**的缓冲头水位。之后 append 的事件（这一轮的
       * run_state / session / user_message / 正文…）全部 > 它，一条不漏；之前的历史一条不重放。
       * 会话 id 还不存在时（首条消息要新建）水位就是 0 —— 反正那时候缓冲是空的。
       */
      const subscribeSince = hub.lastSeq(p.canvasId, p.sessionId!)
      // 带目标的消息（设计 §3.4.2）：先备好目标文件与第 1 轮文本，再走托管开跑。
      // 目标与普通消息的差别只有这一步（其余路径完全一样）。
      const goalSpec = body.goal && typeof body.goal === 'object'
        ? {
            objective: String((body.goal as Record<string, unknown>).objective ?? text),
            budget: Number((body.goal as Record<string, unknown>).budget ?? -1) || -1,
          }
        : null
      if (goalSpec && goalRuntime) {
        // pre-turn 对目标消息同样适用（插件可能改写/拦截）
        if (preTurn) {
          const preAc = new AbortController()
          const verdict = await preTurn({ canvasId: p.canvasId, input, abortSignal: preAc.signal })
          if (verdict.blocked) {
            return streamSSE(c, async (stream) => {
              await stream.writeSSE({
                data: JSON.stringify(verdict.response ?? { type: 'notice', message: '本轮已被插件拦截' }),
              })
              await stream.writeSSE({ data: JSON.stringify({ type: 'done' }) })
            })
          }
        }
        /**
         * 会话**正在跑**时别直接 beginGoal（代码审查发现的竞态）：
         * `beginGoal` 会先让 start.mjs 写好 GOAL.json，再调 startRun —— 而 startRun 在
         * 「已经在跑」时返回 `{started:false}`，那一步就白写了：目标文件躺在那儿、当前这一轮
         * 的 stop hook 下一拍就会读它开始续轮，可用户的 objective 文本**从没作为消息发出去**
         * （第 1 轮协议文本也一起丢了）。旧实现还回了一句 `{steered:true}` —— 其实什么都没送进去。
         *
         * 正确做法与「跑着时发普通消息」完全一致（设计 §3.3.3 / G2）：**进队列**，
         * 条目带 goal，轮到它时由调度器调 startGoal（见 QueueScheduler.tickBody）。
         */
        if (hub.isRunning(p.canvasId, p.sessionId!)) {
          const queued = await store.updateQueue(p.canvasId, p.sessionId!, (q) => ({
            ...q,
            items: [
              ...q.items,
              {
                id: 'q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
                text,
                ...(Array.isArray(body?.images) && body.images.length ? { images: body.images.map(String) } : {}),
                goal: { objective: goalSpec.objective, budget: goalSpec.budget },
                state: 'queued' as const,
                createdAt: Date.now(),
              },
            ],
          }))
          hub.append(p.canvasId, p.sessionId!, { type: 'queue', queue: queued })
          // 让调度器看一眼（这一轮跑完就会自动起这个目标）
          onQueueChanged?.(p.canvasId, p.sessionId!)
          return c.json({ ok: true, queued: true, sessionId: p.sessionId!, goal: true })
        }
        const outcome = await goalRuntime.beginGoal(p.canvasId, p.sessionId!, goalSpec.objective, goalSpec.budget)
        if (!outcome.started) {
          /**
           * beginGoal 返回 false = 恰好在这两步之间有一轮开跑了（竞态）。
           * 此前只回一句 `{steered:true}` —— 其实什么都没送进去（GOAL.json 已被
           * start.mjs 写好，可 objective 文本从没作为消息发出，用户看到「点了没反应」）。
           * 与上面「跑着发目标」同一条路：**进队列**（条目带 goal），调度器轮到它时按目标起。
           */
          const queued = await store.updateQueue(p.canvasId, p.sessionId!, (q) => ({
            ...q,
            items: [
              ...q.items,
              {
                id: 'q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
                text,
                ...(Array.isArray(body?.images) && body.images.length ? { images: body.images.map(String) } : {}),
                goal: { objective: goalSpec.objective, budget: goalSpec.budget },
                state: 'queued' as const,
                createdAt: Date.now(),
              },
            ],
          }))
          hub.append(p.canvasId, p.sessionId!, { type: 'queue', queue: queued })
          onQueueChanged?.(p.canvasId, p.sessionId!)
          return c.json({ ok: true, queued: true, sessionId: p.sessionId!, goal: true })
        }
        // 目标的**参考图**落进宿主记录（界面目标行画迷你图用；GOAL.json 是插件协议，不塞私有字段）
        const goalImages = Array.isArray(body?.images) ? (body!.images as unknown[]).map(String).filter(Boolean) : []
        void store.setGoalImages(p.canvasId, p.sessionId!, goalImages).catch(() => undefined)
        /**
         * 目标「开始跑」也要广播一次 goal_state（真机实测的洞）：
         * 界面上的目标行靠 goal_state 事件更新，而此前只有「改预算 / 暂停 / 恢复」才广播 ——
         * 于是**在这一页刚发起的那个目标**，界面一直不知道它存在，目标行不出现
         * （切一下会话才会显示，因为 openSession 会拉 full.goal）。
         * 读一次刚落盘的 GOAL.json 推给界面即可（beginGoal 里已写好）。
         */
        void readGoalState(sessionScratchpadPath(agentRoot(config.dataDir), p.sessionId!))
          .then((g) => {
            if (g) hub?.append(p.canvasId, p.sessionId!, { type: 'goal_state', goal: g })
          })
          .catch(() => undefined)
        return streamSSE(c, async (stream) => {
          const { unsubscribe } = hub.subscribe(p.canvasId, p.sessionId!, subscribeSince, (item) => {
            void stream.writeSSE({ id: String(item.seq), data: JSON.stringify(item.ev) })
          })
          stream.onAbort(() => unsubscribe())
          await new Promise<void>((resolve) => {
            const tick = setInterval(() => {
              if (!hub.isRunning(p.canvasId, p.sessionId!)) {
                clearInterval(tick)
                resolve()
              }
            }, 120)
            stream.onAbort(() => {
              clearInterval(tick)
              resolve()
            })
          })
          unsubscribe()
        })
      }
      // ★ pre-turn 必须在**开跑之前**跑（空链 = 零开销、直接返回 {}）。
      //   拦截时不进模型、也不起这一轮。
      if (preTurn) {
        const preAc = new AbortController()
        const verdict = await preTurn({ canvasId: p.canvasId, input, abortSignal: preAc.signal })
        if (verdict.blocked) {
          return streamSSE(c, async (stream) => {
            await stream.writeSSE({
              data: JSON.stringify(verdict.response ?? { type: 'notice', message: '本轮已被插件拦截' }),
            })
            await stream.writeSSE({ data: JSON.stringify({ type: 'done' }) })
          })
        }
      }
      const outcome = await runtime.startRun(p.canvasId, input)
      if (!outcome.started) {
        /**
         * 已经在跑：这一句**进队列**（设计 G2「跑着发消息进队列」）。
         *
         * 此前这里回一句 `{steered:true}` 就完了 —— 而 runtime 在「已经在跑」时
         * **什么都没做**（既没 steer 也没落盘）：消息不进模型、不进转录、也不进队列，
         * 静默消失。多标签页 / 双客户端 / 常驻流断线期间的并发发送都会命中（代码审查实测）。
         * 落进队列后由调度器按序发，走的是与「跑着发普通消息」同一条路。
         */
        const queued = await store.updateQueue(p.canvasId, outcome.sessionId!, (q) => ({
          ...q,
          items: [
            ...q.items,
            {
              id: 'q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
              text,
              ...(images?.length ? { images: images.map(String) } : {}),
              // 带 goal 的请求（目标功能未注入时才会走到这）也把目标带上：
              // 调度器轮到它时按目标起，绝不把用户的「目标」意图降级成一句普通提问。
              ...(goalSpec ? { goal: { objective: goalSpec.objective, budget: goalSpec.budget } } : {}),
              state: 'queued' as const,
              createdAt: Date.now(),
            },
          ],
        }))
        hub.append(p.canvasId, outcome.sessionId!, { type: 'queue', queue: queued })
        onQueueChanged?.(p.canvasId, outcome.sessionId!)
        return c.json({ ok: true, queued: true, sessionId: outcome.sessionId })
      }
      return streamSSE(c, async (stream) => {
        // 订阅这一会话的常驻通道：起点是**开跑前**的水位（只收这一轮的事件，
        // 不重放历史 —— 见 subscribeSince 的说明），之后续推新的。
        // 断开 = 只是少一个订阅者，后台那一轮照跑（这就是「后台对话」）。
        const { unsubscribe } = hub.subscribe(p.canvasId!, outcome.sessionId!, subscribeSince, (item) => {
          void stream.writeSSE({ id: String(item.seq), data: JSON.stringify(item.ev) })
        })
        stream.onAbort(() => unsubscribe())
        // 响应挂到这一轮结束：前端用"SSE 还开着"作为正在收流的凭据。
        await new Promise<void>((resolve) => {
          const tick = setInterval(() => {
            if (!hub.isRunning(p.canvasId!, outcome.sessionId!)) {
              clearInterval(tick)
              resolve()
            }
          }, 120)
          stream.onAbort(() => {
            clearInterval(tick)
            resolve()
          })
        })
        unsubscribe()
      })
    }

    // ---------------------------------------------------------------- 旧直连模式
    // （没注入 hub 时保留原行为：一轮跑在响应里，断连即中止。单位测试与老宿主用。）
    const ac = new AbortController()
    return streamSSE(c, async (stream) => {
      // 浏览器关页面 / 断网：立刻中止这一轮，别让模型白跑
      stream.onAbort(() => ac.abort())
      // 直通通道：审批卡片是服务器在等，只能从这里推（生成器里 yield 不出去）
      const notify = (event: AgentChatEvent): void => {
        void stream.writeSSE({ data: JSON.stringify(event) })
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

/**
 * 读这条会话的目标状态（给 GET 会话用）。
 *
 * 为什么放在这个文件里而不是 goal 模块：它只需要"路径 + 读文件"，没有业务；
 * 目标的启动/暂停/恢复那些有业务的部分在 server.ts 注入的 goal 服务里。
 */
async function readGoalForSession(
  config: { dataDir: string },
  sessionId: string,
): Promise<unknown | undefined> {
  try {
    /**
     * 必须与「写」（goalRuntime / goal 插件的 `deps.scratchpadOf`）用**同一个根**：
     * `sessionScratchpadPath` 期望的是 **SDK 口径的 root**（= 本仓的 `agentRoot(dataDir)`），
     * 它会自己再拼 `<project>/agents/<agent>/scratchpad/<sid>`。
     *
     * 踩过的坑（真机 2026-10-09）：这里曾传 `config.dataDir`（数据根）——
     * 少了一层 `agent/`，于是 GOAL.json 明明在跑、GET 会话却恒为 `goal: undefined`，
     * 界面刷新后永远看不到目标状态（"目标不生效"的第二个根源）。
     * 与 agentPaths.ts 里那条"双源漂移"的教训同源：路径只认一处口径。
     */
    const scratch = sessionScratchpadPath(agentRoot(config.dataDir), sessionId)
    const state = await readGoalState(scratch)
    return state ?? undefined
  } catch {
    // 路径非法 / 读不了都不该让"打开会话"失败
    return undefined
  }
}
