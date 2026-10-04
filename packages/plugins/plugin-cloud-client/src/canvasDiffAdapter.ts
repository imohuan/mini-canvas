/**
 * CanvasDiffAdapter —— 把宿主的"画布保存"接到 cloud-server 上。
 *
 * 宿主交来的一律是**整张画布**（节点 + 边）。直接整包 PUT 会把另一个写方
 * （AI 经 MCP 改的画布）在这两次提交之间做的改动整个盖掉 —— 实测过：
 * "AI 刚加的节点，被画布紧接着的一次保存抹掉"。
 *
 * 所以这里比出差集、只发差异（复用 graphDiff）。谁都不覆盖谁。
 *
 * 与老 cloud-save 的 HttpAdapter 的差别：那份打的是 /api/kv/canvas/*（按 key 存），
 * 现在画布是"一个画布一个文件夹"，读写都走 /api/canvases/*。
 */
import { diffGraph, isEmptyOps, type GraphOps } from './graphDiff.js'
import type { CloudApi } from './api.js'
import { CANVAS_ID } from './keys.js'
import { expandNodes, shrinkNodes } from './resourceRef.js'

/** 宿主交给 adapter 的 key 是带 type 前缀的物理 key（如 canvas:graph） */
function bareKey(key: string): string {
  const i = key.indexOf(':')
  return i >= 0 ? key.slice(i + 1) : key
}

const GRAPH = 'graph'
const EDGES = 'graph-edges'
const VIEWPORT = 'graph-viewport'

interface CanvasNodeLike {
  id?: unknown
  [k: string]: unknown
}

/**
 * 只发差异，且**记住"服务器实际拥有什么"**（没送成功的项要留在待发状态）
 *
 * 写出去之前把显示地址收回 `res:<hash>` 相对引用（磁盘上只存引用）。
 * **资源字节不在这里上传** —— 上传/生成时就已经由 resource adapter 存进画布文件夹了
 * （见 cloudResourceAdapter）。这条分工是本次重构的核心：保存路径不再碰字节。
 */
export class CanvasDiffAdapter {
  readonly id = 'canvas'
  readonly capability = { list: false, transactional: false, offline: false }
  /** 上次提交成功的节点 / 边（差的基准） */
  private submittedNodes: unknown[] | undefined
  private submittedEdges: unknown[] | undefined

  constructor(
    private readonly api: CloudApi,
    private readonly canvasId: string = CANVAS_ID,
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const bare = bareKey(key)
    const snap = await this.api.readCanvas(this.canvasId)
    // 读出去之前把 res: 展开成真地址：本地画布（渲染 / 合并比较）用的都是完整地址
    if (bare === GRAPH) return expandAll(snap.nodes, this.canvasId) as T
    if (bare === EDGES) return snap.edges as T
    if (bare === VIEWPORT) return (snap.view ?? undefined) as T
    return undefined
  }

  async set(key: string, value: unknown): Promise<void> {
    const bare = bareKey(key)
    if (bare === VIEWPORT) {
      await this.api.putView(this.canvasId, value)
      return
    }
    // 写出去之前：内嵌字节先传成画布资源、换 res:；本画布地址收回 res:
    // 写出去之前把显示地址收回 res: 相对引用（磁盘上只存引用；渲染用的完整地址不落盘）。
    // 资源的**字节**在更早的时候就存好了（上传/生成时经 resource adapter 直接进画布文件夹），
    // 所以这里不做任何上传 —— 保存路径只负责"把节点里的地址写成引用"。
    let normalized = value
    if (bare === GRAPH && Array.isArray(value)) {
      normalized = shrinkAll(value, this.canvasId)
    }
    if (bare === GRAPH) return this.submitDelta('nodes', this.submittedNodes, normalized, (v) => (this.submittedNodes = v))
    if (bare === EDGES) return this.submitDelta('edges', this.submittedEdges, value, (v) => (this.submittedEdges = v))
    // 其它 key（不该出现）静默忽略：画布域只有这三个
  }

