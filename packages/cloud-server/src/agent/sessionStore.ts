/**
 * AgentSessionStore —— 一个画布下的会话索引与转录（纯逻辑，注入数据根，可单测）。
 *
 * 为什么自己存一份：SDK 的 resumeSession 恢复的是模型上下文（它自己的 trace），
 * 而界面要渲染的是「我们这轮聊了什么」。两者用途不同：trace 给 SDK 续上下文，
 * 本文件给界面回放（刷新 / 重启后都读它）。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { stripMarkupToPlain } from './referenceMarkup.js'
import { canvasAgentDir, canvasSessionFile, canvasSessionsDir, canvasSessionsFile } from './agentPaths.js'

export interface AgentTurn {
  role: 'user' | 'assistant' | 'thinking' | 'tool'
  text: string
  /**
   * 工具调用的结构化信息（role='tool' 时的正主）。
   *
   * 为什么不能只存 `text`（形如 `exec_command({...})`）：回放时分不出
   *   · 这条工具**还在跑**还是**早就跑完了**（界面据此画转圈还是画结果）；
   *   · 它原本是**卡片**（要审批的重活）还是**紧凑一行**。
   * 只存 text 的话，刷新后每条历史工具都会变回一个转圈的卡片（用户报的现象）。
   */
  tool?: { id: string; name: string; arguments: string; output?: string; card?: boolean }
  /** 这一轮结束时打的完成标记（没有 output 时也据此不再画转圈） */
  done?: boolean
  /**
   * 这条用户消息是**引导**（插队进进行中的那轮）而不是普通发送。
   *
   * 为什么落盘：引导消息也要在刷新后留在界面上（旧版只进 SDK trace、不进这里的转录，
   * 刷新后消失 —— 用户实测的洞）；标记让界面能画"引导"小标与普通消息区分。
   */
  steered?: boolean
  /**
   * 用户消息带的图片（data URL）。
   *
   * 落盘的理由：转录是给**界面回放**用的（刷新 / 切会话），图不存下来，
   * 重新打开历史就只剩一句光秃秃的文字，用户会以为图丢了。
   */
  images?: string[]
  ts: number
}

export interface AgentSessionMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  provider: string
  modelId: string
  preview?: string
}

/**
 * 一段「用同一个模型说的话」。
 *
 * 为什么要有它（用户口径 2026-10-11）：切换模型在 SDK 里等于开一条新会话
 * （模型在会话创建时钉死、改不了），而用户期待的是一条长对话里「从这里开始换了模型」——
 * 所以他要求界面画出**分割线**，并标明每段用的是哪个模型。
 *
 * 会话记录里只有一份 provider/modelId（当前那条），历史那段是哪个模型就丢了；
 * 这个数组把每段的起点与模型补回来，界面按 fromUser 在对应位置画分割线。
 */
export interface ModelSegment {
  /** 这一段的第一个用户消息在转录里的**序号**（0 基；按 user 回合数） */
  fromUser: number
  provider: string
  modelId: string
}

/**
 * 折掉**同起点**的重复分段，只留最后一个（即用户在该位置的最后一次选择）。
 *
 * 为什么放在这里而不是路由里：这是这份记录自身的完整性规则 —— 任何写分段的地方
 * （切模型、以后可能有的其它入口）都要满足它，写在数据结构旁边才不会漏。
 * 起点相同时按写入顺序取后者：后写的那次才是"现在真正在用的模型"。
 */
export function dedupeSegments(segments: ModelSegment[]): ModelSegment[] {
  const byStart = new Map<number, ModelSegment>()
  for (const s of segments) byStart.set(s.fromUser, s)
  return [...byStart.values()].sort((a, b) => a.fromUser - b.fromUser)
}

/**
 * 排队消息的状态：
 * - `queued`  等着发
 * - `editing` 正在编辑（阻塞队列，等用户点发送）
 * - `sending` 已认领、这一轮正在跑
 * - `sent`    已送达（留在列表里让界面画"已发送"，下一次 tick 移除）
 *
 * 为什么有 `sent` 这个中间态：从"已认领"到"从列表消失"如果只隔一次事件，
 * 用户看到的是列表突然空了、也没有气泡（用户实测："显示了发送中，为什么没有气泡？"）。
 * 留一拍让界面把这条画成"已发送"，同时它的气泡已经在对话里出现。
 */
