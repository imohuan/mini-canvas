/**
 * TaskManager — 异步任务后台
 *
 * 职责：MCP 只负责"创建任务"，返回 task_id 立即响应；
 * 后台自动处理（留底 → 轮询/请求 → 完成后自动写回节点数据 → 推 SSE）。
 *
 * 任务 = 画布（taskId 即画布 id）。创建任务时关联画布，
 * 任务完成后把结果写回该画布某个节点的 data 字段。
 */
import { randomUUID } from 'node:crypto'
import type { GraphModel } from '../graph/GraphModel'

/** 任务状态 */
export type TaskStatus = 'pending' | 'processing' | 'done' | 'error'

/** 任务记录 */
export interface TaskRecord {
  id: string
  kind: string
  /** 关联的画布 id */
  canvasId: string
  /** 任务结果写回的目标节点 id */
  targetNodeId: string
  payload: Record<string, unknown>
  status: TaskStatus
  progress: number
  result?: unknown
  error?: string
  createdAt: number
}

/** 任务处理器（可插拔占位）。由外部接入真实生成服务时实现。 */
export interface TaskRunner {
  /** 处理任务，返回结果；可多次回调更新进度 */
  run(task: TaskRecord, onProgress: (p: number) => void): Promise<unknown>
}

/**
 * 默认 runner 占位：模拟异步处理（定时递增进度，完成后返回一个占位结果）。
 * 真实生成服务接入时替换。
 */
export class DefaultTaskRunner implements TaskRunner {
  constructor(private steps = 5, private delayMs = 500) {}

  async run(task: TaskRecord, onProgress: (p: number) => void): Promise<unknown> {
    for (let i = 1; i <= this.steps; i++) {
      await new Promise((r) => setTimeout(r, this.delayMs))
      onProgress(Math.round((i / this.steps) * 100))
    }
    return { ok: true, kind: task.kind, note: '占位处理完成（接入真实生成服务后替换）' }
  }
}

export class TaskManager {
  private model: GraphModel
  private runner: TaskRunner
  private tasks = new Map<string, TaskRecord>()

  constructor(model: GraphModel, runner?: TaskRunner) {
    this.model = model
    this.runner = runner ?? new DefaultTaskRunner()
  }

  /**
   * 创建任务。立即返回 task_id，后台开始处理。
   *
   * @param kind 任务类型（image/video/audio 等）
   * @param canvasId 关联画布 id
   * @param targetNodeId 结果写回的目标节点 id
   * @param payload 任务参数
   */
  createTask(
    kind: string,
    canvasId: string,
    targetNodeId: string,
    payload: Record<string, unknown> = {},
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

    // 标记目标节点为渲染中
    this.model.updateNode(canvasId, targetNodeId, {
      data: { status: 'rendering', progress: 0 },
    })

    // 异步后台处理（不阻塞返回；用 setTimeout 确保 createTask 先返回 pending 状态）
    setTimeout(() => void this.process(task), 0)
    return task
  }

  /** 查询任务状态 */
  getTaskStatus(taskId: string): TaskRecord | null {
    return this.tasks.get(taskId) ?? null
  }

  /** 列出所有任务 */
  listTasks(): TaskRecord[] {
    return [...this.tasks.values()]
  }

  /** 后台处理流程 */
  private async process(task: TaskRecord): Promise<void> {
    task.status = 'processing'
    try {
      const result = await this.runner.run(task, (p) => {
        task.progress = p
        // 实时回写节点进度
        this.model.updateNode(task.canvasId, task.targetNodeId, {
          data: { status: 'rendering', progress: p },
        })
      })
      task.status = 'done'
      task.progress = 100
      task.result = result
      // 完成后回写节点：状态 done + 结果
      this.model.updateNode(task.canvasId, task.targetNodeId, {
        data: { status: 'done', progress: 100, result },
      })
    } catch (err) {
      task.status = 'error'
      task.error = (err as Error).message
      this.model.updateNode(task.canvasId, task.targetNodeId, {
        data: { status: 'error', error: (err as Error).message },
      })
    }
  }
}
