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
import { extFromMime, safeExt, type FileStore } from '../store/fileStore.js'

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
  /** 边的类型；缺省与数据层一致取 'custom'（不写会导致云端与本地对同一条边判定不一致） */
  type?: string
  sourceHandle?: string
  targetHandle?: string
  data?: Record<string, unknown>
}

/** 节点批量入参（三段都可省略） */
export interface NodeBatchInput {
  add?: AddNodeInput[]
  delete?: string[]
  /**
   * 新增时若 id 已存在：当成更新（而不是整批拒绝）。
   *
   * 给**同步口**用（网页端提交增量）：AI 刚加的节点会被实时通道合进网页端，
   * 于是网页端下一次提交里就带上了「新增这个已在云端的节点」。对 AI 来说这种说法确实是错的，
   * 但对同步口来说它是**正常时序** —— 若照旧整批拒绝，用户那次真正的改动会被连带丢掉。
   *
   * 不给（缺省 false）= MCP 工具的严格语义：AI 说自己要建一个新 id，那它就该是新的。
   */
  upsert?: boolean
  /**
   * 删除/更新一个**不存在**的目标时：静默跳过，而不是整批拒绝。
   *
   * 同样只给同步口用，理由与 upsert 一样：网页端提交的是「我这份与上一份的差集」，
   * 而「我这边看起来还在、云端已经被 AI 删掉」是并发下的正常时序。
   * 若照旧整批拒绝，用户那次真实的改动会被一个过时的删除请求连带丢掉。
   *
   * 注意这不会掩盖真错误：AI 自己（MCP）仍然走严格语义，写错 id 会明确报出来。
   */
  lenient?: boolean
  update?: {
    id: string
    position?: { x: number; y: number }
    data?: Record<string, unknown>
    /** 尺寸（网页端「图片跟随尺寸」这类改动会写它；增量写不能漏这个字段） */
    size?: { w: number; h: number }
    /** 父节点（分组嵌套）；显式 null 表示解除父子 */
    parentId?: string | null
  }[]
}

/** 连线批量入参（三段都可省略） */
export interface EdgeBatchInput {
  add?: AddEdgeInput[]
  delete?: string[]
  /** 新增一个已存在的边 id → 当成更新（同步口用；理由同 NodeBatchInput.upsert） */
  upsert?: boolean
  /** 删除/更新不存在的东西 → 静默跳过而不是整批拒绝（同步口用；理由同 NodeBatchInput.lenient） */
  lenient?: boolean
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
  /**
   * @param kv    画布数据（与网页界面同一份）
   * @param files 资源存储（与网页端 `POST /api/files` 同一个 FileStore）
   */
  constructor(
    private readonly kv: KvStore,
    private readonly files?: FileStore,
  ) {}

  /**
   * 写操作串行链（见 runExclusive 的说明）。
   *
   * 只对「写」串行，读不加锁 —— 读不会让数据变坏，没必要跟着排队。
   */
  private lock: Promise<unknown> = Promise.resolve()

  /**
   * 把一次写操作排进串行链，返回它自己的结果。
   *
   * 为什么必须有：本对象的写都是「读全量 → 改 → 写全量」。两个写方（AI 与网页端）
   * 若同时进来，会各自读到同一份旧数据、再各自写回只有自己那点改动的结果，**后写的把先写的整个盖掉**
   * （AI 刚加的节点凭空消失）。排成一条链后，后一个跑在「前一个的结果」上，两边都在。
   *
   * 注意：本锁只在**同一个进程**内有效。这是自托管单进程服务（AI 与网页共用一个服务），
   * 够用；若将来要跑多进程，得换成文件锁或真正的数据库事务。
   */
  private runExclusive<T>(job: () => Promise<T>): Promise<T> {
    // 前一个失败不能卡死整条链：用 catch 吞掉错误状态，但把错误本身交给它自己的调用方
    const next = this.lock.then(job, job)
    this.lock = next.catch(() => undefined)
    return next
  }

