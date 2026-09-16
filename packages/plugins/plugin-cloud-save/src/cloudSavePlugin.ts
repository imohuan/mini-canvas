/**
 * plugin-cloud-save —— 云端保存插件（把画布数据与资源落到 cloud-server）。
 *
 * ## 它替用户做了什么
 *
 * 装之前：画布在 localStorage、图片是 dataURL —— 换机器/换浏览器就没了。
 * 装之后：`canvas` / `resource` 两个域的读写换成 HTTP，数据落服务器的 `.mini-canvas/`；
 * 图片等大资源从 dataURL 搬到服务器文件，节点里只留一个稳定 URL。刷新、换浏览器都在。
 *
 * ## 为什么要在插件里自己"云端优先恢复"（而不是只换个 adapter）
 *
 * 宿主的启动顺序是：**先装插件 → 再读本地存档恢复画布**。而本插件是"后装"的
 * （画布 ready 之后由外部 js 装上），那时候本地恢复**已经做完了** —— 只换 adapter
 * 就只能读到以后写的、读不到已经存在的云端数据，等于"只写不读"。
 *
 * 所以这里不赌宿主顺序，自己把语义补全：
 *   ① 先换 adapter（此后读写都走网络）
 *   ② 从云端拉一次
 *   ③ 云端有 → 覆盖本地那份（云端优先）；云端空 → 把当前本地这份推上去（首次上云）
 *
 * 副作用：安装瞬间画面会从"本地数据"换成"云端数据"，可能闪一下。这是后装插件
 * 的固有代价；要消除得走 manifest 冷启动（宿主在恢复前就装好插件），那是另一件事。
 */
import type { ConfigSchema, Context, InferConfig, PluginModule } from '@mini-canvas/canvas-base'
import type {
  CanvasEdge,
  CanvasNode,
  AddEdgeRequest,
  GraphDocumentService,
  GraphEnvelope,
  SaveService,
  SaveType,
} from '@mini-canvas/canvas-data'
import { HttpAdapter } from './httpAdapter'
import { GraphDeltaAdapter } from './graphDeltaAdapter'
import { createRemoteSync } from './remoteSync'
import { collectUploadableFields, uploadFields, DEFAULT_MIN_UPLOAD_BYTES } from './resourceUpload'
import { GRAPH_EDGES_KEY, GRAPH_KEY, GRAPH_VIEWPORT_KEY } from './keys'

export const name = 'cloud-save'

/** 硬依赖：没有 save 就没什么可换的（graph/nodeStore/viewport 都是可选探测） */
export const inject = ['save'] as string[]

export const Config = {
  cloudSaveBaseUrl: {
    type: 'string',
    default: '',
    label: '服务地址',
    group: '常规/云端保存',
    description: 'cloud-server 的根地址。留空 = 与画布同源（由 cloud-server 托管界面时就是这种情况）。',
  },
  cloudSaveIncludeConfig: {
    type: 'boolean',
    default: false,
    label: '配置也上云',
    group: '常规/云端保存',
    description: '开启后，设置面板里的各项配置也会存到服务器（多台机器共享同一套设置）。',
  },
  cloudSaveUploadLocalImages: {
    type: 'boolean',
    default: true,
    label: '图片搬上服务器',
    group: '常规/云端保存',
    description: '把节点里内嵌的大图片（dataURL）换成服务器地址。关掉的话画布数据会很大。',
  },
  cloudSaveMinUploadKb: {
    type: 'number',
    default: 32,
    min: 0,
    max: 8192,
    step: 8,
    label: '搬运门槛 (KB)',
    group: '常规/云端保存',
    description: '小于这个大小的图片留在画布里（搬一趟的网络开销比省下的字节还贵）。',
  },
  cloudSaveRealtime: {
    type: 'boolean',
    default: true,
    label: '实时跟随 AI 改动',
    group: '常规/云端保存',
    description:
      'AI（MCP 工具）在后台改画布时，不用刷新浏览器，画面自动跟着变。关掉之后只有手动操作会保存、AI 的改动要刷新才看得见。',
  },
} satisfies ConfigSchema

export type CloudSavePluginConfig = InferConfig<typeof Config>