export type QueueItemState = 'queued' | 'editing' | 'sending' | 'sent'

/** 排队消息自带的目标声明（轮到它时按目标模式启动） */
export interface QueueGoalSpec {
  objective: string
  /** 总预算（token），-1 = 不限 */
  budget: number
}

/** 一条排队消息。id 由宿主生成，是删除/编辑/引导的锚点 */
export interface QueueItem {
  id: string
  text: string
  /** 图片（data URL），与用户可以发送的消息同款 */
  images?: string[]
  goal?: QueueGoalSpec
  state: QueueItemState
  createdAt: number
  /** 认领（开始发）时的时刻；防重复发送的对账依据之一 */
  sentAt?: number
  /**
   * 这条已经过 pre-turn 中间件了吗（正文是**已改写后**的）。
   *
   * 为什么需要它：跑着发消息时，HTTP 路由会先跑一遍中间件（好决定拦不拦），
   * 发现会话在跑 → 落进队列。等调度器轮到它时**不能再跑一遍** ——
   * 否则「配额计数」这类有状态的中间件会对同一条消息记两次账。
   */
  preTurned?: boolean
}

/** 一个会话的待发队列（用户口径 2026-10-08：随会话文件走，刷新/重启后还在） */
export interface QueueState {
  paused: boolean
  items: QueueItem[]
}

export interface AgentSessionRecord extends AgentSessionMeta {
  turns: AgentTurn[]
  /** 待发消息队列（宿主自己的排队系统；见设计文档 §3.3） */
  queue?: QueueState
  /** 目标是否被宿主暂停（goal 功能；GOAL.json 被挪走时置 true；设计 §3.4.4） */
  goalPaused?: boolean
  /**
   * 当前目标的**参考图**（data URL；发起 / 编辑目标时由界面写入）。
   * 为什么放宿主记录而不是 GOAL.json：那个文件是 goal 插件的协议，字段固定，
   * 宿主往里塞私有字段可能被插件判成坏文件；参考图是「界面展示」用的宿主数据，放这里。
   */
  goalImages?: string[]
  /**
   * 本会话的模型分段（见 ModelSegment）。只有**换过模型**的会话才有它；
   * 没换过的会话不写这个字段（老数据、单模型会话都照常渲染一条线到底）。
   */
  modelSegments?: ModelSegment[]
  /**
   * 最近一次模型请求的上下文用量（token_usage 的 used / limit）。
   *
   * 为什么必须落盘（用户口径 2026-10-11 报的"上下文进度莫名其妙消失"）：
   * usage 事件不落转录、也不在重连时重放 —— 刷新 / 切会话 / 面板重开后界面上那个
   * 指示器就彻底没了，只有再发一条消息才回来。把它存进会话记录，恢复会话时一并带回去。
   */
  lastUsage?: { usedTokens: number; limitTokens: number | null }
}

interface IndexFile {
  sessions: AgentSessionMeta[]
}

export class AgentSessionStore {
  constructor(private readonly root: string) {}

  /**
   * 每会话一条写入串行链。
   *
   * 为什么必须串行：队列更新（patch）与转录追加（appendTurn）写的是**同一个文件**，
   * 各自「读 → 改 → 写」并发交错就会互相覆盖（后写的那次把前一次的改动吞掉）。
   * 串行链让同一会话的所有写排队执行，链与链之间互不影响（不同会话不互相等）。
   */
  private readonly chains = new Map<string, Promise<unknown>>()

