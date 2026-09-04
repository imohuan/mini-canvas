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
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

/** 按扩展名返回媒体 MIME（图片 + 音视频），用于上传文件托管与本地路径中转 */
const EXT_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska', '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
}
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { GraphModel } from '../graph/GraphModel'
import type { GraphEvent } from '../graph/types'
import type { NodeStorage } from '../storage/NodeStorage'
import type { TaskManager } from '../tasks/TaskManager'
import { createSemanticNode } from '../graph/semanticNodes'
import { listGenerationModels } from '../models/ModelRegistry'

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

    // ==================== REST：生成模型配置 ====================
    // 给前端工具栏提供后台模型能力配置（与 MCP models.list 同源 ModelRegistry）。
    // 前端据此渲染模型下拉 / 比例 / 分辨率 / 可接受输入，不再用本地写死的模型表。
    this.app.get('/api/models', (c) => {
      return c.json({ ok: true, models: listGenerationModels() })
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

    // ==================== REST：批量 CRUD（合并执行） ====================
    /** 节点批量：POST /api/canvases/:id/batch-nodes  { add:[], delete:[], update:[] } */
    this.app.post('/api/canvases/:id/batch-nodes', async (c) => {
      const id = c.req.param('id')
      const body = await c.req.json().catch(() => ({}))
      const normAdds = (body.add ?? []).map((a: any) => {
        const data: Record<string, unknown> = a.data ? { ...a.data } : {}
        if (a.options) data.options = { ...((a.data?.options as Record<string, unknown>) ?? {}), ...a.options }
        return { type: a.type, id: a.id, position: a.position, data }
      })
      const result = this.model.applyBatchNodes(id, {
        add: normAdds,
        delete: body.delete,
        update: (body.update ?? []).map((u: any) => ({ id: u.id, patch: { position: u.position, data: u.data } })),
      })
      return c.json(result)
    })

    /** 连线批量：POST /api/canvases/:id/batch-edges */
    this.app.post('/api/canvases/:id/batch-edges', async (c) => {
      const id = c.req.param('id')
      const body = await c.req.json().catch(() => ({}))
      const result = this.model.applyBatchEdges(id, {
        add: body.add ?? [],
        delete: body.delete,
        update: (body.update ?? []).map((u: any) => {
          const { id: _id, ...rest } = u
          return { id: _id, patch: rest }
        }),
      })
      return c.json(result)
    })

    /** 语义化创建节点：POST /api/canvases/:id/create-node  { type, args, position? } */
    this.app.post('/api/canvases/:id/create-node', async (c) => {
      const id = c.req.param('id')
      const body = await c.req.json().catch(() => ({}))
      const result = createSemanticNode(this.model, this.taskManager, {
        canvasId: id,
        type: body.type,
        args: body.args ?? {},
        position: body.position,
      })
      return c.json(result)
    })

    // ==================== REST：持久化 ====================
    this.app.post('/api/canvases/:id/save', async (c) => {
      const id = c.req.param('id')
      const body = await c.req.json().catch(() => null)
      // 前端可传入当前画布的 nodes/edges（含拖拽后的最新位置），覆盖后端内存后再落盘；
      // 未传则用后端内存数据直接保存。
      if (body && Array.isArray(body.nodes)) {
        const data = { nodes: body.nodes, edges: Array.isArray(body.edges) ? body.edges : [] }
        if (!this.model.hasCanvas(id)) this.model.createCanvas(id)
        this.model.fromJSON(id, data)
      }
      const json = this.model.toJSON(id)
      await this.storage.saveCanvas(id, json.nodes, json.edges)
      return c.json({ ok: true, canvasId: id })
    })

    // ==================== REST：上传 / 图片中转 ====================

    /** 上传图片（multipart 字段 file），返回可访问 URL */
    this.app.post('/api/upload', async (c) => {
      try {
        const body = await c.req.parseBody()
        const file = body.file
        if (!file || typeof file === 'string') {
          return c.json({ ok: false, error: '缺少文件字段 file（multipart/form-data）' }, 400)
        }
        const buf = Buffer.from(await file.arrayBuffer())
        const stored = await this.storage.saveUpload(file.name, buf)
        return c.json({ ok: true, url: `/api/files/${stored}`, name: file.name, stored })
      } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 500)
      }
    })

    /** 读取已上传文件（图片/音视频静态托管） */
    this.app.get('/api/files/:name', async (c) => {
      const buf = await this.storage.readUpload(c.req.param('name'))
      if (!buf) return c.json({ ok: false, error: '文件不存在' }, 404)
      const ext = path.extname(c.req.param('name')).toLowerCase()
      return c.body(new Uint8Array(buf), 200, { 'content-type': EXT_MIME[ext] ?? 'application/octet-stream', 'cache-control': 'public, max-age=3600' })
    })

    // ==================== 画布资源（每画布一 assets 文件夹 + 内容哈希去重） ====================
    // 前端图片/视频节点把字节真存后端：POST 上传（返回 assetId/sha256 + url），GET 取字节。
    // 节点只存 assetId；刷新时前端按 assetId 请求 GET 还原 → 跨会话/跨浏览器不丢。
    /** 上传画布资源：POST /api/canvases/:id/resources  (multipart 字段 file) */
    this.app.post('/api/canvases/:id/resources', async (c) => {
      const id = c.req.param('id')
      try {
        const body = await c.req.parseBody()
        const file = body.file
        if (!file || typeof file === 'string') {
          return c.json({ ok: false, error: '缺少文件字段 file（multipart/form-data）' }, 400)
        }
        const buf = Buffer.from(await file.arrayBuffer())
        const { assetId, stored } = await this.storage.saveResource(id, file.name, buf)
        const ext = path.extname(stored).toLowerCase()
        return c.json({
          ok: true,
          canvasId: id,
          assetId,
          stored,
          url: `/api/canvases/${encodeURIComponent(id)}/resources/${stored}`,
          name: file.name,
          type: EXT_MIME[ext] ?? file.type ?? 'application/octet-stream',
          size: buf.length,
        })
      } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 500)
      }
    })

    /** 读取画布资源字节：GET /api/canvases/:id/resources/:assetId */
    this.app.get('/api/canvases/:id/resources/:assetId', async (c) => {
      const { id, assetId } = c.req.param()
      const buf = await this.storage.readResource(id, assetId)
      if (!buf) return c.json({ ok: false, error: '资源不存在' }, 404)
      const ext = path.extname(assetId).toLowerCase()
      return c.body(new Uint8Array(buf), 200, {
        'content-type': EXT_MIME[ext] ?? 'application/octet-stream',
        'cache-control': 'public, max-age=31536000, immutable', // 内容寻址，可永久缓存
      })
    })

    /** 中转本地绝对路径媒体（图片/视频/音频）：GET /api/proxy-media?path=/abs/x.mp4 或 file:/// 形式 */
    this.app.get('/api/proxy-media', async (c) => {
      const raw = c.req.query('path') ?? ''
      let filePath = raw
      // 支持 file:///C:/... 形式
      if (/^file:\/\/\//i.test(filePath)) filePath = filePath.replace(/^file:\/\/\//i, '')
      if (!filePath) return c.json({ ok: false, error: '缺少 path 参数（本地媒体绝对路径）' }, 400)
      try {
        const buf = await fs.readFile(filePath)
        const ext = path.extname(filePath).toLowerCase()
        return c.body(new Uint8Array(buf), 200, { 'content-type': EXT_MIME[ext] ?? 'application/octet-stream' })
      } catch {
        return c.json({ ok: false, error: `无法读取本地文件: ${filePath}` }, 404)
      }
    })

    /** 兼容旧接口名：/api/proxy-image 等价 /api/proxy-media */
    this.app.get('/api/proxy-image', async (c) => {
      const raw = c.req.query('path') ?? ''
      let filePath = raw
      if (/^file:\/\/\//i.test(filePath)) filePath = filePath.replace(/^file:\/\/\//i, '')
      if (!filePath) return c.json({ ok: false, error: '缺少 path 参数（本地媒体绝对路径）' }, 400)
      try {
        const buf = await fs.readFile(filePath)
        const ext = path.extname(filePath).toLowerCase()
        return c.body(new Uint8Array(buf), 200, { 'content-type': EXT_MIME[ext] ?? 'application/octet-stream' })
      } catch {
        return c.json({ ok: false, error: `无法读取本地文件: ${filePath}` }, 404)
      }
    })

    // ==================== REST：任务 ====================
    this.app.post('/api/tasks', async (c) => {
      const body = await c.req.json().catch(() => ({}))
      try {
        const payload = {
          model: body.model ?? '',
          promptText: body.promptText ?? '',
          ratio: body.ratio,
          resolution: body.resolution,
          resources: (body.resources ?? []).map((r: any) => ({ ...r, kind: r.kind ?? 'image' })),
          ...(body.payload ?? {}),
        }
        const task = this.taskManager.createTask(body.kind, body.canvasId, body.targetNodeId, payload)
        return c.json({ ok: true, taskId: task.id, status: task.status })
      } catch (err) {
        return c.json({ ok: false, error: (err as Error).message })
      }
    })
    this.app.get('/api/tasks/:taskId', (c) => {
      const task = this.taskManager.getTaskStatus(c.req.param('taskId'))
      return task ? c.json({ ok: true, task }) : c.json({ ok: false, error: '任务不存在' })
    })
    /** 按节点 id 查任务状态 */
    this.app.get('/api/canvases/:id/nodes/:nodeId/status', (c) => {
      const { id, nodeId } = c.req.param()
      const node = this.model.getNode(id, nodeId)
      if (!node) return c.json({ ok: false, error: '节点不存在' })
      const task = this.taskManager.findTaskByNode(id, nodeId)
      return c.json({ ok: true, nodeId, task: task ?? null, runState: node.data?.runState })
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
