/**
 * QueueScheduler —— 队列的**唯一裁判**（设计 §3.3.2 / §3.3.4）。
 *
 * 职责只有一件：决定"现在要不要发下一条"，以及把"发"这件事安全地做掉。
 * 浏览器不参与这个决定（它只发指令：加/删/改/暂停/引导），后台服务重启也不丢
 * （队列在会话文件里，这里的 `inflight` 只是"本次进程内正在发的"）。
 *
 * ## 三条纪律（对应设计 §3.3.1，用户口径"不许发两遍、不许脏数据"）
 *
 * 1. **单裁判**：`tick` 是唯一入口；所有触发点（一轮结束、队列变更、暂停/恢复、
 *    服务启动）都调它。同一会话同时在跑的 tick 用 `inflight` 挡住。
 * 2. **原子认领**：`queued → sending` 的流转在 sessionStore 的串行链里完成；
 *    认领不到的（已被别处认领/已删除）直接放弃 —— 绝不重发。
 * 3. **失败不吞**：认领后发送失败（模型报错/中止），条目**留在 sending**，
 *    由下一次 tick 的对账逻辑按转录判定（已在转录里 ⇒ 移除；不在 ⇒ 退回 queued）。
 *
 * ## 什么时候才发（三个条件同时满足）
 * - 会话空闲（没有一轮在跑）；
 * - 队列未暂停；
 * - 队头不是 editing（用户正在编辑某条 ⇒ 队列停在原地等他发送）。
 */
import type { AgentSessionStore, QueueItem, QueueItemState, QueueState } from './sessionStore.js'
import type { AgentRuntime, StartRunInput } from './runtime.js'
import type { SessionHub } from './sessionHub.js'
import type { AgentChatEvent } from './translate.js'

export interface QueueSchedulerDeps {
  store: AgentSessionStore
  runtime: AgentRuntime
  hub: SessionHub
  /** 起一轮的真正实现（由宿主注入：它认识 SDK 会话与 prefs；这里不直接依赖） */
  startRun: (input: StartRunInput) => Promise<{ started: boolean; sessionId?: string }>
  /**
   * 目标启动（设计 §3.4.2）：条目带 goal 时用它而不是普通 startRun。
   * 不注入 = 目标功能不可用（带 goal 的条目按普通消息发，绝不静默丢）。
   */
  startGoal?: (
    canvasId: string,
    sessionId: string,
    objective: string,
    budget: number,
  ) => Promise<{ started: boolean }>
  log?: (message: string, extra?: unknown) => void
}

/** 队列事件的广播（界面靠它更新输入框上方的列表） */
function broadcastQueue(deps: QueueSchedulerDeps, canvasId: string, sessionId: string, queue: unknown): void {
  deps.hub.append(canvasId, sessionId, { type: 'queue', queue } satisfies AgentChatEvent)
}

export class QueueScheduler {
  /** 正在 tick 的会话（防同一会话并发 tick —— 纪律 1 的实现） */
  private readonly inflight = new Set<string>()
  /**
   * 上一次 tick 时这个会话"还有没有待发消息"。
   *
   * 为什么记它：`queue_idle` 只在"从有到无"的那一次发（通知时机），
   * 不然每次 tick（一轮结束、用户点一下）都会广播一遍，界面会收到一串重复通知。
   */
  private readonly hadPending = new Set<string>()
  /**
   * 最近一次"发失败"的时间（会话级）。
   *
   * 为什么需要它：起不来通常是配置问题（没配模型、密钥错），而 tick 会被反复触发
   * （每轮结束 / 用户点一下 / 队列变更）——没有这个闸，它会以极快的频率重试同一条，
   * 刷爆日志、空转 CPU。失败后 30 秒内不再自动重试；用户的下一次操作照常立即生效
   * （`tick` 里"人为触发"这条路径不受影响 —— 见 tick 的 forced 参数）。
   */
  private readonly lastFailureAt = new Map<string, number>()
  /** 失败后的自动重试冷却（毫秒） */
  private static readonly RETRY_COOLDOWN_MS = 30_000

