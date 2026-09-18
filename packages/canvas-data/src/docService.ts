/**
 * docService —— 画布**文档门面**（设计文档 §4.1：`nodeStore` + `edgeStore` + `graph` + `history`
 * 合并成 `doc` 一个服务）。
 *
 * 为什么要有它：今天画布数据被拆成四个服务（节点表 / 边表 / 图写入口 / 撤销栈），消费方要同时 inject
 * 四个、还要自己记住"读走谁、写走谁"（读 nodeStore.types、写 graph.updateNode、撤销走 history……
 * 一处搞错就数据漂移）。设计文档的目标服务数是 7，其中数据那一格就叫 `doc`：
 * **节点 + 边 + 事务 + 撤销 + 快照**合成一个名字，消费方只认它。
 *
 * 实现方式：**门面 + 按名惰性解析**（不是把四个实例抓进闭包）。
 *
 * 为什么惰性解析（三条理由，都在这套代码里已有先例）：
 * 1. 与 cordis 规范一致："方法内惰性取现时服务，不缓存"（见 plugin-group 的 GroupService 注释）——
 *    服务被热换（重装基础插件 / 换存储实现）后，抓死的闭包会继续用旧实例，惰性解析不会。
 * 2. 迁移期必须"新老并存"（§九 步骤 5a）：老名字还在，`doc` 只是它们的一层视图；
 *    视图按名解析即可同时服务"经 canvasBasePlugin 装配的生产宿主"与"手工注入老名的最小 ctx"
 *    （后者遍布插件包测试）——两边零改动。
 * 3. 门面自己零状态：不需要在 `ctx.stop()` 时重建，也不会持有已回收的实例。
 *
 * 归属：`doc` 是画布能力层的**内置服务**（与 `slots`/`settings` 同类：恒可取到、依赖判定恒满足），
 * 见 canvas/capabilityLayer.ts 的 `builtins()`。底层四个服务仍由 canvasBasePlugin 注入。
 *
 * 边界：纯转发（读/写/事务/撤销/快照/订阅），**不含任何画布语义**（连接校验在 graph、匿名收敛在
 * nodeStore，门面不重复实现）。零 Vue、零 DOM，Node 可单测。
 */
import type { NodeStoreService, CanvasNode, CanvasNodeType, NodePatch, NodePatchEntry, AddNodeInput } from './nodeStore'
import type { EdgeStoreService, CanvasEdge, AddEdgeRequest, StoredEdgeInput } from './edgeStore'
import type {
  GraphDocumentService,
  GraphEnvelope,
  GraphTransaction,
  ConnectEdgeResult,
} from './graphDocument'
import type { HistoryService } from './history'

/**
 * 门面背后的四个底层服务（**可能缺席**：测试/纯内核只要一部分）。
 *
 * 为什么允许 undefined 而不是在构造时强制给全：门面是能力层内置服务，任何 `new Context()` 都有它；
 * 但"这个 ctx 到底注入了哪几个底层服务"由装配方决定（生产宿主给全，最小测试给一部分）。
 * 门面因此**按需报错**：用到哪个缺席哪个才抛（消息写明缺谁、为什么需要它），不静默返回空数据。
 */
export interface DocSources {
  nodeStore?: NodeStoreService | undefined
  edgeStore?: EdgeStoreService | undefined
  graph?: GraphDocumentService | undefined
  history?: HistoryService | undefined
}

/** 现取四个底层服务（每次调用都重新解析，不缓存） */
export type DocSourceResolver = () => DocSources

/** 一次文档变化（节点桶或边桶；两桶的 reason 词表取其并集） */
export interface DocChange {
  /** 哪一桶变了 */
  kind: 'node' | 'edge'
  /** 变化类型（nodeStore：add/remove/update/replace；edgeStore：add/remove/replace） */
  reason: 'add' | 'remove' | 'update' | 'replace'
  /** 本次涉及的节点/边 id（整体替换时为 undefined） */
  id?: string
}

/**
 * `ctx.get('doc')` 得到的文档服务形状。
 *
 * 分组即"这一格服务干什么"：
 * - **读**：节点/边/类型表/层级查询；
 * - **写**：全部经唯一写入口（自动进历史 + 调度落盘）——这与"以前可以直接 nodeStore 直写"不同，
 *   门面**只暴露收口后的写**，避免继续放大"各写路径各自决定要不要记历史/落盘"的分歧；
 * - **事务/撤销重做**：一次 undo 覆盖节点 + 边；
 * - **快照/整体替换/落盘钩子**；
 * - **订阅**：一次订阅覆盖两桶。
 */
export interface DocService {
  // ==================== 读 ====================
  /** 当前全部节点（只读快照；与 nodeStore 同源） */
  getNodes(): CanvasNode[]
  /** 取某节点 */
  getNode(id: string): CanvasNode | undefined
  /** 某父节点的直属子节点（层级查询；容器型节点用） */
  childNodesOf(parentId: string): CanvasNode[]
  /** 已注册的节点类型表（**只读投影**；注册/注销类型请走 `ctx.nodes.register`） */
  readonly types: ReadonlyMap<string, CanvasNodeType>
  /** 当前全部边（只读快照；与 edgeStore 同源） */
  getEdges(): CanvasEdge[]
  /** 取某条边 */
  getEdge(id: string): CanvasEdge | undefined

