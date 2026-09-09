/**
 * GraphDocument —— 画布图的"唯一写入口"（第二阶段：图写模型收口）。
 *
 * 目的（见 docs/tmp/canvas-render-core-v2-full-audit-2026-09-08.md 第二阶段）：
 * 之前节点/边被 nodeStore/edgeStore/history/save 四个对象分开写，各插件/宿主各自决定
 * "改完是否记历史、是否落盘、是否清 selection、是否级联清边"，漏一步就数据漂移。
 * 本服务把这些统一收口：
 * - 所有图变更经 transaction(原子+进历史) 或直写方法（自动级联/校验）；
 * - 变更自动清掉失效选中态（节点被删、边被删）；
 * - 提交后经注入的 onCommit 调度一次"整图落盘"（防抖），落盘语义由宿主/适配器决定；
 * - undo/redo 直接对"节点+边"统一快照生效，并在恢复后同样触发落盘。
 *
 * 设计边界：
 * - 纯逻辑、零 Vue/DOM，Node 可单测；内部仍以 nodeStore/edgeStore 为数据容器
 *   （渲染层与存量插件继续订阅它们自动刷新，零改动）。
 * - 旧 API（nodeStore/edgeStore/history/save 直写）保留为"冻结兼容层"；
 *   新写逻辑统一走 graph，避免继续放大各写路径的分歧。
 */
import type { NodeStoreService } from './nodeStore'
import type { CanvasNode, AddNodeInput, NodePatchEntry } from './nodeStore'
import type { EdgeStoreService } from './edgeStore'
import type { CanvasEdge, AddEdgeRequest, StoredEdgeInput } from './edgeStore'
import type { HistoryService } from './history'
import type { SelectionService } from './selection'

/** 节点 + 边的统一存储信封（历史快照 / 落盘共用） */
export interface GraphEnvelope {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

/** 一次图事务里可用的写句柄（在事务提交前所有写都进历史，作为一条记录） */
export interface GraphTransaction {
  /** 新建一个节点（推荐：type 已注册）。返回 id */
  createNode(type: string, position: { x: number; y: number }, data?: Record<string, unknown>): string
  /** 批量插入节点（可指定 id/data/parentId/size） */
  addNodes(inputs: AddNodeInput[]): number
  /** 更新一个/多个节点（position/size/parentId/data 均可 patch） */
  updateNode(id: string, patch: Parameters<NodeStoreService['updateNode']>[1]): void
  updateNodes(entries: NodePatchEntry[]): void
  /** 删除节点：连带清与它相连的边、清掉仍存活子节点的 parentId、清选中态 */
  removeNodes(ids: string[]): number
  /** 新增一条边（端点必须存在；去重语义沿用 edgeStore） */
  addEdge(input: AddEdgeRequest): string
  /** 删除边（清选中态） */
  removeEdges(ids: string[]): number
}

/** ctx.get('graph') 得到的图服务形状 */
export interface GraphDocumentService extends GraphTransaction {
  /** 当前全部节点（只读快照；与 nodeStore 同源） */
  getNodes(): CanvasNode[]
  /** 当前全部边（只读快照；与 edgeStore 同源） */
  getEdges(): CanvasEdge[]
  getNode(id: string): CanvasNode | undefined
  getEdge(id: string): CanvasEdge | undefined
  /** 读快照（历史用） */
  snapshot(): GraphEnvelope
  /** 整体回填（刷新恢复/导入）；不清历史 */
  replaceAll(nodes: CanvasNode[], edges?: StoredEdgeInput[]): void
  /**
   * 原子变更 + 进历史：
   * - 内部用 history.withRecord 包住，fn 内多次写合并成一条 undo；
   * - fn 抛错则整批不落历史（已应用的写由调用方保证可重入/无副作用设计，
   *   实际均为同步 store 写，异常前不 emit；异常场景留待后续补回滚）。
   */
  transaction<T>(reason: string, fn: (tx: GraphTransaction) => T): T
  /** 撤销 / 重做（统一对节点+边快照生效，恢复后自动触发落盘调度） */
  undo(): void
  redo(): void
  canUndo(): boolean
  canRedo(): boolean
  /** 注册"整图已变"提交回调（宿主/适配器用于落盘）；返回取消函数 */
  onCommit(cb: (envelope: GraphEnvelope) => void): () => void
  /** 测试/诊断：当前待提交批次是否为空（onCommit 触发前有值） */
  hasPendingCommit(): boolean
}

/** 深度拷贝图（快照隔离，避免内部引用外泄/undo 被后续修改污染） */
function deepCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

function sameGraph(a: GraphEnvelope, b: GraphEnvelope): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * GraphDocument 实现。
 *
 * 依赖注入：
 * - nodeStore/edgeStore：数据容器（本服务读写它们；渲染层与存量订阅不变）。
 * - selection：变更后清理失效选中态。
 * - history：进历史（withRecord 包原子写）。
 * - commit：可选。给则每次提交后同步触发整图落盘入队（实际 flush 由宿主 save 防抖承担）。
 *   不给则仅内存写（headless/测试）。
 */
export class GraphDocument implements GraphDocumentService {
  private commitCbs: Array<(envelope: GraphEnvelope) => void> = []
  private pendingCommit = false

