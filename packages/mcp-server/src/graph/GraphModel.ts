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

  /** 创建节点 */
  createNode(taskId: string, input: CreateNodeInput): CanvasNode {
    const canvas = this.getCanvas(taskId)
    const node: CanvasNode = {
      id: input.id ?? randomUUID(),
      type: input.type,
      position: input.position ?? { x: 0, y: 0 },
      data: { ...(input.data ?? {}) },
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
    this.emit({ type: 'node:updated', canvasId: taskId, nodeId, patch })
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
