/**
 * agentJobSubmit —— 底栏文本聊天下单（POST /api/jobs，动作 agent:chat）。
 *
 * 用户口径 2026-11-09：点发送 = 提交任务给后台；后台调模型、边生成边写节点（data.text），
 * 前端跟随画布同步更新 —— 前端不再直连 /api/agent/chat/completion。
 *
 * 与 cloud-client 的 submitJob 的差别：不依赖那个插件（底栏不能反向 import），
 * 这里就地发请求；令牌走 canvas-base 的 withAdminToken（同一份 localStorage）。
 */
import { withAdminToken } from '@mini-canvas/canvas-base'

/** 当前画布 id（与 cloud-client keys.ts 同一条规则：URL 优先，缺省 default） */
export function currentCanvasId(): string {
  if (typeof window === 'undefined') return 'default'
  try {
    const q = new URLSearchParams(window.location.search).get('canvas')
    if (q && /^[A-Za-z0-9_-]{1,64}$/.test(q)) return q
    const m = /\/canvas\/([A-Za-z0-9_-]{1,64})/.exec(window.location.hash)
    if (m) return m[1]
  } catch {
    /* 异常环境 → 默认 */
  }
  return 'default'
}

export interface AgentJobInput {
  baseUrl: string
  nodeId: string
  /**
   * 目标画布 id。**必须由调用方显式给**（底栏从 URL / 宿主拿）。
   * 多画布下靠 currentCanvasId() 的 URL 兜底会写错画布：任务跑进 default，
   * 用户在当前画布上看不到任何变化（实测踩到）。
   */
  canvasId: string
  provider: string
  modelId: string
  prompt: string
  resources?: Array<{ id?: string; kind: string; name?: string; url?: string; value?: string }>
  signal?: AbortSignal
  /** 测试注入的 fetch（缺省用全局 fetch） */
  fetchImpl?: typeof fetch
}

/** 下单结果：jobId（后台跑）或一句人话错误 */
export type AgentJobSubmitResult = { ok: true; jobId: string } | { ok: false; error: string }

/**
 * 把选中模型透传给动作声明：provider 作者字段 tool= modelId、group= provider（后台解出来）。
 * 409 = 该节点已有任务在跑（连点保护），当成失败但文案友好。
 */
export async function submitAgentChatJob(opts: AgentJobInput): Promise<AgentJobSubmitResult> {
  const base = opts.baseUrl.replace(/\/+$/, '')
  try {
    const f = opts.fetchImpl ?? (typeof fetch === 'undefined' ? undefined : fetch)
    if (!f) return { ok: false, error: '当前环境没有可用的 fetch' }
    const res = await f(base + '/api/jobs', {
      method: 'POST',
      headers: withAdminToken({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        // 用调用方显式给的画布（见 AgentJobInput.canvasId 的说明），不靠 URL 猜
        canvasId: opts.canvasId || currentCanvasId(),
        nodeId: opts.nodeId,
        actionId: 'agent:chat',
        prompts: [{ type: 'prompt', value: opts.prompt }],
        ...(opts.resources && opts.resources.length > 0 ? { resources: opts.resources } : {}),
        // 模型与渠道放 values 透传（JobInput 只收这五个字段；后台 provider 从这里解出）
        values: { agentModel: opts.modelId, agentProvider: opts.provider },
      }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; jobId?: string; error?: string }
    if (!res.ok || !body.jobId) {
      const busy = res.status === 409
      return { ok: false, error: busy ? '该节点已有任务在跑，等它完成或取消后再发' : (body.error ?? '提交任务失败（HTTP ' + res.status + '）') }
    }
    return { ok: true, jobId: body.jobId }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return { ok: false, error: '已取消' }
    return { ok: false, error: err instanceof Error ? err.message : '提交任务失败' }
  }
}
