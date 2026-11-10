/**
 * 一次动作调用的接线：上传素材 → 下单。
 *
 * 用户口径 2026-11-10：**任务只有后台在跑**。这里只把活交出去，不等结果 ——
 * 进度与终态由后台写节点、SSE 推回来，SSE 断了由 jobsWatcher 那一条全局定时器批量对账。
 * 所以这里不再返回「轮询函数」，也就不存在「一个任务一个轮询」的第二条链路。
 */
import type { CloudApi } from './api.js'
import { pendingUploadFields } from './resourceRef.js'

/** 上游素材（与 kernel ToolResource 同形的最小面） */
export interface ResourceLike {
  /** 资源 id（与提示词里的 tag.value 一一对应） */
  id?: string
  kind?: string
  /** 资源名称（节点名称，给人和模型辨认用） */
  name?: string
  url?: string
  value?: string
  [k: string]: unknown
}

/** 一段提示词：标签引用某个资源，或普通文字 */
export interface PromptSegmentLike {
  type: 'tag' | 'prompt'
  value: string
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
): Promise<Array<{ id?: string; kind: string; name?: string; url?: string; value?: string }>> {
  const out: Array<{ id?: string; kind: string; name?: string; url?: string; value?: string }> = []
  for (const r of resources ?? []) {
    const kind = typeof r.kind === 'string' ? r.kind : 'image'
    const id = typeof r.id === 'string' && r.id !== '' ? r.id : undefined
    const name = typeof r.name === 'string' && r.name !== '' ? r.name : undefined
    const url = typeof r.url === 'string' ? r.url : undefined
    const base = { ...(id ? { id } : {}), kind, ...(name ? { name } : {}) }
    if (url && /^(data:|blob:)/i.test(url) && deps.toBlob) {
      // 后台拿不到 data:/blob: —— 先传上去换成画布资源地址（URL）
      try {
        const blob = await deps.toBlob(url)
        if (blob) {
          const uploaded = await deps.uploadLocal(deps.canvasId, blob, kind + '.bin')
          out.push({ ...base, url: uploaded.url })
          continue
        }
      } catch (err) {
        deps.onError?.('[cloud-client] 素材上传失败，已跳过这一项', err)
        continue
      }
    }
    const item: { id?: string; kind: string; name?: string; url?: string; value?: string } = { ...base }
    if (url) item.url = url
    if (typeof r.value === 'string') item.value = r.value
    out.push(item)
  }
  return out
}

/** 下单。返回 jobId（异步）或直接结果（同步完成）。 */
export async function submitJob(
  deps: RunDeps,
  input: { nodeId: string; actionId: string; prompts?: PromptSegmentLike[]; values?: Record<string, unknown>; resources?: ResourceLike[] },
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
    ...(input.prompts !== undefined ? { prompts: input.prompts } : {}),
    ...(input.values ? { values: input.values } : {}),
    ...(resources.length > 0 ? { resources } : {}),
  })
  return { jobId }
}
