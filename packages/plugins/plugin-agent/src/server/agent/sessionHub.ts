/**
 * SessionHub —— 每会话一条**常驻事件通道**（设计 §3.2）。
 *
 * 为什么需要它：过去"跑一轮"的生命周期绑在浏览器那条 HTTP 响应上 —— 页面刷新 = 连接断开 =
 * 服务端主动 abort 这一轮（路由里 stream.onAbort 的原话）。现在把两者解耦：
 *
 *   1. 一轮在**后台**自己跑到底（本文件驱动），不受任何 HTTP 连接影响；
 *   2. 每次事件追加进本会话的缓冲（带自增 seq），并推给当前所有订阅者；
 *   3. 页面用「订阅」来收听 —— 断了只是少一个订阅者，跑照跑；
 *      刷新后拿 since=N 重新订阅，先把 N 之后的事件回放给它，再续推新的。
 *
 * 为什么是"每会话常驻"而不是"每轮一个"：队列（排队消息）在**会话空闲时**也会自动起下一轮，
 * 那时没有正在跑的 run，但事件（队列变化、下一轮的开始）仍然必须有人推给页面 ——
 * 常驻通道是这些"非 run 事件"的家。
 */
import type { AgentChatEvent } from './translate.js'

/** 缓冲里的一条事件（seq 单调递增，重连以它为坐标） */
export interface HubEvent {
  seq: number
  ev: AgentChatEvent
}

type Subscriber = (item: HubEvent) => void

/**
 * 这条事件是不是「已经落进转录」的那种。
 *
 * 决定重连时要不要跳过它：落过盘的（最终正文 / 思考 / 工具调用与结果）已经能从
 * GET 会话拿回来，重放会在界面上重复一遍；没落盘的（partial 增量、usage、notice、
 * error、approval_*、session、done）必须重放，界面才接得上"正在写的半段"。
 *
 * 为什么放在 hub 而不是 runtime 里调 markCommit：runtime 是"先写盘、后 yield"，
 * 它不知道该事件被分到的 seq；hub 在 append 的同一拍就能把水位推到位，不会错位。
 */
export function isTranscriptPersisted(ev: AgentChatEvent): boolean {
  if (ev.type === 'text' || ev.type === 'thinking') return ev.final === true
  return ev.type === 'tool_call' || ev.type === 'tool_output'
}

/** 缓冲上限：2000 条或约 500KB（先到先裁；裁掉的用 droppedSeq 记录，见设计第 5 点） */
const MAX_EVENTS = 2000
const MAX_BYTES = 500 * 1024

interface SessionChannel {
  events: HubEvent[]
  bytes: number
  /** 已被裁掉的最小 seq 之前的水位（0 = 一条都没裁过） */
  droppedSeq: number
  nextSeq: number
  subscribers: Set<Subscriber>
  /**
   * 「已落转录」的水位：最后一次成功写进会话文件的事件 seq。
   *
   * 断线重连的坐标：页面刷新后从**转录**（GET 会话）恢复历史，再订阅
   * `since=commitSeq` 拿到「还没落转录的那部分」——正在写的半段文字、跑着的工具。
   * 从 0 重放会与转录里的内容重复显示，所以必须用这个水位而不是 0。
   */
  commitSeq: number
  /** 订阅者对事件处理抛错时用的日志钩子（由宿主注入） */
  log?: (message: string, extra?: unknown) => void
}

export interface HubStartOptions {
  /** 跑这一轮的生产者（runtime 的事件生成器） */
  run: (signal: AbortSignal) => AsyncGenerator<AgentChatEvent>
  /** 出错了也要让界面知道（追加一条 error 事件） */
  onError?: (err: unknown) => void
}

