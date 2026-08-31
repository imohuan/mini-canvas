/**
 * MCP 工具定义与注册
 *
 * 所有通过 MCP 暴露的 Tool 在这里集中定义。Phase 3 起接入 GraphModel，
 * 把画布增删改查 / 连线 / 定位 / 保存 / 订阅 映射为可调用的 Tool。
 */

/** MCP 工具参数 Schema（最小 JSON Schema 描述） */
export interface ToolParam {
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  required?: boolean
  description?: string
}

/** MCP 工具定义 */
export interface McpTool {
  name: string
  description: string
  params: ToolParam[]
  handler: (args: Record<string, unknown>) => Promise<unknown>
}

/** 返回全部工具定义（Phase 3 前先返回空列表，list-tools 可运行） */
export function listTools(): McpTool[] {
  return []
}

/** 根据工具名找到 handler，找不到返回 null */
export function findTool(name: string): McpTool | null {
  return listTools().find((t) => t.name === name) ?? null
}