  /**
   * 存一个资源（图片/视频等字节），返回**同源稳定 URL**。
   *
   * 为什么 MCP 需要这个：AI 要往画布里放图，得先把字节交给服务器 —— 否则节点里只能写
   * 一个外链（可能挂、可能跨域、用户换机器就取不到）。落盘后拿到 `/uploads/<hash>.png`，
   * 与网页端上传走的是**同一个 FileStore**（同内容会去重成同一个 url）。
   */
  async saveResource(bytes: Uint8Array, opts: { fileName?: string; mime?: string } = {}) {
    if (!this.files) throw new Error('[mcp] 未配置资源存储，无法保存资源')
    if (bytes.byteLength === 0) throw new Error('[mcp] 资源内容为空')
    // 扩展名来源：文件名 → MIME 反查。白名单外（含 .html/.js）回落空扩展名，
    // 与网页端同规则（同源托管下这些会造成 XSS 面）。
    const ext = safeExt(opts.fileName ?? '') || extFromMime(opts.mime ?? '')
    return this.files.save(bytes, ext)
  }

  /** 列出已存资源的 id（AI 排查"我传的图在不在"用） */
  async listResources(): Promise<string[]> {
    return this.files ? this.files.ids() : []
  }

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
  * 「以这份为准」整体重写（网页端的整包保存走这条）。
  *
  * 与 batchNodes 的区别：batch 是「在现有画布上增删改」，这条是「整个换成我这份」。
  * 用户删光节点、恢复历史、导入画布这类操作必须用它 —— 用 batch 表达不出「删掉你没提到的那些」。
  *
  * 同样进串行链：否则它与 AI 的增量写并发时，一方会把另一方整个盖掉。
  */
  /**
   * 单个画布 key 的改写（网页端 `PUT /api/kv/canvas/graph` 这类整包保存走这条）。
   *
   * 为什么必须收进本对象、而不是让路由直接调 `kv.set`：整包保存是「读全量 → 改 → 写全量」的兄弟形态，
   * 它与 AI 的增量写并发时同样会互相覆盖。只有把**所有对画布 key 的写**都排进同一把锁，
   * 「谁后写谁覆盖」这件事才真正消失。
   *
   * `key` 用裸 key（`graph` / `graph-edges`），与路由的 URL 段一致。
   */
  async writeKey(key: string, value: unknown): Promise<void> {
    return this.runExclusive(async () => {
      await this.kv.set('canvas', key, value)
    })
  }

  /** 单键删除（同样要过锁：它在语义上也是一次画布写） */
  async removeKey(key: string): Promise<boolean> {
    return this.runExclusive(async () => this.kv.remove('canvas', key))
  }

  /** 这个 key 是否属于「画布图数据」（决定要不要收进上面那把锁） */
  static isGraphKey(key: string): boolean {
    return key === GRAPH_KEY || key === GRAPH_EDGES_KEY
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
    return this.runExclusive(() => this.batchNodesLocked(input))
  }

