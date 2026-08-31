/**
 * CanvasHttpServer — HTTP + SSE 服务
 *
 * - REST 端点：前端通过 HTTP 发命令（读取画布、保存、创建节点等），
 *   对应 MCP 工具同一套 GraphModel 数据。
 * - SSE 端点 `/events`：单向推送图变化（实时刷新前端/客户端）。
 *
 * 命令既走 MCP stdio（AI），也走 HTTP REST（前端），二者操作同一 GraphModel。
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve, type ServerType } from '@hono/node-server'
import { streamSSE } from 'hono/streaming'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { GraphModel } from '../graph/GraphModel'
import type { GraphEvent } from '../graph/types'
import type { NodeStorage } from '../storage/NodeStorage'
import type { TaskManager } from '../tasks/TaskManager'

/** 单个 SSE 连接的待发送事件队列 */
interface SseClient {
  id: string
  canvasId?: string
  queue: GraphEvent[]
  resolve: (() => void) | null
  closed: boolean
}

export interface HttpServerOptions {
  model: GraphModel
  storage: NodeStorage
  taskManager: TaskManager
  port: number
}

export class CanvasHttpServer {
  private app = new Hono()
  private model: GraphModel
  private storage: NodeStorage
  private taskManager: TaskManager
  private port: number
  private clients = new Set<SseClient>()
  private server?: ServerType
  private unsubscribe: (() => void) | null = null

  constructor(options: HttpServerOptions) {
    this.model = options.model
    this.storage = options.storage
    this.taskManager = options.taskManager
    this.port = options.port

    // 允许前端跨域访问（前端 dev server 与后台不同端口）
    this.app.use('*', cors())

    // 订阅 GraphModel 所有图事件
    this.unsubscribe = this.model.on((event) => this.broadcast(event))

    // ==================== REST：画布 ====================
    this.app.get('/api/canvases', (c) => c.json({ canvases: this.model.listCanvases() }))
    this.app.post('/api/canvases', async (c) => {
      const body = await c.req.json().catch(() => ({}))
      const taskId = (body.taskId as string) ?? ''
      const name = (body.name as string) ?? taskId
      this.model.createCanvas(taskId, name)
      await this.storage.createProject(name, taskId)
      return c.json({ ok: true, canvasId: taskId })
    })
    this.app.delete('/api/canvases/:id', async (c) => {
      const id = c.req.param('id')
      const removed = this.model.deleteCanvas(id)
      await this.storage.deleteProject(id)
      return c.json({ ok: removed })
    })

    // ==================== REST：节点/连线/定位 ====================
    this.app.get('/api/canvases/:id', async (c) => {
      const id = c.req.param('id')
      return c.json({ ...this.model.toJSON(id) })
    })
    this.app.post('/api/canvases/:id/nodes', async (c) => {
      const id = c.req.param('id')
      const body = await c.req.json().catch(() => ({}))
      const node = this.model.createNode(id, {
        type: body.type,
        position: body.position,
        data: body.data,
      })
      return c.json({ ok: true, node })
    })
    this.app.patch('/api/canvases/:id/nodes/:nodeId', async (c) => {
      const { id, nodeId } = c.req.param()
      const body = await c.req.json().catch(() => ({}))
      const node = this.model.updateNode(id, nodeId, {
        position: body.position,
        data: body.data,
      })
      return c.json(node ? { ok: true, node } : { ok: false, error: '节点不存在' })
    })
    this.app.delete('/api/canvases/:id/nodes/:nodeId', (c) => {
      const { id, nodeId } = c.req.param()
      return c.json({ ok: this.model.deleteNode(id, nodeId) })
    })
    this.app.post('/api/canvases/:id/edges', async (c) => {
      const id = c.req.param('id')
      const body = await c.req.json().catch(() => ({}))
      try {
        const edge = this.model.createEdge(id, {
          source: body.source,
          target: body.target,
          sourceHandle: body.sourceHandle,
          targetHandle: body.targetHandle,
        })
        return c.json({ ok: true, edge })
      } catch (err) {
        return c.json({ ok: false, error: (err as Error).message })
      }
    })

    // ==================== REST：持久化 ====================
    this.app.post('/api/canvases/:id/save', async (c) => {
      const id = c.req.param('id')
      const json = this.model.toJSON(id)
      await this.storage.saveCanvas(id, json.nodes, json.edges)
      return c.json({ ok: true, canvasId: id })
    })

    // ==================== REST：任务 ====================
    this.app.post('/api/tasks', async (c) => {
      const body = await c.req.json().catch(() => ({}))
      try {
        const task = this.taskManager.createTask(
          body.kind,
          body.canvasId,
          body.targetNodeId,
          body.payload ?? {},
        )
        return c.json({ ok: true, taskId: task.id, status: task.status })
      } catch (err) {
        return c.json({ ok: false, error: (err as Error).message })
      }
    })
    this.app.get('/api/tasks/:taskId', (c) => {
      const task = this.taskManager.getTaskStatus(c.req.param('taskId'))
      return task ? c.json({ ok: true, task }) : c.json({ ok: false, error: '任务不存在' })
    })

    // ==================== SSE：实时推送 ====================
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
        stream.onAbort(() => {
          client.closed = true
          this.clients.delete(client)
        })
        await stream.writeSSE({ event: 'ready', data: JSON.stringify({ clientId: client.id }) })
        while (!client.closed) {
          const event = await this.next(client)
          if (!event) break
          // 用统一的 message 事件推送，事件类型放 data.type 中（便于 EventSource 通配接收）
          await stream.writeSSE({ data: JSON.stringify(event) })
        }
      })
    })

    // 健康检查
    this.app.get('/health', (c) => c.json({ ok: true, clients: this.clients.size }))
  }

  /**
   * 挂载 MCP Streamable HTTP 端点 `/mcp`，供外部 MCP 客户端（Claude Code / Desktop 等）连接。
   * stateless 模式：每个请求新建一个独立 transport + server 实例，避免 server.connect 重复绑定。
   */
  mountMcp(createServer: () => McpServer): void {
    this.app.all('/mcp', async (c) => {
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      })
      const server = createServer()
      await server.connect(transport)
      const response = await transport.handleRequest(c.req.raw)
      return new Response(response.body, response)
    })
    console.log('[mini-canvas] MCP Streamable HTTP 端点已挂载: /mcp')
  }

  /** 启动 HTTP 服务器 */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = serve({ fetch: this.app.fetch, port: this.port }, (info) => {
        console.log(`[mini-canvas] HTTP/SSE 服务已启动: http://localhost:${info.port}/ (REST + /events SSE)`)
        resolve()
      })
    })
  }

  /** 关闭服务器 */
  stop(): void {
    this.unsubscribe?.()
    this.server?.close()
  }

  private broadcast(event: GraphEvent): void {
    for (const client of this.clients) {
      if (client.canvasId && event.canvasId && client.canvasId !== event.canvasId) continue
      client.queue.push(event)
      client.resolve?.()
    }
  }

  private next(client: SseClient): Promise<GraphEvent | null> {
    if (client.queue.length > 0) return Promise.resolve(client.queue.shift()!)
    if (client.closed) return Promise.resolve(null)
    return new Promise((resolve) => {
      client.resolve = () => {
        client.resolve = null
        if (client.closed) return resolve(null)
        resolve(client.queue.shift() ?? null)
      }
    })
  }
}
