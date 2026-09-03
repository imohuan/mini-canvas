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
import { listGenerationModels } from '../models/ModelRegistry'

/** MCP 工具定义（给 list-tools 用，与 SDK 注册保持一致） */
export interface McpTool {
  name: string
  description: string
}

const TOOL_LIST: McpTool[] = [
  { name: 'canvas.create_canvas', description: '创建画布（taskId 即画布 id）' },
  { name: 'canvas.list_canvases', description: '列出所有画布' },
  { name: 'canvas.delete_canvas', description: '删除画布' },
  { name: 'canvas.batch', description: '画布批量增删' },
  { name: 'canvas.batch_nodes', description: '画布节点批量增删改查（add/delete/update 合并）' },
  { name: 'canvas.batch_edges', description: '画布连线批量增删改查（add/delete/update 合并）' },
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
  { name: 'node.status', description: '按节点 id 查询其最近任务状态' },
  { name: 'models.list', description: '列出后台可用的生成模型与能力' },
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
    '创建节点（image/video/audio/text/panorama/image-compare）。options 为该节点的持久化配置（图片节点：promptText/promptDoc/selectedModel/selectedRatio/selectedResolution/selectedTemplate），会合并进 data.options',
    {
      taskId: z.string(),
      type: z.enum(['image', 'video', 'audio', 'text', 'panorama', 'image-compare']),
      position: z.object({ x: z.number(), y: z.number() }).optional(),
      data: z.record(z.unknown()).optional(),
      options: z.record(z.unknown()).optional().describe('节点持久化配置，合并进 data.options（如 promptText、selectedModel 等）'),
    },
    async ({ taskId, type, position, data, options }) => {
      const mergedData = {
        ...(data ?? {}),
        ...(options ? { options: { ...(data?.options as Record<string, unknown> | undefined), ...options } } : {}),
      }
      const node = model.createNode(taskId, { type, position, data: mergedData })
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
    '更新节点（data 内字段可更新 status/progress/options/taskId 等；taskId 为节点运行任务的 id）',
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

  // ==================== 批量 CRUD（合并执行） ====================

  server.tool(
    'canvas.batch_nodes',
    '画布节点批量增删改查，合并一次执行：{ add:[{type,position?,data?,options?,id?}], delete:[nodeId,...], update:[{id, patch?}] }。add 支持语义 type(image/video/audio/text/...) 自动转前端可渲染格式；update.patch.data/options 为浅合并。返回 added/deleted/updated ids',
    {
      canvasId: z.string().describe('画布 id（taskId）'),
      add: z.array(z.object({
        type: z.string().describe('语义类型 image/video/audio/text/panorama/image-compare 或 custom'),
        id: z.string().optional(),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
        data: z.record(z.unknown()).optional(),
        options: z.record(z.unknown()).optional().describe('持久化配置，合并进 data.options'),
      })).optional(),
      delete: z.array(z.string()).optional(),
      update: z.array(z.object({
        id: z.string(),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
        data: z.record(z.unknown()).optional(),
      })).optional(),
    },
    async ({ canvasId, add, delete: del, update }) => {
      const normAdds: import('../graph/GraphModel').CreateNodeInput[] = (add ?? []).map((a) => {
        const baseData: Record<string, unknown> = a.data ? { ...a.data } : {}
        if (a.options) baseData.options = { ...(a.data?.options as Record<string, unknown> | undefined), ...a.options }
        return { type: a.type as any, id: a.id, position: a.position, data: baseData }
      })
      const result = model.applyBatchNodes(canvasId, {
        add: normAdds,
        delete: del,
        update: (update ?? []).map((u) => ({ id: u.id, patch: { position: u.position, data: u.data } })),
      })
      return toText(result)
    },
  )

  server.tool(
    'canvas.batch_edges',
    '画布连线批量增删改查，合并一次执行：{ add:[{source,target,sourceHandle?,targetHandle?,id?}], delete:[edgeId,...], update:[{id, patch?}] }。返回 added/deleted/updated ids',
    {
      canvasId: z.string(),
      add: z.array(z.object({
        source: z.string(),
        target: z.string(),
        sourceHandle: z.string().optional(),
        targetHandle: z.string().optional(),
        id: z.string().optional(),
      })).optional(),
      delete: z.array(z.string()).optional(),
      update: z.array(z.object({
        id: z.string(),
        source: z.string().optional(),
        target: z.string().optional(),
        sourceHandle: z.string().optional(),
        targetHandle: z.string().optional(),
        data: z.record(z.unknown()).optional(),
      })).optional(),
    },
    async ({ canvasId, add, delete: del, update }) => {
      const result = model.applyBatchEdges(canvasId, {
        add: add ?? [],
        delete: del,
        update: (update ?? []).map((u) => {
          const { id, ...rest } = u
          return { id, patch: rest as any }
        }),
      })
      return toText(result)
    },
  )

  server.tool(
    'canvas.batch',
    '画布批量增删：{ add:[{id(taskId), name?}], delete:[canvasId,...] }。返回 added/deleted',
    {
      add: z.array(z.object({ id: z.string(), name: z.string().optional() })).optional(),
      delete: z.array(z.string()).optional(),
    },
    async ({ add, delete: del }) => {
      const added: string[] = []
      for (const c of add ?? []) {
        if (!model.hasCanvas(c.id)) {
          model.createCanvas(c.id, c.name)
          await storage.createProject(c.name ?? c.id, c.id)
        }
        added.push(c.id)
      }
      const deleted: string[] = []
      for (const id of del ?? []) {
        if (model.deleteCanvas(id)) {
          await storage.deleteProject(id)
          deleted.push(id)
        }
      }
      return toText({ ok: true, added, deleted })
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
    '提交一次生成任务到后台（低层原语；语义化创建请用 create_node）。立即返回 task_id，后台自动处理，进度/结果经 SSE 广播并写回目标节点 data.runState',
    {
      kind: z.enum(['image', 'video', 'audio', 'text']).describe('任务类型'),
      canvasId: z.string().describe('关联画布 id（taskId）'),
      targetNodeId: z.string().describe('结果写回的目标节点 id'),
      model: z.string().describe('模型 id，如 doubao-seedream-45 / apimart-gpt-image-2'),
      promptText: z.string().optional().describe('提示词'),
      ratio: z.string().optional(),
      resolution: z.string().optional(),
      resources: z.array(z.object({ id: z.string().optional(), kind: z.string().optional(), name: z.string().optional(), url: z.string().optional() })).optional().describe('参考图/音频等资源，url 为可访问地址'),
    },
    async ({ kind, canvasId, targetNodeId, model, promptText, ratio, resolution, resources }) => {
      try {
        const payload = { model, promptText: promptText ?? '', ratio, resolution, resources: (resources ?? []).map((r) => ({ ...r, kind: (r.kind as any) ?? 'image' })) }
        const task = taskManager.createTask(kind, canvasId, targetNodeId, payload)
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

  server.tool(
    'node.status',
    '按节点 id 查询该节点最近一次生成任务的状态（status/progress/message/result/error）',
    { canvasId: z.string(), nodeId: z.string() },
    async ({ canvasId, nodeId }) => {
      const node = model.getNode(canvasId, nodeId)
      if (!node) return toText({ ok: false, error: '节点不存在' })
      const task = taskManager.findTaskByNode(canvasId, nodeId)
      const runState = node.data?.runState
      return toText({
        ok: true,
        nodeId,
        task: task
          ? { id: task.id, kind: task.kind, status: task.status, progress: task.progress, message: task.message, result: task.result, error: task.error }
          : null,
        runState,
      })
    },
  )

  server.tool(
    'models.list',
    '列出后台当前可用的生成模型及其能力（kind/model/label/ratio/resolution/supportsInput/description）',
    {},
    async () => {
      const models = listGenerationModels()
      return toText({ ok: true, models })
    },
  )

  return server
}
