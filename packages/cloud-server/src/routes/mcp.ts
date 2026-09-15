/**
 * mcp 路由 —— 把 MCP 服务挂在网页服务的同一个端口上（`/mcp`）。
 *
 * 为什么共用一个服务而不是各起一个进程：两边要读写**同一张画布**。
 * 分两个进程就得处理"两个进程同时改同一个 json"的冲突；同进程内共享一个
 * `CanvasDocument`，读写都是同一份文件，天然一致。用户也是这么要的：
 * "启动 serve 的时候也同时会开启 mcp，他们共用一个服务"。
 *
 * 传输方式用 **Streamable HTTP**（MCP 官方为"服务端已有一个 HTTP 服务"设计的形态）：
 * 客户端配一个 URL 就能连，不像 stdio 那样要求由客户端来拉起我们的进程 ——
 * 而这里进程是用户自己 `npx` 起的，我们必须主动提供端口。
 *
 * stateless 模式（`sessionIdGenerator: undefined`）：每个请求新建一个独立的
 * transport + server 实例。本项目所有工具都是无状态的读写，不需要跨请求会话，
 * 这样也就不存在"会话过期"和"重复 connect 同一实例"的坑。
 */
import { Hono } from 'hono'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { CanvasDocument } from '../mcp/canvasDoc.js'
import { createCanvasMcpServer } from '../mcp/server.js'

export function mcpRoutes(doc: CanvasDocument): Hono {
  const app = new Hono()
  app.all('/mcp', async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    const server = createCanvasMcpServer(doc)
    await server.connect(transport)
    const response = await transport.handleRequest(c.req.raw)
    // 原样把 SDK 的 Response 交回 Hono（保留 SSE body 与各类响应头）
    return new Response(response.body, response)
  })
  return app
}
