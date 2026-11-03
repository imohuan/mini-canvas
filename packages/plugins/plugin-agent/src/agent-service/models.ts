import type { AgentServiceContext, AgentServiceDeps } from './context.js'

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

  return {
    saveModel,
    saveModelsBulk,
    deleteModel,
    setDefaultModel,
  }
}



