import type { AgentServiceContext, AgentServiceDeps } from '../context.js'
import type { ModelProbeView } from '../../api/agentApi.js'

/** 模型渠道与默认模型（列表 / 批量保存 / 删除 / 设默认） */
export function createModelDomain(ctx: AgentServiceContext, deps: AgentServiceDeps) {
  const { state, api } = ctx

  async function saveModel(body: Record<string, unknown>): Promise<void> {
    await api.saveModel(body)
    await deps.refresh()
  }

  async function saveModelsBulk(body: Record<string, unknown>): Promise<void> {
    await api.saveModelsBulk(body)
    await deps.refresh()
  }

  async function deleteModel(provider: string, modelId: string): Promise<void> {
    await api.deleteModel(provider, modelId)
    await deps.refresh()
  }

  async function setDefaultModel(provider: string, modelId: string): Promise<void> {
    await api.setDefaultModel(provider, modelId)
    state.model = { provider, modelId }
    await deps.refresh()
  }

  /**
   * 真实请求测试（选中某个模型后「测试」）。
   *
   * 与「拉取模型清单」分开：清单只证明能列出来；这个会真的发一句「只回复 OK」，
   * 所以能抓到「列得出来但聊不了 / 协议不对 / 没权限」这类问题。
   */
  async function probeModel(body: {
    provider?: string
    modelId?: string
    baseUrl?: string
    apiKey?: string
    clientType?: string
  }): Promise<ModelProbeView> {
    try {
      const r = await api.probeModel(body)
      return {
        ok: r.ok === true,
        clientType: String(r.clientType ?? ''),
        tried: (Array.isArray(r.tried) ? r.tried : []) as ModelProbeView['tried'],
        latencyMs: Number(r.latencyMs ?? 0),
        ...(typeof r.reply === 'string' && r.reply ? { reply: r.reply } : {}),
        ...(typeof r.error === 'string' && r.error ? { error: r.error } : {}),
        ...(r.fallback === 'non-stream' ? { fallback: 'non-stream' as const } : {}),
      }
    } catch (err) {
      return {
        ok: false,
        clientType: '',
        tried: [],
        latencyMs: 0,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  return {
    saveModel,
    saveModelsBulk,
    deleteModel,
    setDefaultModel,
    probeModel,
  }
}



