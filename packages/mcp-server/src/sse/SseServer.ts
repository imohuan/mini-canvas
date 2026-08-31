/**
 * SseServer — SSE 实时推送通道（单向，服务器 → 客户端）
 *
 * 桥接 GraphModel 的图事件到 SSE `/events` 端点。
 * 命令走 MCP stdio/HTTP，变化由这里单向推给订阅者（前端/客户端）。
 */
import { Hono } from 'hono'
import { serve, type ServerType } from '@hono/node-server'
import { streamSSE } from 'hono/streaming'
import type { GraphModel } from '../graph/GraphModel'
import type { GraphEvent } from '../graph/types'

/** 单个 SSE 连接的待发送事件队列 */
interface SseClient {
  id: string
  /** 是否只订阅指定画布 */
  canvasId?: string
  queue: GraphEvent[]
  resolve: (() => void) | null
  closed: boolean
}

export interface SseServerOptions {
  model: GraphModel
  port: number
}

export class SseServer {
  private app = new Hono()
  private model: GraphModel
  private port: number
  private clients = new Set<SseClient>()
  private server?: ServerType
  private unsubscribe: (() => void) | null = null

  constructor(options: SseServerOptions) {
    this.model = options.model
    this.port = options.port

    // 订阅 GraphModel 所有图事件
    this.unsubscribe = this.model.on((event) => this.broadcast(event))

    // /events?canvasId=xxx — 实时推送
    this.app.get('/events', (c) => {
      const canvasId = c.req.query('canvasId')
      return streamSSE(c, async (stream) => {
        const client: SseClient = {
          id: crypto.randomUUID(),
          canvasId,
          queue: [],
          resolve: null,
          closed: false,
        }
        this.clients.add(client)
        // 客户端断开时清理
        stream.onAbort(() => {
          client.closed = true
          this.clients.delete(client)
        })
        // 发送连接就绪事件
        await stream.writeSSE({ event: 'ready', data: JSON.stringify({ clientId: client.id }) })
        // 循环取出待发送事件
        while (!client.closed) {
          const event = await this.next(client)
          if (!event) break
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
        }
      })
    })

    // 健康检查
    this.app.get('/health', (c) => c.json({ ok: true, clients: this.clients.size }))
  }

  /** 启动 HTTP 服务器 */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = serve({ fetch: this.app.fetch, port: this.port }, (info) => {
        console.log(`[mini-canvas] SSE 服务已启动: http://localhost:${info.port}/events`)
        resolve()
      })
    })
  }

  /** 关闭服务器 */
  stop(): void {
    this.unsubscribe?.()
    this.server?.close()
  }

  /** 广播事件给所有订阅者（按 canvasId 过滤） */
  private broadcast(event: GraphEvent): void {
    for (const client of this.clients) {
      // 'graph:changed' 总是推；其余事件按 canvasId 过滤
      if (client.canvasId && event.canvasId && client.canvasId !== event.canvasId) continue
      client.queue.push(event)
      client.resolve?.()
    }
  }

  /** 取下一个待发送事件（无则等待） */
  private next(client: SseClient): Promise<GraphEvent | null> {
    if (client.queue.length > 0) return Promise.resolve(client.queue.shift()!)
    if (client.closed) return Promise.resolve(null)
    return new Promise((resolve) => {
      client.resolve = () => {
        client.resolve = null
        if (client.closed) return resolve(null)
        const evt = client.queue.shift()
        resolve(evt ?? null)
      }
    })
  }
}
