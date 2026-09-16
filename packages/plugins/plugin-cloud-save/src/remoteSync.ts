/**
 * remoteSync —— 订阅服务器的实时通道，把 AI（MCP）对画布做的改动落到本地。
 *
 * ## 它在整条链路里的位置
 *
 *   MCP 工具改画布 → cloud-server 写 kv → SSE 通知 → 【本模块】读云端 → 三方合并 → 落到本地画布
 *
 * 没有它的话，用户让 AI 在画布上加个节点，屏幕上是不会变的 —— 得手动刷新浏览器。
 *
 * ## 为什么不能「收到通知就整包覆盖」
 *
 * 本插件不是「服务器唯一权威、前端只做显示」的架构（那种架构下整包覆盖没问题）：
 * 用户此刻正在本地操作，整包覆盖会冲掉刚建的节点、把正在输入的内容换回旧值。
 * 所以这里走 remoteMerge 的三方合并，只动「确实该动的」那些。
 *
 * ## 为什么不区分「是不是我自己写的」
 *
 * 不需要：本地写上去之后，云端内容就等于本地内容，三方合并自然算出「无事可做」
 * （base=mine=theirs）。用「上次同步时的云端快照」当基准，比维护一张「我发过的请求」清单
 * 更简单，也不会因为请求失败/重试而失准。
 *
 * ## 本模块的边界
 *
 * - 不认识 Vue、不认识渲染层：只调入参给的几个回调。
 * - 读写都走注入的函数（readCloud / graph），所以单测里能把云端与本地都换成假的。
 * - 零 import 工作区包（插件要打成自包含 ESM，见 vite.config.ts 的说明）。
 *
 * ## 一个已知的语义限制（与 remoteMerge 同一处，改的时候两边要一起看）
 *
 * 落地用的是本地画布的 updateNode，而它对 data 是**浅合并、不能删字段**。
 * 所以「云端少了一个 data 字段」这种局面本层表达不出来，合并层也就不产出删除 ——
 * 与其产出一个落不下去的合并结果（本地与云端静默不一致），不如保持能做到的语义。
 * 代价是**真的会漏**：云端删掉某个 data 字段时，本地不会跟着删（remoteMerge 的文件头列了
 * 会造出这种局面的几条真实路径）。要根治得让落地侧支持字段级删除。
 */
import { planRemoteMerge, isPlanEmpty, type CanvasGraphSnapshot, type MergeEdge, type MergeNode, type RemoteMergePlan } from './remoteMerge'

/** 世界最小 EventSource 形状（浏览器 EventSource 天然满足；单测给假的） */
export interface EventSourceLike {
  close(): void
  addEventListener(type: string, listener: (e: { data: string }) => void): void
  onerror?: ((e: unknown) => void) | null
}

/** 本地画布读写口（由插件接到真 graph 服务上；本模块不 import 数据层类型） */
export interface RemoteGraphHandlers {
  getNodes(): MergeNode[]
  getEdges(): MergeEdge[]
  /**
   * 把一轮合并结果落到本地画布。**整批一次应用**（不是一堆细粒度方法），
   * 好让调用方把它包进一个事务 —— AI 的一次改动在用户那里只该是一条撤销记录，
   * 否则 Ctrl+Z 要按好几下，还会退到「只改了一半」的中间状态。
   */
  applyPlan(plan: RemoteMergePlan): void
}

export interface RemoteSyncOptions {
  /** 服务根地址；空串 = 同源（cloud-server 托管界面时就是这种情况） */
  baseUrl?: string
  /** 注入 EventSource 工厂（测试用；不传用浏览器全局 EventSource） */
  createEventSource?: (url: string) => EventSourceLike
  /** 读云端某个 key（没保存过返回 undefined） */
  readCloud: (type: string, key: string) => Promise<unknown>
  /** 本地画布读写口 */
  graph: RemoteGraphHandlers
  /** 本地是否认识某个节点类型（不认识就跳过：本地渲染不了，塞进来只会是坏数据） */
  knownType: (type: string) => boolean
  /** 事件合并窗口（毫秒）。一次改动会连发几个 key 的通知，攒一小会儿只跑一轮。 */
  debounceMs?: number
  /** 出问题时报告（默认 console.warn）：实时通道断了不该影响画布继续用 */
  onError?: (message: string, err?: unknown) => void
  /** 每把一轮云端变化落到本地后回调（诊断用：想知道「AI 改完到底有没有落到本地」） */
  onApplied?: (plan: RemoteMergePlan) => void
}

export interface RemoteSync {
  /** 开始订阅（可重复调用，幂等） */
  start(): void
  /** 停止订阅并关掉连接 */
  stop(): void
  /** 是否在订阅中 */
  isRunning(): boolean
  /**
   * 把「当前云端状态」记为基准，不应用任何改动。
   *
   * 安装插件、恢复完云端数据之后必须调用一次，否则第一次收到事件时会拿着空基准去比，
   * 把云端所有节点都当成「新增」再插一遍。
   */
  refreshBase(): Promise<void>
}

