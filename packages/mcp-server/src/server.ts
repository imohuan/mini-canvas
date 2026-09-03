/**
 * MCP 后台服务组装入口
 *
 * 组装 GraphModel + NodeStorage + TaskManager + MCP SDK server + HTTP(SSE)，
 * 按 transport 启动。
 *
 * 命令两个入口，操作同一份数据：
 * - MCP stdio（AI / 外部 MCP 客户端）
 * - HTTP REST（前端 mini-canvas）
 * 实时变化统一走 SSE `/events` 推送。
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { ServerConfig } from './types'
import { GraphModel } from './graph/GraphModel'
import { NodeStorage } from './storage/NodeStorage'
import { createMcpServer } from './mcp/server'
import { CanvasHttpServer } from './http/CanvasHttpServer'
import { TaskManager } from './tasks/TaskManager'
import { getModelRegistry } from './models/ModelRegistry'
import { Web2apiRunner } from './models/executors/web2apiRunner'
import { getWeb2apiClient } from './client/web2apiClient'

/** 按配置装配真实生成 runner：配置了 web2api 则连接并覆盖注册表默认 runner */
function setupGeneration(config: ServerConfig): void {
  const registry = getModelRegistry()
  const client = getWeb2apiClient(config.web2api)
  if (client) {
    registry.registerRunner('web2api', new Web2apiRunner(client))
    console.log(`[mini-canvas] 生成后台: 已配置 web2api ${config.web2api}（任务将转发真实生成）`)
  } else {
    console.log(`[mini-canvas] 生成后台: 未配置 --web2api，生成任务将返回明确错误（可用 --web2api http://localhost:8033/mcp 接入）`)
  }
}

/**
 * 启动 MCP 后台服务
 */
export async function startServer(config: ServerConfig): Promise<void> {
  console.log(`[mini-canvas] 启动 MCP 后台服务`)
  console.log(`  transport : ${config.transport}`)
  console.log(`  port      : ${config.port}`)
  console.log(`  workdir   : ${config.dir}`)

  // 初始化存储与图模型（全局共享一份，MCP / HTTP / SSE 操作同一数据）
  const storage = new NodeStorage(config.dir)
  await storage.init()
  const model = new GraphModel()

  // 从磁盘自动恢复所有已保存的画布（服务重启后数据不丢）
  for (const project of storage.listProjects()) {
    const data = await storage.loadCanvas(project.id)
    if (!model.hasCanvas(project.id)) model.createCanvas(project.id, project.name)
    model.fromJSON(project.id, data)
  }
  if (storage.listProjects().length > 0) {
    console.log(`[mini-canvas] 已从磁盘恢复 ${storage.listProjects().length} 个画布项目`)
  }

  // 异步任务后台（真实生成 runner：配置 web2api 则转发，否则明确错误）
  setupGeneration(config)
  const taskManager = new TaskManager(model)

  // 启动 HTTP + REST + SSE 服务（前端画布经此读写与实时刷新）
  const http = new CanvasHttpServer({ model, storage, taskManager, port: config.port })
  await http.start()

  if (config.transport === 'stdio') {
    console.log(`[mini-canvas] 连接 stdio transport（等待 MCP 客户端...）`)
    const server = createMcpServer(model, storage, taskManager)
    const transport = new StdioServerTransport()
    await server.connect(transport)
  } else if (config.transport === 'sse') {
    // sse 模式：HTTP(REST) + SSE 服务前端，同时把同一套 MCP 工具挂到 /mcp 端点，
    // 供外部 MCP 客户端（Claude Code / Desktop / 自定义客户端）通过 streamable HTTP 连接。
    http.mountMcp(() => createMcpServer(model, storage, taskManager))
    console.log(`[mini-canvas] sse 模式：HTTP(REST) + SSE 已就绪，等待前端/客户端接入`)
    console.log(`[mini-canvas] MCP 客户端连接地址: http://localhost:${config.port}/mcp`)
  }
}
