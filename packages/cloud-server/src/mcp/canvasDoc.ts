/**
 * CanvasDocument —— MCP 与网页界面**共用同一份画布数据**的读写层。
 *
 * 为什么需要它：`npx mini-canvas-cloud serve` 同时提供网页画布与 MCP 接口，
 * 这两边必须看到同一张画布 —— 否则 AI 改的和用户在浏览器里看到的各是一份，
 * 那这个 MCP 就是摆设。所以 MCP 不另起一套存储，直接读写网页界面用的那套 key：
 *
 *   canvas:graph          节点数组（或 {nodes,edges} 信封）
 *   canvas:graph-edges    边数组
 *   canvas:graph-viewport 视口
 *
 * 这几条的物理形态就是 `KvStore` 落盘的 `.mini-canvas/kv/*.json`，
 * 也就是网页端 `HttpAdapter` 打在 `/api/kv/canvas/*` 上的同一批数据。
 *
 * 边界（有意如此）：
 * - 本模块只管"读出来 / 写回去"与批量增删改的语义，不认识 Vue、不认识渲染。
 * - **不动 viewport**：AI 加节点不该把用户当前看的视野重置掉。
 * - 类型定义就地写（不 import @mini-canvas/canvas-data）：本包要能独立 `npx` 跑，
 *   而 canvas-data 是 private 的工作区包，装不到用户机器上。字段形状由测试与
 *   canvas-data 的导出逐字比对守住（见 __tests__/canvasDoc.test.ts）。
 */
import { randomUUID } from 'node:crypto'
import type { KvStore } from '../store/kvStore.js'

/** 画布节点图的持久化 key（type='canvas'）。值 = CanvasNode[] 或 {nodes,edges} 信封 */
export const GRAPH_KEY = 'graph'
/** 画布边集的持久化 key（type='canvas'）。值 = CanvasEdge[] */
export const GRAPH_EDGES_KEY = 'graph-edges'
/** 画布视口的持久化 key（type='canvas'）。值 = { x, y, zoom } */
export const GRAPH_VIEWPORT_KEY = 'graph-viewport'

/** 画布节点（与 @mini-canvas/canvas-data 的同名字段对齐；这里只留数据层用得到的） */
export interface CanvasNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
  /** 声明尺寸（可选；渲染层实测尺寸不进这里） */
  size?: { w: number; h: number }
  /** 父节点（分组嵌套，可选） */
  parentId?: string
}

/** 画布连线 */
export interface CanvasEdge {
  id: string
  source: string
  target: string
  type?: string
  sourceHandle?: string
  targetHandle?: string
  data?: Record<string, unknown>
}

/** 画布全量快照 */
export interface CanvasSnapshot {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  viewport?: { x: number; y: number; zoom: number }
}

/** 批量增删改的结果（与 mcp-server 的 BatchResult 同形状，便于客户端迁移） */
export interface BatchResult {
  ok: boolean
  added: string[]
  deleted: string[]
  updated: string[]
  errors: { op: string; index: number; message: string }[]
}

/** 新增节点的入参 */
export interface AddNodeInput {
  type: string
  id?: string
  position?: { x: number; y: number }
  data?: Record<string, unknown>
  size?: { w: number; h: number }
  parentId?: string
}

/** 新增连线的入参 */
export interface AddEdgeInput {
  source: string
  target: string
  id?: string
  sourceHandle?: string
  targetHandle?: string
  data?: Record<string, unknown>
}

/** 节点批量入参（三段都可省略） */
export interface NodeBatchInput {
  add?: AddNodeInput[]
  delete?: string[]
  update?: { id: string; position?: { x: number; y: number }; data?: Record<string, unknown> }[]
}

/** 连线批量入参（三段都可省略） */
export interface EdgeBatchInput {
  add?: AddEdgeInput[]
  delete?: string[]
  update?: { id: string; source?: string; target?: string; sourceHandle?: string; targetHandle?: string; data?: Record<string, unknown> }[]
}

/** 稳定边 id：与数据层 edgeStoreId 同约定（无端口时 `e-{source}-{target}`） */
export function edgeIdOf(edge: { source: string; target: string; sourceHandle?: string; targetHandle?: string }): string {
  const sh = edge.sourceHandle && edge.sourceHandle !== 'source' ? edge.sourceHandle : ''
  const th = edge.targetHandle && edge.targetHandle !== 'target' ? edge.targetHandle : ''
  if (!sh && !th) return `e-${edge.source}-${edge.target}`
  return `e-${sh ? `${edge.source}:${sh}` : edge.source}-${th ? `${edge.target}:${th}` : edge.target}`
}

