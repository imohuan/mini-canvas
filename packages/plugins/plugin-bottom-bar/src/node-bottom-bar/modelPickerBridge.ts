/**
 * modelPickerBridge —— 底栏读取「Agent 配置里的可用模型」的桥。
 *
 * 为什么需要它：底栏不能反向 import plugin-agent（插件之间不互相依赖）。
 * Agent 已经把自己的服务挂在 `agent` 下（ctx.inject('agent', …)），
 * 里面就有 state.models；这里只按服务名取，取不到就返回空。
 *
 * 用户口径（2026-11-07）：模型下拉直接复用 Agent 的那一份，不再另配。
 */

/** 只取本桥需要的字段：ModelRow 的形状由 Agent 维护，这里不复制一份 */
export interface ModelRowLike {
  provider: string
  modelId: string
  hasKey: boolean
  isDefault: boolean
  isVision: boolean
  contextWindow?: number
  displayName?: string
}

interface AgentServiceLike {
  state?: {
    models?: ModelRowLike[]
    model?: { provider: string; modelId: string } | null
  }
  refresh?(): Promise<void>
}

/**
 * 从上下文读 Agent 的模型清单。
 *
 * 返回 `models` 与 Agent 当前会话模型（只用于「打开时高亮默认」）。
 * Agent 没装时两个字段都是空 —— 调用方据此回退到动作下拉。
 */
export function readAgentModels(ctx: {
  tryGet<T>(name: string): T | undefined
}): { models: ModelRowLike[]; current: { provider: string; modelId: string } | null } {
  const agent = ctx.tryGet<AgentServiceLike>('agent')
  const models = Array.isArray(agent?.state?.models) ? agent!.state!.models! : []
  const current = agent?.state?.model ?? null
  return { models, current }
}

/**
 * 让 Agent 拉一次最新配置。
 *
 * 底栏通常在画布打开时就挂了，而 Agent 的 refresh 由它自己的面板触发；
 * 用户先开画布、后进设置改模型时，底栏手里的清单可能是旧的。
 * 打开下拉前调一次（失败静默：后台没起时仍显示上次那份）。
 */
export async function refreshAgentModels(ctx: {
  tryGet<T>(name: string): T | undefined
}): Promise<void> {
  const agent = ctx.tryGet<AgentServiceLike>('agent')
  try {
    await agent?.refresh?.()
  } catch {
    /* 后台没起 / 没配：保留现有清单，不弹错 */
  }
}

