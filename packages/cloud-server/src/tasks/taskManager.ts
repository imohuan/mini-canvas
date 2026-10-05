/**
 * TaskManager —— 后台的任务调度中心（唯一驱动层）。
 *
 * 流程：下单 → 立刻返回 jobId → 后台自己轮 provider → 每一帧都把状态**写进节点**
 * （`data.runState`）→ 前端经 SSE 跟着变 → 终态归档一笔历史。
 *
 * 两条设计要点：
 *
 * 1. **写节点走增量口**（`batchNodes`，内部有串行锁）。整包写会与网页端的保存互相覆盖
 *    （网页端与后台是两个写方，谁后写谁覆盖 —— 这正是增量口存在的理由）。
 * 2. **进度帧不节流到"不写"**：前端要知道跑到哪了，所以每帧都写；
 *    但写的是**同一个 runState 键**，不会把节点撑大。
 */
import { randomUUID } from 'node:crypto'
import type { CanvasDocument } from '../mcp/canvasDoc.js'
import type { ProviderRegistry } from '../providers/registry.js'
import type { ActionDef, JobInput, Provider } from '../providers/types.js'
import type { HistoryStore } from './history.js'
import type { HistoryEntry, Job } from './types.js'

/** 默认轮询间隔（ms） */
export const DEFAULT_INTERVAL = 1500
/** 默认整体超时（ms）—— 长视频会被动作自己的 pollTimeoutMs 顶掉 */
export const DEFAULT_TIMEOUT = 300_000

/** 一次任务要用的外部能力（注入，便于单测给假货） */
export interface TaskDeps {
  doc: CanvasDocument
  /**
   * 按画布 id 取该画布的文档（多画布：**进度/终态要写进任务所属的那张画布**）。
   *
   * 不传时回落 `doc`（默认画布）。曾经的写法固定用 `doc`（默认画布的文档），于是
   * **非默认画布**上的任务，进度全写进了 default（那里根本没有那个节点 id）→ 静默失败，
   * 表现就是"进度一直卡在 0%"（用户实测）。
   */
  docForCanvas?: (canvasId: string) => CanvasDocument
  registry: ProviderRegistry
  history: HistoryStore
  /** 把节点里的 `res:<hash>` 引用解析成 provider 能取的真实地址 */
  resolveResourceUrl(canvasId: string, ref: string): string
  /** 测试可注入假时钟 / 睡眠 */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** 任务成功产出资源时的回调（server 用来把产物登记进资产目录；测试可省） */
  onArtifact?: (canvasId: string, urls: string[]) => void
  onError?: (message: string, err?: unknown) => void
}

/** 写 runState 的小工具（把"节点可能已被删"收敛掉：任务还在跑，只是没地方写进度） */
function nodeRunStatePatch(runState: Record<string, unknown>): { data: Record<string, unknown> } {
  return { data: { runState } }
}

export class TaskManager {
  private readonly jobs = new Map<string, Job>()
  /** 每个 job 一个取消句柄 */
  private readonly cancels = new Map<string, AbortController>()
  /** 已经不在跑的 job（终态）；后台循环据此提前收工，不留悬挂的循环 */
  private readonly settled = new Set<string>()
  /** 在跑的后台循环（dispose 要等它们退干净，否则关停后还有人在写盘） */
  private readonly running = new Set<Promise<void>>()

  constructor(private readonly deps: TaskDeps) {}

  /**
   * 停掉所有在跑的任务（服务关停 / 测试收尾）。
   *
   * **要 await**：abort 只是让循环"下一次检查时退出"，它可能正卡在一次写盘中间；
   * 不等的话，关停之后还会有一次迟到的写入（测试里实测过：清理临时目录时报非空）。
   */
  async dispose(): Promise<void> {
    for (const ctrl of this.cancels.values()) ctrl.abort()
    this.cancels.clear()
    await Promise.allSettled([...this.running])
  }

