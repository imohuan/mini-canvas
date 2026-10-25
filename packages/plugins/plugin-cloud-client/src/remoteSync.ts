/**
 * remoteSync —— 订阅后台的实时通道，把变化落到本地。
 *
 * 为什么不能"收到通知就整包覆盖"：本插件不是「服务器唯一权威、前端只做显示」的架构 ——
 * 用户此刻正在本地操作，整包覆盖会冲掉刚建的节点、把正在输入的内容换回旧值。
 * 所以走 remoteMerge 的三方合并，只动"确实该动的"那些。
 *
 * 三种变化分三路处理：
 * - 画布那三个 key → 三方合并落到本地（AI 改画布、后台推进任务进度都走这条）
 * - 清单版本 → 叫上层重拉动作表（后台加/删平台，前端菜单跟着变）
 * - 历史版本 → 叫上层重拉历史（新生成的东西立刻出现在历史里）
 *
 * 零 Vue / 零工作区依赖。
 */
import { planRemoteMerge, isPlanEmpty } from './remoteMerge.js'
import type { CanvasGraphSnapshot, MergeEdge, MergeNode, RemoteMergePlan } from './remoteMerge.js'
import type { ChangeEvent, EventSourceLike } from './apiTypes.js'

/** 本地画布读写口（由插件接到真 doc 上；本模块不 import 数据层类型） */
export interface LocalGraphHandlers {
  getNodes(): MergeNode[]
  getEdges(): MergeEdge[]
  /** 当前本地边（仅换 id 时需要完整端点；缺省 = 旧宿主不改边） */
  localEdges?(): MergeEdge[]
  /** 某节点的直接子节点（换 id 时要改 parentId；缺省 = 旧宿主不改父子） */
  childNodesOf?(nodeId: string): Array<{ id: string }>
  /**
   * 把一轮合并结果落到本地画布。
   * 调用方应把「作品字段」包进事务（一条撤销记录），把「只改 runState 的进度帧」单独落
   * （不进撤销栈 —— 否则用户按一次 Ctrl+Z 只退一格进度条）。
   */
  applyPlan(plan: RemoteMergePlan): void
  /** 把后台实际拥有的节点/边快照同步给保存适配器（合并后由调用方显式推进） */
  noteServerSnapshot?(snapshot: CanvasGraphSnapshot): void
  /**
   * 此刻用户是否正在编辑某节点：返回被占用的字段（position / data / size）或空集。
   * 合并层对“正在编辑的字段”只延迟应用，其他节点与字段照常同步。
   * 不传 = 旧宿主没有这个信号，按“没有正在编辑”处理。
   */
  editingFields?(nodeId: string): ReadonlySet<'position' | 'data' | 'size'>
  /** 已经确认过的云端图版本（供诊断/状态展示；不参与合并） */
  onRevision?(revision: number): void
}

export interface RemoteSyncOptions {
  /** 读云端某个 key（没保存过返回 undefined） */
  readCloud: (type: string, key: string) => Promise<unknown>
  /**
   * 一次读取完整画布快照（可选；给了就不会再用 readCloud 分两次读节点/边）。
   * 返回里的 revision 必须与 nodes/edges 来自同一次服务端读取。
   */
  readSnapshot?: () => Promise<{ nodes: unknown; edges: unknown; revision?: number }>
  /** 只读画布图版本（定时 ping）。无这个接口的旧服务端返回 undefined，降级为完整快照核对。 */
  readRevision?: () => Promise<number | undefined>
  /** 画布过滤：SSE 会送来所有画布的事件，不能拿别的画布版本推进当前书签 */
  canvasId?: string
  graph: LocalGraphHandlers
  /** 本地认不认识某个节点类型（不认识就跳过：本地渲染不了，塞进来只会是坏数据） */
  knownType: (type: string) => boolean
  /** 订阅变化（由 CloudApi 提供） */
  subscribe: (onChange: (e: ChangeEvent) => void, onError?: (msg: string) => void) => () => void
  /** 后台的动作清单变了 */
  onActionsChanged?: () => void
  /** 后台有了新历史 */
  onHistoryChanged?: () => void
  /** 事件合并窗口（毫秒）：一次改动会连发几个 key 的通知，攒一下只跑一轮 */
  debounceMs?: number
  /** 定时核对间隔（毫秒）；0 = 关闭。默认 15 秒，只在页面可见时运行 */
  revisionPollMs?: number
  onError?: (message: string, err?: unknown) => void
}

const GRAPH_KEY = 'graph'
const GRAPH_EDGES_KEY = 'graph-edges'
const CANVAS = 'canvas'

/** 值得让本地跟着动的画布 key（视口变化不该导致节点重装） */
const WATCHED_KEYS = new Set([GRAPH_KEY, GRAPH_EDGES_KEY])