export class SessionHub {
  private readonly channels = new Map<string, SessionChannel>()
  private readonly running = new Map<string, { abort: AbortController; startedAt: number }>()
  /**
   * 已删会话的「墓碑」：删掉之后到**应用层解禁**之前，一律拒绝再建通道。
   *
   * 为什么必须有：删会话时那一轮可能还在跑，它的 finally 一定会再 append 一次
   * `run_state:false`（runtime 还会 append `done`）—— 光删 channels 项没用，
   * channel() 是懒建的，一 append 就把它建回来（内存泄漏没止住）。
   */
  private readonly tombstones = new Set<string>()

  constructor(private readonly deps: { log?: (message: string, extra?: unknown) => void } = {}) {}

  private key(canvasId: string, sessionId: string): string {
    return canvasId + '/' + sessionId
  }

  private channel(canvasId: string, sessionId: string): SessionChannel {
    const k = this.key(canvasId, sessionId)
    let ch = this.channels.get(k)
    if (!ch) {
      ch = { events: [], bytes: 0, droppedSeq: 0, nextSeq: 1, subscribers: new Set(), commitSeq: 0, ...(this.deps.log ? { log: this.deps.log } : {}) }
      this.channels.set(k, ch)
    }
    return ch
  }

  /**
   * 追加一条事件：进缓冲（超限裁剪）+ 推给所有订阅者。
   *
   * 返回这条事件被分到的 seq：调用方若要**自己**再写一份到别的响应流上（如压缩路由），
   * 必须带上同一个 seq —— 否则前端的按-seq 去重认不出"这两条是同一件事"，
   * 界面上同一条事件会应用两遍（正文重复 / 状态翻转）。
   */
  append(canvasId: string, sessionId: string, ev: AgentChatEvent): number {
    // 会话已删：这条是「正在跑的那一轮」的收尾事件，丢掉即可（别把通道建回来）
    if (this.tombstones.has(this.key(canvasId, sessionId))) return 0
    const ch = this.channel(canvasId, sessionId)
    const item: HubEvent = { seq: ch.nextSeq++, ev }
    ch.events.push(item)
    ch.bytes += JSON.stringify(ev).length
    while (ch.events.length > MAX_EVENTS || (ch.bytes > MAX_BYTES && ch.events.length > 1)) {
      const gone = ch.events.shift()
      if (!gone) break
      ch.bytes -= JSON.stringify(gone.ev).length
      ch.droppedSeq = gone.seq
    }
    for (const sub of [...ch.subscribers]) {
      try {
        sub(item)
      } catch (err) {
        // 一个订阅者坏掉不能影响其他人，更不能影响这一轮
        ch.log?.('hub subscriber threw', { err: err instanceof Error ? err.message : String(err) })
      }
    }
    return item.seq
  }

  /**
   * 订阅：先回放 since 之后的事件，再续推新的。
   *
   * 返回值里的 gapDetected 为真 = since 太旧、中间那段已被裁掉（调用方应当
   * 用「GET 会话转录」重放一次再续，见设计 §3.2 第 5 点的保底路径）。
   */
  subscribe(
    canvasId: string,
    sessionId: string,
    since: number,
    onEvent: Subscriber,
  ): { replay: HubEvent[]; gapDetected: boolean; droppedSeq: number; unsubscribe: () => void } {
    const ch = this.channel(canvasId, sessionId)
    const replay = ch.events.filter((e) => e.seq > since)
    const gapDetected = since > 0 && since < ch.droppedSeq
    for (const item of replay) {
      try {
        onEvent(item)
      } catch (err) {
        ch.log?.('hub subscriber threw during replay', { err: err instanceof Error ? err.message : String(err) })
      }
    }
    ch.subscribers.add(onEvent)
    return {
      replay,
      gapDetected,
      droppedSeq: ch.droppedSeq,
      unsubscribe: () => {
        ch.subscribers.delete(onEvent)
      },
    }
  }

  /** 当前缓冲里最新一条事件的 seq（界面重连时用它对齐；空缓冲返回 0） */
  lastSeq(canvasId: string, sessionId: string): number {
    const ch = this.channels.get(this.key(canvasId, sessionId))
    return ch ? ch.nextSeq - 1 : 0
  }

