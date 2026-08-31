/**
 * MCP 服务构建
 *
 * 把 GraphModel（headless 画布）+ NodeStorage（落盘）包成 MCP Tool，
 * 用官方 @modelcontextprotocol/sdk 创建 server。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { GraphModel } from '../graph/GraphModel'
import type { NodeStorage } from '../storage/NodeStorage'
import type { TaskManager } from '../tasks/TaskManager'

/** MCP 工具定义（给 list-tools 用，与 SDK 注册保持一致） */
export interface McpTool {
  name: string
  description: string
}

const TOOL_LIST: McpTool[] = [
  { name: 'canvas.create_canvas', description: '创建画布（taskId 即画布 id）' },
  { name: 'canvas.list_canvases', description: '列出所有画布' },
  { name: 'canvas.delete_canvas', description: '删除画布' },
  { name: 'canvas.create_node', description: '创建节点（图片/视频/音频/文本等）' },
  { name: 'canvas.list_nodes', description: '列出画布下所有节点' },
  { name: 'canvas.get_node', description: '获取单个节点' },
  { name: 'canvas.update_node', description: '更新节点' },
  { name: 'canvas.delete_node', description: '删除节点（含关联连线）' },
  { name: 'canvas.create_edge', description: '创建连线' },
  { name: 'canvas.list_edges', description: '列出画布下所有连线' },
  { name: 'canvas.delete_edge', description: '删除连线' },
  { name: 'canvas.set_node_position', description: '设置节点位置' },
  { name: 'canvas.set_viewport', description: '设置视口（缩放/平移）' },
  { name: 'canvas.save', description: '保存画布到本地 JSON（后台落盘）' },
  { name: 'canvas.load', description: '从本地 JSON 加载画布' },
  { name: 'canvas.export_json', description: '导出画布 JSON' },
  { name: 'task.create', description: '创建异步任务，立即返回 task_id，后台自动处理' },
  { name: 'task.status', description: '查询任务状态' },
]

/** 列出所有工具（list-tools CLI 用） */
export function listTools(): McpTool[] {
  return TOOL_LIST
}

/**
 * 创建并配置 MCP server
 */
