/**
 * mockBackend —— 内存假后台（纯逻辑，node 可单测）。
 *
 * 实现用户描述的第三方 API 形状：创建任务（同步/异步两种）+ 查询任务。
 * 真后台接入时只要把这里的 createTask/queryTask 换成 HTTP 调用即可（动作的 run/resume 不变）。
 */

/** 一次任务查询返回的状态（与 ToolPollState 同形，进度/文案/结果） */
export interface MockTaskView {
  status: 'running' | 'done'
  progress?: number
  message?: string
  result?: { ok: boolean; urls?: string[]; text?: string; error?: string }
}

export interface MockBackendOptions {
  /** 异步任务的帧数（每帧一个 interval） */
  steps?: number
  /** 每帧时长 ms（默认 120ms：10 帧 = 1.2s，肉眼可见的进度推进） */
  intervalMs?: number
  /** 完成时产出的地址（mock 产物） */
  resultUrl?: string
  now?: () => number
}

interface MockTask {
  id: string
  steps: number
  intervalMs: number
  resultUrl: string
  startedAt: number
}

export class MockBackend {
  private tasks = new Map<string, MockTask>()
  private seq = 0
  private opts: Required<Pick<MockBackendOptions, 'steps' | 'intervalMs' | 'resultUrl'>> & { now: () => number }

  constructor(opts: MockBackendOptions = {}) {
    this.opts = {
      steps: opts.steps ?? 10,
      intervalMs: opts.intervalMs ?? 120,
      resultUrl: opts.resultUrl ?? 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">' +
        /* 主题色白名单: 示例图的 SVG 内容色（画进图片节点里当素材），不是界面外观 */
        '<rect width="320" height="240" fill="#dbeafe"/>' +
        /* 主题色白名单: 同上 */
        '<text x="160" y="120" font-size="18" text-anchor="middle" fill="#1d4ed8">mock 产物</text></svg>',
      ),
      now: opts.now ?? (() => Date.now()),
    }
  }

  /** 创建任务：立即返回 taskId（异步形态；同步动作不需要它） */
  createTask(): { taskId: string } {
    this.seq += 1
    const id = 'mock-' + this.seq
    this.tasks.set(id, {
      id,
      steps: this.opts.steps,
      intervalMs: this.opts.intervalMs,
      resultUrl: this.opts.resultUrl,
      startedAt: this.opts.now(),
    })
    return { taskId: id }
  }

  /** 查询任务：按经过的帧数推进进度到 100 后给出结果 */
  queryTask(taskId: string): MockTaskView {
    const task = this.tasks.get(taskId)
    if (!task) return { status: 'done', result: { ok: false, error: '任务不存在：' + taskId } }
    const elapsed = this.opts.now() - task.startedAt
    const step = Math.min(Math.floor(elapsed / task.intervalMs), task.steps)
    if (step < task.steps) {
      return {
        status: 'running',
        progress: Math.round((step / task.steps) * 100),
        message: 'mock 后台处理中（' + step + '/' + task.steps + '）',
      }
    }
    return {
      status: 'done',
      progress: 100,
      result: { ok: true, urls: [task.resultUrl] },
    }
  }
}
