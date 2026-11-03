/**
 * agentSessions 的「发送消息」路由实现。
 *
 * 从 agentSessions.ts 原样搬出；托管 / 旧直连两条路径、事件顺序与返回值未改。
 * 依赖全部由调用方按同一时刻的同一份值传入。
 */
import { streamSSE } from 'hono/streaming'
import type { Hono } from 'hono'
import type { AgentRuntime, SessionPrefs } from '../agent/runtime.js'
import type { AgentSessionStore } from '../agent/sessionStore.js'
import type { SessionHub } from '../agent/sessionHub.js'
import type { AgentChatEvent } from '../agent/translate.js'
import type { AgentConfigService } from '../agent/config.js'
import { safeJson } from './agent.js'
import { readGoalState } from '../agent/goalState.js'
import { agentRoot, sessionScratchpadPath } from '../agent/agentPaths.js'
import type { GoalRuntimePort } from './agentSessionsShared.js'

export interface MessageRouteDeps {
  store: AgentSessionStore
  runtime: AgentRuntime
  config: AgentConfigService
  hub?: SessionHub
  onQueueChanged?: (canvasId: string, sessionId: string) => void
  goalRuntime?: GoalRuntimePort
  guardParams: (c: { req: { param: (k: string) => string | undefined } }) => { ok: true; canvasId: string; sessionId?: string } | { ok: false; res: Response }
  readPrefs: (body: Record<string, unknown> | undefined) => Promise<SessionPrefs | undefined>
  preTurn?: (turn: {
    canvasId: string
    input: { canvasId: string; sessionId: string; text: string; images?: string[]; prefs?: SessionPrefs }
    abortSignal: AbortSignal
  }) => Promise<{ blocked?: true; response?: unknown }>
}

export function registerMessageRoute(app: Hono, deps: MessageRouteDeps): void {
  const { store, runtime, config, preTurn, hub, onQueueChanged, goalRuntime, guardParams, readPrefs } = deps
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
              // ⚠️ 用 `input.text` 而不是上面的 `text`：中间件可能刚改写它
              //    （preTurn 收的就是 input 的引用），用 `text` 会把改写丢掉。
              text: input.text,
              ...(input.images?.length ? { images: input.images.map(String) } : {}),
              // 带 goal 的请求（目标功能未注入时才会走到这）也把目标带上：
              // 调度器轮到它时按目标起，绝不把用户的「目标」意图降级成一句普通提问。
              ...(goalSpec ? { goal: { objective: goalSpec.objective, budget: goalSpec.budget } } : {}),
              state: 'queued' as const,
              createdAt: Date.now(),
              // ★ 上面已经跑过 pre-turn 了（这正是「跑着发」这条路）：调度器轮到它时
              //   **不许再跑一遍**，否则有状态的中间件（配额、计数）会对同一条记两次账。
              //   正文用的是 input.text（**改写后**的那份），不是原始 text。
              preTurned: true,
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
}

