/**
 * MCP 后台服务组装入口
 *
 * 组装 GraphModel + NodeStorage + MCP SDK server + SSE 推送，按 transport 启动。
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { ServerConfig } from './types'
import { GraphModel } from './graph/GraphModel'
import { NodeStorage } from './storage/NodeStorage'
import { createMcpServer } from './mcp/server'
import { SseServer } from './sse/SseServer'
import { TaskManager } from './tasks/TaskManager'

/**
 * 启动 MCP 后台服务
 */
export async function startServer(config: ServerConfig): Promise<void> {
  console.log(`[mini-canvas] 启动 MCP 后台服务`)
  console.log(`  transport : ${config.transport}`)
  console.log(`  port      : ${config.port}`)
  console.log(`  workdir   : ${config.dir}`)

  // 初始化存储与图模型（全局共享一份，MCP 与 SSE 操作同一数据）
  const storage = new NodeStorage(config.dir)
  await storage.init()
  const model = new GraphModel()

  // 异步任务后台（可插拔 runner，真实生成服务接入时替换）
  const taskManager = new TaskManager(model)

  // 启动 SSE 推送通道（实时变化广播给前端/客户端）
  const sse = new SseServer({ model, port: config.port })
  await sse.start()

  if (config.transport === 'stdio') {
    console.log(`[mini-canvas] 连接 stdio transport（等待 MCP 客户端...）`)
    const server = createMcpServer(model, storage, taskManager)
    const transport = new StdioServerTransport()
    await server.connect(transport)
  } else if (config.transport === 'sse') {
    console.log(`[mini-canvas] SSE 模式：HTTP + SSE 已就绪，MCP 命令通道待接入`)
  }
}
