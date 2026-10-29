/**
 * 语义化节点创建（create_node 的核心实现）—— 前后端都经此创建，保持图结构与连线语义一致。
 *
 * type=image（视频/音频/文本同构预留）：
 * - 预览模式 args.path：查画布是否已有 sourcePath===path 的图片节点；有→直接复用(不重复建)；
 *   无→新建图片预览节点(data.imageUrl=proxy 路径, data.sourcePath=归一化绝对路径)。不提交任务。
 * - 生成模式 args.prompt：对每个 referenceImages 绝对路径，复用/新建对应预览节点，
 *   再建"生成节点"并自动连线(源预览 → 生成节点, 显式 source/target handle)，
 *   然后提交一次后台生成任务(TaskManager)。返回生成节点 nodeId + taskId。
 */
import type { GraphModel } from './GraphModel'
import type { TaskManager } from '../tasks/TaskManager'
import { randomUUID } from 'node:crypto'

export type CreateNodeType = 'image' | 'video' | 'audio' | 'text'

/** create_node 的可序列化入参（MCP/REST 共用） */
export interface SemanticNodeRequest {
  canvasId: string
  type: CreateNodeType
  /** 预览或生成参数（按 type 变化） */
  args: {
    /** 预览模式：要展示的本地媒体绝对路径 */
    path?: string
    /** 生成模式：提示词 */
    prompt?: string
    model?: string
    ratio?: string
    resolution?: string
    /** 生成模式的参考图（绝对路径列表） */
    referenceImages?: string[]
    /** 可选标题 */
    label?: string
    [key: string]: unknown
  }
  position?: { x: number; y: number }
}

export interface SemanticNodeResult {
  ok: boolean
  error?: string
  /** 本次实际创建/复用的"主"节点 id（生成模式=生成节点；预览模式=预览节点） */
  nodeId?: string
  /** 预览节点 id（含新建与复用），按 referenceImages/path 顺序 */
  previewNodeIds?: string[]
  /** 自动创建的连线 id */
  edgeIds?: string[]
  /** 若创建即提交了任务，给出 taskId */
  taskId?: string
  mode?: 'preview' | 'generate'
}

/** 归一到统一分隔符的绝对路径（windows 反斜杠 → 斜杠，便于跨平台比对去重） */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/')
}

/** 预览/参考图节点的图片展示 URL（相对后台；前端插件会按 baseUrl 补全） */
export function proxyUrlFor(absPath: string): string {
  return `/api/proxy-media?path=${encodeURIComponent(absPath)}`
}

/** 生成节点落在参考图下方的默认坐标（近似铺开，无需精确） */
function genPosition(_previews: number, start: { x: number; y: number }): { x: number; y: number } {
  return { x: start.x, y: start.y + 420 }
}

/**
 * 创建语义节点。返回 ok/nodeId/taskId 等。
 */
export function createSemanticNode(
  model: GraphModel,
  taskManager: TaskManager,
  req: SemanticNodeRequest,
): SemanticNodeResult {
  const { canvasId, type, args } = req
  if (!model.hasCanvas(canvasId)) {
    return { ok: false, error: `画布不存在: ${canvasId}（请先创建画布）` }
  }

  // ===== 预览模式：仅展示一个本地媒体 =====
  if (args.path) {
    const absPath = normalizePath(args.path)
    // 去重：是否已有相同 sourcePath 的该类型预览节点
    const existing = model.listNodes(canvasId).find((n) => n.data?.sourcePath === absPath && n.data?.nodeType === type)
    if (existing) {
      return { ok: true, nodeId: existing.id, previewNodeIds: [existing.id], mode: 'preview' }
    }
    const pos = req.position ?? { x: 100 + model.listNodes(canvasId).length * 40, y: 100 + model.listNodes(canvasId).length * 40 }
    const data = previewNodeData(type, absPath, args.label)
    const node = model.createNode(canvasId, { type, position: pos, data, id: `pv-${randomUUID().slice(0, 8)}` })
    return { ok: true, nodeId: node.id, previewNodeIds: [node.id], mode: 'preview' }
  }

  // ===== 生成模式：需要 prompt =====
  if (!args.prompt || !String(args.prompt).trim()) {
    return { ok: false, error: `生成模式需要 args.prompt（参考图用 args.referenceImages）` }
  }

  // 1) 参考图：复用或新建预览节点
  const refImages = (args.referenceImages ?? []).map(normalizePath)
  const previewNodeIds: string[] = []
  for (const p of refImages) {
    let pv = model.listNodes(canvasId).find((n) => n.data?.sourcePath === p && n.data?.nodeType === type)
    if (!pv) {
      const data = previewNodeData(type, p, undefined)
      pv = model.createNode(canvasId, { type, position: { x: 100 + previewNodeIds.length * 360, y: 60 }, data, id: `pv-${randomUUID().slice(0, 8)}` })
    }
    if (pv && !previewNodeIds.includes(pv.id)) previewNodeIds.push(pv.id)
  }

  // 2) 生成节点
  const gpos = genPosition(refImages.length, req.position ?? { x: 100, y: 60 })
  const genData = generationNodeData(type, req)
  const genNode = model.createNode(canvasId, { type, position: gpos, data: genData, id: `gen-${randomUUID().slice(0, 8)}` })

  // 3) 自动连线：每个预览节点 → 生成节点（显式 handle，对齐前端渲染）
  const edgeIds: string[] = []
  for (const srcId of previewNodeIds) {
    const e = model.createEdge(canvasId, {
      source: srcId,
      target: genNode.id,
      sourceHandle: 'source',
      targetHandle: 'target',
    })
    edgeIds.push(e.id)
  }

  // 4) 提交后台生成任务（结果写回生成节点）
  const task = taskManager.createTask(type, canvasId, genNode.id, {
    model: args.model ?? '',
    promptText: String(args.prompt),
    ratio: args.ratio,
    resolution: args.resolution,
    resources: previewNodeIds.map((id) => {
      const n = model.getNode(canvasId, id)
      return { kind: 'image', url: n?.data?.sourcePath as string | undefined, id }
    }),
  })

  return { ok: true, nodeId: genNode.id, previewNodeIds, edgeIds, taskId: task.id, mode: 'generate' }
}

/** 预览节点 data（前端 <img> 可渲染） */
function previewNodeData(type: CreateNodeType, absPath: string, label?: string): Record<string, unknown> {
  return {
    nodeType: type,
    label: label || basename(absPath) || type,
    imageUrl: proxyUrlFor(absPath),
    sourcePath: absPath,
    imageName: basename(absPath),
    cardWidth: 240,
    cardHeight: 240,
  }
}

/** 生成节点 data：含 options(对齐 ImageBottomToolbar 持久化配置) + runState 由 TaskManager 维护 */
function generationNodeData(type: CreateNodeType, req: SemanticNodeRequest): Record<string, unknown> {
  const args = req.args as Record<string, unknown>
  const options = {
    promptText: String(args.prompt ?? ''),
    ...(args.model ? { selectedModel: args.model } : {}),
    ...(args.ratio ? { selectedRatio: args.ratio } : {}),
    ...(args.resolution ? { selectedResolution: args.resolution } : {}),
  }
  const data: Record<string, unknown> = {
    nodeType: type,
    label: (args.label as string) || (type === 'image' ? '图片生成' : `${type} 生成`),
    options,
    cardWidth: 320,
    cardHeight: 320,
  }
  return data
}

function basename(p: string): string {
  const parts = p.split('/')
  return parts[parts.length - 1] || p
}