  async remove(key: string): Promise<void> {
    const bare = bareKey(key)
    if (bare === GRAPH) {
      await this.api.patchNodes({ delete: collectIds(this.submittedNodes) })
      this.submittedNodes = []
      return
    }
    if (bare === EDGES) {
      await this.api.patchEdges({ delete: collectIds(this.submittedEdges) })
      this.submittedEdges = []
    }
  }

  /** 把"服务器现有的这份"记成基准（装载时先读一次，免得第一次保存把已有的全当成新增） */
  async primeFromServer(): Promise<void> {
    const snap = await this.api.readCanvas(this.canvasId)
    this.submittedNodes = Array.isArray(snap.nodes) ? snap.nodes : []
    this.submittedEdges = Array.isArray(snap.edges) ? snap.edges : []
  }

  /**
   * 读服务器那份，并把 `res:` 展开成当前画布的可请求地址。
   *
   * 为什么要展开：服务器上存的是画布内相对引用（`res:<hash>`），而渲染组件是拿值直接塞进
   * `<img src>` 的 —— 直接把 `res:...` 塞进去，浏览器只会报 ERR_UNKNOWN_URL_SCHEME，
   * 图显示不出来。恢复路径（装载时以云端为准覆盖本地）走的就是这里，必须给真地址。
   */
  async getRaw(): Promise<{ nodes: unknown[]; edges: unknown[]; view: unknown }> {
    const snap = await this.api.readCanvas(this.canvasId)
    return { ...snap, nodes: expandAll(snap.nodes, this.canvasId) as unknown[] }
  }

  /**
   * 只发差集。
   *
   * 成功才把基准推到现在这份；失败就让基准停在原地 —— 下一轮保存会重发同一批差集
   * （宁可重发，也不要让改动悄悄丢掉）。
   */
  private async submitDelta(
    kind: 'nodes' | 'edges',
    base: unknown[] | undefined,
    value: unknown,
    remember: (v: unknown[]) => void,
  ): Promise<void> {
    if (!Array.isArray(value)) return
    const ops: GraphOps = diffGraph(base as never, value as never)
    if (isEmptyOps(ops)) {
      remember(value)
      return
    }
    const body = {
      ...(ops.add.length > 0 ? { add: ops.add } : {}),
      ...(ops.delete.length > 0 ? { delete: ops.delete } : {}),
      ...(ops.update.length > 0 ? { update: ops.update } : {}),
    }
    if (kind === 'nodes') await this.api.patchNodes(body as never)
    else await this.api.patchEdges(body as never)
    remember(value)
  }
}

function collectIds(list: unknown[] | undefined): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const item of list) {
    const id = item && typeof item === 'object' ? (item as CanvasNodeLike).id : undefined
    if (typeof id === 'string') out.push(id)
  }
  return out
}

/** 把一批节点里的 res: 展开（只回变过的那些，逐节点应用） */
function expandAll(nodes: unknown, canvasId: string): unknown {
  if (!Array.isArray(nodes)) return nodes
  const list = nodes as Array<{ id?: unknown; data?: Record<string, unknown> }>
  const patches = expandNodes(
    list.map((n) => ({ id: String(n.id ?? ''), ...(n.data ? { data: n.data } : {}) })),
    canvasId,
  )
  if (patches.length === 0) return nodes
  const byId = new Map(patches.map((p) => [p.id, p.data]))
  return list.map((n) =>
    byId.has(String(n.id ?? '')) ? { ...n, data: { ...(n.data ?? {}), ...byId.get(String(n.id ?? ''))! } } : n,
  )
}

/** 把一批节点里的画布内资源地址收回 `res:`（磁盘上只存相对引用） */
function shrinkAll(nodes: unknown, canvasId: string): unknown {
  if (!Array.isArray(nodes)) return nodes
  const list = nodes as Array<{ id?: unknown; data?: Record<string, unknown> }>
  const patches = shrinkNodes(
    list.map((n) => ({ id: String(n.id ?? ''), ...(n.data ? { data: n.data } : {}) })),
    canvasId,
  )
  if (patches.length === 0) return nodes
  const byId = new Map(patches.map((p) => [p.id, p.data]))
  return list.map((n) =>
    byId.has(String(n.id ?? '')) ? { ...n, data: { ...(n.data ?? {}), ...byId.get(String(n.id ?? ''))! } } : n,
  )
}


