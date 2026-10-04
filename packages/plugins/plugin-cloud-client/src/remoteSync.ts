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
  /**
   * 把一轮合并结果落到本地画布。
   * 调用方应把「作品字段」包进事务（一条撤销记录），把「只改 runState 的进度帧」单独落
   * （不进撤销栈 —— 否则用户按一次 Ctrl+Z 只退一格进度条）。
   */
  applyPlan(plan: RemoteMergePlan): void
}

export interface RemoteSyncOptions {
  /** 读云端某个 key（没保存过返回 undefined） */
  readCloud: (type: string, key: string) => Promise<unknown>
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
  return {
    id: n.id,
    type: n.type,
    position: { x: Number(pos?.x ?? 0), y: Number(pos?.y ?? 0) },
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
  const report = opts.onError ?? ((msg: string) => console.warn('[cloud-client] ' + msg))
  let base: CanvasGraphSnapshot | null = null
  let unsubscribe: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  /** 正在跑一轮时又来了通知 → 记个标记，跑完补一轮（不丢事件也不并发） */
  let dirty = false
  let inflight = false

  async function readCloudSnapshot(): Promise<CanvasGraphSnapshot> {
    const [nodes, edges] = await Promise.all([
      opts.readCloud(CANVAS, GRAPH_KEY),
      opts.readCloud(CANVAS, GRAPH_EDGES_KEY),
    ])
    return toSnapshot(nodes, edges)
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
        const theirs = await readCloudSnapshot()
        const mine: CanvasGraphSnapshot = { nodes: opts.graph.getNodes(), edges: opts.graph.getEdges() }
        const baseline = base ?? { nodes: [], edges: [] }
        const plan = planRemoteMerge(baseline, mine, theirs, opts.knownType)
        if (!isPlanEmpty(plan)) opts.graph.applyPlan(plan)
        // 基准永远跟到云端最新：下次才知道"云端这回改了没有"
        base = theirs
      } while (dirty)
    } catch (err) {
      report('实时同步失败（下次事件会再试）', err)
    } finally {
      inflight = false
      // 这轮失败时若正好有事件进来（dirty 被置位），while 已跳出、不会再跑，
      // 而"下次事件"可能永远不来（后台不再改动了）—— 那就漏了一次同步。这里补排一轮。
      if (dirty) schedule()
    }
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
    },
    stop() {
      running = false
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      unsubscribe?.()
      unsubscribe = null
    },
    isRunning: () => running,
    async refreshBase() {
      base = await readCloudSnapshot()
    },
  }
}
