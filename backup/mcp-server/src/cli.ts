#!/usr/bin/env node
/**
 * mini-canvas MCP 后台服务 CLI 入口
 *
 * 用法：
 *   mini-canvas mcp start --transport stdio|sse --port 8765 --dir ./workspace
 *   mini-canvas mcp list-tools
 */
import { Command } from 'commander'
import { startServer } from './server'

const program = new Command()

program
  .name('mini-canvas')
  .description('Mini Canvas MCP 后台服务')
  .version('0.0.0')

const mcp = program.command('mcp').description('MCP 后台服务相关命令')

mcp
  .command('start')
  .description('启动 MCP 后台服务')
  .option('-t, --transport <type>', '传输通道: stdio | sse', 'stdio')
  .option('-p, --port <number>', 'HTTP 端口 (sse 模式使用)', '8765')
  .option('-d, --dir <path>', '工作目录 (画布 JSON 落盘位置)', './workspace')
  .option('-w, --web2api <url>', '真实生成后台 web2api 的 MCP 端点(如 http://localhost:8033/mcp)；不配则生成返回明确错误')
  .action(async (opts) => {
    const config = {
      transport: opts.transport as 'stdio' | 'sse',
      port: parseInt(opts.port, 10),
      dir: opts.dir as string,
      web2api: (opts.web2api as string | undefined) || undefined,
    }
    await startServer(config)
  })

mcp
  .command('list-tools')
  .description('列出所有可用的 MCP 工具')
  .action(async () => {
    const { listTools } = await import('./mcp/tools')
    const names = listTools().map((t) => `- ${t.name}: ${t.description}`)
    console.log('可用 MCP 工具:')
    console.log(names.join('\n'))
  })

program.parse(process.argv)
