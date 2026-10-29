/**
 * MCP 工具清单（list-tools CLI 使用）
 *
 * 工具的实际注册逻辑在 `./server.ts`（createMcpServer）。
 * 这里只做透传导出，供 CLI `mini-canvas mcp list-tools` 使用。
 */
export { listTools, type McpTool } from './server'