  // ==================== 写（唯一写入口：自动进历史 + 调度落盘） ====================
  /** 按已注册类型建一个节点，返回 id（进历史） */
  createNode(type: string, position: { x: number; y: number }, data?: Record<string, unknown>): string
  /** 批量插入节点（可指定 id/data/size/parentId）；返回插入数（进历史） */
  addNodes(inputs: AddNodeInput[]): number
  /** 改某节点（position/size/parentId/data）；节点不存在抛错（进历史） */
  updateNode(id: string, patch: NodePatch): void
  /** 批量改节点（原子一条历史） */
  updateNodes(entries: NodePatchEntry[]): void
  /** 改某节点 data（等价 updateNode(id, { data })） */
  updateNodeData(id: string, data: Record<string, unknown>): void
  /** 删节点：连带清相连边、清子节点父引用、清选中（进历史） */
  removeNodes(ids: string[]): number
  /** 加一条边（过守门人：自连/成环/重复/类型/容量） */
  addEdge(input: AddEdgeRequest): string
  /** 加一条连接线的**全路径统一入口**：校验 → 满额挤出 → 落边（结果带 status/reason） */
  connectEdge(input: AddEdgeRequest): ConnectEdgeResult
  /** 删边（清选中） */
  removeEdges(ids: string[]): number

  // ==================== 事务 / 撤销重做 ====================
  /** 原子变更 + 进历史：fn 内多次写合并成一条 undo */
  transaction<T>(reason: string, fn: (tx: GraphTransaction) => T): T
  /** 撤销（对节点 + 边统一快照生效，恢复后触发落盘调度） */
  undo(): void
  /** 重做 */
  redo(): void
  canUndo(): boolean
  canRedo(): boolean
  /** 撤销栈深度（测试/诊断；plugin-history 的只读 facade 用它） */
  readonly undoDepth: number

  // ==================== 快照 / 整体替换 / 落盘 ====================
  /** 深拷贝快照（节点 + 边；与内部引用隔离） */
  snapshot(): GraphEnvelope
  /** 整体回填（刷新恢复 / 导入 / 云端整份覆盖）；不清历史 */
  replaceAll(nodes: CanvasNode[], edges?: StoredEdgeInput[]): void
  /** 注册"整图已变"提交回调（落盘方用）；返回取消函数 */
  onCommit(cb: (envelope: GraphEnvelope) => void): () => void
  /** 当前待提交批次是否为空（测试/诊断） */
  hasPendingCommit(): boolean

  // ==================== 订阅 ====================
  /** 订阅节点**或**边任一变化（一次订阅覆盖两桶）；返回取消函数 */
  subscribe(listener: (change: DocChange) => void): () => void
}

/**
 * 建一个文档门面。
 * @param resolve 现取四个底层服务（每次调用都调用它，不缓存结果）
 */
export function createDocService(resolve: DocSourceResolver): DocService {
  /** 取底层服务；缺席即抛（消息写明缺谁 —— 装配缺件要响亮，不静默返回空数据） */
  function need<K extends keyof DocSources>(key: K): NonNullable<DocSources[K]> {
    const impl = resolve()[key]
    if (!impl) {
      throw new Error(
        `[doc] 缺少底层服务 "${String(key)}"：` +
          '节点/边的读走 nodeStore/edgeStore，写与事务/撤销/快照走 graph（由 canvas-base 注入）。',
      )
    }
    return impl as NonNullable<DocSources[K]>
  }

  return {
    // —— 读 ——
    getNodes: () => need('nodeStore').getNodes(),
    getNode: (id) => need('nodeStore').getNode(id),
    childNodesOf: (parentId) => need('nodeStore').childNodesOf(parentId),
    get types() {
      return need('nodeStore').types
    },
    getEdges: () => need('edgeStore').getEdges(),
    getEdge: (id) => need('edgeStore').getEdge(id),

    // —— 写（全部经 graph：唯一写入口） ——
    createNode: (type, position, data) => need('graph').createNode(type, position, data),
    addNodes: (inputs) => need('graph').addNodes(inputs),
    updateNode: (id, patch) => need('graph').updateNode(id, patch),
    updateNodes: (entries) => need('graph').updateNodes(entries),
    updateNodeData: (id, data) => need('graph').updateNode(id, { data }),
    removeNodes: (ids) => need('graph').removeNodes(ids),
    addEdge: (input) => need('graph').addEdge(input),
    connectEdge: (input) => need('graph').connectEdge(input),
    removeEdges: (ids) => need('graph').removeEdges(ids),

    // —— 事务 / 撤销重做 ——
    transaction: (reason, fn) => need('graph').transaction(reason, fn),
    undo: () => need('graph').undo(),
    redo: () => need('graph').redo(),
    canUndo: () => need('graph').canUndo(),
    canRedo: () => need('graph').canRedo(),
    get undoDepth() {
      return need('history').undoDepth
    },

    // —— 快照 / 整体替换 / 落盘 ——
    snapshot: () => need('graph').snapshot(),
    replaceAll: (nodes, edges) => need('graph').replaceAll(nodes, edges),
    onCommit: (cb) => need('graph').onCommit(cb),
    hasPendingCommit: () => need('graph').hasPendingCommit(),

    // —— 订阅（两桶合一） ——
    subscribe(listener) {
      const offNodes = need('nodeStore').subscribe((reason, id) =>
        listener({ kind: 'node', reason, ...(id !== undefined ? { id } : {}) }),
      )
      const offEdges = need('edgeStore').subscribe((reason, id) =>
        listener({ kind: 'edge', reason, ...(id !== undefined ? { id } : {}) }),
      )
      return () => {
        offNodes()
        offEdges()
      }
    },
  }
}
