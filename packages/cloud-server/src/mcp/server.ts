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
import { promises as fs } from 'node:fs'
import type { CanvasDocument } from './canvasDoc.js'

/** 工具清单（给 `--list-tools` 与诊断用；与实际注册保持一致） */
export interface McpTool {
  name: string
  description: string
}

export const TOOL_LIST: McpTool[] = [
  { name: 'canvas.get', description: '读取整张画布（节点/连线/视口全量），供 AI 掌握画布当前全貌' },
  { name: 'canvas.overview', description: '只读画布规模（节点数/边数/节点类型分布），大画布时先看这个再决定要不要读全量' },
  { name: 'canvas.add_image', description: '一步往画布放一张图（上传字节 → 建图片节点），支持本地路径 / http(s) 链接 / dataURL' },
  { name: 'resource.upload', description: '把资源字节交给服务器（本地路径 / http(s) 链接 / base64 / 已有 dataURL），返回稳定 URL 供节点引用' },
  { name: 'resource.list', description: '列出服务器上已存资源的 id 与 URL' },
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

  /**
   * 把"资源来源"取成字节。支持三种给法，覆盖 AI 手里常见的形态：
   * - `path`：服务器本机的文件路径（AI 在本地干活最常见）；
   * - `url` ：http(s) 链接（AI 从网上下到的图）；
   * - `dataUrl` / `base64`：已经拿在手里的字节。
   *
   * 一次只接受一种，说不清就报错 —— 宁可让 AI 明确一次，也不要猜错拿错图。
   */
  async function readResourceSource(src: {
    path?: string
    url?: string
    dataUrl?: string
    base64?: string
    fileName?: string
    mime?: string
  }): Promise<{ bytes: Uint8Array; fileName?: string; mime?: string }> {
    const given = [src.path, src.url, src.dataUrl, src.base64].filter((v) => v !== undefined && v !== '')
    if (given.length === 0) throw new Error('需要给出 path / url / dataUrl / base64 之一')
    if (given.length > 1) throw new Error('path / url / dataUrl / base64 只能给一个')

    if (src.path) {
      const bytes = new Uint8Array(await fs.readFile(src.path))
      const name = src.fileName ?? src.path.split(/[\\/]/).pop() ?? undefined
      return { bytes, ...(name ? { fileName: name } : {}) }
    }
    if (src.url) {
      const res = await fetch(src.url)
      if (!res.ok) throw new Error(`拉取失败 ${res.status}: ${src.url}`)
      const mime = res.headers.get('content-type') ?? undefined
      const bytes = new Uint8Array(await res.arrayBuffer())
      const fromUrl = src.url.split('?')[0].split('/').pop() ?? undefined
      const name = src.fileName ?? fromUrl
      return { bytes, ...(name ? { fileName: name } : {}), ...(mime ? { mime } : {}) }
    }
    const dataUrl = src.dataUrl ?? `data:${src.mime ?? 'application/octet-stream'};base64,${src.base64 ?? ''}`
    const comma = dataUrl.indexOf(',')
    if (comma < 0) throw new Error('dataUrl 格式不对（缺逗号）')
    const header = dataUrl.slice(0, comma)
    const payload = dataUrl.slice(comma + 1)
    const isBase64 = header.includes(';base64')
    const mime = header.slice('data:'.length).split(';')[0] || src.mime || undefined
    const bytes = isBase64
      ? Uint8Array.from(Buffer.from(payload, 'base64'))
      : new Uint8Array(Buffer.from(decodeURIComponent(payload), 'utf8'))
    return { bytes, ...(src.fileName ? { fileName: src.fileName } : {}), ...(mime ? { mime } : {}) }
  }

  /** 资源来源的参数 schema（上传与 add_image 共用） */
  const sourceSchema = {
    path: z.string().optional().describe('服务器本机的文件绝对路径'),
    url: z.string().optional().describe('http(s) 链接'),
    dataUrl: z.string().optional().describe('data:image/png;base64,... 形式'),
    base64: z.string().optional().describe('纯 base64（需配合 mime）'),
    fileName: z.string().optional().describe('文件名（用于推断扩展名/展示名）'),
    mime: z.string().optional().describe('MIME，如 image/png'),
  }

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
    'resource.upload',
    '把资源字节交给服务器存储，返回**同源稳定 URL**（形如 /uploads/abc123.png）。' +
      '来源四选一：path(服务器本机路径) / url(http(s) 链接) / dataUrl / base64+mime。' +
      '拿到 URL 后写进节点的 data.imageUrl 即可显示（换机器/刷新都还在）。' +
      '同内容只存一份（按内容哈希），重复上传会返回同一个 URL',
    sourceSchema,
    async (args) => {
      try {
        const src = await readResourceSource(args)
        const stored = await doc.saveResource(src.bytes, {
          ...(src.fileName !== undefined ? { fileName: src.fileName } : {}),
          ...(src.mime !== undefined ? { mime: src.mime } : {}),
        })
        return toText({ ok: true, ...stored })
      } catch (err) {
        return toText({ ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    },
  )

  server.tool(
    'resource.list',
    '列出服务器上已存资源的 id 与同源 URL',
    {},
    async () => {
      const ids = await doc.listResources()
      return toText({ ok: true, count: ids.length, resources: ids.map((id) => ({ id, url: `/uploads/${id}` })) })
    },
  )

  server.tool(
    'canvas.add_image',
    '一步往画布放一张图：先把字节存成服务器资源，再建一个图片节点指向它。' +
      '省掉"先 upload 拿到 URL、再 batch_nodes 建节点"两次往返 —— AI 说"放张图"通常就是这个意图。' +
      '来源同样是 path / url / dataUrl / base64 四选一。返回新节点 id 与资源 URL',
    {
      ...sourceSchema,
      position: positionSchema.optional().describe('可省略；省略则自动摆在现有节点右侧空位'),
      id: z.string().optional().describe('节点 id，可省略（服务端生成 ai- 前缀的）'),
      label: z.string().optional().describe('节点标题（写进 data.label，没有 title 的节点靠它辨认）'),
      data: z.record(z.unknown()).optional().describe('额外写进节点 data 的字段（会与 imageUrl 合并）'),
    },
    async (args) => {
      try {
        const src = await readResourceSource(args)
        const stored = await doc.saveResource(src.bytes, {
          ...(src.fileName !== undefined ? { fileName: src.fileName } : {}),
          ...(src.mime !== undefined ? { mime: src.mime } : {}),
        })
        const data: Record<string, unknown> = { ...(args.data ?? {}), imageUrl: stored.url }
        if (src.fileName) data.imageName = src.fileName
        if (args.label) data.label = args.label
        const r = await doc.batchNodes({
          add: [
            {
              type: 'image',
              ...(args.id !== undefined ? { id: args.id } : {}),
              ...(args.position !== undefined ? { position: args.position } : {}),
              data,
            },
          ],
        })
        if (!r.ok) {
          return toText({ ...r, ok: false, error: r.errors.map((e) => e.message).join('; ') })
        }
        return toText({ ok: true, nodeId: r.added[0], url: stored.url, size: stored.size, mime: stored.mime })
      } catch (err) {
        return toText({ ok: false, error: err instanceof Error ? err.message : String(err) })
      }
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