export interface RemoteSync {
  start(): void
  stop(): void
  isRunning(): boolean
  /**
   * 把「当前云端状态」记为基准，不应用任何改动。
   * 安装插件、恢复完云端数据之后**必须**调用一次，否则第一次收到事件时会拿着空基准去比，
   * 把云端所有节点都当成"新增"再插一遍。
   */
  refreshBase(): Promise<void>
  /** 立即向后台核对一次版本（用户点“立即核对”/测试用） */
  check(): Promise<void>
  /** 诊断状态：已确认版本（旧服务端为 undefined） */
  status(): { knownRevision: number | undefined; revisionSupported?: boolean; deferred?: boolean }
  /** 最近一次实际应用过的云端快照；未合并过为 undefined */
  serverSnapshot(): CanvasGraphSnapshot | undefined
}

/** 三种形态都认（旧数组只存节点 / 信封含边 / 空），与后端恢复逻辑同款 */
export function toSnapshot(rawNodes: unknown, rawEdges: unknown): CanvasGraphSnapshot {
  let nodeList: unknown[] = []
  let edgeList: unknown[] = Array.isArray(rawEdges) ? rawEdges : []
  if (Array.isArray(rawNodes)) {
    nodeList = rawNodes
  } else if (rawNodes && typeof rawNodes === 'object' && Array.isArray((rawNodes as { nodes?: unknown }).nodes)) {
    const env = rawNodes as { nodes: unknown[]; edges?: unknown }
    nodeList = env.nodes
    if (Array.isArray(env.edges)) edgeList = env.edges
  }
  const nodes: MergeNode[] = []
  for (const raw of nodeList) {
    const n = normalizeNode(raw)
    if (n) nodes.push(n)
  }
  const edges: MergeEdge[] = []
  for (const raw of edgeList) {
    const e = normalizeEdge(raw)
    if (e) edges.push(e)
  }
  return { nodes, edges }
}

/** 把任意来源的节点收敛成本模块看得懂的最小形状（形状不对的当作没有） */
function normalizeNode(raw: unknown): MergeNode | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const n = raw as Partial<MergeNode>
  if (typeof n.id !== 'string' || typeof n.type !== 'string') return undefined
  const pos = n.position as { x?: unknown; y?: unknown } | undefined
  const x = pos?.x
  const y = pos?.y
  return {
    id: n.id,
    type: n.type,
    // 保留“缺失”而不是伪造 0,0：新增比较必须能区分“没有位置”与“就在原点”。
    ...(typeof x === 'number' && typeof y === 'number' ? { position: { x, y } } : {}),
    data: (n.data && typeof n.data === 'object' ? { ...n.data } : {}) as Record<string, unknown>,
    ...(typeof n.parentId === 'string' ? { parentId: n.parentId } : {}),
    ...(n.size && typeof n.size === 'object' ? { size: { ...n.size } } : {}),
  }
}

function normalizeEdge(raw: unknown): MergeEdge | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const e = raw as Partial<MergeEdge>
  if (typeof e.id !== 'string' || typeof e.source !== 'string' || typeof e.target !== 'string') return undefined
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    ...(typeof e.sourceHandle === 'string' ? { sourceHandle: e.sourceHandle } : {}),
    ...(typeof e.targetHandle === 'string' ? { targetHandle: e.targetHandle } : {}),
    ...(typeof e.type === 'string' ? { type: e.type } : {}),
    ...(e.data && typeof e.data === 'object' ? { data: { ...e.data } as Record<string, unknown> } : {}),
  }
}