  /**
   * 建一个任务。**立即返回**（后台开始跑）。
   *
   * 提交是同步等 provider 的 `submit`（拿到 taskId 或立即完成），
   * 之后的推进全在后台循环里 —— 所以前端点完"发送"马上拿得到 jobId。
   */
  async createJob(input: JobInput): Promise<Job | { error: string }> {
    const action = this.deps.registry.getAction(input.actionId)
    if (!action) return { error: '未找到动作 ' + input.actionId }
    const provider = this.deps.registry.providerOf(input.actionId)
    if (!provider) return { error: '动作 ' + input.actionId + ' 没有归属的 provider' }

    const job: Job = {
      id: randomUUID(),
      canvasId: input.canvasId,
      nodeId: input.nodeId,
      actionId: input.actionId,
      providerId: provider.id,
      status: 'running',
      progress: 0,
      message: '任务已提交，等待执行…',
      createdAt: this.now(),
    }
    this.jobs.set(job.id, job)

    // 提交帧：立刻写节点，用户马上能看到"排队中"
    await this.writeRunState(job, { status: 'running', progress: 0, message: job.message, actionId: action.id, taskId: job.id, startedAt: job.createdAt })

    const ctrl = new AbortController()
    this.cancels.set(job.id, ctrl)
    // 后台跑（不阻塞 createJob 返回）
    const loop = this.run(job, provider, action, this.resolveInput(job.canvasId, input), ctrl.signal)
    this.running.add(loop)
    void loop.finally(() => this.running.delete(loop))
    return job
  }

