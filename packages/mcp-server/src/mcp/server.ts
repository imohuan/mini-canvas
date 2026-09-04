/**
 * MCP 服务构建
 *
 * 把 GraphModel（headless 画布）+ NodeStorage（落盘）+ TaskManager（后台生成任务）
 * 包成一组"简洁"的 MCP Tool，用官方 @modelcontextprotocol/sdk 创建 server。
 *
 * 设计原则（AI 视角最小可用面）：
 * - 画布生命周期：create/list/delete/get（get 返回整张画布供 AI 读上下文）。
 * - 节点/连线编辑：全部收敛到 canvas.batch_nodes / canvas.batch_edges，
 *   支持 { add:[...], delete:[...], update:[...] } 一次合并执行，不再暴露单点原语。
 * - 语义化创建 + 后台任务：create_node（预览/生成双模式，自动建预览节点并连线并提交任务）
 *   + node.status（按 nodeId 查任务进度）。不再暴露 task.create/task.status。
 * - 底层 model 方法 / REST（前端插件走 REST + SSE）与 MCP 工具面解耦：
 *   删工具不影响前端功能，只影响 AI 经 MCP 能看到、能调用的能力。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { GraphModel } from '../graph/GraphModel'
import type { NodeStorage } from '../storage/NodeStorage'
import type { TaskManager } from '../tasks/TaskManager'
import { listGenerationModels } from '../models/ModelRegistry'
import { createSemanticNode } from '../graph/semanticNodes'

/** MCP 工具定义（给 list-tools 用，与 SDK 注册保持一致） */
export interface McpTool {
  name: string
  description: string
}

const TOOL_LIST: McpTool[] = [
  { name: 'canvas.create_canvas', description: '创建画布（taskId 即画布 id）' },
  { name: 'canvas.list_canvases', description: '列出所有画布' },
  { name: 'canvas.delete_canvas', description: '删除画布' },
  { name: 'canvas.get', description: '读取整张画布（节点/连线/视口全量）' },
  { name: 'canvas.batch_nodes', description: '画布节点批量增删改（add/delete/update 合并一次执行）' },
  { name: 'canvas.batch_edges', description: '画布连线批量增删改（add/delete/update 合并一次执行）' },
  { name: 'create_node', description: '语义化创建节点（预览或生成任务，自动建参考图预览节点并连线）' },
  { name: 'node.status', description: '按节点 id 查询该节点最近一次生成任务的状态' },
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

  // ==================== 画布生命周期 ====================

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

  server.tool(
    'canvas.get',
    '读取整张画布全量（nodes/edges/viewport），供 AI 掌握画布当前全貌后继续编辑',
    { canvasId: z.string().describe('画布 id（taskId）') },
    async ({ canvasId }) => {
      if (!model.hasCanvas(canvasId)) return toText({ ok: false, error: '画布不存在' })
      const json = model.toJSON(canvasId)
      return toText({ ok: true, canvasId, nodeCount: json.nodes.length, edgeCount: json.edges.length, nodes: json.nodes, edges: json.edges, viewport: json.viewport })
    },
  )

  // ==================== 语义化创建（create_node） ====================

  server.tool(
    'create_node',
    '语义化创建节点并（生成模式）自动提交后台任务。type=image/video/audio/text。' +
      '用法一(预览/展示资源)：{ type:"image", args:{ path:"绝对路径" } } → 自动复用/新建展示节点，返回 nodeId。' +
      '用法二(生成任务)：{ type:"image", args:{ prompt, model?, ratio?, resolution?, referenceImages?:[绝对路径...] } } → 后台按 referenceImages 自动复用/新建预览节点并连线到生成节点，然后提交生成任务。返回生成节点 nodeId + taskId。' +
      '返回的 nodeId 可用 node.status 查询任务进度',
    {
      canvasId: z.string().describe('画布 id'),
      type: z.enum(['image', 'video', 'audio', 'text']),
      args: z.object({
        path: z.string().optional().describe('预览/展示的本地媒体绝对路径'),
        prompt: z.string().optional().describe('生成提示词'),
        model: z.string().optional().describe('生成模型 id，如 doubao-seedream-45 / apimart-gpt-image-2'),
        ratio: z.string().optional(),
        resolution: z.string().optional(),
        referenceImages: z.array(z.string()).optional().describe('生成模式的参考图绝对路径列表'),
        label: z.string().optional().describe('节点标题'),
      }),
      position: z.object({ x: z.number(), y: z.number() }).optional(),
    },
    async ({ canvasId, type, args, position }) => {
      const result = createSemanticNode(model, taskManager, { canvasId, type, args, position })
      return toText(result)
    },
  )

  // ==================== 节点批量 CRUD（合并执行） ====================

  server.tool(
    'canvas.batch_nodes',
    '画布节点批量增删改，合并一次执行：{ add:[{type,position?,data?,options?,id?}], delete:[nodeId,...], update:[{id, position?, data?}] }。' +
      'add 支持语义 type(image/video/audio/text/panorama/image-compare) 自动转前端可渲染格式；options 合并进 data.options；update.data/options 为浅合并。返回 added/deleted/updated ids',
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

  // ==================== 连线批量 CRUD（合并执行） ====================

  server.tool(
    'canvas.batch_edges',
    '画布连线批量增删改，合并一次执行：{ add:[{source,target,sourceHandle?,targetHandle?,id?}], delete:[edgeId,...], update:[{id, source?/target?/sourceHandle?/targetHandle?/data?}] }。返回 added/deleted/updated ids',
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

  // ==================== 任务状态 ====================

  server.tool(
    'node.status',
    '按节点 id 查询该节点最近一次生成任务的状态（status/progress/message/result/error/runState）',
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

  // ==================== 模型 ====================

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