export function createRemoteSync(opts: RemoteSyncOptions): RemoteSync {
  const debounceMs = opts.debounceMs ?? 200
  const revisionPollMs = opts.revisionPollMs ?? 15_000
  const report = opts.onError ?? ((msg: string) => console.warn('[cloud-client] ' + msg))
  let base: CanvasGraphSnapshot | null = null
  /** 最近一次实际应用的云端快照（供保存适配器同步基准；与 base 区分延迟节点） */
  let appliedSnapshot: CanvasGraphSnapshot | undefined
  /** 已确认的云端图版本；undefined = 旧服务端没有版本接口（兼容模式） */
  let knownRevision: number | undefined
  let unsubscribe: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let visibilityBound = false
  let onlineBound = false
  let running = false
  /** 正在跑一轮时又来了通知 → 记个标记，跑完补一轮（不丢事件也不并发） */
  let dirty = false
  let inflight = false
  /** 定时核对已安排在跑：避免每 15 秒叠加一轮 */
  let reconcileInflight: Promise<void> | null = null
  /** 上一轮有节点因“正在编辑”被延迟：编辑结束后要补核对，不能等云端再变一次 */
  let hasDeferredUpdates = false

  async function readCloudSnapshot(): Promise<{ graph: CanvasGraphSnapshot; revision?: number }> {
    if (opts.readSnapshot) {
      const snap = await opts.readSnapshot()
      return {
        graph: toSnapshot(snap.nodes, snap.edges),
        ...(typeof snap.revision === 'number' ? { revision: snap.revision } : {}),
      }
    }
    // 兼容旧调用方：两次读取仍可能拼出撕裂快照；新接线一律走 readSnapshot。
    const [nodes, edges] = await Promise.all([
      opts.readCloud(CANVAS, GRAPH_KEY),
      opts.readCloud(CANVAS, GRAPH_EDGES_KEY),
    ])
    return { graph: toSnapshot(nodes, edges) }
  }

  /** 跑一轮：读云端 → 三方合并 → 落地 → 刷新基准 */
  async function syncOnce(): Promise<void> {
    if (inflight) {
      dirty = true
      return
    }
    inflight = true
    try {
      do {
        dirty = false
        const read = await readCloudSnapshot()
        const theirs = read.graph
        // 同一轮只认一份完整快照：版本与节点/边一起推进，绝不拼接。
        if (typeof read.revision === 'number') knownRevision = read.revision
        if (typeof read.revision === 'number') opts.graph.onRevision?.(read.revision)
        const mine: CanvasGraphSnapshot = { nodes: opts.graph.getNodes(), edges: opts.graph.getEdges() }
        const baseline = base ?? { nodes: [], edges: [] }
        const plan = planRemoteMerge(baseline, mine, theirs, opts.knownType)
        // 定时核对可能正好撞上用户拖拽/输入：只延迟被占用节点的对应字段，
        // 不禁用整张画布的同步（新增节点、其他节点变化仍然立即落地）。
        const held = opts.graph.editingFields ? collectEditingFields(plan, opts.graph.editingFields) : new Set<string>()
        if (held.size > 0) holdEditingFields(plan, held)
        if (!isPlanEmpty(plan)) opts.graph.applyPlan(plan)
        hasDeferredUpdates = held.size > 0
        // 保存基准记录**后台真实拥有**的那一版（延迟的是“合并基准”，不是后台事实）。
        // 两者若混用，用户正在拖拽的节点会被误标成“尚未提交”，下一次保存又把它本地的
        // 位置当成新改动发上去 —— 这正是两份基准要分开维护的原因。
        appliedSnapshot = theirs
        // 基准跟着**应用成功的那一版**走：正在编辑的节点还没落地，
        // 这一版不能记为已同步（否则下一轮 sameNode 会以为已经合过而不重试）。
        // 延迟节点不能从基准里删掉：删掉会让下一轮把它当成“云端新增”，
        // 已有本地节点时反而永远不更新。正确做法是保留**修改前**的那一版，
        // 下轮 sameNode(base, theirs) 仍判为“云端改了”，于是继续重试。
        base = held.size > 0 ? snapshotWithHeldAtBaseline(theirs, held, baseline) : theirs
        // 合并完成后再把保存基准推到后台真实快照：放在 base 之后，保证调用顺序
        // 永远是“先算下一轮合并基准、再对齐提交基准”。
        opts.graph.noteServerSnapshot?.(theirs)
        // 补一次订阅前漏掉的通知：跑完再看一眼版本，避免“核对时正好又变了一次”漏掉。
        if (opts.readRevision) {
          const latest = await opts.readRevision()
          if (typeof latest === 'number' && (knownRevision === undefined || latest > knownRevision)) {
            dirty = true
          }
        }
      } while (dirty)
    } catch (err) {
      // 不推进 knownRevision：失败后下一次定时核对会继续重试。
      report('实时同步失败（稍后会自动重试）', err)
    } finally {
      inflight = false
      // 这轮失败时若正好有事件进来（dirty 被置位），while 已跳出、不会再跑，
      // 而"下次事件"可能永远不来（后台不再改动了）—— 那就漏了一次同步。这里补排一轮。
      if (dirty) schedule()
    }
  }

  /**
   * 定时/重连核对：先只问版本，版本没变就结束；变了才拉完整画布合并。
   *
   * 这是针对「SSE 长时间不通讯自动断开、漏掉一帧通知」的兜底：
   * 不依赖长连接一直活着，也不把整张画布反复搬。
   */
  async function reconcile(): Promise<void> {
    if (!running) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    // 已在核对：不再叠加。定时器每 15 秒一次，网络慢时不能把请求越堆越多。
    if (reconcileInflight) return reconcileInflight
    const job = (async () => {
      try {
        if (opts.readRevision) {
          const remote = await opts.readRevision()
          if (typeof remote === 'number') {
            if (knownRevision !== undefined && remote <= knownRevision && !hasDeferredUpdates) return
            // 版本不同（或首次没有基线）→ 拉完整快照合并；不会用事件跳版。
            // 同一轮失败不推进 knownRevision；下一次定时核对会再次看到版本落后并重试。
            schedule()
            return
          }
        }
        // 旧服务端没有版本接口：低频完整快照核对（只在可见时）。
        schedule()
      } catch (err) {
        report('定时核对失败（稍后重试）', err)
      }
    })()
    reconcileInflight = job
    try {
      await job
    } finally {
      if (reconcileInflight === job) reconcileInflight = null
    }
  }

  /** 页面回到前台：立即核对一次；隐藏期间暂停定时核对（由 reconcile 自行跳过） */
  function onVisibility(): void {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') void reconcile()
  }

  /** 浏览器从离线恢复：长连接可能还没恢复，立即核对一次 */
  function onOnline(): void {
    void reconcile()
  }

  function schedule(): void {
    if (!running) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void syncOnce()
    }, debounceMs)
  }

  function onEvent(e: ChangeEvent): void {
    if (e.type === CANVAS) {
      // 多画布：别的画布的事件不能触发当前画布的整包合并。
      if (opts.canvasId !== undefined && e.canvasId !== undefined && e.canvasId !== opts.canvasId) return
      // 只对画布本体那两类跑合并；视口变化不该触发节点重装
      if (WATCHED_KEYS.has(e.key)) schedule()
      return
    }
    if (e.type === 'config') {
      if (e.key === 'providers-version') opts.onActionsChanged?.()
      else if (e.key === 'history-rev') opts.onHistoryChanged?.()
    }
  }

  return {
    start() {
      if (running) return
      running = true
      unsubscribe = opts.subscribe(onEvent, (msg) => report(msg))
      if (revisionPollMs > 0 && typeof setInterval === 'function') {
        pollTimer = setInterval(() => void reconcile(), revisionPollMs)
      }
      if (typeof document !== 'undefined' && !visibilityBound) {
        visibilityBound = true
        document.addEventListener('visibilitychange', onVisibility)
      }
      if (typeof window !== 'undefined' && !onlineBound) {
        onlineBound = true
        window.addEventListener('online', onOnline)
      }
      // 订阅建立后再核对一次：恢复完成到订阅建立之间的窗口也不会漏。
      void reconcile()
    },
    stop() {
      running = false
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      unsubscribe?.()
      unsubscribe = null
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      if (typeof document !== 'undefined' && visibilityBound) {
        visibilityBound = false
        document.removeEventListener('visibilitychange', onVisibility)
      }
      if (typeof window !== 'undefined' && onlineBound) {
        onlineBound = false
        window.removeEventListener('online', onOnline)
      }
    },
    isRunning: () => running,
    async refreshBase() {
      const read = await readCloudSnapshot()
      base = read.graph
      appliedSnapshot = read.graph
      knownRevision = read.revision
    },
    async check() {
      await reconcile()
    },
    status() {
      return {
        knownRevision,
        ...(typeof knownRevision === 'number' ? { revisionSupported: true } : {}),
        deferred: hasDeferredUpdates,
      }
    },
    serverSnapshot() {
      return appliedSnapshot
    },
  }
}