/** 深拷贝（快照隔离：读出去的数组被调用方改了也不能污染我们内部状态） */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export class CanvasDocument {
  constructor(private readonly kv: KvStore) {}

  /** 读整张画布。从未保存过 = 空画布（不是错误） */
  async read(): Promise<CanvasSnapshot> {
    const raw = await this.kv.get<CanvasNode[] | { nodes?: CanvasNode[]; edges?: CanvasEdge[] }>( 'canvas', GRAPH_KEY)
    const rawEdges = await this.kv.get<CanvasEdge[]>('canvas', GRAPH_EDGES_KEY)
    const viewport = await this.kv.get<{ x: number; y: number; zoom: number }>('canvas', GRAPH_VIEWPORT_KEY)

    // 三种形态都要认（与网页端恢复逻辑同款）：旧数组只存节点 / 新信封含边 / 空
    let nodes: CanvasNode[] = []
    let edges: CanvasEdge[] = Array.isArray(rawEdges) ? rawEdges : []
    if (Array.isArray(raw)) {
      nodes = raw
    } else if (raw && Array.isArray(raw.nodes)) {
      nodes = raw.nodes
      if (Array.isArray(raw.edges)) edges = raw.edges
    }
    return {
      nodes: clone(nodes),
      edges: clone(edges),
      ...(viewport ? { viewport: clone(viewport) } : {}),
    }
  }

  /**
   * 写整张画布。
   * 只写 nodes/edges 两个 key（**不碰 viewport**：AI 编辑不该重置用户当前视野）。
   */
  async write(snapshot: { nodes: CanvasNode[]; edges: CanvasEdge[] }): Promise<void> {
    await this.kv.set('canvas', GRAPH_KEY, snapshot.nodes)
    await this.kv.set('canvas', GRAPH_EDGES_KEY, snapshot.edges)
  }

  /**
   * 给新增节点挑一个"不压在别人身上"的位置（没显式给 position 时用）。
   * 规则：摆在现有节点右侧一段距离，纵向对齐最上面那个。让 AI 建出来的节点一眼能看见。
   */
  private nextFreePosition(nodes: CanvasNode[]): { x: number; y: number } {
    if (nodes.length === 0) return { x: 120, y: 120 }
    const maxRight = Math.max(...nodes.map((n) => n.position.x + (n.size?.w ?? 240)))
    const minTop = Math.min(...nodes.map((n) => n.position.y))
    return { x: Math.round(maxRight + 80), y: Math.round(minTop) }
  }

  /** 生成一个不与现有节点冲突的 id。用 `ai-` 前缀，和网页端自增的数字 id 天然不撞。 */
  private newNodeId(taken: Set<string>): string {
    for (let i = 0; i < 1000; i++) {
      const id = `ai-${randomUUID().slice(0, 8)}`
      if (!taken.has(id)) return id
    }
    throw new Error('[mcp] 生成节点 id 失败（连续冲突）')
  }

  /**
   * 节点批量增删改（一次调用合并执行）。
   *
   * 语义与 mcp-server 的 canvas.batch_nodes 对齐：**先整体预校验，再按 delete→add→update 应用**。
   * 预校验不过就整批拒绝、一个都不动 —— 半成品最难查（AI 以为改成功了，画布却是错的）。
   */
  async batchNodes(input: NodeBatchInput): Promise<BatchResult> {
    const snap = await this.read()
    const result: BatchResult = { ok: true, added: [], deleted: [], updated: [], errors: [] }
    const adds = input.add ?? []
    const dels = input.delete ?? []
    const ups = input.update ?? []
    const error = (op: string, index: number, message: string) => result.errors.push({ op, index, message })

    const existing = new Set(snap.nodes.map((n) => n.id))
    const willAdd = new Set<string>()
    for (let i = 0; i < adds.length; i++) {
      const a = adds[i]
      if (!a.type || typeof a.type !== 'string') error('add', i, '缺少节点 type')
      if (a.id !== undefined) {
        if (existing.has(a.id) || willAdd.has(a.id)) error('add', i, `节点 id 重复: ${a.id}`)
        else willAdd.add(a.id)
      }
    }
    for (const id of dels) {
      if (!existing.has(id) && !willAdd.has(id)) error('delete', 0, `要删除的节点不存在: ${id}`)
    }
    for (const u of ups) {
      if (!existing.has(u.id) && !willAdd.has(u.id)) error('update', 0, `要更新的节点不存在: ${u.id}`)
    }
    if (result.errors.length > 0) {
      result.ok = false
      return result
    }

    // ---- 应用：delete → add → update ----
    const nodes = snap.nodes
    let edges = snap.edges
    const delSet = new Set(dels)
    if (dels.length > 0) {
      // 删节点级联删边（与网页端 / GraphDocument 的语义一致：不允许悬挂边）
      edges = edges.filter((e) => !delSet.has(e.source) && !delSet.has(e.target))
    }
    const kept = nodes.filter((n) => !delSet.has(n.id))

    const taken = new Set([...existing, ...willAdd])
    for (const a of adds) {
      const id = a.id ?? this.newNodeId(taken)
      taken.add(id)
      kept.push({
        id,
        type: a.type,
        // 自动定位只看"当前存活"的节点（用 kept：已剔除被删的，且含本批刚加的）
        position: a.position ?? this.nextFreePosition(kept),
        data: a.data ? { ...a.data } : {},
        ...(a.size ? { size: { ...a.size } } : {}),
        ...(a.parentId ? { parentId: a.parentId } : {}),
      })
      result.added.push(id)
    }

    for (const u of ups) {
      const node = kept.find((n) => n.id === u.id)
      if (!node) continue
      if (u.position) node.position = { x: u.position.x, y: u.position.y }
      if (u.data) node.data = { ...node.data, ...u.data }
      result.updated.push(u.id)
    }

    await this.write({ nodes: kept, edges })
    result.deleted = dels.filter((id) => existing.has(id))
    return result
  }

  /**
   * 连线批量增删改。语义与 batchNodes 一致（先预校验，再 delete→add→update）。
   * 新增时会校验两端节点存在，且不允许自连 —— 不然画出一堆孤儿边，渲染层还得兜。
   */
  async batchEdges(input: EdgeBatchInput): Promise<BatchResult> {
    const snap = await this.read()
    const result: BatchResult = { ok: true, added: [], deleted: [], updated: [], errors: [] }
    const adds = input.add ?? []
    const dels = input.delete ?? []
    const ups = input.update ?? []
    const error = (op: string, index: number, message: string) => result.errors.push({ op, index, message })

    const nodeIds = new Set(snap.nodes.map((n) => n.id))
    const existing = new Set(snap.edges.map((e) => e.id))
    for (let i = 0; i < adds.length; i++) {
      const a = adds[i]
      if (!nodeIds.has(a.source)) error('add', i, `源节点不存在: ${a.source}`)
      if (!nodeIds.has(a.target)) error('add', i, `目标节点不存在: ${a.target}`)
      if (a.source === a.target) error('add', i, '连线两端不能是同一节点')
      if (a.id !== undefined && existing.has(a.id)) error('add', i, `连线 id 重复: ${a.id}`)
    }
    for (const id of dels) {
      if (!existing.has(id)) error('delete', 0, `要删除的连线不存在: ${id}`)
    }
    for (const u of ups) {
      if (!existing.has(u.id)) error('update', 0, `要更新的连线不存在: ${u.id}`)
    }
    if (result.errors.length > 0) {
      result.ok = false
      return result
    }

    const delSet = new Set(dels)
    let edges = snap.edges.filter((e) => !delSet.has(e.id))

    for (const a of adds) {
      const id = a.id ?? edgeIdOf(a)
      // 同 id 视为同一条（与数据层 addEdge 的去重语义一致）
      const dup = edges.find((e) => e.id === id)
      if (dup) {
        result.updated.push(id)
        continue
      }
      edges.push({
        id,
        source: a.source,
        target: a.target,
        ...(a.sourceHandle ? { sourceHandle: a.sourceHandle } : {}),
        ...(a.targetHandle ? { targetHandle: a.targetHandle } : {}),
        ...(a.data ? { data: { ...a.data } } : {}),
      })
      result.added.push(id)
    }

    for (const u of ups) {
      const edge = edges.find((e) => e.id === u.id)
      if (!edge) continue
      if (u.source) edge.source = u.source
      if (u.target) edge.target = u.target
      if (u.sourceHandle !== undefined) edge.sourceHandle = u.sourceHandle
      if (u.targetHandle !== undefined) edge.targetHandle = u.targetHandle
      if (u.data) edge.data = { ...(edge.data ?? {}), ...u.data }
      result.updated.push(u.id)
    }

    await this.write({ nodes: snap.nodes, edges })
    result.deleted = dels.filter((id) => existing.has(id))
    return result
  }
}
