/**
 * GraphModel — headless 无头画布引擎（纯数据层，零 DOM）
 *
 * 持有所有画布，一个画布 = 一个 taskId（任务 ID 即画布 ID）。
 * 每次变更递增 graphVersion，并派发事件，供 MCP Tool 与 SSE 订阅使用。
 */
import { randomUUID } from 'node:crypto'
import type {
  CanvasEdge,
  CanvasNode,
  CanvasNodeType,
  CanvasViewport,
  GraphEvent,
} from './types'

/** 单个画布内部状态 */
interface CanvasGraph {
  id: string
  name: string
  nodes: Map<string, CanvasNode>
  edges: Map<string, CanvasEdge>
  viewport: CanvasViewport
  graphVersion: number
}

/** 事件监听器 */
type Listener = (event: GraphEvent) => void

/** 创建节点参数 */
export interface CreateNodeInput {
  type: CanvasNodeType
  position?: { x: number; y: number }
  data?: Record<string, unknown>
  id?: string
}

/** 创建连线参数 */
export interface CreateEdgeInput {
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  data?: Record<string, unknown>
  id?: string
}

/** 批量 CRUD 结果 */
export interface BatchResult<T = string> {
  ok: boolean
  added: T[]
  deleted: string[]
  updated: string[]
  errors: { op: string; index: number; message: string }[]
}

/** 节点批量入参（add/delete/update 均可省略） */
export interface NodeBatchInput {
  add?: CreateNodeInput[]
  delete?: string[]
  update?: { id: string; patch: Partial<CanvasNode> }[]
}

/** 连线批量入参（add/delete/update 均可省略） */
export interface EdgeBatchInput {
  add?: CreateEdgeInput[]
  delete?: string[]
  update?: { id: string; patch: Partial<CanvasEdge> }[]
}

export class GraphModel {
  private canvases = new Map<string, CanvasGraph>()
  private listeners = new Set<Listener>()

  // ==================== 事件总线 ====================

