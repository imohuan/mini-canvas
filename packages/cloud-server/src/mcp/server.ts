/**
 * createCanvasMcpServer —— 把画布能力包成 MCP 工具。
 *
 * 设计取向：**面向 AI 的最小可用面**。
 * - 读：`canvas.get` 一次给全量（节点+边），AI 先看清再动手。
 * - 写：全部收敛到 `canvas.batch_nodes` / `canvas.batch_edges`，三段式
 *   `{add, delete, update}` 一次合并执行 —— 不暴露单点原语，省得 AI 反复往返。
 * - 另给 `canvas.overview` 一个"只看规模"的轻量读数，避免大画布每次读全量。
 *
 * 数据面：全部经 `CanvasDocument` 落到网页端同一份 `canvas:*` key 上，
 * 所以 AI 改完刷新浏览器就能看到，不需要任何同步机制。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { CanvasDocument } from './canvasDoc.js'

/** 工具清单（给 `--list-tools` 与诊断用；与实际注册保持一致） */
export interface McpTool {
  name: string
  description: string
}

export const TOOL_LIST: McpTool[] = [
  { name: 'canvas.get', description: '读取整张画布（节点/连线/视口全量），供 AI 掌握画布当前全貌' },
  { name: 'canvas.overview', description: '只读画布规模（节点数/边数/节点类型分布），大画布时先看这个再决定要不要读全量' },
  { name: 'canvas.batch_nodes', description: '节点批量增删改（add/delete/update 合并一次执行）' },
  { name: 'canvas.batch_edges', description: '连线批量增删改（add/delete/update 合并一次执行）' },
]

/** 列出所有工具 */
export function listTools(): McpTool[] {
  return TOOL_LIST
}

/** 位置参数（多处复用） */
const positionSchema = z.object({ x: z.number(), y: z.number() })

export function createCanvasMcpServer(doc: CanvasDocument): McpServer {
  const server = new McpServer({ name: 'mini-canvas-cloud', version: '0.0.0' })
  const toText = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] })

  server.tool(
    'canvas.get',
    '读取整张画布全量（nodes/edges/viewport）。AI 编辑前应先读一次，掌握现有节点 id 与连线关系',
    {},
    async () => {
      const snap = await doc.read()
      return toText({
        ok: true,
        nodeCount: snap.nodes.length,
        edgeCount: snap.edges.length,
        nodes: snap.nodes,
        edges: snap.edges,
        viewport: snap.viewport ?? null,
      })
    },
  )

  server.tool(
    'canvas.overview',
    '只读画布规模与节点类型分布（不返回节点明细）。大画布时先看这个，避免一次拉回太多内容',
    {},
    async () => {
      const snap = await doc.read()
      const byType: Record<string, number> = {}
      for (const n of snap.nodes) byType[n.type] = (byType[n.type] ?? 0) + 1
      return toText({ ok: true, nodeCount: snap.nodes.length, edgeCount: snap.edges.length, types: byType })
    },
  )

  server.tool(
    'canvas.batch_nodes',
    '节点批量增删改，合并一次执行：{ add:[{type,position?,data?,id?,size?}], delete:[nodeId...], update:[{id,position?,data?}] }。' +
      'type 用画布注册的节点类型（如 text / image / 3d-preview / image-compare）。' +
      '删节点会连带删掉它的连线。整批先预校验，任一非法则一个都不改（返回 errors）。' +
      'id 可省略，服务端会生成一个 `ai-` 前缀的短 id 并在 added 里返回',
    {
      add: z
        .array(
          z.object({
            type: z.string().describe('节点类型，如 text / image'),
            id: z.string().optional().describe('可省略；省略则由服务端生成'),
            position: positionSchema.optional().describe('可省略；省略则自动摆在现有节点右侧空位'),
            data: z.record(z.unknown()).optional().describe('节点数据，如 text 节点的 { text: "..." }'),
            size: z.object({ w: z.number(), h: z.number() }).optional(),
            parentId: z.string().optional().describe('父节点 id（分组嵌套）'),
          }),
        )
        .optional(),
      delete: z.array(z.string()).optional().describe('要删除的节点 id 列表'),
      update: z
        .array(
          z.object({
            id: z.string(),
            position: positionSchema.optional(),
            data: z.record(z.unknown()).optional().describe('浅合并进节点 data'),
          }),
        )
        .optional(),
    },
    async ({ add, delete: del, update }) => {
      const result = await doc.batchNodes({
        ...(add ? { add } : {}),
        ...(del ? { delete: del } : {}),
        ...(update ? { update } : {}),
      })
      return toText(result)
    },
  )

  server.tool(
    'canvas.batch_edges',
    '连线批量增删改，合并一次执行：{ add:[{source,target,sourceHandle?,targetHandle?}], delete:[edgeId...], update:[{id,...}] }。' +
      'add 的两端必须是已存在的节点 id。边 id 可省略，服务端按 `e-{source}-{target}` 生成（同一条边重复添加会被去重）',
    {
      add: z
        .array(
          z.object({
            source: z.string().describe('源节点 id'),
            target: z.string().describe('目标节点 id'),
            id: z.string().optional(),
            sourceHandle: z.string().optional(),
            targetHandle: z.string().optional(),
            data: z.record(z.unknown()).optional(),
          }),
        )
        .optional(),
      delete: z.array(z.string()).optional(),
      update: z
        .array(
          z.object({
            id: z.string(),
            source: z.string().optional(),
            target: z.string().optional(),
            sourceHandle: z.string().optional(),
            targetHandle: z.string().optional(),
            data: z.record(z.unknown()).optional(),
          }),
        )
        .optional(),
    },
    async ({ add, delete: del, update }) => {
      const result = await doc.batchEdges({
        ...(add ? { add } : {}),
        ...(del ? { delete: del } : {}),
        ...(update ? { update } : {}),
      })
      return toText(result)
    },
  )

  return server
}