  constructor(
    private readonly nodeStore: NodeStoreService,
    private readonly edgeStore: EdgeStoreService,
    private readonly selection: SelectionService,
    private readonly history: HistoryService,
    private readonly commit?: (envelope: GraphEnvelope) => void,
  ) {}

  getNodes(): CanvasNode[] {
    return this.nodeStore.getNodes()
  }
  getEdges(): CanvasEdge[] {
    return this.edgeStore.getEdges()
  }
  getNode(id: string): CanvasNode | undefined {
    return this.nodeStore.getNode(id)
  }
  getEdge(id: string): CanvasEdge | undefined {
    return this.edgeStore.getEdge(id)
  }

  snapshot(): GraphEnvelope {
    return {
      nodes: deepCopy(this.nodeStore.getNodes()),
      edges: deepCopy(this.edgeStore.getEdges()),
    }
  }

  replaceAll(nodes: CanvasNode[], edges?: StoredEdgeInput[]): void {
    this.nodeStore.replaceAll(deepCopy(nodes))
    this.edgeStore.replaceAll(edges ? deepCopy(edges as CanvasEdge[]) : [])
    this.selection.clear()
    this.scheduleCommit()
  }

  // ==================== 原子写（每次进历史） ====================

  createNode(type: string, position: { x: number; y: number }, data?: Record<string, unknown>): string {
    let id = ''
    this.history.withRecord(() => {
      const store = this.nodeStore
      if (data) {
        // 需要原子：先建空节点再写 data 会触发两次 notify，但对历史只有一次快照差异。
        // 走 addNodes 一次广播，保持历史与订阅都收敛。
        id = store.addNode(type, position)
        store.updateNodeData(id, data)
      } else {
        id = store.addNode(type, position)
      }
    })
    this.scheduleCommit()
    return id
  }

  addNodes(inputs: AddNodeInput[]): number {
    if (inputs.length === 0) return 0
    const n = this.history.withRecord(() => this.nodeStore.addNodes(inputs))
    this.scheduleCommit()
    return n
  }

  updateNode(id: string, patch: Parameters<NodeStoreService['updateNode']>[1]): void {
    this.history.withRecord(() => this.nodeStore.updateNode(id, patch))
    this.scheduleCommit()
  }

  updateNodes(entries: NodePatchEntry[]): void {
    if (entries.length === 0) return
    this.history.withRecord(() => this.nodeStore.updateNodes(entries))
    this.scheduleCommit()
  }

  removeNodes(ids: string[]): number {
    if (ids.length === 0) return 0
    const removed = this.history.withRecord(() => {
      const idSet = new Set(ids)
      // 级联：先移除任何一端被删的边
      for (const e of this.edgeStore.getEdges()) {
        if (idSet.has(e.source) || idSet.has(e.target)) this.edgeStore.removeEdge(e.id)
      }
      // 仍存活但父被删的子节点解除父引用
      for (const n of this.nodeStore.getNodes()) {
        if (n.parentId && idSet.has(n.parentId)) {
          this.nodeStore.updateNode(n.id, { parentId: undefined })
        }
      }
      const count = this.nodeStore.removeNodes(ids)
      // 清理选中态：被删节点移出节点选中；被删边移出边选中
      for (const id of ids) this.selection.remove(id)
      this.pruneSelection()
      return count
    })
    this.scheduleCommit()
    return removed
  }