/** 画布相关、值得让本地跟着动的 key（视口变化不该导致节点重装） */
const WATCHED_KEYS = new Set(['graph', 'graph-edges'])

const GRAPH_KEY = 'graph'
const GRAPH_EDGES_KEY = 'graph-edges'
const CANVAS_TYPE = 'canvas'

/** 把任意来源的节点数据收敛成本模块看得懂的最小形状（形状不对的当作没有） */
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

/** 云端那份数据 → 快照。三种历史形态都认（旧数组只存节点 / 新信封含边 / 空），与宿主恢复逻辑同款。 */
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

/** 拼实时通道地址：baseUrl 末尾斜杠去掉，避免出现 `//api` */
export function eventsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/kv/events?type=${CANVAS_TYPE}`
}

export function createRemoteSync(opts: RemoteSyncOptions): RemoteSync {
  const debounceMs = opts.debounceMs ?? 200
  const report = opts.onError ?? ((msg: string) => console.warn('[cloud-save] ' + msg))
  /** 上次同步时的云端状态：三方合并的基准（null = 还没建立过） */
  let base: CanvasGraphSnapshot | null = null
  let source: EventSourceLike | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  /** 正在跑一轮时又来了通知 → 记个标记，跑完补一轮（不丢事件也不并发） */
  let dirty = false
  let inflight = false

  async function readCloudSnapshot(): Promise<CanvasGraphSnapshot> {
    const [nodes, edges] = await Promise.all([
      opts.readCloud(CANVAS_TYPE, GRAPH_KEY),
      opts.readCloud(CANVAS_TYPE, GRAPH_EDGES_KEY),
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
        // 本地不认识的节点类型当成「云端没有」：渲染层没有对应组件，
        // 塞进来只会得到空白/报错，比「没同步过来」更难排查。
        const plan = planRemoteMerge(baseline, mine, theirs, opts.knownType)
        if (!isPlanEmpty(plan)) {
          opts.graph.applyPlan(plan)
          opts.onApplied?.(plan)
        }
        // 基准永远跟到云端最新：下次才知道「云端这回改了没有」
        base = theirs
      } while (dirty)
    } catch (err) {
      report('实时同步失败（下次事件会再试）', err)
    } finally {
      inflight = false
      // 这轮失败时若正好有事件进来（dirty 被置位），while 已跳出、不会再跑，
      // 而「下次事件」可能永远不来（AI 不再改动了）—— 那就漏了一次同步。这里补排一轮。
      if (dirty) schedule()
    }
  }

  /** 事件进来后攒一下再跑：一次改动会连发几个 key，没必要每个都读一遍整张画布 */
  function schedule(): void {
    if (!running) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void syncOnce()
    }, debounceMs)
  }

  function onMessage(e: { data?: string }): void {
    // 事件内容只用来过滤「是不是画布这个 key 变了」；真数据一律现读（服务器只报 key，不带值）
    try {
      const parsed = JSON.parse(String(e?.data ?? '')) as { type?: string; key?: string }
      if (parsed?.type !== undefined && parsed.type !== CANVAS_TYPE) return
      if (parsed?.key !== undefined && !WATCHED_KEYS.has(parsed.key)) return
    } catch {
      // 解析不了也当成「变了」处理：宁可多读一次，也不要漏掉 AI 的改动
    }
    schedule()
  }

  return {
    start() {
      if (running) return
      // 没有 EventSource（Node/测试环境）就直接不订阅，不当成错误刷告警：
      // 这不是「坏了」，而是「这个环境里没这条通道」，画布照常能用。
      if (!opts.createEventSource && typeof EventSource === 'undefined') return
      running = true
      const create = opts.createEventSource ?? ((url: string) => new EventSource(url) as unknown as EventSourceLike)
      try {
        source = create(eventsUrl(opts.baseUrl ?? ''))
        source.addEventListener('message', onMessage)
        // 断线交给 EventSource 自己重连（浏览器内置，带退避策略）
        source.onerror = () => report('实时通道断开，浏览器会自动重连')
      } catch (err) {
        // 连不上不致命：画布照常能用，只是看不到 AI 的实时改动
        report('无法订阅实时通道', err)
        // 订阅没成，就不能把自己报成「运行中」——否则状态撒谎（别人以为在实时同步），
        // 而且之后每次 start() 都会被开头的 `if (running) return` 挡掉，永远不再重试。
        running = false
      }
    },
    stop() {
      running = false
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      source?.close()
      source = null
    },
    isRunning: () => running,
    async refreshBase() {
      base = await readCloudSnapshot()
    },
  }
}
