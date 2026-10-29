/** 服务传输通道类型 */
export type TransportType = 'stdio' | 'sse'

/** MCP 后台服务配置 */
export interface ServerConfig {
  /** 传输通道: stdio(默认) 走 MCP 标准协议; sse 走 HTTP + SSE */
  transport: TransportType
  /** HTTP 端口 (sse 模式使用) */
  port: number
  /** 工作目录，画布 JSON 落盘位置 */
  dir: string
  /** 真实生成后台 web2api 的 MCP 端点（如 http://localhost:8033/mcp）；不配则生成任务返回明确错误 */
  web2api?: string
}