  constructor(private readonly deps: QueueSchedulerDeps) {}

  private key(canvasId: string, sessionId: string): string {
    return canvasId + '/' + sessionId
  }

  /**
   * 看看能不能发下一条。所有触发点都调它；不需要发就立刻返回。
   *
   * 为什么是"同步返回 void + 内部 await"：触发点遍布各处（路由、runtime 的 finally），
   * 它们不该被调度拖住；调度失败有日志、有对账兜底。
   */
  tick(canvasId: string, sessionId: string, opts: { forced?: boolean } = {}): void {
    const k = this.key(canvasId, sessionId)
    // 冷却期内不自动重试（forced = 用户明确操作：加消息、点恢复、改完配置回来 —— 立即生效）
    if (!opts.forced) {
      const failedAt = this.lastFailureAt.get(k)
      if (failedAt !== undefined && Date.now() - failedAt < QueueScheduler.RETRY_COOLDOWN_MS) return
    }
    void this.tickAsync(canvasId, sessionId).catch((err) => {
      this.deps.log?.('queue tick failed', {
        session: sessionId,
        err: err instanceof Error ? err.message : String(err),
      })
    })
  }

  /** 一轮跑完后的收尾：把 sending 的结算掉，再看下一条（runtime 的 finally 之后调） */
  onRunFinished(canvasId: string, sessionId: string): void {
    void this.settleAsync(canvasId, sessionId)
      .then(() => this.tickAsync(canvasId, sessionId))
      .catch((err) => {
        this.deps.log?.('queue settle failed', {
          session: sessionId,
          err: err instanceof Error ? err.message : String(err),
        })
      })
  }

  /** 会话被删除：清掉本会话的三张内存表（inflight / hadPending / lastFailureAt）。
   *  不清的后果（review 指出）：hadPending 残留会让 queue_idle 判错；
   *  lastFailureAt 残留会让新会话被旧会话的 30 秒失败冷却挡住自动发送。 */
  forget(canvasId: string, sessionId: string): void {
    const k = this.key(canvasId, sessionId)
    this.inflight.delete(k)
    this.hadPending.delete(k)
    this.lastFailureAt.delete(k)
  }

