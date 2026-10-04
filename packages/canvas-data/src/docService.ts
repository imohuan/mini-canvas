/**
 * docService —— 画布**文档门面**（设计文档 §4.1：`nodeStore` + `edgeStore` + `graph` + `history`
 * 合并成 `doc` 一个服务）。
 *
 * 为什么要有它：今天画布数据被拆成四个服务（节点表 / 边表 / 图写入口 / 撤销栈），消费方要同时 inject
 * 四个、还要自己记住"读走谁、写走谁"（读 nodeStore.types、写 graph.updateNode、撤销走 history……
 * 一处搞错就数据漂移）。设计文档的目标服务数是 7，其中数据那一格就叫 `doc`：
 * **节点 + 边 + 事务 + 撤销 + 快照**合成一个名字，消费方只认它。
 *
 * 实例来源（步骤 5c 起）：**装配方直接交给门面**。canvasBasePlugin 建好四个实例后
 * `createDocService({ nodeStore, edgeStore, graph, history })` 并 `ctx.inject('doc', …)`。
 * 门面**不再按名解析** —— 5c 已把四个老服务名下线（`ctx.get('nodeStore')` 取不到）。
 *
 * 为什么是"交实例"而不是"按名解析"（5a/5b 期的做法）：
 * 1. 5a 期按名解析是为了"新老并存、两边零改动"；5c 的目标就是删名，解析路径随之作废
 *    （老名没了，再解析只会得到 undefined）。
 * 2. 交实例更贴合 cordis 规范：解析器不再替门面缓存/查找，装配方给什么就用什么；
 *    服务被热换（重装基础插件）时随装配重新建门面，同样不会用到旧实例。
 * 3. 门面自己零状态：不需要在 `ctx.stop()` 时重建。
 *
 * 归属：`doc` 现在与 block 里另外六个基础服务一样，是**由基础插件注入的真服务**（不是能力层内置）。
 * 底层四个实例仍是 nodeStore/edgeStore/graph/history 这些**对象**（名字不再是 ctx 服务名）。
 *
 * 边界：纯转发（读/写/事务/撤销/快照/订阅），**不含任何画布语义**（连接校验在 graph、匿名收敛在
 * nodeStore，门面不重复实现）。零 Vue、零 DOM，Node 可单测。
 */
import type { NodeStoreService, CanvasNode, CanvasNodeType, NodePatch, NodePatchEntry, AddNodeInput } from './nodeStore'
import { nodeSizePatch } from './nodeStore'
import type { EdgeStoreService, CanvasEdge, AddEdgeRequest, StoredEdgeInput } from './edgeStore'
import type {
  GraphDocumentService,
  GraphEnvelope,
  GraphTransaction,
  ConnectEdgeResult,
} from './graphDocument'
import type { HistoryService } from './history'

/** 正有限数判定：尺寸只认这种值（0/负数/NaN/Infinity/非数字一律拒写） */
function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * 门面背后的四个底层实现（**可能缺席**：单元测试只要一部分）。
 *
 * 为什么允许 undefined 而不是在构造时强制给全：门面是"那四个东西"的统一视图，
 * 但"装配方手上到底有哪几个"由装配决定（生产宿主给全，只测读路径的单元测试给一部分）。
 * 门面因此**按需报错**：用到哪个缺席哪个才抛（消息写明缺谁、为什么需要它），不静默返回空数据。
 */
export interface DocSources {
  nodeStore?: NodeStoreService | undefined
  edgeStore?: EdgeStoreService | undefined
  graph?: GraphDocumentService | undefined
  history?: HistoryService | undefined
}

