/**
 * runState —— data.runState 的读写与归一（纯函数，零 Vue/零 DOM，node 可单测）。
 *
 * 形状与 mcp-server 既有的一致（有意撞名：同一个含义用同一个键，云端后台写的进度
 * 前端能直接显示）。写盘走 doc.updateNodeRuntime（落盘但不进撤销栈），见 graphDocument。
 */
import type { ToolProgress } from '@mini-canvas/kernel'

/** 节点运行状态（唯一持久化位置 = node.data.runState） */
export interface NodeRunState {
  status: 'idle' | 'running' | 'done' | 'error'
  /** 0-100；外部只给阶段时省略（UI 走不确定态） */
  progress?: number
  message?: string
  /** 异步任务 id（刷新后靠它续查） */
  taskId?: string
  /** 谁提交的（用户要求：保存「任务是谁提交的」） */
  actionId?: string
  /** 提交时间戳（ms；诊断用） */
  startedAt?: number
}

const STATUSES: ReadonlySet<string> = new Set(['idle', 'running', 'done', 'error'])

/** 收敛进度到 0-100（NaN/Infinity/越界全部夹回合法区间） */
function clampProgress(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return Math.max(0, Math.min(100, v))
}

/** 读节点 data 里的 runState 并归一：缺省 idle，非法值收敛而不是报错 */
export function readRunState(data: Record<string, unknown> | undefined | null): NodeRunState {
  const raw = (data?.runState ?? {}) as Partial<NodeRunState>
  const status = typeof raw.status === 'string' && STATUSES.has(raw.status) ? raw.status : 'idle'
  const out: NodeRunState = { status }
  const progress = clampProgress(raw.progress)
  if (progress !== undefined) out.progress = progress
  if (typeof raw.message === 'string' && raw.message) out.message = raw.message
  if (typeof raw.taskId === 'string' && raw.taskId) out.taskId = raw.taskId
  if (typeof raw.actionId === 'string' && raw.actionId) out.actionId = raw.actionId
  if (typeof raw.startedAt === 'number' && Number.isFinite(raw.startedAt)) out.startedAt = raw.startedAt
  return out
}

/** 提交那一帧：running + 0% + 提交者 + 排队文案 */
export function runningState(actionId: string, message?: string): NodeRunState {
  return { status: 'running', progress: 0, actionId, startedAt: Date.now(), message: message ?? '任务已提交，等待执行…' }
}

/** 中间帧：进度/文案/taskId 覆盖进上一帧，actionId 恒不丢（刷新后要知道是谁提交的） */
export function progressState(base: NodeRunState, p: ToolProgress): NodeRunState {
  const next: NodeRunState = { ...base }
  const progress = clampProgress(p.progress)
  if (progress !== undefined) next.progress = progress
  if (typeof p.message === 'string' && p.message) next.message = p.message
  if (typeof p.taskId === 'string' && p.taskId) next.taskId = p.taskId
  return next
}

/** 终态：done（100%） */
export function doneState(actionId: string, taskId?: string): NodeRunState {
  return { status: 'done', progress: 100, actionId, ...(taskId ? { taskId } : {}) }
}

/** 终态：error（失败文案给用户看，不写进作品字段） */
export function errorState(actionId: string, message: string): NodeRunState {
  return { status: 'error', message, actionId }
}

