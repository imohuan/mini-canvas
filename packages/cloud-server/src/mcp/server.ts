/**
 * createCanvasMcpServer —— 把画布能力包成 MCP 工具。
 *
 * 设计取向：**面向 AI 的最小可用面**。
 * - 读：`canvas_get` 一次给全量（节点+边），AI 先看清再动手。
 * - 写：全部收敛到 `canvas_batch_nodes` / `canvas_batch_edges`，三段式
 *   `{add, delete, update}` 一次合并执行 —— 不暴露单点原语，省得 AI 反复往返。
 * - 另给 `canvas_overview` 一个"只看规模"的轻量读数，避免大画布每次读全量。
 *
 * 数据面：全部经 `CanvasDocument` 落到网页端同一份 `canvas:*` key 上，
 * 所以 AI 改完刷新浏览器就能看到，不需要任何同步机制。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { promises as fs } from 'node:fs'
import type { CanvasDocument } from './canvasDoc.js'
import type { ProviderRegistry } from '../providers/registry.js'
import type { TaskManager } from '../tasks/taskManager.js'
import { DEFAULT_CANVAS_ID } from '../store/canvasPaths.js'
import { kindOfMime, mimeFromName } from '../store/mime.js'
import { toResourceUrl } from '../store/canvasResources.js'
import type { McpToolDef } from '../serverFramework/mcp.js'

/**
 * CanvasDocument 的最小用面（工具只用到这几个方法）。
 *
 * 抽成接口是为了「按画布取文档」—— 默认画布用服务启动时建好的那一个实例，
 * 其它画布每次现建一个（轻量对象，内部只是拼路径）。
 */
export interface CanvasDocLike {
  read(): Promise<{
    nodes: Array<{ id: string; type: string; data?: Record<string, unknown> }>
    edges: Array<{ source: string; target: string }>
    viewport?: unknown
  }>
  /** 返回值里 `url` 是**同源 URL**（`/api/canvases/<画布id>/resources/<哈希>`） */
  saveResource(bytes: Uint8Array, opts?: { fileName?: string; mime?: string }): Promise<{
    url: string
    size: number
    mime: string
  }>
  listResources(): Promise<string[]>
  /**
   * 带类型信息的资源清单（可选：老调用方 / 极简替身不一定实现）。
   * 缺了时 resource_list 退回 listResources + 本地拼 —— 但拿不到 mime/kind，前端只能按名字猜。
   */
  listResourceInfos?(): Promise<Array<{ name: string; mime: string; kind: 'image' | 'video' | 'audio' | 'other'; url: string }>>
  batchNodes(input: unknown): Promise<{
    ok: boolean
    added: string[]
    deleted: string[]
    updated: string[]
    errors: Array<{ message: string }>
  }>
  batchEdges(input: unknown): Promise<{
    ok: boolean
    added: string[]
    deleted: string[]
    updated: string[]
    errors: Array<{ message: string }>
  }>
}

/** 按画布 id 取文档；返回 undefined = 该画布不存在（工具据此报错，而不是悄悄写进 default） */
export type CanvasDocResolver = (canvasId: string) => Promise<CanvasDocLike | undefined> | CanvasDocLike | undefined

/** 参考素材（交给 provider 的一份上游内容） */
export interface CanvasResourceRef {
  kind: string
  url?: string
  value?: string
}

/**
 * 从目标节点的**入边**收集参考素材（纯函数，可单测）。
 *
 * 语义与底栏一致：「连进来的就算素材」。provider 的参考图只认 `input.resources`，
 * 所以 MCP 下单时必须自己从边算出这份清单，否则参考图根本没传过去。
 * 按边出现的顺序、去重；图片/视频取媒体地址，文本取 text。
 */
export function collectReferenceResources(
  nodes: Array<{ id: string; type: string; data?: Record<string, unknown> }>,
  edges: Array<{ source: string; target: string }>,
  targetNodeId: string,
  extraNodeIds: string[] = [],
): CanvasResourceRef[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const wanted = [...edges.filter((e) => e.target === targetNodeId).map((e) => e.source), ...extraNodeIds]
  const out: CanvasResourceRef[] = []
  const seen = new Set<string>()
  for (const id of wanted) {
    if (seen.has(id)) continue
    seen.add(id)
    const n = byId.get(id)
    if (!n) continue
    const d = (n.data ?? {}) as Record<string, unknown>
    const kind = n.type === 'video' ? 'video' : n.type === 'audio' ? 'audio' : n.type === 'image' ? 'image' : 'other'
    const url = [d.imageUrl, d.videoUrl, d.audioUrl].find((u): u is string => typeof u === 'string' && !!u)
    const text = typeof d.text === 'string' ? d.text : undefined
    out.push({ kind, ...(url ? { url } : {}), ...(text && !url ? { value: text } : {}) })
  }
  return out
}