  private serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve()
    const next = prev.then(task, task)
    // 链本身不因某次失败而断：吞掉结果，只保留时序
    this.chains.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }

  /** 会话列表（新的在前）。索引不存在 = 还没有会话，返回空数组 */
  async list(canvasId: string): Promise<AgentSessionMeta[]> {
    const idx = await this.readIndex(canvasId)
    return [...idx.sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(canvasId: string, sessionId: string): Promise<AgentSessionRecord | undefined> {
    return readJson<AgentSessionRecord>(canvasSessionFile(this.root, canvasId, sessionId))
  }

  /**
   * 落一份带元信息的转录文件；已存在则原样返回（不覆盖转录）。
   * 公开入口走串行链 —— 与 appendTurn / queue 操作共用同一条链，避免并发覆盖。
   */
  async ensure(canvasId: string, meta: Omit<AgentSessionMeta, 'updatedAt'>): Promise<AgentSessionRecord> {
    return this.serialize(this.key(canvasId, meta.id), () => this.ensureRecord(canvasId, meta))
  }

  /** ensure 的无锁内核（供已持有串行链的调用方复用；直接调用会绕过串行） */
  private async ensureRecord(
    canvasId: string,
    meta: Omit<AgentSessionMeta, 'updatedAt'>,
  ): Promise<AgentSessionRecord> {
    const existing = await this.get(canvasId, meta.id)
    if (existing) return existing
    const record: AgentSessionRecord = { ...meta, updatedAt: Date.now(), turns: [] }
    await this.writeRecord(canvasId, record)
    await this.upsertIndex(canvasId, record)
    return record
  }

  /** 串行链的键（画布 + 会话；同一会话一把锁） */
  private key(canvasId: string, sessionId: string): string {
    return canvasId + '/' + sessionId
  }

  // ------------------------------------------------------------------ 队列

  /** 读队列（没有就返回空队列；老会话文件没有这个字段也兼容） */
  async getQueue(canvasId: string, sessionId: string): Promise<QueueState> {
    const record = await this.get(canvasId, sessionId)
    const q = record?.queue
    return { paused: q?.paused === true, items: Array.isArray(q?.items) ? q.items : [] }
  }

  /**
   * 在串行链上改队列：读 → 改 → 写。
   *
   * mutator 拿到当前队列的**深拷贝**，改完返回新队列；返回 null 表示放弃本次修改
   * （返回值也用于告诉调用方"认领失败"这类结果）。整个过程在该会话的锁内完成，
   * 外部多次调用也不会交错 —— 这是"一条消息只发一次"的地基。
   */
  async updateQueue(
    canvasId: string,
    sessionId: string,
    mutator: (queue: QueueState) => QueueState | null,
  ): Promise<QueueState | null> {
    return this.serialize(this.key(canvasId, sessionId), async () => {
      const record = await this.get(canvasId, sessionId)
      const current: QueueState = {
        paused: record?.queue?.paused === true,
        items: Array.isArray(record?.queue?.items) ? record!.queue!.items : [],
      }
      const next = mutator(structuredClone(current))
      if (next === null) return null
      const target =
        record ??
        (await this.ensureRecord(canvasId, {
          id: sessionId,
          title: '新会话',
          createdAt: Date.now(),
          provider: 'default',
          modelId: 'default',
        }))
      target.queue = next
      await this.writeRecord(canvasId, target)
      return next
    })
  }

  /** 记/清目标的宿主侧暂停标记（不进 GOAL.json；设计 §3.4.4） */
  async setGoalPaused(canvasId: string, sessionId: string, paused: boolean): Promise<void> {
    return this.serialize(this.key(canvasId, sessionId), async () => {
      const record = await this.get(canvasId, sessionId)
      if (!record) return
      if (paused) record.goalPaused = true
      else delete record.goalPaused
      await this.writeRecord(canvasId, record)
    })
  }

  /** 写当前目标的参考图（发起 / 编辑目标时；空数组 = 清掉） */
  async setGoalImages(canvasId: string, sessionId: string, images: string[]): Promise<void> {
    return this.serialize(this.key(canvasId, sessionId), async () => {
      const record = await this.get(canvasId, sessionId)
      if (!record) return
      if (images.length) record.goalImages = images
      else delete record.goalImages
      await this.writeRecord(canvasId, record)
    })
  }

  /** 追加一条并同步索引里的 updatedAt / preview（会话不存在时自动建） */
  async appendTurn(canvasId: string, sessionId: string, turn: AgentTurn): Promise<void> {
    return this.serialize(this.key(canvasId, sessionId), async () => {
      let record = await this.get(canvasId, sessionId)
      if (!record) {
        record = await this.ensureRecord(canvasId, {
          id: sessionId,
          title: '新会话',
          createdAt: turn.ts,
          provider: 'default',
          modelId: 'default',
        })
      }
      record.turns.push(turn)
      record.updatedAt = Date.now()
      if (turn.role === 'user' || turn.role === 'assistant') {
        // 摘要也要人类可读：剥标记再截断（用户消息里存的已是无标记文本，但旧数据 / 外部写入可能带）
        record.preview = stripMarkupToPlain(turn.text).slice(0, 160)
      }
      await this.writeRecord(canvasId, record)
      await this.upsertIndex(canvasId, record)
    })
  }

  /**
   * 给某条工具记录补上后到的信息（目前只有 output）。
   *
   * 为什么必须**原地补**而不是新追加一条：转录回放是按顺序重演，
   * 新追加一条会让界面上出现「一个永远没结果的调用 + 一条孤立的结果」。
   * 按 tool.id 从后往前找（同一轮里 id 唯一，倒着找最快命中最新的那条）。
   */
  async patchTool(
    canvasId: string,
    sessionId: string,
    toolId: string,
    patch: Partial<NonNullable<AgentTurn['tool']>>,
  ): Promise<boolean> {
    return this.serialize(this.key(canvasId, sessionId), async () => {
      const record = await this.get(canvasId, sessionId)
      if (!record) return false
      for (let i = record.turns.length - 1; i >= 0; i--) {
        const t = record.turns[i]
        if (t.role === 'tool' && t.tool?.id === toolId) {
          t.tool = { ...t.tool, ...patch }
          await this.writeRecord(canvasId, record)
          return true
        }
      }
      return false
    })
  }

  /**
   * 一轮跑完：把这条会话里**所有**工具记录标成已完成。
   *
   * 为什么需要这个「兜底」：有些工具不会吐 output（比如失败被跳过、或只回一个空结果），
   * 只按 output 判断完成的话，它们刷新后会永远停在「正在执行」的转圈上。
   */
  async finishTools(canvasId: string, sessionId: string): Promise<void> {
    const record = await this.get(canvasId, sessionId)
    if (!record) return
    let changed = false
    for (const t of record.turns) {
      if (t.role === 'tool' && !t.done) {
        t.done = true
        changed = true
      }
    }
    if (changed) await this.writeRecord(canvasId, record)
  }

  /** 改标题；首句自动命名也走它 */
  async rename(canvasId: string, sessionId: string, title: string): Promise<boolean> {
    const record = await this.get(canvasId, sessionId)
    if (!record) return false
    record.title = title
    await this.writeRecord(canvasId, record)
    await this.upsertIndex(canvasId, record)
    return true
  }

  async remove(canvasId: string, sessionId: string): Promise<boolean> {
    const idx = await this.readIndex(canvasId)
    const next = idx.sessions.filter((s) => s.id !== sessionId)
    if (next.length === idx.sessions.length) return false
    // 记墓碑：删会话的那一刻可能还有一轮在跑，它的收尾会 appendTurn / 写队列 ——
    // 那些写会把文件**复活**（磁盘上留下半截脏会话）。只有本进程内记得住；
    // 服务重启后墓碑丢失，但那时正在跑的轮也早没了。
    this.removed.add(this.key(canvasId, sessionId))
    await writeJson(canvasSessionsFile(this.root, canvasId), { sessions: next })
    await fs.rm(canvasSessionFile(this.root, canvasId, sessionId), { force: true })
    return true
  }

  /** 已删会话的墓碑（同进程内拒绝再写；ensure / appendTurn / 队列写都查它） */
  private readonly removed = new Set<string>()

  /** 删整张画布的 agent 目录（删画布时调用；目录不存在也当成功） */
  async removeCanvas(canvasId: string): Promise<void> {
    await fs.rm(canvasAgentDir(this.root, canvasId), { recursive: true, force: true })
  }

  /**
   * 分支（fork）：从「某条用户消息之前」拷贝转录，开一条**新会话**。
   *
   * 用户口径（2026-10-06）：编辑旧消息重发 = 以它上面的内容为历史继续；
   * 它下面的旧回复留在原会话（变成另一个分支）。每个分支是独立的 AgentSession。
   *
   * 做法：找到那条用户消息，把它**之前**的回合拷成新会话的初始转录；
   * 新会话标题带分支来源（历史列表可辨认）。SDK 侧由路由层对新 id resumeSession ——
   * 转录在这里、resume 语义就是「按已有转录继续」。
   */
  async forkFrom(
    canvasId: string,
    parentSessionId: string,
    userText: string,
  ): Promise<{ sessionId: string; parentId: string; copied: number; point: string }> {
    const parent = await this.get(canvasId, parentSessionId)
    if (!parent) throw new Error('会话不存在: ' + parentSessionId)
    // 找**最后一条**匹配的用户消息（同名消息可能多条，编辑最晚那条最符合直觉）
    let at = -1
    for (let i = parent.turns.length - 1; i >= 0; i--) {
      const t = parent.turns[i]
      if (t.role === 'user' && t.text === userText) { at = i; break }
    }
    if (at === -1) throw new Error('会话里没有这条消息: ' + userText.slice(0, 40))
    // 分支点 = 这条消息在父转录中的下标；拷贝它**之前**的回合
    const copied = parent.turns.slice(0, at).map((t) => structuredClone(t))
    const sessionId = 'session-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 10)
    const title = parent.title + ' · 分支:' + userText.trim().replace(/\s+/g, ' ').slice(0, 12)
    await this.ensure(canvasId, {
      id: sessionId,
      title,
      createdAt: Date.now(),
      provider: parent.provider,
      modelId: parent.modelId,
    })
    for (const t of copied) await this.appendTurn(canvasId, sessionId, t)
    return { sessionId, parentId: parentSessionId, copied: copied.length, point: 'turn:' + at }
  }

  /**
   * 在**末尾**开一条分支：把父会话的全部转录拷进新会话，分叉点 = 末尾（turn:N，N = 总回合数）。
   *
   * 用途只有一个（用户口径 2026-10-11）：**切换模型**。
   * SDK 的模型钉在会话上、改不了，所以换模型只能开新会话；而用户要的是"接着聊、
   * 从这里起换了模型"—— 于是把历史整段带过去，再在界面上画一条分割线。
   *
   * 与 forkFrom 的差别：那个按**用户消息文本**定位分叉点（编辑重发），这里固定在末尾。
   * 分叉点用同一个 turn:N 形态登记进 branchStore —— 于是切换模型出来的新会话
   * 天然与"编辑出来的分支"共用一套分页器 / 历史聚合（用户要求的效果与分支一致）。
   */
  async branchFromEnd(
    canvasId: string,
    parentSessionId: string,
    opts: { title?: string; provider?: string; modelId?: string; modelSegments?: ModelSegment[] } = {},
  ): Promise<{ sessionId: string; parentId: string; copied: number; point: string }> {
    const parent = await this.get(canvasId, parentSessionId)
    if (!parent) throw new Error('会话不存在: ' + parentSessionId)
    const copied = parent.turns.map((t) => structuredClone(t))
    const sessionId = 'session-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 10)
    await this.ensure(canvasId, {
      id: sessionId,
      title: opts.title?.trim() || parent.title,
      createdAt: Date.now(),
      provider: opts.provider ?? parent.provider,
      modelId: opts.modelId ?? parent.modelId,
    })
    for (const t of copied) await this.appendTurn(canvasId, sessionId, t)
    // 模型分段随历史一起带过去；新的一段由路由追加 —— 追加前先**折掉同起点的旧分段**。
    //
    // 为什么要折（真机实测到的脏数据）：用户在同一位置连切两次模型（A → B → A）时，
    // 第二段会与第一段共用同一个 fromUser（转录没变），于是记录里出现
    // [A@0, B@1, A@1] 两条同起点的分段 —— 界面只能画一条线，另一条成了幽灵数据。
    // 折掉同起点的旧值后，每个起点只剩最后一次选择（这才对得上"界面上显示的那条线"）。
    if (opts.modelSegments?.length) {
      await this.setModelSegments(canvasId, sessionId, dedupeSegments(opts.modelSegments))
    }
    /**
     * 最近用量也带过去。
     *
     * 为什么不能只带转录：切模型后上下文没变（历史全在），界面上的"上下文用量"要是空的，
     * 用户看到的就是**刚换完模型指示器就消失了** —— 正是他报的那个"进度莫名其妙消失"
     * （这条会话是新 id，原来的用量记录留在父会话上）。
     */
    if (parent.lastUsage) {
      await this.setLastUsage(canvasId, sessionId, parent.lastUsage)
    }
    return {
      sessionId,
      parentId: parentSessionId,
      copied: copied.length,
      point: 'turn:' + parent.turns.length,
    }
  }

  /** 写模型分段（空数组 = 清掉）。分段是宿主侧记录，不塞进 SDK 那边。 */
  async setModelSegments(
    canvasId: string,
    sessionId: string,
    segments: ModelSegment[],
  ): Promise<void> {
    return this.serialize(this.key(canvasId, sessionId), async () => {
      const record = await this.get(canvasId, sessionId)
      if (!record) return
      if (segments.length) record.modelSegments = segments
      else delete record.modelSegments
      await this.writeRecord(canvasId, record)
    })
  }

  /**
   * 记下最近一次请求的上下文用量（界面恢复会话时用它把指示器画回来）。
   *
   * 为什么要节流写盘：每个模型请求都会发一次 token_usage（一轮里可能十几次），
   * 每次都"读整个会话文件 → 改 → 整写"代价不小，而且这些中间值没人要 ——
   * 只保留最新的那个（见 shouldWriteUsage 的节流判定，调用方判断）。
   */
  async setLastUsage(
    canvasId: string,
    sessionId: string,
    usage: { usedTokens: number; limitTokens: number | null },
  ): Promise<void> {
    return this.serialize(this.key(canvasId, sessionId), async () => {
      const record = await this.get(canvasId, sessionId)
      if (!record) return
      record.lastUsage = {
        usedTokens: Math.max(0, Math.round(usage.usedTokens)),
        ...(usage.limitTokens && usage.limitTokens > 0 ? { limitTokens: Math.round(usage.limitTokens) } : { limitTokens: null }),
      }
      await this.writeRecord(canvasId, record)
    })
  }

  private async readIndex(canvasId: string): Promise<IndexFile> {
    const raw = await readJson<IndexFile>(canvasSessionsFile(this.root, canvasId))
    return { sessions: Array.isArray(raw?.sessions) ? raw.sessions : [] }
  }

  private async writeRecord(canvasId: string, record: AgentSessionRecord): Promise<void> {
    // 已删会话：**不落盘**（正在跑的那一轮收尾时会来写，走了就把它删掉；
    // 不拦的话删会话后磁盘上会重新长出一条只留半截的脏会话）
    if (this.removed.has(this.key(canvasId, record.id))) return
    await fs.mkdir(canvasSessionsDir(this.root, canvasId), { recursive: true })
    await writeJson(canvasSessionFile(this.root, canvasId, record.id), record)
  }

  private async upsertIndex(canvasId: string, record: AgentSessionRecord): Promise<void> {
    // 已删会话：不重新登记进索引（否则列表里会冒出一条已删会话）
    if (this.removed.has(this.key(canvasId, record.id))) return
    const idx = await this.readIndex(canvasId)
    const meta: AgentSessionMeta = {
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      provider: record.provider,
      modelId: record.modelId,
      ...(record.preview !== undefined ? { preview: record.preview } : {}),
    }
    const next = idx.sessions.filter((s) => s.id !== record.id)
    next.push(meta)
    await writeJson(canvasSessionsFile(this.root, canvasId), { sessions: next })
  }
}

/** 读 JSON；不存在 / 内容坏掉都返回 undefined 并出声（与 canvasStore 同口径） */
async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.warn('[agentSessionStore] ' + file + ' 不是合法 JSON，按缺失处理')
      return undefined
    }
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT') {
      return undefined
    }
    throw err
  }
}

/** 原子写（先临时文件再 rename），与 canvasStore 同一套做法 */
async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await fs.rename(tmp, file)
}