/** 同步状态（供 UI/console 查询"现在同步到哪一步了"） */
export interface CloudSaveStatus {
  /** 是否已切到云端后端 */
  active: boolean
  /** 最近一次操作的结果：'loading' | 'restored' | 'seeded' | 'error' */
  phase: 'loading' | 'restored' | 'seeded' | 'error'
  /** 从云端恢复的节点数（首次上云时为 0） */
  restoredNodes: number
  /** 已搬到服务器的资源字段数 */
  uploadedResources: number
  /** 失败信息（phase='error' 时） */
  error?: string
  /** 实时通道是否订阅中（AI 改画布能不能立刻看到） */
  realtime: boolean
  /** 实时同步已应用过几轮（诊断用：AI 改完到底有没有落到本地） */
  appliedRounds: number
  /** 因服务端拒绝而被跳过的保存次数（>0 说明有东西一直没能同步上去，需要查） */
  skippedSaves: number
  /** 最近一次被跳过的原因（诊断用） */
  lastSkip?: string
}

/** cloud-save 服务（ctx.get('cloud-save')）：状态查询 + 手动触发 */
export interface CloudSaveService {
  status(): CloudSaveStatus
  /**
   * 立刻把本地还没上云的东西推上去（主要是搬资源），返回最新状态。
   * **不会重新拉云端**：调用时用户多半已经改过本地数据，拉回来会覆盖掉刚做的改动。
   * 需要重新以云端为准 → 重新装载插件（install 那一次才拉）。
   */
  sync(): Promise<CloudSaveStatus>
}

/** 用到的服务（都经 ctx.get 取，缺失则该项能力自动降级） */
interface Deps {
  save: SaveService
  graph?: GraphDocumentService
  nodeStore?: { getNodes(): CanvasNode[]; updateNode(id: string, patch: { data: Record<string, unknown> }): void }
  /** 已注册的节点类型（判断云端来的节点本地认不认识；缺失则一律认） */
  knownTypes?: ReadonlyMap<string, unknown>
  /** 视口服务（渲染层注入）；只用到 setViewport，故按结构取，不 import 渲染层类型 */
  viewport?: { setViewport(v: { x: number; y: number; zoom: number }): void }
  /** 本插件挂上的 canvas 域 adapter（有它就能走批量读取口，省掉无意义的 404） */
  canvasAdapter?: HttpAdapter
}

/**
 * 从云端恢复（或把本地首次推上去）。不抛错：失败只记状态 —— 插件是后装的，
 * 在 apply 里抛出去宿主那边拿不到（apply 的 Promise 没人在等），静默失败更糟，故收敛成状态。
 */
async function restoreFromCloud(deps: Deps, status: CloudSaveStatus): Promise<void> {
  const { save, graph, nodeStore } = deps
  try {
    // 一次读回三个 key（没保存过的不出现在结果里，等价于 undefined）。
    // 逐个读语义相同，但三个 GET 里未保存的那些会各回一个 404，浏览器控制台会记
    // "加载资源失败" —— 用户看着像画布坏了。有批量口就走批量口。
    const adapter = deps.canvasAdapter
    const cloud = adapter ? await adapter.getMany([GRAPH_KEY, GRAPH_EDGES_KEY, GRAPH_VIEWPORT_KEY]) : undefined
    const cloudNodes = (adapter
      ? cloud?.[GRAPH_KEY]
      : await save.get<CanvasNode[] | GraphEnvelope>(GRAPH_KEY, 'canvas')) as CanvasNode[] | GraphEnvelope | undefined
    const cloudEdges = (adapter
      ? cloud?.[GRAPH_EDGES_KEY]
      : await save.get<CanvasEdge[]>(GRAPH_EDGES_KEY, 'canvas')) as CanvasEdge[] | undefined

    // 两个 key 都没存过 → "从未上云"：把当前这副本地数据推上去（首次上云）
    if (cloudNodes === undefined && cloudEdges === undefined) {
      const nodes = nodeStore?.getNodes() ?? []
      save.set(GRAPH_KEY, nodes, 'canvas')
      save.set(GRAPH_EDGES_KEY, graph?.getEdges() ?? [], 'canvas')
      await save.flush()
      status.phase = 'seeded'
      status.restoredNodes = 0
      return
    }

    // 三种形态都认（与宿主恢复逻辑同款）：旧数组只存节点 / 新信封含边 / 空
    let nodes: CanvasNode[] = []
    let edges: CanvasEdge[] = cloudEdges ?? []
    if (Array.isArray(cloudNodes)) nodes = cloudNodes
    else if (cloudNodes && Array.isArray(cloudNodes.nodes)) {
      nodes = cloudNodes.nodes
      edges = (cloudNodes.edges ?? []) as CanvasEdge[]
    }

    graph?.replaceAll(nodes, edges)
    await save.flush() // replaceAll 会触发提交 → 把"云端这份"再落回去（幂等，同时刷新本地存档）
    status.phase = 'restored'
    status.restoredNodes = nodes.length

    // 视口是纯视图状态：云端有就恢复（best-effort，拿不到就交给宿主的本地逻辑）
    const vp = (adapter
      ? cloud?.[GRAPH_VIEWPORT_KEY]
      : await save.get<{ x: number; y: number; zoom: number }>(GRAPH_VIEWPORT_KEY, 'canvas')) as
      | { x: number; y: number; zoom: number }
      | undefined
    if (vp && deps.viewport) deps.viewport.setViewport(vp)
  } catch (err) {
    status.phase = 'error'
    status.error = err instanceof Error ? err.message : String(err)
    console.warn('[cloud-save] 云端恢复失败：' + status.error)
  }
}