export function createMcpServer(
  model: GraphModel,
  storage: NodeStorage,
  taskManager: TaskManager,
): McpServer {
  const server = new McpServer({
    name: 'mini-canvas',
    version: '0.0.0',
  })

  // MCP tool handler 应返回 CallToolResult：{ content: [{ type:'text', text }] }
  const toText = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] })

  // ==================== 画布/任务 ====================

  server.tool(
    'canvas.create_canvas',
    '创建画布，taskId 即画布 id',
    {
      taskId: z.string().describe('画布/任务 id'),
      name: z.string().optional().describe('画布名称'),
    },
    async ({ taskId, name }) => {
      model.createCanvas(taskId, name)
      await storage.createProject(name ?? taskId, taskId)
      return toText({ ok: true, canvasId: taskId })
    },
  )

  server.tool(
    'canvas.list_canvases',
    '列出所有画布',
    {},
    async () => {
      return toText({ canvases: model.listCanvases() })
    },
  )

  server.tool(
    'canvas.delete_canvas',
    '删除画布及其数据',
    { taskId: z.string() },
    async ({ taskId }) => {
      const removed = model.deleteCanvas(taskId)
      await storage.deleteProject(taskId)
      return toText({ ok: removed, canvasId: taskId })
    },
  )

  // ==================== 节点 ====================

  server.tool(
    'canvas.create_node',
    '创建节点（image/video/audio/text/panorama/image-compare）',
    {
      taskId: z.string(),
      type: z.enum(['image', 'video', 'audio', 'text', 'panorama', 'image-compare']),
      position: z.object({ x: z.number(), y: z.number() }).optional(),
      data: z.record(z.unknown()).optional(),
    },
    async ({ taskId, type, position, data }) => {
      const node = model.createNode(taskId, { type, position, data })
      return toText({ ok: true, node })
    },
  )

  server.tool(
    'canvas.list_nodes',
    '列出画布下所有节点',
    { taskId: z.string() },
    async ({ taskId }) => {
      return toText({ nodes: model.listNodes(taskId) })
    },
  )

  server.tool(
    'canvas.get_node',
    '获取单个节点',
    { taskId: z.string(), nodeId: z.string() },
    async ({ taskId, nodeId }) => {
      const node = model.getNode(taskId, nodeId)
      return toText(node ? { ok: true, node } : { ok: false, error: '节点不存在' })
    },
  )

  server.tool(
    'canvas.update_node',
    '更新节点（data 内字段可更新 status/progress 等）',
    {
      taskId: z.string(),
      nodeId: z.string(),
      position: z.object({ x: z.number(), y: z.number() }).optional(),
      data: z.record(z.unknown()).optional(),
    },
    async ({ taskId, nodeId, position, data }) => {
      const node = model.updateNode(taskId, nodeId, {
        position: position as any,
        data: data as any,
      })
      return toText(node ? { ok: true, node } : { ok: false, error: '节点不存在' })
    },
  )

  server.tool(
    'canvas.delete_node',
    '删除节点（含关联连线）',
    { taskId: z.string(), nodeId: z.string() },
    async ({ taskId, nodeId }) => {
      const removed = model.deleteNode(taskId, nodeId)
      return toText({ ok: removed })
    },
  )

  // ==================== 连线 ====================

  server.tool(
    'canvas.create_edge',
    '创建连线',
    {
      taskId: z.string(),
      source: z.string(),
      target: z.string(),
      sourceHandle: z.string().optional(),
      targetHandle: z.string().optional(),
    },
    async ({ taskId, source, target, sourceHandle, targetHandle }) => {
      try {
        const edge = model.createEdge(taskId, { source, target, sourceHandle, targetHandle })
        return toText({ ok: true, edge })
      } catch (err) {
        return toText({ ok: false, error: (err as Error).message })
      }
    },
  )

  server.tool(
    'canvas.list_edges',
    '列出画布下所有连线',
    { taskId: z.string() },
    async ({ taskId }) => {
      return toText({ edges: model.listEdges(taskId) })
    },
  )

  server.tool(
    'canvas.delete_edge',
    '删除连线',
    { taskId: z.string(), edgeId: z.string() },
    async ({ taskId, edgeId }) => {
      const removed = model.deleteEdge(taskId, edgeId)
      return toText({ ok: removed })
    },
  )

  // ==================== 定位 ====================

  server.tool(
    'canvas.set_node_position',
    '设置节点位置',
    { taskId: z.string(), nodeId: z.string(), x: z.number(), y: z.number() },
    async ({ taskId, nodeId, x, y }) => {
      const node = model.setNodePosition(taskId, nodeId, x, y)
      return toText(node ? { ok: true, node } : { ok: false, error: '节点不存在' })
    },
  )

  server.tool(
    'canvas.set_viewport',
    '设置视口（缩放/平移）',
    { taskId: z.string(), x: z.number(), y: z.number(), zoom: z.number() },
    async ({ taskId, x, y, zoom }) => {
      model.setViewport(taskId, { x, y, zoom })
      return toText({ ok: true, viewport: model.getViewport(taskId) })
    },
  )

  // ==================== 持久化（归后台） ====================

  server.tool(
    'canvas.save',
    '保存画布到本地 JSON（由后台落盘）',
    { taskId: z.string() },
    async ({ taskId }) => {
      const json = model.toJSON(taskId)
      await storage.saveCanvas(taskId, json.nodes, json.edges)
      return toText({ ok: true, canvasId: taskId })
    },
  )

  server.tool(
    'canvas.load',
    '从本地 JSON 加载画布到内存（由后台读取）',
    { taskId: z.string() },
    async ({ taskId }) => {
      const data = await storage.loadCanvas(taskId)
      if (!model.hasCanvas(taskId)) model.createCanvas(taskId)
      model.fromJSON(taskId, data)
      return toText({ ok: true, nodeCount: data.nodes.length, edgeCount: data.edges.length })
    },
  )

  server.tool(
    'canvas.export_json',
    '导出画布完整 JSON',
    { taskId: z.string() },
    async ({ taskId }) => {
      return toText({ json: model.toJSON(taskId) })
    },
  )

  // ==================== 异步任务（后台接管） ====================

  server.tool(
    'task.create',
    '创建异步任务，立即返回 task_id，后台自动处理（图片/视频/音频生成）',
    {
      kind: z.enum(['image', 'video', 'audio', 'text']),
      canvasId: z.string().describe('关联画布 id（taskId）'),
      targetNodeId: z.string().describe('结果写回的目标节点 id'),
      payload: z.record(z.unknown()).optional().describe('任务参数，如 { prompt }'),
    },
    async ({ kind, canvasId, targetNodeId, payload }) => {
      try {
        const task = taskManager.createTask(kind, canvasId, targetNodeId, payload ?? {})
        return toText({ ok: true, taskId: task.id, status: task.status })
      } catch (err) {
        return toText({ ok: false, error: (err as Error).message })
      }
    },
  )

  server.tool(
    'task.status',
    '查询任务状态（含进度/结果）',
    { taskId: z.string() },
    async ({ taskId }) => {
      const task = taskManager.getTaskStatus(taskId)
      return task
        ? toText({ ok: true, task })
        : toText({ ok: false, error: '任务不存在' })
    },
  )

  return server
}
