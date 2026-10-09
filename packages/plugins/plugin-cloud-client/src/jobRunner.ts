/**
 * 一次动作调用的接线：上传素材 → 下单 → 返回轮询函数。
 *
 * 与 plugin-web2api-tools 的 presetRun 是同一件事，只换"问谁"：
 * 那边直连 web2api，这边问 cloud-server。
 *
 * 为什么返回的是**轮询函数**而不是自己去等：底栏的 taskRuntime 本来就有完整的
 * 提交 → 轮询 → 终态 → resume 流程。复用它可以白拿三样东西：
 * 取消能立刻收敛、刷新后能续查、进度写法（落盘不进撤销栈）已经调好了。
 */
import type { CloudApi } from './api.js'
import type { ServerJob } from './apiTypes.js'
import { pendingUploadFields } from './resourceRef.js'

/** 底栏认识的轮询状态（与内核 ToolPollState 同形；这里就地声明，避免 import） */
export type PollState =
  | { status: 'running'; progress?: number; message?: string; taskId?: string }
  | { status: 'done'; result: { ok: boolean; urls?: string[]; text?: string; error?: string; taskId?: string } }

/** 上游素材（与 kernel ToolResource 同形的最小面） */
export interface ResourceLike {
  kind?: string
  url?: string
  value?: string
  [k: string]: unknown
}

export interface RunDeps {
  api: CloudApi
  canvasId: string
  /** 读某节点 data（下单前检查有没有没上传的本地地址） */
  readNodeData(nodeId: string): Record<string, unknown> | undefined
  /** 把 dataURL / blob 传成画布资源，返回画布内资源地址（同源 URL） */
  uploadLocal(canvasId: string, bytes: Blob, name: string): Promise<{ url: string }>
  /** 数据地址 → Blob（浏览器环境由 URL/atob 实现；测试注入假的） */
  toBlob?(dataUrl: string): Promise<Blob | undefined>
  onError?(msg: string, err?: unknown): void
}

/** 把上游素材里"后台取不到"的地址换成可取的 */
async function normalizeResources(
  deps: RunDeps,
  resources: ResourceLike[] | undefined,
): Promise<Array<{ kind: string; url?: string; value?: string }>> {
  const out: Array<{ kind: string; url?: string; value?: string }> = []
  for (const r of resources ?? []) {
    const kind = typeof r.kind === 'string' ? r.kind : 'image'
    const url = typeof r.url === 'string' ? r.url : undefined
    if (url && /^(data:|blob:)/i.test(url) && deps.toBlob) {
      // 后台拿不到 data:/blob: —— 先传上去换成画布资源地址（URL）
      try {
        const blob = await deps.toBlob(url)
        if (blob) {
          const uploaded = await deps.uploadLocal(deps.canvasId, blob, kind + '.bin')
          out.push({ kind, url: uploaded.url })
          continue
        }
      } catch (err) {
        deps.onError?.('[cloud-client] 素材上传失败，已跳过这一项', err)
        continue
      }
    }
    const item: { kind: string; url?: string; value?: string } = { kind }
    if (url) item.url = url
    if (typeof r.value === 'string') item.value = r.value
    out.push(item)
  }
  return out
}

/** 把后端的 Job 翻译成底栏认识的轮询状态 */
export function toPollState(job: ServerJob, jobId: string): PollState {
  if (job.status === 'running') {
    return {
      status: 'running',
      ...(typeof job.progress === 'number' ? { progress: job.progress } : {}),
      ...(job.message ? { message: job.message } : {}),
      // ★ taskId 必须带上：底栏靠它记 serverTaskId，点「取消」才发得出去。
      //   不带的话，首次下单的取消只会 abort 本地等待，后台任务照跑、照烧额度。
      taskId: jobId,
    }
  }
  const r = job.result ?? { ok: false }
  return {
    status: 'done',
    result: {
      ok: job.status === 'done' && r.ok !== false,
      ...(r.urls ? { urls: r.urls } : {}),
      ...(r.text ? { text: r.text } : {}),
      ...(r.error ? { error: r.error } : {}),
      taskId: jobId,
    },
  }
}

/** 造一个轮询函数（run 与 resume 共用一份实现） */
export function makeJobPoll(deps: RunDeps, jobId: string): () => Promise<PollState> {
  return async () => {
    try {
      const job = await deps.api.getJob(jobId)
      if (!job) {
        // 后台说没这个任务（服务重启 / 任务被清）：收敛成失败，别让界面永远转
        return { status: 'done', result: { ok: false, error: '任务在后台已不存在（可能服务重启过）', taskId: jobId } }
      }
      return toPollState(job, jobId)
    } catch (err) {
      // 查一次失败不算终态：报给用户但继续（下一拍可能就好了）
      return { status: 'running', message: err instanceof Error ? err.message : '任务查询失败', taskId: jobId }
    }
  }
}

/** 下单。返回 jobId（异步）或直接结果（同步完成）。 */
export async function submitJob(
  deps: RunDeps,
  input: { nodeId: string; actionId: string; prompt?: string; values?: Record<string, unknown>; resources?: ResourceLike[] },
): Promise<{ jobId: string } | { done: { ok: boolean; urls?: string[]; text?: string; error?: string } }> {
  // 节点里可能还躺着没上传的本地地址（dataURL）—— 后台取不到，先换个说法告诉它
  const data = deps.readNodeData(input.nodeId)
  const pending = pendingUploadFields(data)
  if (pending.length > 0) {
    deps.onError?.('[cloud-client] 节点里还有未上传的本地资源（' + pending.join('/') + '），后台可能取不到')
  }

  const resources = await normalizeResources(deps, input.resources)
  const jobId = await deps.api.createJob({
    canvasId: deps.canvasId,
    nodeId: input.nodeId,
    actionId: input.actionId,
    ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
    ...(input.values ? { values: input.values } : {}),
    ...(resources.length > 0 ? { resources } : {}),
  })
  return { jobId }
}
