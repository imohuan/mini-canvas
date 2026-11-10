/**
 * jobsWatcher —— 前端**唯一**的任务对账定时器。
 *
 * 用户口径 2026-11-10：任务只有后台在跑，前端不要「一个任务一个轮询」。
 * 这里一条定时器扫整张画布：
 *
 * 1. 收集所有 `runState.status === 'running'` 且有 `taskId` 的节点；
 * 2. **没有就一个请求都不发**；
 * 3. 有就一次批量问（`GET /api/jobs?ids=…`），按结果把进度 / 终态写回节点。
 *
 * 它只是 SSE 的兜底：推送正常时一问就发现「已经和后台一样」，不写任何东西
 * （每帧都写会让整张画布反复落盘）。
 *
 * 零 Vue / 零 DOM：时钟、请求、读写都由调用方注入，node 环境可单测。
 */
import type { ServerJob } from './apiTypes.js'

/** 画布上一个正在跑的节点（调用方从 doc 里扫出来） */
export interface RunningNodeLike {
  nodeId: string
  nodeType: string
  taskId: string
  actionId?: string
  data?: Record<string, unknown>
}

export interface JobsWatcherDeps {
  /** 扫描当前画布上所有 running 的节点 */
  listRunning(): RunningNodeLike[]
  /** 批量查任务（一次一批） */
  fetchJobs(ids: readonly string[]): Promise<Record<string, ServerJob | null>>
  /** 写运行期状态（= doc.updateNodeRuntime，落盘不进撤销栈） */
  writeRuntime(nodeId: string, data: Record<string, unknown>): void
  /** 写作品字段（= doc.updateNode，进历史）。终态产物落地用 */
  writeResult?(nodeId: string, data: Record<string, unknown>): void
  /** 对账间隔（ms），默认 2000 */
  intervalMs?: number
  /** 一次批量问多少个（默认 50；后台上限 200） */
  batchSize?: number
  /** 「已提交但还没有任务号」的宽限期（ms），默认 30 秒 */
  graceMs?: number
  now?(): number
  /** 页面是否可见（不可见时跳过这一拍） */
  visible?(): boolean
  onError?(message: string, err?: unknown): void
}

/** 默认对账间隔：SSE 是主路，这一拍只是兜底；太快没有意义，太慢用户看不到反应 */
export const DEFAULT_WATCH_MS = 2000
export const DEFAULT_BATCH = 50
/** 已提交、任务号还没回来的宽限期：与后台建任务、写回 taskId 的耗时对齐 */
export const DEFAULT_GRACE_MS = 30_000

/** 节点类型 → 产物字段（与后台 / 写入器同一套口径） */
const MEDIA_FIELD: Record<string, string> = {
  image: 'imageUrl',
  video: 'videoUrl',
  audio: 'audioUrl',
}

/** 把一批 id 切成若干块（后台一次最多 200，这里默认 50 更保守） */
export function chunkIds(ids: readonly string[], size: number): string[][] {
  const step = Math.max(1, Math.floor(size))
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += step) out.push(ids.slice(i, i + step))
  return out
}

/**
 * 后台 Job → 节点 runState 的那一帧。
 *
 * 只搬**后台给出的**字段，不自己估数（用户 2026-11-10：进度是后台的数据）。
 */
export function frameOf(job: ServerJob): Record<string, unknown> {
  if (job.status === 'running') {
    return {
      status: 'running',
      actionId: job.actionId,
      taskId: job.id,
      ...(typeof job.progress === 'number' ? { progress: job.progress } : {}),
      ...(typeof job.message === 'string' && job.message ? { message: job.message } : {}),
      ...(typeof job.value === 'number' ? { value: job.value } : {}),
      ...(typeof job.suffix === 'string' ? { suffix: job.suffix } : {}),
      ...(typeof job.progressText === 'string' ? { progressText: job.progressText } : {}),
      ...(typeof job.tail === 'string' ? { tail: job.tail } : {}),
      ...(typeof job.canCancel === 'boolean' ? { canCancel: job.canCancel } : {}),
    }
  }
  const r: { ok?: boolean; urls?: string[]; text?: string; error?: string } = job.result ?? {}
  if (job.status === 'done' && r.ok !== false) {
    return {
      status: 'done',
      progress: 100,
      actionId: job.actionId,
      taskId: job.id,
      ...(Array.isArray(r.urls) ? { urls: r.urls } : {}),
      ...(typeof job.canCancel === 'boolean' ? { canCancel: job.canCancel } : {}),
    }
  }
  const reason =
    typeof r.error === 'string' && r.error.trim()
      ? r.error.trim()
      : typeof job.message === 'string' && job.message.trim() && job.message !== 'queued'
        ? job.message.trim()
        : '任务失败（后台没有给出原因）'
  return {
    status: 'error',
    message: reason,
    reason,
    actionId: job.actionId,
    taskId: job.id,
    ...(typeof job.canCancel === 'boolean' ? { canCancel: job.canCancel } : {}),
  }
}

