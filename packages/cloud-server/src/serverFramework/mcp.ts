/**
 * mcp —— `ctx.mcp` 能力段：让插件给 AI 加一个可调用的 MCP 工具。
 *
 * 为什么需要它：后台已经有 MCP 服务（AI 通过它读写画布）。
 * 插件若也能注册工具，AI 的能力就能被插件扩展 —— 与前端 `ctx.registryOf('tool')` 呼应。
 *
 * ## 形状为什么这么简单
 *
 * MCP 官方 schema 用的是 zod。但**插件是外挂的单文件 JS**，让它 import zod 不现实
 * （data: URL 里没有依赖解析）。所以这里收一个**朴素描述**：
 *   - `inputSchema`：一个「参数名 → 类型」的简表（string/number/boolean），够覆盖绝大多数工具；
 *   - `handler(args)`：收校验后的参数、返回可 JSON 化的值。
 * 宿主把它翻译成 SDK 认识的 zod schema 再注册。
 *
 * ## 回收
 *
 * 注册进注册场（`server/mcp-tool`），条目归注册方插件 → **卸载即摘**。
 * MCP server 是**每请求新建**的（见 routes/mcp.ts 的 stateless 说明），
 * 所以每次建时现读注册场即可，天然拿到最新集合。
 */
import type { PluginScope, Registry } from '@mini-canvas/kernel'

/** 注册场名：插件注册的 MCP 工具 */
export const MCP_TOOL_FIELD = 'server/mcp-tool'

/** 一个参数的简表类型（够覆盖绝大多数工具；复杂 schema 走宿主内置工具） */
export type McpParamType = 'string' | 'number' | 'boolean'

/** 插件注册一个 MCP 工具时的声明 */
export interface McpToolDef {
  /** 工具名（建议 `插件名.动作` 形式，避免与内置工具撞名） */
  name: string
  /** 给 AI 看的一句话说明（写好这句，AI 才知道什么时候用） */
  description: string
  /** 参数简表：键 = 参数名，值 = 类型。缺省 = 不收参数 */
  input?: Record<string, McpParamType>
  /** 必填参数名（缺省全可选） */
  required?: string[]
  /** 执行体：收参数、返回可 JSON 化的值 */
  handler(args: Record<string, unknown>): unknown | Promise<unknown>
}

/** `ctx.mcp` 的形状 */
export interface McpRegistrar {
  /** 注册一个 MCP 工具（随插件卸载回收） */
  tool(def: McpToolDef): void
}

export function createMcpRegistrar(ctx: PluginScope, scopeName: string): McpRegistrar {
  const field = ctx.registryOf<McpToolDef>(MCP_TOOL_FIELD)
  return {
    tool(def) {
      field.add(def.name, def, { id: scopeName })
    },
  }
}

/** 取当前全部插件注册的 MCP 工具（供建 MCP server 时注册） */
export function listPluginMcpTools(ctx: { registryOf<T>(k: string): Registry<T> }): McpToolDef[] {
  const field = ctx.registryOf<McpToolDef>(MCP_TOOL_FIELD)
  const out: McpToolDef[] = []
  for (const key of field.keys()) {
    for (const e of field.list(key)) out.push(e.value)
  }
  return out
}