  /** 查任务（前端轮询 / 续查用） */
  getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId)
  }

  /** 按节点反查（诊断用） */
  findJobByNode(canvasId: string, nodeId: string): Job | undefined {
    return [...this.jobs.values()].find((j) => j.canvasId === canvasId && j.nodeId === nodeId)
  }

  /** 列出全部任务（诊断用） */
  listJobs(): Job[] {
    return [...this.jobs.values()]
  }

  /**
   * 取消一个任务。
   *
   * 先 abort 本地等待（立刻收敛），再让 provider 去服务端真取消 ——
   * 只 abort 的话服务端那个任务还在跑、还在花钱。
   */
  async cancel(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId)
    if (!job) return false
    this.cancels.get(jobId)?.abort()
    if (job.providerTaskId) {
      const provider = this.deps.registry.providerOf(job.actionId)
      const action = this.deps.registry.getAction(job.actionId)
      if (provider?.cancel && action) {
        try {
          await provider.cancel(job.providerTaskId, action)
        } catch (err) {
          // 服务端取消失败不改变"本地已取消"这个事实（用户已经看到取消了）
          this.deps.onError?.('[tasks] 服务端取消失败', err)
        }
      }
    }
    return true
  }

  // ==================== 内部 ====================

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now()
  }

  private sleep(ms: number): Promise<void> {
    return this.deps.sleep ? this.deps.sleep(ms) : new Promise((r) => setTimeout(r, ms))
  }

  /** 把节点里的 res: 引用换成 provider 能取的真实地址（provider 拿不到"画布内相对引用"） */
  private resolveInput(canvasId: string, input: JobInput): JobInput {
    const resources = (input.resources ?? []).map((r) => ({
      ...r,
      ...(typeof r.url === 'string' && r.url.startsWith('res:')
        ? { url: this.deps.resolveResourceUrl(canvasId, r.url) }
        : {}),
    }))
    return { ...input, resources }
  }

  /** 写节点 runState（走增量口；节点已被删就静默跳过 —— 任务还在跑，只是没地方写进度） */
  private async writeRunState(job: Job, runState: Record<string, unknown>): Promise<void> {
    try {
      // 写进**任务所属那张画布**的文档（多画布）：用 deps.doc 会写错画布 → 静默失败 → 进度卡 0
      const doc = this.deps.docForCanvas?.(job.canvasId) ?? this.deps.doc
      await doc.batchNodes({ update: [{ id: job.nodeId, ...nodeRunStatePatch(runState) }] })
    } catch (err) {
      this.deps.onError?.('[tasks] 写节点进度失败（节点可能已被删除）', err)
    }
  }

  /** 后台推进：提交 → 轮询 → 终态 → 归档 */
  private async run(job: Job, provider: Provider, action: ActionDef, input: JobInput, signal: AbortSignal): Promise<void> {
    const interval = action.pollIntervalMs ?? DEFAULT_INTERVAL
    const timeoutMs = action.pollTimeoutMs ?? DEFAULT_TIMEOUT
    const startedAt = this.now()

    try {
      const submitted = await provider.submit(action, input)

      // 提交即完成（同步生成）
      if ('done' in submitted) {
        return this.finish(job, action, { ok: true, urls: submitted.urls, text: submitted.text })
      }
      if ('error' in submitted) {
        return this.finish(job, action, { ok: false, error: submitted.error })
      }

      job.providerTaskId = submitted.taskId

      // 轮询到终态
      while (true) {
        // 已经收敛过（被取消 / 已判超时）→ 立刻退出，不留悬挂循环
        if (this.settled.has(job.id)) return
        if (signal.aborted) {
          this.settled.add(job.id)
          await this.writeRunState(job, { status: 'error', message: '已取消', actionId: action.id, taskId: job.id })
          job.status = 'error'
          job.message = '已取消'
          job.finishedAt = this.now()
          return
        }
        if (this.now() - startedAt > timeoutMs) {
          const minutes = Math.max(1, Math.round(timeoutMs / 60000))
          return this.finish(job, action, { ok: false, error: '任务超时（已等待 ' + minutes + ' 分钟）' })
        }

        const poll = provider.poll ? await provider.poll(submitted.taskId, action) : { status: 'running' as const }
        if (poll.taskId) job.providerTaskId = poll.taskId

        if (poll.status === 'running') {
          job.progress = poll.progress ?? job.progress
          job.message = poll.message ?? job.message
          await this.writeRunState(job, {
            status: 'running',
            progress: job.progress,
            message: job.message,
            actionId: action.id,
            taskId: job.id,
            startedAt: job.createdAt,
          })
          await this.sleep(interval)
          continue
        }

        if (poll.status === 'error') {
          return this.finish(job, action, { ok: false, error: poll.error ?? '任务失败' })
        }
        return this.finish(job, action, { ok: true, urls: poll.urls, text: poll.text })
      }
    } catch (err) {
      // 任何异常都收敛成失败，不留悬挂的 running
      return this.finish(job, action, { ok: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      this.cancels.delete(job.id)
    }
  }

  /** 终态：写节点 + 归档历史 */
  private async finish(
    job: Job,
    action: ActionDef,
    result: { ok: boolean; urls?: string[]; text?: string; error?: string },
  ): Promise<void> {
    if (this.settled.has(job.id)) return
    this.settled.add(job.id)
    // 先落盘（节点 + 历史），**最后**才把 job 标成终态 ——
    // 反过来的话，别人一看到 status 变了就来读节点，可能读到的还是上一帧
    // （测试里实测过这个竞态）。
    const finishedAt = this.now()
    await this.writeRunState(
      job,
      result.ok
        ? { status: 'done', progress: 100, message: '已完成', actionId: action.id, taskId: job.id, urls: result.urls ?? [] }
        : { status: 'error', message: result.error ?? '任务失败', actionId: action.id, taskId: job.id },
    )

    await this.deps.history.append(job.canvasId, this.toHistoryEntry(job, action, result, finishedAt))

    // 成功且有产物 → 通知宿主把它登记进资产目录（用户口径：资产 = 所有生成过的产物）。
    // 放在历史之后、终态之前：登记失败不该影响任务终态（宿主侧自己兜错）。
    if (result.ok && result.urls && result.urls.length > 0) {
      this.deps.onArtifact?.(job.canvasId, result.urls)
    }

    job.status = result.ok ? 'done' : 'error'
    job.progress = result.ok ? 100 : job.progress
    job.result = { ...result, taskId: job.id }
    job.finishedAt = finishedAt
  }

  /** 从动作声明推断产物类型（前端按它分组 / 计数） */
  private kindOf(action: ActionDef): HistoryEntry['kind'] {
    const t = action.nodeTypes?.[0]
    return t === 'image' || t === 'video' || t === 'audio' ? t : 'other'
  }

  private toHistoryEntry(
    job: Job,
    action: ActionDef,
    result: { ok: boolean; urls?: string[]; text?: string; error?: string },
    finishedAt: number,
  ): HistoryEntry {
    return {
      id: randomUUID(),
      jobId: job.id,
      canvasId: job.canvasId,
      nodeId: job.nodeId,
      actionId: action.id,
      title: action.title,
      kind: this.kindOf(action),
      status: result.ok ? 'done' : 'error',
      // 还没有人工审核流程：一律 passed（前端的评级下拉因此不是死控件）
      rating: 'passed',
      ...(result.urls && result.urls.length > 0 ? { urls: result.urls } : {}),
      ...(result.text ? { text: result.text } : {}),
      createdAt: job.createdAt,
      finishedAt,
      ...(result.error ? { error: result.error } : {}),
    }
  }
}