/**
 * 现取四个底层实现（每次调用都重新解析，不缓存）。
 *
 * 生产装配不用它（canvasBasePlugin 直接交实例）；留它是为了表达"来源会变"的装配，
 * 也让既有单测的 `createDocService(() => ({ ... }))` 写法不必改。
 */
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

  // ==================== 节点类型表（数据侧写口） ====================
  /**
   * 注册一个节点类型的数据部分（type/label/尺寸/连接约束/类型级能力）。
   *
   * 为什么在这里：5c 起节点类型表就是 doc 的一部分（nodeStore 不再是服务名），而
   * `registerNodeType(ctx, def)` 这个底层助手需要写它 —— 助手自己没有实例，唯一持有者就是 doc。
   * **作者侧正式入口仍是 `ctx.nodes.register`**（一次把数据 + 展示两处都落表）；
   * 这里是"只落数据侧"的低层口，供 registerNodeType 与能力层复用，不是给作者的第二条路。
   */
  registerType(def: CanvasNodeType): void
  /** 注销某节点类型（热卸插件时回收；不存在则 no-op）。语义与 registerType 对称。 */
  unregisterType(type: string): void
  /** 当前全部边（只读快照；与 edgeStore 同源） */
  getEdges(): CanvasEdge[]
  /** 取某条边 */
  getEdge(id: string): CanvasEdge | undefined

  // ==================== 写（唯一写入口：自动进历史 + 调度落盘） ====================
  /** 按已注册类型建一个节点，返回 id（进历史） */
  createNode(type: string, position: { x: number; y: number }, data?: Record<string, unknown>): string
  /**
   * 取下一个可用节点 id（短数字 '1' '2' '3' …）并占掉它。
   *
   * 插件要在**建节点之前**拿到 id（先拿 id 才能连边 / 选中）时用它 —— 别再各自造
   * `xxx-时间戳-随机` 那种 id：统一来源，画布里的 id 才是一个形态。
   */
  nextNodeId(): string
  /** 取下一个可用边 id（短数字）并占掉它。与 nextNodeId 同一道理（两者各自独立计数）。 */
  nextEdgeId(): string
  /** 批量插入节点（可指定 id/data/size/parentId）；返回插入数（进历史） */
  addNodes(inputs: AddNodeInput[]): number
  /** 改某节点（position/size/parentId/data）；节点不存在抛错（进历史） */
  updateNode(id: string, patch: NodePatch): void
  /** 批量改节点（原子一条历史） */
  updateNodes(entries: NodePatchEntry[]): void
  /** 改某节点 data（等价 updateNode(id, { data })） */
  updateNodeData(id: string, data: Record<string, unknown>): void
  /**
   * 改某节点的标题（label）。这是"改标题"的一等入口 —— 调用方不该自己去拼 data.label。
   * 传空串 / undefined / 全空白 → 清掉标题（节点显示回类型名）。
   */
  setNodeLabel(id: string, label: string | undefined): void
  /** 把某节点移到绝对坐标（同父坐标系）。改的是位置，不是别的。 */
  moveNode(id: string, position: { x: number; y: number }): void
  /** 批量移动（原子一次历史）；顺序即入参顺序。 */
  moveNodes(entries: Array<{ id: string; position: { x: number; y: number } }>): void
  /**
   * 设/清某节点的父（组归属）。undefined = 解除父（回到顶层）。
   * 父 id 不存在或指向自己由调用方保证 —— 本方法只做这一件事：写 parentId。
   */
  setNodeParent(id: string, parentId: string | undefined): void
  /**
   * 改某节点的卡片尺寸（宽高，px）。这是"设尺寸"的**一等入口**：内部走唯一写入口，
   * 自动进历史 + 调度落盘，并把 data.cardWidth/cardHeight 镜像一并刷新（不用自己写两份）。
   *
   * 为什么单独给一个方法，而不要求调用方拼 `updateNode(id, { size: { w, h } })`：
   * 尺寸是插件最常改的东西之一，把"拼 patch + 记得正身是 size"这条约定收进一个方法，
   * 作者不必知道 `size` 与 `data.cardWidth` 的分工（那是内部实现细节）。
   *
   * @returns 是否写入成功；宽高非正有限数（0/负数/NaN/字符串）→ false 且不写（不污染节点）
   */
  setNodeSize(id: string, w: number, h: number): boolean
  /** 写节点运行期状态：落盘但不进撤销栈（进度帧用） */
  updateNodeRuntime(id: string, patch: NodePatch): void
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
 *
 * @param sources 四个底层实现。**生产装配传实例对象**（canvasBasePlugin 建好后直接交）；
 *   传函数时按"现取"语义每次调用都重新求值（不缓存）—— 两条路都允许，便于单测只装配一部分。
 */
export function createDocService(sources: DocSources | DocSourceResolver): DocService {
  /** 归一成"现取"函数：交实例 = 每次返回同一份；交解析器 = 每次重新调用它 */
  const resolve: DocSourceResolver = typeof sources === 'function' ? sources : () => sources

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
    registerType: (def) => need('nodeStore').registerType(def),
    unregisterType: (type) => need('nodeStore').unregisterType(type),
    getEdges: () => need('edgeStore').getEdges(),
    getEdge: (id) => need('edgeStore').getEdge(id),

    // —— 写（全部经 graph：唯一写入口） ——
    createNode: (type, position, data) => need('graph').createNode(type, position, data),
    nextNodeId: () => need('nodeStore').nextId(),
    nextEdgeId: () => need('edgeStore').nextId(),
    addNodes: (inputs) => need('graph').addNodes(inputs),
    updateNode: (id, patch) => need('graph').updateNode(id, patch),
    updateNodes: (entries) => need('graph').updateNodes(entries),
    updateNodeData: (id, data) => need('graph').updateNode(id, { data }),
    setNodeLabel: (id, label) => {
      const text = typeof label === 'string' ? label.trim() : ''
      need('graph').updateNode(id, { data: { label: text || undefined } })
    },
    moveNode: (id, position) => need('graph').updateNode(id, { position: { x: position.x, y: position.y } }),
    moveNodes: (entries) =>
      need('graph').updateNodes(
        entries.map((e) => ({ id: e.id, patch: { position: { x: e.position.x, y: e.position.y } } })),
      ),
    setNodeParent: (id, parentId) => need('graph').updateNode(id, { parentId }),
    setNodeSize: (id, w, h) => {
      // 非法尺寸一律拒写：NaN/0 写进去会让卡片塌成不可见的形状，比"没生效"更难排查
      if (!isPositiveFinite(w) || !isPositiveFinite(h)) return false
      need('graph').updateNode(id, nodeSizePatch(w, h))
      return true
    },
    updateNodeRuntime: (id, patch) => need('graph').updateNodeRuntime(id, patch),
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
