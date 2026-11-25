import { MCP_TOOL_PREFIX } from '@prismshadow/penguin-core'

export interface ProbeToolRow {
  name: string
  server: string
  description: string
  fullName: string
  parameters?: Record<string, unknown>
}

/**
 * 把 SDK 的工具定义整理成界面的工具行。
 *
 * 工具全名形如 `mcp__canvas__canvas_get`，拆回「服务 / 工具」后界面才能按服务分组。
 * 一并带上 `parameters`（MCP 的 inputSchema）—— 下拉与标签的悬停卡片要列出参数。
 */
export function probeToolRows(defs: Array<{ name?: unknown; description?: unknown; parameters?: unknown }>): ProbeToolRow[] {
  return defs.map((d) => {
    const full = String(d.name ?? '')
    const rest = full.startsWith(MCP_TOOL_PREFIX) ? full.slice(MCP_TOOL_PREFIX.length) : full
    const sep = rest.indexOf('__')
    const parameters = d.parameters
    return {
      name: sep >= 0 ? rest.slice(sep + 2) : rest,
      server: sep >= 0 ? rest.slice(0, sep) : '',
      description: String(d.description ?? ''),
      fullName: full,
      ...(parameters && typeof parameters === 'object' ? { parameters: parameters as Record<string, unknown> } : {}),
    }
  })
}