/**
 * 从计划里摘掉“用户正在编辑的那几个字段”，避免核对结果覆盖当前操作。
 *
 * 只处理 updateNodes（已有节点）；add/remove 不碰用户输入框。
 * 摘字段后如果该节点只剩同值数据，planRemoteMerge 的后续比较会自然不再产出更新；
 * 这里保守处理：字段被占用就把该更新整条延后到下一轮。
 */
function collectEditingFields(
  plan: RemoteMergePlan,
  editingFields: (nodeId: string) => ReadonlySet<'position' | 'data' | 'size'>,
): Set<string> {
  const held = new Set<string>()
  for (const node of plan.updateNodes) {
    if (editingFields(node.id).size > 0) held.add(node.id)
  }
  return held
}

/** 把仍在编辑的节点从“已应用基准”里去掉，保留其他已合并节点的新版本 */
function holdEditingFields(plan: RemoteMergePlan, held: ReadonlySet<string>): void {
  plan.updateNodes = plan.updateNodes.filter((node) => !held.has(node.id))
}

/** 把仍在编辑的节点回退到“上一轮基准里的版本”，保留其他节点的最新版 */
function snapshotWithHeldAtBaseline(
  snapshot: CanvasGraphSnapshot,
  held: ReadonlySet<string>,
  previous: CanvasGraphSnapshot,
): CanvasGraphSnapshot {
  const prevById = new Map(previous.nodes.map((node) => [node.id, node]))
  return {
    nodes: snapshot.nodes.map((node) => (held.has(node.id) ? (prevById.get(node.id) ?? node) : node)),
    edges: snapshot.edges,
  }
}