  addEdge(input: AddEdgeRequest): string {
    const id = this.history.withRecord(() => this.edgeStore.addEdge(input))
    this.scheduleCommit()
    return id
  }

  removeEdges(ids: string[]): number {
    if (ids.length === 0) return 0
    const removed = this.history.withRecord(() => {
      let n = 0
      for (const id of ids) {
        if (this.edgeStore.removeEdge(id)) {
          n += 1
          this.selection.removeEdge(id)
        }
      }
      return n
    })
    this.scheduleCommit()
    return removed
  }

  transaction<T>(reason: string, fn: (tx: GraphTransaction) => T): T {
    const tx = this.makeTx()
    const out = this.history.withRecord(() => fn(tx))
    this.scheduleCommit()
    void reason
    return out
  }

  // ==================== 撤销 / 重做 ====================

  undo(): void {
    const before = this.snapshot()
    this.history.undo()
    if (!sameGraph(before, this.snapshot())) {
      this.selection.clear()
      this.scheduleCommit()
    }
  }

  redo(): void {
    const before = this.snapshot()
    this.history.redo()
    if (!sameGraph(before, this.snapshot())) {
      this.selection.clear()
      this.scheduleCommit()
    }
  }

  canUndo(): boolean {
    return this.history.canUndo()
  }
  canRedo(): boolean {
    return this.history.canRedo()
  }

  // ==================== 提交（落盘调度） ====================

  onCommit(cb: (envelope: GraphEnvelope) => void): () => void {
    this.commitCbs.push(cb)
    return () => {
      const i = this.commitCbs.indexOf(cb)
      if (i >= 0) this.commitCbs.splice(i, 1)
    }
  }

  hasPendingCommit(): boolean {
    return this.pendingCommit
  }

  private makeTx(): GraphTransaction {
    return {
      createNode: (type, position, data) => this.createNode(type, position, data),
      addNodes: (inputs) => this.addNodes(inputs),
      updateNode: (id, patch) => this.updateNode(id, patch),
      updateNodes: (entries) => this.updateNodes(entries),
      removeNodes: (ids) => this.removeNodes(ids),
      addEdge: (input) => this.addEdge(input),
      removeEdges: (ids) => this.removeEdges(ids),
    }
  }

  /** 把 selection 收敛到仍存在的节点/边：避免删除后残留幽灵选中 */
  private pruneSelection(): void {
    const aliveNodes = new Set(this.nodeStore.getNodes().map((n) => n.id))
    const aliveEdges = new Set(this.edgeStore.getEdges().map((e) => e.id))
    const nodeSel = [...this.selection.ids].filter((id) => aliveNodes.has(id))
    const edgeSel = [...this.selection.edgeIds].filter((id) => aliveEdges.has(id))
    if (nodeSel.length !== this.selection.ids.size) this.selection.set(nodeSel)
    if (edgeSel.length !== this.selection.edgeIds.size) this.selection.setEdges(edgeSel)
  }

  /**
   * 每次变更后立即同步触发"整图提交"（commit 回调/宿主 save.set 均同步入队；
   * 实际落盘仍由 SaveService 自身防抖 flush 合并，不改写语义）。
   * 不做 setTimeout 合并：旧直写语义要求"调用返回后存储脏队列已包含本次图"，
   * 宿主可在任意时刻 flush，避免测试/关闭时丢最后一次变更。
   */
  private scheduleCommit(): void {
    this.pendingCommit = true
    const envelope = this.snapshot()
    for (const cb of this.commitCbs) {
      try {
        cb(envelope)
      } catch {
        /* 单个提交回调失败不阻断其它 */
      }
    }
    if (this.commit) this.commit(envelope)
    this.pendingCommit = false
  }
}
