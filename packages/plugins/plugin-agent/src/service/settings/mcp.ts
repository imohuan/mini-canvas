import type { AgentServiceContext, AgentServiceDeps } from '../context.js'
import type { McpProbeResult } from '../types.js'

/** MCP：增删 / 主动探测 / 让当前会话重连 */
export function createMcpDomain(ctx: AgentServiceContext, deps: AgentServiceDeps) {
  const { state, api } = ctx
  const { setError, canvasId } = ctx

  async function addMcp(body: Record<string, unknown>): Promise<void> {
    await api.addMcp(body)
    await deps.refresh()
  }

  async function removeMcp(name: string): Promise<void> {
    await api.removeMcp(name)
    await deps.refresh()
  }

  /**
   * 主动连一次 MCP，把「连了几个、有哪些工具」拿回来。
   *
   * 为什么不复用会话里的那份连接：那是 SDK 在第一次 run() 时自己起的，
   * 探它要碰会话生命周期（耦合重，而且没会话时还探不了）。这里独立探一次，
   * 探测完服务端会立刻关掉连接 —— 用户点一次「检查」就查一次，代价合理。
   */
  async function probeMcp(names?: string[]): Promise<McpProbeResult> {
    try {
      const r = await api.probeMcp(names)
      return {
        ok: r.ok === true,
        servers: (Array.isArray(r.servers) ? r.servers : []) as McpProbeResult['servers'],
        tools: (Array.isArray(r.tools) ? r.tools : []) as McpProbeResult['tools'],
        warnings: (Array.isArray(r.warnings) ? r.warnings : []).map(String),
        ...(typeof r.error === 'string' ? { error: r.error } : {}),
      }
    } catch (err) {
      return { ok: false, servers: [], tools: [], warnings: [], error: err instanceof Error ? err.message : String(err) }
    }
  }
  async function reconnectMcp(): Promise<boolean> {
    if (!state.sessionId) return false
    try {
      const r = await api.reconnectMcp(canvasId(), state.sessionId)
      return r.released === true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }

  /** 检测还没保存的 MCP 配置（添加页）：连一次、列出工具、立刻断开 */
  async function probeMcpDraft(body: Record<string, unknown>): Promise<McpProbeResult> {
    try {
      const r = await api.probeMcpDraft(body)
      return {
        ok: r.ok === true,
        servers: (Array.isArray(r.servers) ? r.servers : []) as McpProbeResult['servers'],
        tools: (Array.isArray(r.tools) ? r.tools : []) as McpProbeResult['tools'],
        warnings: (Array.isArray(r.warnings) ? r.warnings : []).map(String),
        ...(typeof r.error === 'string' ? { error: r.error } : {}),
      }
    } catch (err) {
      return { ok: false, servers: [], tools: [], warnings: [], error: err instanceof Error ? err.message : String(err) }
    }
  }

  return {
    addMcp,
    removeMcp,
    probeMcp,
    probeMcpDraft,
    reconnectMcp,
  }
}