  /** 订阅图事件 */
  on(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: GraphEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  // ==================== 画布生命周期 ====================

  /** 创建画布（taskId 即画布 id）。已存在则返回现有实例。 */
  createCanvas(taskId: string, name?: string): CanvasGraph {
    if (this.canvases.has(taskId)) return this.canvases.get(taskId)!
    const canvas: CanvasGraph = {
      id: taskId,
      name: name ?? taskId,
      nodes: new Map(),
      edges: new Map(),
      viewport: { x: 0, y: 0, zoom: 1 },
      graphVersion: 0,
    }
    this.canvases.set(taskId, canvas)
    this.emit({ type: 'graph:changed', canvasId: taskId, graphVersion: 0 })
    return canvas
  }

  /** 删除画布 */
  deleteCanvas(taskId: string): boolean {
    return this.canvases.delete(taskId)
  }

  /** 列出所有画布 */
  listCanvases(): { id: string; name: string; nodeCount: number; edgeCount: number }[] {
    return [...this.canvases.values()].map((c) => ({
      id: c.id,
      name: c.name,
      nodeCount: c.nodes.size,
      edgeCount: c.edges.size,
    }))
  }

  /** 画布是否存在 */
  hasCanvas(taskId: string): boolean {
    return this.canvases.has(taskId)
  }

  private getCanvas(taskId: string): CanvasGraph {
    const canvas = this.canvases.get(taskId)
    if (!canvas) {
      throw new Error(`[GraphModel] 画布不存在: ${taskId}（请先 createCanvas）`)
    }
    return canvas
  }

  // ==================== 节点 CRUD ====================

  /**
   * 前端插件注册的语义节点类型（映射到 VueFlow type='custom' + data.nodeType）
   */
  private static SEMANTIC_NODE_TYPES = new Set([
    'image', 'video', 'text', 'panorama', 'image-compare',
  ])

  /**
   * 创建节点
   *
   * 兼容两种 type 语义：
   * - 语义类型（image/video/text/...）：自动转成前端可渲染的
   *   `type:'custom'` + `data.nodeType`，这样画布能渲染成插件节点。
   * - 直接传 VueFlow 格式（type='custom' 且 data.nodeType 已设）：原样保留。
   */
  createNode(taskId: string, input: CreateNodeInput): CanvasNode {
    const canvas = this.getCanvas(taskId)
    const isSemantic = GraphModel.SEMANTIC_NODE_TYPES.has(input.type)
    const node: CanvasNode = {
      id: input.id ?? randomUUID(),
      type: isSemantic ? 'custom' : input.type,
      position: input.position ?? { x: 0, y: 0 },
      data: isSemantic
        ? { ...(input.data ?? {}), nodeType: input.type }
        : { ...(input.data ?? {}) },
    }
    canvas.nodes.set(node.id, node)
    this.bump(canvas)
    this.emit({ type: 'node:added', canvasId: taskId, node })
    this.emit({ type: 'graph:changed', canvasId: taskId, graphVersion: canvas.graphVersion })
    return node
  }

  /** 删除节点（同时删除关联连线） */
  deleteNode(taskId: string, nodeId: string): boolean {
    const canvas = this.getCanvas(taskId)
    const removed = canvas.nodes.delete(nodeId)
    if (removed) {
      // 清理关联连线
      for (const [edgeId, edge] of canvas.edges) {
        if (edge.source === nodeId || edge.target === nodeId) {
          canvas.edges.delete(edgeId)
          this.emit({ type: 'edge:removed', canvasId: taskId, edgeId })
        }
      }
      this.bump(canvas)
      this.emit({ type: 'node:removed', canvasId: taskId, nodeId })
      this.emit({ type: 'graph:changed', canvasId: taskId, graphVersion: canvas.graphVersion })
    }
    return removed
  }

  /** 更新节点（部分字段合并） */
  updateNode(taskId: string, nodeId: string, patch: Partial<CanvasNode>): CanvasNode | null {
    const canvas = this.getCanvas(taskId)
    const node = canvas.nodes.get(nodeId)
    if (!node) return null
    if (patch.position) node.position = { ...node.position, ...patch.position }
    if (patch.data) node.data = { ...node.data, ...patch.data }
    for (const key of Object.keys(patch)) {
      if (key !== 'position' && key !== 'data' && key !== 'id') {
        ;(node as Record<string, unknown>)[key] = (patch as Record<string, unknown>)[key]
      }
    }
    this.bump(canvas)
    this.emit({ type: 'node:updated', canvasId: taskId, nodeId, patch, node })
    this.emit({ type: 'graph:changed', canvasId: taskId, graphVersion: canvas.graphVersion })
    return node
  }

  /** 查询节点 */
  getNode(taskId: string, nodeId: string): CanvasNode | null {
    return this.getCanvas(taskId).nodes.get(nodeId) ?? null
  }

  /** 列出节点 */
  listNodes(taskId: string): CanvasNode[] {
    return [...this.getCanvas(taskId).nodes.values()]
  }

  // ==================== 连线 CRUD ====================

  /** 创建连线（校验 source/target 存在且不指向同一节点） */
  createEdge(taskId: string, input: CreateEdgeInput): CanvasEdge {
    const canvas = this.getCanvas(taskId)
    if (input.source === input.target) {
      throw new Error('[GraphModel] 连线两端不能是同一节点')
    }
    if (!canvas.nodes.has(input.source) || !canvas.nodes.has(input.target)) {
      throw new Error(`[GraphModel] 连线节点不存在: source=${input.source}, target=${input.target}`)
    }
    const edge: CanvasEdge = {
      id: input.id ?? randomUUID(),
      source: input.source,
      target: input.target,
      sourceHandle: input.sourceHandle,
      targetHandle: input.targetHandle,
      data: input.data,
    }
    canvas.edges.set(edge.id, edge)
    this.bump(canvas)
    this.emit({ type: 'edge:added', canvasId: taskId, edge })
    this.emit({ type: 'graph:changed', canvasId: taskId, graphVersion: canvas.graphVersion })
    return edge
  }

  /** 删除连线 */
  deleteEdge(taskId: string, edgeId: string): boolean {
    const canvas = this.getCanvas(taskId)
    const removed = canvas.edges.delete(edgeId)
    if (removed) {
      this.bump(canvas)
      this.emit({ type: 'edge:removed', canvasId: taskId, edgeId })
      this.emit({ type: 'graph:changed', canvasId: taskId, graphVersion: canvas.graphVersion })
    }
    return removed
  }

  /** 列出连线 */
  listEdges(taskId: string): CanvasEdge[] {
    return [...this.getCanvas(taskId).edges.values()]
  }

  // ==================== 批量 CRUD（原子合并执行） ====================

  /**
   * 批量操作通用结果。按「净效果预校验 + delete→add→update 顺序」：
   * 预校验失败的整批拒绝（返回 errors、不做任何变更）；预校验通过后逐条应用。
   */
  applyBatchNodes(taskId: string, input: NodeBatchInput): BatchResult {
    const canvas = this.getCanvas(taskId)
    const result: BatchResult = { ok: true, added: [], deleted: [], updated: [], errors: [] }
    const adds = input.add ?? []
    const dels = input.delete ?? []
    const ups = input.update ?? []

    // ---- 预校验（净效果推演，不做变更） ----
    const existing = new Set(canvas.nodes.keys())
    const willAdd = new Set<string>()
    const error = (op: string, index: number, message: string) => result.errors.push({ op, index, message })

    for (let i = 0; i < adds.length; i++) {
      const a = adds[i]
      if (a.id !== undefined) {
        if (existing.has(a.id) || willAdd.has(a.id)) {
          error('add', i, `节点 id 重复: ${a.id}`)
        } else {
          willAdd.add(a.id)
        }
      }
    }
    for (const id of dels) {
      if (!existing.has(id) && !willAdd.has(id)) {
        error('delete', 0, `要删除的节点不存在: ${id}`)
      }
    }
    for (const u of ups) {
      if (!existing.has(u.id) && !willAdd.has(u.id)) {
        error('update', 0, `要更新的节点不存在: ${u.id}`)
      }
    }

    if (result.errors.length > 0) {
      result.ok = false
      return result
    }

    // ---- 执行：delete → add → update ----
    for (const id of dels) {
      if (this.deleteNode(taskId, id)) result.deleted.push(id)
    }
    for (const a of adds) {
      result.added.push(this.createNode(taskId, a).id)
    }
    for (const u of ups) {
      const n = this.updateNode(taskId, u.id, u.patch)
      if (n) result.updated.push(u.id)
    }
    this.emit({ type: 'batch:done', canvasId: taskId, resource: 'node', addedCount: result.added.length, deletedCount: result.deleted.length, updatedCount: result.updated.length })
    return result
  }

  /**
   * 连线批量 CRUD —— {add,delete,update} 合并一次执行。
   * 应用顺序：delete → add → update。预校验 add 的 source/target 在 delete+add 后的节点集内、
   * delete 目标存在、update 目标存在。
   */
  applyBatchEdges(taskId: string, input: EdgeBatchInput): BatchResult {
    const canvas = this.getCanvas(taskId)
    const result: BatchResult = { ok: true, added: [], deleted: [], updated: [], errors: [] }
    const adds = input.add ?? []
    const dels = input.delete ?? []
    const ups = input.update ?? []

    const existingNodes = new Set(canvas.nodes.keys())
    const willDelete = new Set(dels)
    const existingEdges = new Set(canvas.edges.keys())
    const error = (op: string, index: number, message: string) => result.errors.push({ op, index, message })

    // 净效果节点集 = 存量 − 本批要删的节点（删除节点会连带删它的边）
    const liveNodes = new Set([...existingNodes].filter((id) => !willDelete.has(id)))
    for (let i = 0; i < adds.length; i++) {
      const e = adds[i]
      if (!liveNodes.has(e.source) || !liveNodes.has(e.target)) {
        error('add', i, `连线端点不存在: ${e.source}/${e.target}`)
      }
      if (e.source === e.target) error('add', i, '连线两端不能是同一节点')
    }
    for (const id of dels) {
      if (!existingEdges.has(id)) error('delete', 0, `要删除的连线不存在: ${id}`)
    }
    for (const u of ups) {
      if (!existingEdges.has(u.id)) error('update', 0, `要更新的连线不存在: ${u.id}`)
    }
    if (result.errors.length > 0) {
      result.ok = false
      return result
    }

    for (const id of dels) {
      if (this.deleteEdge(taskId, id)) result.deleted.push(id)
    }
    for (const a of adds) {
      try {
        result.added.push(this.createEdge(taskId, a).id)
      } catch (err) {
        result.errors.push({ op: 'add', index: 0, message: (err as Error).message })
      }
    }
    for (const u of ups) {
      const edge = canvas.edges.get(u.id)
      if (!edge) continue
      const { id: _id, ...rest } = u.patch
      Object.assign(edge, rest)
      this.bump(canvas)
      this.emit({ type: 'graph:changed', canvasId: taskId, graphVersion: canvas.graphVersion })
      result.updated.push(u.id)
    }
    this.emit({ type: 'batch:done', canvasId: taskId, resource: 'edge', addedCount: result.added.length, deletedCount: result.deleted.length, updatedCount: result.updated.length })
    return result
  }

  // ==================== 定位 / 布局 ====================

  /** 设置节点位置 */
  setNodePosition(taskId: string, nodeId: string, x: number, y: number): CanvasNode | null {
    return this.updateNode(taskId, nodeId, { position: { x, y } })
  }

  /** 设置视口 */
  setViewport(taskId: string, viewport: CanvasViewport): void {
    const canvas = this.getCanvas(taskId)
    canvas.viewport = { ...viewport }
    this.bump(canvas)
    this.emit({ type: 'graph:changed', canvasId: taskId, graphVersion: canvas.graphVersion })
  }

  /** 获取视口 */
  getViewport(taskId: string): CanvasViewport {
    return this.getCanvas(taskId).viewport
  }

  // ==================== 序列化 ====================

  /** 导出画布为可落盘 JSON */
  toJSON(taskId: string): { nodes: CanvasNode[]; edges: CanvasEdge[]; viewport: CanvasViewport } {
    const canvas = this.getCanvas(taskId)
    return {
      nodes: [...canvas.nodes.values()],
      edges: [...canvas.edges.values()],
      viewport: { ...canvas.viewport },
    }
  }

  /** 从 JSON 导入画布（覆盖当前内容） */
  fromJSON(taskId: string, data: { nodes: CanvasNode[]; edges: CanvasEdge[]; viewport?: CanvasViewport }): void {
    const canvas = this.getCanvas(taskId)
    canvas.nodes = new Map(data.nodes.map((n) => [n.id, n]))
    canvas.edges = new Map(data.edges.map((e) => [e.id, e]))
    if (data.viewport) canvas.viewport = { ...data.viewport }
    this.bump(canvas)
    this.emit({ type: 'graph:changed', canvasId: taskId, graphVersion: canvas.graphVersion })
  }

  /** 当前图版本号（订阅增量用） */
  getVersion(taskId: string): number {
    return this.getCanvas(taskId).graphVersion
  }

  private bump(canvas: CanvasGraph): void {
    canvas.graphVersion++
  }
}
