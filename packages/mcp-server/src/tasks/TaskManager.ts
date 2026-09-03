/**
 * TaskManager — 后台任务调度中心（唯一驱动层）
 *
 * 职责：接收"创建任务"，立即返回 task_id，随后由本管理器统一驱动一次生成，
 * 结果/进度写回目标节点的 data.runState，并经 GraphModel 事件（SSE）广播。
 *
 * 驱动模型（R3）：runner 契约为 run(task) → RunOutcome（GenerationResult | PollFn），
 * TaskManager 内部 while 定时调 PollFn 直到 done；不做双时钟。
 * - runner 返回 GenerationResult（同步）→ 直接 done
 * - runner 返回 PollFn → 按 interval 轮询，running 的 progress/message 转成节点 runState
 */
import { randomUUID } from 'node:crypto'
import type { GraphModel } from '../graph/GraphModel'
import type { GenerationPayload } from '../models/types'
import { getModelRegistry, type ModelRegistry } from '../models/ModelRegistry'

/** 任务状态 */
export type TaskStatus = 'pending' | 'processing' | 'done' | 'error'

/** 任务记录 */
export interface TaskRecord {
  id: string
  kind: string
  /** 关联的画布 id */
  canvasId: string
  /** 结果写回的目标节点 id */
  targetNodeId: string
  payload: GenerationPayload
  status: TaskStatus
  progress: number
  message?: string
  result?: unknown
  error?: string
  createdAt: number
}

export interface TaskManagerOptions {
  /** PollFn 轮询间隔 ms（默认 1500） */
  interval?: number
  /** 任务最大等待 ms（默认 10 分钟） */
  timeoutMs?: number
}

export class TaskManager {
  private model: GraphModel
  private registry: ModelRegistry
  private tasks = new Map<string, TaskRecord>()
  private interval: number
  private timeoutMs: number

  constructor(model: GraphModel, options: TaskManagerOptions & { registry?: ModelRegistry } = {}) {
    this.model = model
    this.registry = options.registry ?? getModelRegistry()
    this.interval = options.interval ?? 1500
    this.timeoutMs = options.timeoutMs ?? 600_000
  }

  /**
   * 创建任务。立即返回 task_id，后台开始处理。
   *
   * @param kind 任务类型（image/video/audio 等，用于 data.runState.status 区分）
   * @param canvasId 关联画布 id
   * @param targetNodeId 结果写回的目标节点 id
   * @param payload 生成载荷（GenerationPayload：model/promptText/ratio/resolution/resources）
   */
  createTask(
    kind: string,
    canvasId: string,
    targetNodeId: string,
    payload: GenerationPayload = { model: '', promptText: '', resources: [] },
  ): TaskRecord {
    const task: TaskRecord = {
      id: randomUUID(),
      kind,
      canvasId,
      targetNodeId,
      payload,
      status: 'pending',
      progress: 0,
      createdAt: Date.now(),
    }
    this.tasks.set(task.id, task)

    // 标记目标节点为排队中
    this.writeRunState(canvasId, targetNodeId, { status: 'running', progress: 0, message: '任务已提交，等待执行…', taskId: task.id })

    // 异步后台处理（确保 createTask 先返回 pending）
    setTimeout(() => void this.process(task), 0)
    return task
  }

  /** 查询任务状态 */
  getTaskStatus(taskId: string): TaskRecord | null {
    return this.tasks.get(taskId) ?? null
  }

  /** 按目标节点 id 反查任务 */
  findTaskByNode(canvasId: string, nodeId: string): TaskRecord | undefined {
    return [...this.tasks.values()].find((t) => t.canvasId === canvasId && t.targetNodeId === nodeId)
  }

  /** 列出所有任务 */
  listTasks(): TaskRecord[] {
    return [...this.tasks.values()]
  }

  /** 统一写回节点 data.runState（触发 node:updated(全量) → SSE 广播） */
  private writeRunState(canvasId: string, nodeId: string, rs: Record<string, unknown>): void {
    const node = this.model.getNode(canvasId, nodeId)
    if (!node) return
    const data = node.data ?? {}
    this.model.updateNode(canvasId, nodeId, {
      data: { ...data, runState: { ...((data.runState as Record<string, unknown>) ?? {}), ...rs } },
    })
  }

  /** 后台处理流程 */
  private async process(task: TaskRecord): Promise<void> {
    task.status = 'processing'
    const updateNode = (rs: Record<string, unknown>) => this.writeRunState(task.canvasId, task.targetNodeId, rs)
    const onProgress = (p: { progress?: number; message?: string; taskId?: string }) => {
      if (typeof p.progress === 'number') task.progress = p.progress
      if (p.message) task.message = p.message
      updateNode({ status: 'running', progress: p.progress, message: p.message, taskId: p.taskId ?? task.id })
    }
    try {
      const result = await this.registry.executeModelRun(task.payload, {
        interval: this.interval,
        timeoutMs: this.timeoutMs,
        onProgress,
      })
      task.status = 'done'
      task.progress = 100
      task.result = result
      if (result.ok) {
        const urls = result.urls ?? []
        updateNode({ status: 'done', progress: 100, message: '已完成', taskId: result.taskId ?? task.id, urls })
      } else {
        const msg = result.error ?? '生成失败'
        task.error = msg
        updateNode({ status: 'error', message: msg, taskId: task.id })
      }
    } catch (err) {
      task.status = 'error'
      task.error = (err as Error).message
      updateNode({ status: 'error', message: (err as Error).message, taskId: task.id })
    }
  }
}