/**
 * 把节点里内嵌的资源（dataURL 图片/视频）搬到服务器，写回稳定 URL。
 * 返回搬成功几个。
 */
async function offloadResources(deps: Deps, status: CloudSaveStatus, baseUrl: string, minBytes: number): Promise<number> {
  const { graph, nodeStore } = deps
  const nodes = nodeStore?.getNodes() ?? []
  const fields = collectUploadableFields(nodes, minBytes)
  if (fields.length === 0) return 0
  const { patches, errors } = await uploadFields(fields, { baseUrl })
  for (const e of errors) console.warn(`[cloud-save] 资源上传失败 ${e.nodeId}.${e.field}: ${e.error}`)
  for (const p of patches) {
    // 走 graph（有历史 + 提交落盘）；没有 graph 的宿主退到 nodeStore 直写
    if (graph) graph.updateNode(p.nodeId, { data: p.data })
    else nodeStore?.updateNode(p.nodeId, { data: p.data })
  }
  status.uploadedResources += patches.length
  return patches.length
}

export function apply(ctx: Context, config?: CloudSavePluginConfig): void {
  const baseUrl = config?.cloudSaveBaseUrl ?? ''
  const minBytes = (config?.cloudSaveMinUploadKb ?? 32) * 1024
  const uploadResources = config?.cloudSaveUploadLocalImages !== false

  const deps: Deps = {
    save: ctx.get<SaveService>('save'),
    graph: ctx.get<GraphDocumentService | undefined>('graph') ?? undefined,
    nodeStore:
      ctx.get<Deps['nodeStore'] | undefined>('nodeStore') ?? undefined,
    viewport: ctx.get<Deps['viewport'] | undefined>('viewport') ?? undefined,
    knownTypes: ctx.get<{ types?: ReadonlyMap<string, unknown> } | undefined>('nodeStore')?.types,
  }

  const status: CloudSaveStatus = {
    active: true,
    phase: 'loading',
    restoredNodes: 0,
    uploadedResources: 0,
    realtime: false,
    appliedRounds: 0,
    skippedSaves: 0,
  }

  // ① 换 adapter —— 必须最先做，后面所有读写才走网络。
  //    config 域默认不换（设置面板留在本地：多机器共享设置往往不是用户想要的）。
  const domains: SaveType[] = config?.cloudSaveIncludeConfig
    ? ['canvas', 'resource', 'config']
    : ['canvas', 'resource']
  for (const type of domains) {
    // 画布域用「增量适配器」：宿主每次交来整张画布，若原样 PUT 会把 AI 在两
    // 次提交之间做的改动整个盖掉（AI 刚加的节点凭空消失）。它只把差异发出去。
    const adapter =
      type === 'canvas'
        ? new GraphDeltaAdapter({
            baseUrl,
            type,
            // 有项目因服务端拒绝而被跳过时记一笔：让「某个东西一直存不上」这件事可见，
            // 否则它会以「画布看着正常、只是那处改动永远不同步」的形式静默存在。
            onSkipped: ({ key, messages }) => {
              status.skippedSaves += 1
              status.lastSkip = `${key}: ${messages.join('; ')}`
            },
          })
        : new HttpAdapter({ baseUrl, type })
    deps.save.useAdapter(type, adapter)
    // 记下 canvas 域那个：恢复时走它的批量读取口（逐个 GET 会在控制台刷 404）
    if (type === 'canvas') deps.canvasAdapter = adapter
  }

  // ② + ③ 云端优先恢复（异步：不阻塞宿主 ready；失败收敛成 status）
  //
  // 串行化：安装时的这次同步、节点变化触发的同步、用户手动 sync() 可能**同时在飞**。
  // 若放任并发，两趟会各自扫到同一张还没写回的 dataURL → 同一张图被传两次
  // （白费流量；写回又是两次 updateNode → 多记两条撤销）。故这里排成一条链：
  // 后来的等前一趟跑完再跑，天然看到已写回的 URL。
  let chain: Promise<void> = Promise.resolve()
  /** 往链尾排队：保证同一时刻只有一趟在跑（顺序即调用顺序） */
  const enqueue = (job: () => Promise<void>): Promise<void> => {
    chain = chain.then(job)
    return chain
  }

  /** 只推不拉：把本地新增的内嵌资源搬上服务器。日常（节点变化/手动同步）走这条。 */
  const pushResources = (): Promise<void> =>
    enqueue(async () => {
      if (uploadResources) await offloadResources(deps, status, baseUrl, minBytes)
    })

  // 安装时这一次是唯一"拉云端"的时机：先恢复，再把恢复出来的资源搬走。
  const ready = enqueue(async () => {
    await restoreFromCloud(deps, status)
    if (uploadResources) await offloadResources(deps, status, baseUrl, minBytes)
  })

  // 之后新加进来的本地图片（上传/拖入/生成出图都会写 dataURL）也自动搬走。
  // 防抖合并 + 写回后 URL 不再是 dataURL，因此不会自己触发自己。
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  const offNodes = deps.nodeStore
    ? subscribeNodeStore(ctx, () => {
        if (disposed || !uploadResources) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          if (disposed) return
          void pushResources()
        }, 800)
      })
    : undefined

  // ==================== 实时跟随：AI（MCP）改完画布，本地自动跟着变 ====================
  //
  // 没有这一段，用户让 AI 加个节点，屏幕上不会动 —— 得手动刷新浏览器才看得到。
  // 通道是 cloud-server 的 SSE（/api/kv/events），落到本地时走三方合并（见 remoteSync）。
  //
  // 没有 graph 就不订阅：合并出来的结果只能经 graph 落地（有历史、能落盘），
  // 订阅了也应用不了 —— 那会让状态谎报「已在实时同步」，比不订阅更误导。
  const realtime =
    config?.cloudSaveRealtime === false || !deps.graph
      ? null
      : createRemoteSync({
          baseUrl,
          readCloud: (type, key) => deps.save.get(key, type as SaveType),
          graph: {
            getNodes: () => (deps.graph?.getNodes() ?? deps.nodeStore?.getNodes() ?? []) as never,
            getEdges: () => (deps.graph?.getEdges() ?? []) as never,
            // 整批包进一个事务：AI 的一次改动，在用户那里就是一条撤销记录
            applyPlan: (plan) => {
              const g = deps.graph
              // 没有 graph（老宿主）就没法落地：静默返回，并**不**让 onApplied 记成已应用
              if (!g) return
              g.transaction('云端/AI 改动', () => {
                g.removeEdges(plan.removeEdgeIds)
                g.removeNodes(plan.removeNodeIds)
                // 「认不认识这个类型」的过滤已在合并层做过（见 remoteSync 的 knownType）
                if (plan.addNodes.length > 0) {
                  g.addNodes(
                    plan.addNodes.map((n) => ({
                      id: n.id,
                      type: n.type,
                      position: n.position,
                      data: n.data,
                      ...(n.parentId !== undefined ? { parentId: n.parentId } : {}),
                      ...(n.size !== undefined ? { size: n.size } : {}),
                    })),
                  )
                }
                for (const n of plan.updateNodes) {
                  if (!g.getNode(n.id)) continue
                  // 合并层算出来的是「这个节点最终该长什么样」，所以 position/data/size/parentId
                  // 一并交出去。数据层的 data 是浅合并语义，但合并结果本就包含本地原有的 key，
                  // 合出来就是这份结果（MCP 侧同样只做合并，不会删掉单个 data 字段）。
                  g.updateNode(n.id, {
                    position: n.position,
                    data: { ...n.data },
                    ...(n.size !== undefined ? { size: { ...n.size } } : {}),
                    ...(n.parentId !== undefined ? { parentId: n.parentId } : {}),
                  })
                }
                for (const e of plan.updateEdges) {
                  g.removeEdges([e.id])
                  // 远端合并的边也过守门人：远端图同样不该出现自连/成环/类型不符的脏边。
                  // 注意 update 场景刚 remove 过同 id，connectEdge 的 duplicate 判定不会误伤。
                  g.connectEdge(toEdgeRequest(e))
                }
                for (const e of plan.addEdges) g.connectEdge(toEdgeRequest(e))
              })
            },
          },
          knownType: (type) => isKnownType(deps, type),
          onApplied: () => {
            status.appliedRounds += 1
          },
        })

  // 订阅要等安装时那次「云端恢复」跑完：否则会拿空基准比一次，
  // 把云端已有的节点全当成新增、又往本地插一遍。
  void ready.then(async () => {
    if (!realtime || disposed) return
    try {
      await realtime.refreshBase()
      realtime.start()
      status.realtime = realtime.isRunning()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[cloud-save] 实时通道建立失败（画布照常可用）：' + msg)
    }
  })

  // 上架状态服务：宿主/console 可查"同步到哪一步了"，也能手动再同步一次
  const service: CloudSaveService = {
    status: () => ({ ...status }),
    async sync() {
      // 注意：**不重新拉云端**。手动同步发生在用户已经在本地改了东西之后，
      // 这时用云端版本覆盖本地会把用户刚做的改动抹掉。所以只做"上行"。
      await pushResources()
      return { ...status }
    },
  }
  ctx.inject('cloud-save', service)
  // 让 UI/脚本能拿到（也便于在浏览器 console 里查状态）
  ctx.effect(() => () => {
    disposed = true
    if (timer) clearTimeout(timer)
    offNodes?.()
    realtime?.stop()
  })
}

