import type { AgentServiceContext, AgentServiceDeps } from '../context.js'
import type { ApprovalPolicyView } from '../types.js'

/** 审批：允许 / 拒绝 + 审批规则（自动放行策略） */
export function createPolicyDomain(ctx: AgentServiceContext, deps: AgentServiceDeps) {
  const { state, api } = ctx
  const { canvasId, setError } = ctx

  async function decide(approvalId: string, decision: 'allow' | 'deny'): Promise<void> {
    if (!state.sessionId) return
    // 先把卡片点亮（用户立刻看到反馈），再发请求
    deps.applyEvent({ type: 'approval_result', id: approvalId, decision })
    try {
      await api.approve(canvasId(), state.sessionId, approvalId, decision)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function savePolicy(policy: ApprovalPolicyView): Promise<void> {
    try {
      const r = await api.putPolicy(policy as unknown as Record<string, unknown>)
      const next = r.policy as ApprovalPolicyView | undefined
      if (next) state.policy = next
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /** 恢复出厂的审批规则（只影响规则清单与总开关） */
  async function restorePolicy(): Promise<void> {
    try {
      const r = await api.restorePolicy()
      const next = r.policy as ApprovalPolicyView | undefined
      if (next) state.policy = next
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return {
    decide,
    savePolicy,
    restorePolicy,
  }
}