  /** 已落转录的水位（新建通道 / 从没跑过 = 0） */
  commitSeq(canvasId: string, sessionId: string): number {
    const ch = this.channels.get(this.key(canvasId, sessionId))
    return ch ? ch.commitSeq : 0
  }

  /** 这条会话有没有一轮正在跑 */
  isRunning(canvasId: string, sessionId: string): boolean {
    return this.running.has(this.key(canvasId, sessionId))
  }

  /** 正在跑的那一轮从何时开始（界面显示"正在跑"的锚；没有返回 null） */
  runStartedAt(canvasId: string, sessionId: string): number | null {
    return this.running.get(this.key(canvasId, sessionId))?.startedAt ?? null
  }

  /**
   * 在后台跑一轮：消费生成器 → 每条事件 append；结束（正常/出错/中止）都收尾。
   *
   * 返回的 promise 在**这一轮彻底结束**时 resolve —— 调用方（队列调度器）靠它串起
   * "跑完一轮再决定发下一条"。注意这不是给 HTTP 用的：HTTP 只订阅，不 await 它。
   */
  async start(canvasId: string, sessionId: string, opts: HubStartOptions): Promise<void> {
    const k = this.key(canvasId, sessionId)
    // 会话已删：拒绝再开一轮（否则 channel() 会把刚删掉的通道又建回来）
    if (this.tombstones.has(k)) throw new Error('会话已删除，不能开新的一轮')
    if (this.running.has(k)) {
      throw new Error('这一轮已经在跑了（同一会话不能并发两个 run）')
    }
    const ch = this.channel(canvasId, sessionId)
    const abort = new AbortController()
    this.running.set(k, { abort, startedAt: Date.now() })
    // 明确广播"开跑了"：界面据此把发送键换成终止、并把这条会话标成"正在跑"。
    // 用专门事件而不是让界面从别的事件推断 —— 空闲时也会起轮（队列自动发），
    // 界面对"什么时候开始"需要一个不依赖具体事件的权威信号。
    this.append(canvasId, sessionId, { type: 'run_state', running: true })
    try {
      for await (const ev of opts.run(abort.signal)) {
        this.append(canvasId, sessionId, ev)
        // 落过盘的事件：追加的同一拍把水位推过它（重连不重放；见 isTranscriptPersisted）
        if (isTranscriptPersisted(ev)) ch.commitSeq = ch.nextSeq - 1
      }
    } catch (err) {
      // 生成器自己通常会 yield error 事件；这里兜住"生成器直接抛"的情况
      opts.onError?.(err)
      this.append(canvasId, sessionId, {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
      this.append(canvasId, sessionId, { type: 'done' })
    } finally {
      this.append(canvasId, sessionId, { type: 'run_state', running: false })
      this.running.delete(k)
    }
  }

  /** 中止正在跑的那一轮（用户点终止；hub 只负责发信号，收尾由 run 的 finally 做） */
  abort(canvasId: string, sessionId: string): boolean {
    const entry = this.running.get(this.key(canvasId, sessionId))
    if (!entry) return false
    entry.abort.abort()
    return true
  }

  /** 删会话时放掉这条通道（缓冲与订阅一起丢） */
  forget(canvasId: string, sessionId: string): void {
    const k = this.key(canvasId, sessionId)
    this.tombstones.add(k)
    this.running.get(k)?.abort.abort()
    this.channels.delete(k)
    this.running.delete(k)
  }

  /**
   * 解禁（复用同一个会话 id 时调）。
   *
   * 正常路径用不到：删会话后新建会拿新 id。留着它是为了「删了又拿同一个 id 建回来」
   * （恢复/测试）不至于被墓碑永久拒掉。
   */
  revive(canvasId: string, sessionId: string): void {
    this.tombstones.delete(this.key(canvasId, sessionId))
  }

  /** 进程退出时全部中止 */
  disposeAll(): void {
    for (const [, entry] of this.running) entry.abort.abort()
    this.running.clear()
    this.channels.clear()
  }
}