  /**
   * 对账 + 结算（设计 §3.3.1 的重启对账）：
   *
   * - `sending` 且转录里已有这条 user 回合 ⇒ 已送达：**标记为 sent 留在队列里**
   *   （界面据此把它显示成"已发送"一行，短暂停留后由界面自己收起），
   *   下次 tick 时再真正移除 —— 为什么要留一拍：立即移除会让"队列里那条"和
   *   "对话里刚冒出来的气泡"之间没有任何过渡，用户看到的是列表突然空了
   *   （用户实测："显示了发送中，为什么没有气泡？"）；
   * - `sending` 但转录里没有 ⇒ 没送达（进程重启/启动失败）：退回 `queued` 重排。
   *
   * 这里是"不重发"的最后一道闸：宁可把一条退回去重发**一次**（它确实没送达），
   * 也绝不把已送达的重发第二遍。
   */
  async settleAsync(canvasId: string, sessionId: string): Promise<void> {
    const record = await this.deps.store.get(canvasId, sessionId)
    if (!record?.queue?.items?.length) return
    const sending = record.queue.items.filter((it) => it.state === 'sending')
    if (!sending.length) return
    /**
     * 转录里的 user 回合指纹（文本 + 图，去空白比较；引导过的也算送达 ——
     * 它确实进过模型）。
     *
     * 为什么要带上图（回归审计发现的洞）：纯图条目 text 为空，只按文本比对时
     * 「转录里有没有这条」恒不成立 ⇒ 每次都走「退回 queued」⇒ 发一次、退一次、**无限重发**。
     * 指纹把「文本 + 图」一起纳入，两种消息（纯文字 / 纯图 / 图文）都落在同一条路径上。
     */
    const fingerprint = (text: string, images: string[] | undefined): string =>
      text.trim() + '\u0000' + JSON.stringify(images ?? [])
    const delivered = new Set(
      record.turns.filter((t) => t.role === 'user').map((t) => fingerprint(t.text, t.images)),
    )
    const queue = await this.deps.store.updateQueue(canvasId, sessionId, (q) => {
      const next: QueueItem[] = []
      for (const it of q.items) {
        if (it.state !== 'sending') {
          next.push(it)
          continue
        }
        // 带目标的条目：调度器走的是 `startGoal(objective)`，落进转录的正文是
        // **objective**（不是 item.text）—— 拿 item.text 比会恒不成立 ⇒ 退回 queued ⇒
        // 目标被反复重启。所以对账文本要按「这一条实际发出去的是什么」取。
        const sentText = it.goal ? it.goal.objective : it.text
        if (delivered.has(fingerprint(sentText, it.images))) {
          // 已送达：标成 sent 留在列表里（界面画成"已发送"，随后自己收起）。
          // 真正移除交给下一次 tick —— 见上面函数头对"为什么要留一拍"的说明。
          next.push({ ...it, state: 'sent' as QueueItemState })
          continue
        }
        // 没送达（进程重启 / 启动失败 / 转录里确实没有）：退回 queued 重排。
        // 宁可把一条退回去重发**一次**（它确实没送达），也绝不吞掉用户的东西。
        next.push({ ...it, state: 'queued' })
      }
      return { ...q, items: next }
    })
    if (queue) broadcastQueue(this.deps, canvasId, sessionId, queue)
  }

  private async tickAsync(canvasId: string, sessionId: string): Promise<void> {
    const k = this.key(canvasId, sessionId)
    if (this.inflight.has(k)) return
    this.inflight.add(k)
    try {
      await this.tickInner(canvasId, sessionId)
    } finally {
      this.inflight.delete(k)
    }
  }

  private async tickInner(canvasId: string, sessionId: string): Promise<void> {
    // 条件一：会话必须空闲（一轮跑完才轮到下一条）
    if (this.deps.hub.isRunning(canvasId, sessionId)) return
    const queue = await this.deps.store.getQueue(canvasId, sessionId)
    /**
     * tick 出口统一广播一次队列快照。
     *
     * 为什么放在出口而不是每个分支里：tick 里有多条 return 路径（暂停、编辑阻塞、
     * 认领失败、起不来…），逐条广播必然漏 —— 漏一次界面就停在旧状态
     * （用户实测：后台队列已空、前端还挂着一行）。
     * 出口一处广播 + 各关键动作即时广播（认领后）两者配合：
     * 前者保证"最终一致"，后者保证"变化立刻可见"。
     */
    const broadcast = (): void => {
      void this.deps.store
        .getQueue(canvasId, sessionId)
        .then((q) => broadcastQueue(this.deps, canvasId, sessionId, q))
        .catch(() => undefined)
    }
    try {
      await this.tickBody(canvasId, sessionId, queue)
    } finally {
      broadcast()
    }
  }

