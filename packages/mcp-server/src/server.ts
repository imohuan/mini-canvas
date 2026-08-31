/**
 * MCP 后台服务组装入口
 *
 * 组装 GraphModel + NodeStorage + MCP SDK server，按 transport 连接。
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { ServerConfig } from './types'
import { GraphModel } from './graph/GraphModel'
import { NodeStorage } from './storage/NodeStorage'
import { createMcpServer } from './mcp/server'

/**
 * 启动 MCP 后台服务
 */
export async function startServer(config: ServerConfig): Promise<void> {
  console.log(`[mini-canvas] 启动 MCP 后台服务`)
  console.log(`  transport : ${config.transport}`)
  console.log(`  port      : ${config.port}`)
  console.log(`  workdir   : ${config.dir}`)

  // 初始化存储与图模型
  const storage = new NodeStorage(config.dir)
  await storage.init()
  const model = new GraphModel()
  const server = createMcpServer(model, storage)

  if (config.transport === 'stdio') {
    console.log(`[mini-canvas] 连接 stdio transport（等待 MCP 客户端...）`)
    const transport = new StdioServerTransport()
    await server.connect(transport)
  } else if (config.transport === 'sse') {
    console.log(`[mini-canvas] SSE 模式待实现 (Phase 4)，当前暂回退 stdio`)
    const transport = new StdioServerTransport()
    await server.connect(transport)
  }
}