  /** batchNodes 的实际实现（已持锁：内部读写都看同一份缓存，不受并发干扰） */
  private async batchNodesLocked(input: NodeBatchInput): Promise<BatchResult> {
    const snap = await this.read()
    const result: BatchResult = { ok: true, added: [], deleted: [], updated: [], errors: [] }
    const adds = input.add ?? []
    const dels = input.delete ?? []
    const ups = input.update ?? []
    const error = (op: string, index: number, message: string) => result.errors.push({ op, index, message })

    const existing = new Set(snap.nodes.map((n) => n.id))
    const willAdd = new Set<string>()
    /** upsert 模式下，「新增一个已存在的 id」转成对它的更新（不报错，也不算新增） */
    const upsertedInto = new Set<string>()
    for (let i = 0; i < adds.length; i++) {
      const a = adds[i]
      if (!a.type || typeof a.type !== 'string') error('add', i, '缺少节点 type')
      if (a.id !== undefined) {
        // 同一个 id 既在 delete 又在 add 里：意图矛盾（到底要它还是不要它），必须响亮报错。
        // 不报的话下面按「删完之后的列表」去找它会找不到 —— 那是 TypeError（500），不是人话。
        if (input.upsert && dels.includes(a.id) && existing.has(a.id)) {
          error('add', i, `同一批里既要删又要加同一个 id: ${a.id}`)
        } else if (input.upsert && existing.has(a.id)) upsertedInto.add(a.id)
        else if (existing.has(a.id) || willAdd.has(a.id)) error('add', i, `节点 id 重复: ${a.id}`)
        else willAdd.add(a.id)
      }
    }
    for (const id of dels) {
      // lenient（同步口）：删一个「云端已经没有」的东西 = 目的已达成，跳过而不是拒绝整批
      if (!existing.has(id) && !willAdd.has(id) && !input.lenient) error('delete', 0, `要删除的节点不存在: ${id}`)
    }
    for (const u of ups) {
      if (!existing.has(u.id) && !willAdd.has(u.id) && !input.lenient) error('update', 0, `要更新的节点不存在: ${u.id}`)
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
      // upsert：这个 id 云端已经有了 → 把它当成一次更新（保留原 type，不重复入 added）
      if (id !== undefined && upsertedInto.has(id)) {
        // 预校验已挡住「同一批既删又加」，所以这里必然找得到；仍做存在性判断，
        // 不靠 `!` 断言把潜在崩溃藏进类型系统里。
        const node = kept.find((n) => n.id === id)
        if (node) {
          if (a.position) node.position = { x: a.position.x, y: a.position.y }
          if (a.data) node.data = { ...node.data, ...a.data }
          if (a.size) node.size = { w: a.size.w, h: a.size.h }
          if (a.parentId) node.parentId = a.parentId
          result.updated.push(id)
        }
        continue
      }
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
      // 尺寸：给了就写（nil 之外的形状由 schema 保证）；没给就保持原样
      if (u.size) node.size = { w: u.size.w, h: u.size.h }
      // 父节点：null 是「解除父子」的显式表达，undefined 才是「没提这个字段」
      if (u.parentId === null) delete node.parentId
      else if (u.parentId !== undefined) node.parentId = u.parentId
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
    return this.runExclusive(() => this.batchEdgesLocked(input))
  }

  /** batchEdges 的实际实现（已持锁） */
  private async batchEdgesLocked(input: EdgeBatchInput): Promise<BatchResult> {
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
      // 同 id 已存在：同步口（upsert）当成更新，MCP 口保持严格（对 AI 来说说重复了就该报错）
      if (a.id !== undefined && existing.has(a.id) && !input.upsert) error('add', i, `连线 id 重复: ${a.id}`)
    }
    for (const id of dels) {
      if (!existing.has(id) && !input.lenient) error('delete', 0, `要删除的连线不存在: ${id}`)
    }
    for (const u of ups) {
      if (!existing.has(u.id) && !input.lenient) error('update', 0, `要更新的连线不存在: ${u.id}`)
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
        // upsert：已存在就按新内容更新它（端点/端口/data/type 都跟上）
        if (input.upsert) {
          dup.source = a.source
          dup.target = a.target
          dup.type = a.type ?? dup.type ?? 'custom'
          if (a.sourceHandle !== undefined) dup.sourceHandle = a.sourceHandle
          if (a.targetHandle !== undefined) dup.targetHandle = a.targetHandle
          if (a.data) dup.data = { ...(dup.data ?? {}), ...a.data }
        }
        result.updated.push(id)
        continue
      }
      edges.push({
        id,
        source: a.source,
        target: a.target,
        // type 必须落盘：数据层会给边补 'custom'，云端若留空，两边对同一条边的判定就不一致 ——
        // 表现为「AI 改了边本地看不到」与「AI 删了边本地删不掉」（本地把它当成「我改过的边」而保留）。
        type: a.type ?? 'custom',
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
