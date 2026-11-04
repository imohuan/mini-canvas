import type { AgentServiceContext, AgentServiceDeps } from '../context.js'
import type { AgentServiceState } from '../types.js'

/** 技能：候选扫描 / 导入 / 删除 / 上游模型清单 */
export function createSkillDomain(ctx: AgentServiceContext, deps: AgentServiceDeps) {
  const { state, api } = ctx
  const { setError } = ctx

  async function importSkill(dir: string): Promise<void> {
    await api.importSkill(dir)
    await deps.refresh()
  }

  async function loadSkillCandidates(): Promise<void> {
    try {
      const r = await api.skillSources()
      state.skillCandidates = (Array.isArray(r.candidates) ? r.candidates : []) as AgentServiceState['skillCandidates']
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * 问上游要模型清单（GET {baseUrl}/models）。
   *
   * 用户手里是自建网关，模型 ID 有一串，让他手打容易错 —— 拉回来做成下拉。
   * 失败不抛（可能还没配密钥）：把错误原样交给界面显示。
   */
  async function loadUpstreamModels(
    body: { provider?: string; modelId?: string; baseUrl?: string; apiKey?: string } = {},
  ): Promise<{ ok: boolean; models: string[]; error?: string }> {
    try {
      const r = await api.upstreamModels(body)
      const models = (Array.isArray(r.models) ? r.models : []).map(String)
      state.upstreamModels = models
      if (!r.ok && typeof r.error === 'string') setError(r.error)
      return { ok: r.ok === true, models, ...(typeof r.error === 'string' ? { error: r.error } : {}) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      return { ok: false, models: [], error: message }
    }
  }
  async function removeSkill(name: string): Promise<void> {
    await api.removeSkill(name)
    await deps.refresh()
    await loadSkillCandidates()
  }

  return {
    importSkill,
    loadSkillCandidates,
    loadUpstreamModels,
    removeSkill,
  }
}