/**
 * 订阅 nodeStore 变化。
 * nodeStore 的 subscribe 是数据层的老 API（不经 ctx 事件），故单独包一层取；
 * 取不到就退化成"只在安装时扫一次"，不报错。
 */
function subscribeNodeStore(ctx: Context, cb: () => void): (() => void) | undefined {
  const store = ctx.get<{ subscribe?(l: () => void): () => void } | undefined>('nodeStore')
  return store?.subscribe?.(cb)
}

/**
 * 本地认不认识某个节点类型。
 *
 * 不认识就别往画布里塞（插件没装、类型已注销）：渲染层没有对应组件，
 * 加进去只会得到一片空白/报错，比「没同步过来」更难排查。
 * 取不到类型表（宿主没按结构暴露）时一律认，与既有行为对齐。
 */
function isKnownType(deps: Deps, type: string): boolean {
  const types = deps.knownTypes
  if (!types) return true
  return types.has(type)
}

/** 合并层的边 → 数据层 addEdge 入参（只映射两边都认的字段） */
function toEdgeRequest(e: {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  type?: string
  data?: Record<string, unknown>
}): AddEdgeRequest {
  return {
    source: e.source,
    target: e.target,
    ...(e.type !== undefined ? { type: e.type } : {}),
    ...(e.sourceHandle !== undefined ? { sourceHandle: e.sourceHandle } : {}),
    ...(e.targetHandle !== undefined ? { targetHandle: e.targetHandle } : {}),
    ...(e.data !== undefined ? { data: { ...e.data } } : {}),
  }
}

/** 兼容旧装配的 PluginModule 出口 */
export const cloudSavePlugin: PluginModule = { name, inject, Config, apply }