export interface JobsWatcher {
  start(): void
  stop(): void
  /** 立刻对账一次（回到前台 / 测试用） */
  tick(): Promise<void>
  isRunning(): boolean
}

export function createJobsWatcher(deps: JobsWatcherDeps): JobsWatcher {
  const intervalMs = deps.intervalMs ?? DEFAULT_WATCH_MS
  const batchSize = deps.batchSize ?? DEFAULT_BATCH
  const graceMs = deps.graceMs ?? DEFAULT_GRACE_MS
  const now = deps.now ?? Date.now
  const report = deps.onError ?? ((msg: string, err?: unknown) => console.warn('[cloud-client] ' + msg, err))
  let timer: ReturnType<typeof setInterval> | null = null
  let inflight = false

  /** 这一帧和节点上现有的完全一样就不写（每帧都写会让整张画布反复落盘） */
  function same(node: RunningNodeLike, next: Record<string, unknown>): boolean {
    const prev = (node.data?.runState ?? {}) as Record<string, unknown>
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
    for (const k of keys) {
      if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) return false
    }
    return true
  }

  /** 终态产物落地：后台没写进来时（SSE 断着）至少把媒体字段补上 */
  function writeArtifact(node: RunningNodeLike, job: ServerJob): void {
    if (!deps.writeResult) return
    const url = job.result?.urls?.[0]
    if (!url) return
    const field = MEDIA_FIELD[node.nodeType]
    if (!field) return
    if (typeof node.data?.[field] === 'string' && node.data[field] === url) return
    deps.writeResult(node.nodeId, { [field]: url })
  }

  async function runOnce(): Promise<void> {
    const visible = deps.visible
    if (visible && !visible()) return
    let nodes: RunningNodeLike[]
    try {
      nodes = deps.listRunning()
    } catch (err) {
      report('扫描在跑的任务失败', err)
      return
    }
    /** 没有在跑的节点：一个请求都不发 */
    if (nodes.length === 0) return

    /**
     * 有 running 但没有任务号：可能刚提交（后台还没建好任务），也可能是一条旧残留。
     * 宽限期内什么都不做；超时了才收敛成失败 —— 否则卡片会一直转圈。
     */
    const withId: RunningNodeLike[] = []
    const t = now()
    for (const n of nodes) {
      if (n.taskId) {
        withId.push(n)
        continue
      }
      const startedAt = Number((n.data?.runState as { startedAt?: unknown } | undefined)?.startedAt ?? 0)
      if (startedAt > 0 && t - startedAt <= graceMs) continue
      deps.writeRuntime(n.nodeId, {
        runState: {
          status: 'error',
          message: '上次的任务已经不在后台了（服务重启或任务丢失）',
          reason: '上次的任务已经不在后台了（服务重启或任务丢失）',
          hint: '重新点一次提交即可',
          ...(n.actionId ? { actionId: n.actionId } : {}),
        },
      })
    }
    if (withId.length === 0) return

    // 同一个任务号只问一次（理论上不会重复，但节点复制可能带出两份）
    const ids = [...new Set(withId.map((n) => n.taskId))]
    for (const chunk of chunkIds(ids, batchSize)) {
      let result: Record<string, ServerJob | null>
      try {
        result = await deps.fetchJobs(chunk)
      } catch (err) {
        // 这一批失败不当终态：下一拍再问（网络抖动很常见）
        report('批量查任务失败（稍后重试）', err)
        continue
      }
      for (const node of withId) {
        if (!chunk.includes(node.taskId)) continue
        const job = result[node.taskId]
        if (!job) {
          // 后台说没这个号：收敛成失败，别让卡片永远转
          deps.writeRuntime(node.nodeId, {
            runState: {
              status: 'error',
              message: '任务在后台已不存在（可能服务重启过）',
              reason: '任务在后台已不存在（可能服务重启过）',
              hint: '重新点一次提交即可',
              ...(node.actionId ? { actionId: node.actionId } : {}),
              taskId: node.taskId,
            },
          })
          continue
        }
        const frame = frameOf(job)
        if (!same(node, frame)) deps.writeRuntime(node.nodeId, { runState: frame })
        if (job.status !== 'running') writeArtifact(node, job)
      }
    }
  }

  async function tick(): Promise<void> {
    if (inflight) return
    inflight = true
    try {
      await runOnce()
    } finally {
      inflight = false
    }
  }

  return {
    start() {
      if (timer) return
      timer = setInterval(() => void tick(), intervalMs)
      void tick()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
    tick,
    isRunning: () => timer !== null,
  }
}
