/**
 * MCP 后台服务组装入口
 *
 * 负责把各模块（GraphModel / NodeStorage / TaskManager / MCP / SSE）组装成一个
 * 可运行的服务器。各模块在后续 Phase 中逐步实现并在此挂载。
 */
import type { ServerConfig } from './types'

/**
 * 启动 MCP 后台服务
 *
 * @param config 服务配置（传输通道、端口、工作目录）
 */
export async function startServer(config: ServerConfig): Promise<void> {
  console.log(`[mini-canvas] 启动 MCP 后台服务`)
  console.log(`  transport : ${config.transport}`)
  console.log(`  port      : ${config.port}`)
  console.log(`  workdir   : ${config.dir}`)

  // TODO(Phase 1): 初始化 GraphModel
  // TODO(Phase 2): 初始化 NodeStorage
  // TODO(Phase 3): 初始化 MCP SDK server + 注册工具
  // TODO(Phase 4): 初始化 SSE 推送通道
  // TODO(Phase 5): 初始化 TaskManager 异步任务后台

  if (config.transport === 'sse') {
    console.log(`[mini-canvas] SSE 模式待实现 (Phase 4)`)
  } else {
    console.log(`[mini-canvas] stdio 模式待实现 (Phase 3)`)
  }
}