  private async tickBody(canvasId: string, sessionId: string, queue: QueueState): Promise<void> {
    const k = this.key(canvasId, sessionId)
    // 条件二：没暂停
    if (queue.paused) return
    /**
     * 先清掉"已送达"的行（它们留在列表里只为让界面画一拍"已发送"）。
     *
     * 为什么不只清队头：队列可能是 [sent, queued, queued]（前一条刚送达、后面还排着），
     * 只清队头的话后面的会永远不动。这里一次性清掉所有 sent，再按剩下的继续。
     */
    let current = queue
    const sentIds = current.items.filter((it) => it.state === 'sent').map((it) => it.id)
    if (sentIds.length) {
      const cleaned = await this.deps.store.updateQueue(canvasId, sessionId, (q) => ({
        ...q,
        items: q.items.filter((it) => !sentIds.includes(it.id)),
      }))
      if (cleaned) {
        current = cleaned
        broadcastQueue(this.deps, canvasId, sessionId, cleaned)
      }
    }
    const head = current.items[0]
    if (!head) {
      // 队列空了且当前没有轮在跑 ⇒ 广播「队列已跑完」（通知时机之二；设计 §3.5）。
      // 为什么在这里判而不是在结束时判：结束时可能还有下一条要发（那就不算"跑完"）。
      if (this.hadPending.has(k)) {
        this.hadPending.delete(k)
        this.deps.hub.append(canvasId, sessionId, { type: 'queue_idle' } satisfies AgentChatEvent)
      }
      return
    }
    this.hadPending.add(k)
    // 条件三：队头不在编辑中（用户在改它 ⇒ 队列停住等他点发送）
    if (head.state === 'editing') return
    // 已经在发（sending）的队头：说明上一轮还没结算（run 刚结束的竞态）——
    // 先结算再看，本轮不重复认领。
    if (head.state === 'sending') {
      await this.settleAsync(canvasId, sessionId)
      const after = await this.deps.store.getQueue(canvasId, sessionId)
      if (after.items[0]?.state === 'sending') return
    }

    // ---- 原子认领：queued → sending（在串行链里判"它还是队头且还是 queued"）
    let claimed: QueueItem | undefined
    const after = await this.deps.store.updateQueue(canvasId, sessionId, (q) => {
      const first = q.items[0]
      if (!first || first.state !== 'queued') return null // 被别人抢了/状态变了：放弃
      claimed = { ...first, state: 'sending', sentAt: Date.now() }
      return { ...q, items: [claimed, ...q.items.slice(1)] }
    })
    if (!claimed || !after) return
    // 认领成功立刻广播：队头从 queued 变 sending，界面要跟上
    // （不广播的话界面上的队列会"停在旧状态" —— 用户实测：后台队列已空、
    //   前端还挂着一行。）
    broadcastQueue(this.deps, canvasId, sessionId, after)

    // ---- 发（认领成功才发；失败也不回退，交给下一次对账）
    const item = claimed
    let started = false
    try {
      if (item.goal && this.deps.startGoal) {
        const r = await this.deps.startGoal(canvasId, sessionId, item.goal.objective, item.goal.budget)
        started = r.started
      } else {
        const r = await this.deps.startRun({
          canvasId,
          sessionId,
          text: item.text,
          ...(item.images?.length ? { images: item.images } : {}),
        })
        started = r.started
      }
    } catch (err) {
      this.deps.log?.('queue start failed', {
        session: sessionId,
        item: item.id,
        err: err instanceof Error ? err.message : String(err),
      })
    }
    if (!started) {
      this.lastFailureAt.set(k, Date.now())
      // 没起成（会话在跑 / 出错）：退回 queued，等下一次 tick（不丢消息）
      const back = await this.deps.store.updateQueue(canvasId, sessionId, (q) => ({
        ...q,
        items: q.items.map((it) => (it.id === item.id ? { ...it, state: 'queued' } : it)),
      }))
      if (back) broadcastQueue(this.deps, canvasId, sessionId, back)
      // 起不来往往是配置问题（没配模型、密钥错）——同一轮里反复重试只会刷日志。
      // 记一次失败并 STOP：等下一次**人为触发**（用户改配置后再点、或加新消息）
      // 再给它机会。消息还在队列里，不丢。
      this.deps.log?.('queue paused after failed dispatch (配置问题？修好后会随下一次操作恢复)', {
        session: sessionId,
        item: item.id,
      })
      return
    }
    this.deps.log?.('queue dispatched', { session: sessionId, item: item.id, goal: !!item.goal })
  }
}