/** 工具清单（给 `--list-tools` 与诊断用；与实际注册保持一致） */
export interface McpTool {
  name: string
  description: string
}

export const TOOL_LIST: McpTool[] = [
  { name: 'canvas_list_canvases', description: '列出所有画布（id + 名字），写画布前用它确认该往哪张画布写' },
  { name: 'canvas_get', description: '读取整张画布（节点/连线/视口全量），供 AI 掌握画布当前全貌' },
  { name: 'canvas_overview', description: '只读画布规模（节点数/边数/节点类型分布），大画布时先看这个再决定要不要读全量' },
  { name: 'canvas_add_image', description: '一步往画布放一张图（上传字节 → 建图片节点），支持本地路径 / http(s) 链接 / dataURL' },
  { name: 'resource_upload', description: '把资源字节交给服务器（本地路径 / http(s) 链接 / base64 / 已有 dataURL），返回稳定 URL 供节点引用' },
  { name: 'resource_list', description: '列出本画布已存资源（名字 / 类型 / 访问地址），据此判断每个资源该当图、视频还是音频用' },
  { name: 'canvas_batch_nodes', description: '节点批量增删改（add/delete/update 合并一次执行）' },
  { name: 'canvas_batch_edges', description: '连线批量增删改（add/delete/update 合并一次执行）' },
  { name: 'generation_actions', description: '列出后台可用的生成动作（模型 + 要什么参数），AI 据此挑一个' },
  { name: 'generation_create', description: '提交一次生成任务（不开页面也能干活）；结果写回指定节点' },
  { name: 'generation_status', description: '查一次生成任务的状态与产物' },
]

/** 列出所有工具 */
export function listTools(): McpTool[] {
  return TOOL_LIST
}

/** 位置参数（多处复用） */
const positionSchema = z.object({ x: z.number(), y: z.number() })

export function createCanvasMcpServer(
  doc: CanvasDocument | CanvasDocLike,
  registry?: ProviderRegistry,
  tasks?: TaskManager,
  /** 插件注册的额外 MCP 工具（ctx.mcp 的落点）；缺省 = 没有插件工具 */
  pluginTools?: McpToolDef[],
  /**
   * 按画布取文档。**必须给**才能多画布工作：AI 传 `canvasId` 时用它取对应画布，
   * 不传则用默认画布（`doc`）。缺省时退回「只有默认画布」的旧行为（测试 / 单画布够用）。
   */
  resolveDoc?: CanvasDocResolver,
  /** 列出全部画布（画布 id + 名字）。给 AI 用来发现「该往哪张画布写」的 id */
  listCanvases?: () => Promise<Array<{ id: string; name: string }>>,
): McpServer {
  const server = new McpServer({ name: 'mini-canvas-cloud', version: '0.0.0' })
  const toText = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] })

  /** 本次调用该操作哪张画布：给了 canvasId 就按它取（不存在则报错），没给就用默认画布 */
  async function pickDoc(canvasId?: string): Promise<{ doc: CanvasDocument | CanvasDocLike } | { error: string }> {
    if (canvasId) {
      const d = resolveDoc ? await resolveDoc(canvasId) : undefined
      if (!d) return { error: '画布不存在: ' + canvasId }
      return { doc: d }
    }
    return { doc }
  }

  /** 统一的 canvasId 入参（所有读写工具都收） */
  const canvasIdSchema = z
    .string()
    .optional()
    .describe('画布 id（省略 = default）。用户的画布 id 在引用里是 `画布id#节点id` 的前半段；不确定就先 canvas_list_canvases')

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
    'canvas_list_canvases',
    '列出这台服务器上的**所有画布**（id + 名字）。' +
      '写画布前用它确认「该往哪张画布写」——用户正看着哪张，就用哪张的 id；' +
      '所有读写工具的 canvasId 参数都从这里取',
    {},
    async () => {
      if (!listCanvases) return toText({ ok: true, canvases: [] })
      const canvases = await listCanvases()
      return toText({ ok: true, canvases })
    },
  )

  server.tool(
    'canvas_get',
    '读取画布。不给 nodeId = 读整张全量（nodes/edges/viewport），AI 编辑前先读一次掌握现状；' +
      '给 nodeId = 只读那一个节点（引用某个节点时用，不必为看一个节点拉回整张画布）',
    {
      nodeId: z.string().optional().describe('只读这一个节点；省略 = 读整张画布'),
      canvasId: canvasIdSchema,
    },
    async ({ nodeId, canvasId }) => {
      const picked = await pickDoc(canvasId)
      if ('error' in picked) return toText({ ok: false, error: picked.error })
      const snap = await picked.doc.read()
      // 按 id 只取一个：省掉"读全量再自己筛"。找不到就如实回空，不编一个空节点。
      if (nodeId !== undefined) {
        const node = snap.nodes.find((n) => n.id === nodeId)
        if (!node) return toText({ ok: false, error: '节点不存在: ' + nodeId })
        const related = snap.edges.filter((e) => e.source === nodeId || e.target === nodeId)
        const byId = new Map(snap.nodes.map((n) => [n.id, n]))
        return toText({
          ok: true,
          node,
          // 顺带把直接相连的边与对端节点给出：AI 常要"这个节点连了谁"，省一次往返
          edges: related,
          neighbors: related
            .map((e) => byId.get(e.source === nodeId ? e.target : e.source))
            .filter((n): n is NonNullable<typeof n> => n !== undefined)
            .map((n) => ({ id: n.id, type: n.type, label: n.data?.label ?? null })),
        })
      }
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
    'canvas_overview',
    '只读画布规模与节点类型分布（不返回节点明细）。大画布时先看这个，避免一次拉回太多内容',
    { canvasId: canvasIdSchema },
    async ({ canvasId }) => {
      const picked = await pickDoc(canvasId)
      if ('error' in picked) return toText({ ok: false, error: picked.error })
      const snap = await picked.doc.read()
      const byType: Record<string, number> = {}
      for (const n of snap.nodes) byType[n.type] = (byType[n.type] ?? 0) + 1
      return toText({ ok: true, nodeCount: snap.nodes.length, edgeCount: snap.edges.length, types: byType })
    },
  )

  server.tool(
    'resource_upload',
    '把资源字节交给服务器存储，返回**同源 URL**（`/api/canvases/<画布>/resources/<哈希>`，可直接写进节点 data 的 imageUrl 等字段）。' +
      '来源四选一：path(服务器本机路径) / url(http(s) 链接) / dataUrl / base64+mime。' +
      '返回里的 url 就是那个地址，浏览器直接就能请求。' +
      '同内容只存一份（按内容哈希），重复上传会返回同一个地址',
    { ...sourceSchema, canvasId: canvasIdSchema },
    async (args) => {
      try {
        const picked = await pickDoc(args.canvasId)
        if ('error' in picked) return toText({ ok: false, error: picked.error })
        const src = await readResourceSource(args)
        const stored = await picked.doc.saveResource(src.bytes, {
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
    'resource_list',
    '列出本画布已存资源（每个资源带 name / mime / kind / url）。kind 是 image/video/audio/other ——' +
      '按扩展名认不出时会读文件头嗅探（画布资源按内容哈希落盘、很多没有扩展名）。' +
      '根据 kind 决定怎么展示：只有 image 能进 <img>，音频硬塞进 <img> 就是裂图',
    { canvasId: canvasIdSchema },
    async ({ canvasId }) => {
      const picked = await pickDoc(canvasId)
      if ('error' in picked) return toText({ ok: false, error: picked.error })
      // 优先用带类型的清单（kind 不全靠调用方猜）；拿不到就退回名字清单，本地补上 url/类型
      const resources = picked.doc.listResourceInfos
        ? await picked.doc.listResourceInfos()
        : (await picked.doc.listResources()).map((name) => ({
            name,
            mime: mimeFromName(name),
            kind: kindOfMime(mimeFromName(name)),
            url: toResourceUrl(canvasId ?? DEFAULT_CANVAS_ID, name),
          }))
      return toText({ ok: true, count: resources.length, resources })
    },
  )

  server.tool(
    'canvas_add_image',
    '一步往画布放一张图：先把字节存成画布资源，再建一个图片节点指向它。' +
      '省掉"先 upload 再 batch_nodes 建节点"两次往返 —— AI 说"放张图"通常就是这个意图。' +
      '来源同样是 path / url / dataUrl / base64 四选一。返回新节点 id 与资源地址（同源 URL）',
    {
      ...sourceSchema,
      canvasId: canvasIdSchema,
      position: positionSchema.optional().describe('可省略；省略则自动摆在现有节点右侧空位'),
      id: z.string().optional().describe('节点 id，可省略（服务端发一个自增数字号，并在 added 里返回）'),
      label: z.string().optional().describe('节点标题（写进 data.label，没有 title 的节点靠它辨认）'),
      data: z.record(z.unknown()).optional().describe('额外写进节点 data 的字段（会与 imageUrl 合并）'),
    },
    async (args) => {
      try {
        const picked = await pickDoc(args.canvasId)
        if ('error' in picked) return toText({ ok: false, error: picked.error })
        const src = await readResourceSource(args)
        const stored = await picked.doc.saveResource(src.bytes, {
          ...(src.fileName !== undefined ? { fileName: src.fileName } : {}),
          ...(src.mime !== undefined ? { mime: src.mime } : {}),
        })
        // 节点里写**同源 URL**（/api/canvases/<画布>/resources/<哈希>）：
        // 节点里存的东西就该是浏览器/下游能直接请求的地址。
        const data: Record<string, unknown> = { ...(args.data ?? {}), imageUrl: stored.url }
        if (src.fileName) data.imageName = src.fileName
        if (args.label) data.label = args.label
        const r = await picked.doc.batchNodes({
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
    'canvas_batch_nodes',
    '节点批量增删改，合并一次执行：{ add:[{type,position?,data?,id?,size?}], delete:[nodeId...], update:[{id,position?,data?}] }。' +
      'type 用画布注册的节点类型（如 text / image / 3d-preview / image-compare）。' +
      '删节点会连带删掉它的连线。整批先预校验，任一非法则一个都不改（返回 errors）。' +
      'id 可省略，服务端会发一个自增数字 id 并在 added 里返回',
    {
      canvasId: canvasIdSchema,
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
    async ({ add, delete: del, update, canvasId }) => {
      const picked = await pickDoc(canvasId)
      if ('error' in picked) return toText({ ok: false, error: picked.error, added: [], deleted: [], updated: [], errors: [] })
      const result = await picked.doc.batchNodes({
        ...(add ? { add } : {}),
        ...(del ? { delete: del } : {}),
        ...(update ? { update } : {}),
      })
      return toText(result)
    },
  )

  server.tool(
    'canvas_batch_edges',
    '连线批量增删改，合并一次执行：{ add:[{source,target,sourceHandle?,targetHandle?}], delete:[edgeId...], update:[{id,...}] }。' +
      'add 的两端必须是已存在的节点 id。边 id 可省略，服务端按 `e-{source}-{target}` 生成（同一条边重复添加会被去重）',
    {
      canvasId: canvasIdSchema,
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
    async ({ add, delete: del, update, canvasId }) => {
      const picked = await pickDoc(canvasId)
      if ('error' in picked) return toText({ ok: false, error: picked.error, added: [], deleted: [], updated: [], errors: [] })
      const result = await picked.doc.batchEdges({
        ...(add ? { add } : {}),
        ...(del ? { delete: del } : {}),
        ...(update ? { update } : {}),
      })
      return toText(result)
    },
  )

  // ==================== 生成任务（不开页面也能干活）====================
  //
  // 这三个工具的存在理由：**用户不打开页面时，AI 也得能下单**。
  // 没有它们，"把生成交给后台"这条承诺就只剩"页面开着的时候"成立。
  // 后台跑任务、写节点、记历史整套都在 TaskManager 里，这里只是给它开个 MCP 口。
  if (registry && tasks) {
    server.tool(
      'generation_actions',
      '列出后台可用的生成动作（有哪些模型、要什么参数）。AI 先看这个，再挑一个 actionId 下单',
      {},
      async () => toText({ ok: true, actions: registry.listActions() }),
    )

    server.tool(
      'generation_create',
      '提交一次生成任务。立即返回 jobId；进度与产物由后台写回目标节点（data.runState），' +
        '产物也会自动写进节点的媒体字段（图片 imageUrl / 音频 audioUrl / 视频 videoUrl），无需再手动搬运。' +
        '参数：canvasId（用户那张画布）、actionId（从 generation_actions 拿）、nodeId（结果写回哪个节点，**必须已存在**）、' +
        'prompt（提示词）、values（动作声明的参数）。' +
        '**参考图**：把参考图节点用 canvas_batch_edges 连到目标节点（source=参考图节点, target=目标节点），' +
        '后台会自动把入边上的图片/视频当作参考图；也可以用 referenceNodeIds 显式补充',
      {
        actionId: z.string().describe('动作 id，从 generation_actions 里挑'),
        nodeId: z.string().describe('结果写回哪个节点（节点必须已存在）'),
        prompt: z.string().optional().describe('提示词'),
        values: z.record(z.unknown()).optional().describe('动作参数（键 = 参数 key）'),
        canvasId: canvasIdSchema,
        referenceNodeIds: z
          .array(z.string())
          .optional()
          .describe('额外的参考图节点 id（除入边之外再补几个）；一般不用，连好边就够了'),
      },
      async (args) => {
        const canvasId = args.canvasId ?? DEFAULT_CANVAS_ID
        // 参考图来自画布上的**入边**（与底栏「连进来就算素材」同一套语义）：
        // target=本节点 的边，其 source 节点若有图片/视频/音频，就当参考素材交给 provider。
        // 这条不能少 —— provider 的参考图只认 input.resources，MCP 不收集的话参考图根本没传过去。
        const resources: Array<{ kind: string; url?: string; value?: string }> = []
        let targetDoc: CanvasDocLike | undefined
        try {
          const picked = await pickDoc(args.canvasId)
          if (!('error' in picked)) {
            targetDoc = picked.doc
            const snap = await picked.doc.read()
            resources.push(...collectReferenceResources(snap.nodes, snap.edges, args.nodeId, args.referenceNodeIds ?? []))
          }
        } catch {
          /* 收集参考图失败不该挡下单：缺参考图仍可生成，只是少了参考 */
        }
        // 把**提示词与参数写进目标节点**（用户口径：点开节点就能看到这次用的提示词）。
        // 与底栏同一套字段：参数落 `data.barValues`、提示词落 `data.barPrompt` ——
        // 底栏重挂载后会从这两个字段恢复，用户点开节点看到的就是 AI 这次用的内容。
        try {
          const data: Record<string, unknown> = { barValues: { ...(args.values ?? {}), actionId: args.actionId } }
          if (args.prompt !== undefined) data.barPrompt = args.prompt
          await targetDoc?.batchNodes({ update: [{ id: args.nodeId, data }] })
        } catch {
          /* 写回提示词失败不该挡下单（任务照样能跑，只是节点上看不到提示词） */
        }
        const job = await tasks.createJob({
          canvasId,
          nodeId: args.nodeId,
          actionId: args.actionId,
          ...(args.prompt !== undefined ? { prompt: args.prompt } : {}),
          ...(args.values ? { values: args.values } : {}),
          ...(resources.length ? { resources } : {}),
        })
        if ('error' in job) return toText({ ok: false, error: job.error })
        return toText({ ok: true, jobId: job.id, status: job.status, canvasId, nodeId: args.nodeId })
      },
    )

    server.tool(
      'generation_status',
      '查一次生成任务的状态与产物（AI 提交后可以隔一会儿问一次）',
      { jobId: z.string().describe('generation_create 返回的 jobId') },
      async (args) => {
        const job = tasks.getJob(args.jobId)
        return job ? toText({ ok: true, job }) : toText({ ok: false, error: '任务不存在' })
      },
    )
  }

  // ==================== 插件注册的 MCP 工具（ctx.mcp）====================
  //
  // 放在最后、由调用方把「当前注册场里的工具」传进来。为什么让**调用方**取列表而不是本函数
  // 自己去读注册场：本函数只认识 doc/registry/tasks，不该知道"插件系统"的存在
  // （与 agentSessions 的 preTurn 参数同一取向：谁在轮次前做什么，由宿主注入）。
  if (pluginTools && pluginTools.length > 0) {
    // 已注册的名字（内置工具）；插件工具若同名，SDK 会抛
    // `Tool X is already registered` 让整个 /mcp 500 —— 所以这里先查重、跳过并警告。
    // 为什么不用"插件优先覆盖"：内置工具是宿主承诺的能力，被插件悄悄顶掉更危险。
    const taken = new Set(TOOL_LIST.map((x) => x.name))
    for (const t of pluginTools) {
      if (taken.has(t.name)) {
        console.warn(
          '[mcp] 插件工具 "' + t.name + '" 与已注册的工具重名，已跳过（换个名字，或加插件名前缀）',
        )
        continue
      }
      taken.add(t.name)
      // 参数简表 → zod schema（MCP SDK 只认 zod）
      const shape: Record<string, z.ZodTypeAny> = {}
      for (const [key, type] of Object.entries(t.input ?? {})) {
        const base =
          type === 'number'
            ? z.number()
            : type === 'boolean'
              ? z.boolean()
              : z.string()
        shape[key] = (t.required ?? []).includes(key) ? base : base.optional()
      }
      const cb = async (args: Record<string, unknown>) => {
        try {
          const value = await t.handler(args ?? {})
          return toText(value === undefined ? { ok: true } : value)
        } catch (err) {
          return toText({ ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      }
      // shape 与 cb 都是动态构造的，SDK 的重载在类型层认不出来；运行时契约一致
      ;(server.tool as unknown as (n: string, d: string, s: unknown, c: unknown) => unknown)(
        t.name,
        t.description,
        shape,
        cb,
      )
    }
  }

  return server
}
