/**
 * standardCapabilities —— 宿主提供的**标准能力包**（设计文档 §4.5「capability」/ 案例 5 / 决策 9）。
 *
 * 为什么要有标准能力包：作者抱怨的"组件里得重复实现一堆通用 hooks"——读节点、改节点、
 * 看缩放、看选中、调工具、读上游、加媒体，这些事每个节点插件都在各写一份。宿主把它们
 * 注册进 registryOf('capability')，插件只需在 attach 里写 needs: ['node','zoom']。
 *
 * 与决策 9 的关系：
 * - ① 谁有权注册：不设限 —— 任何插件都能注册同名能力（order 小者赢，主题插件因此能整套换掉）。
 *   本模块只是**宿主那一份**的默认实现，不是唯一入口。
 * - ② 实例作用域：工厂每节点调一次（由消费方组件回收，见 createCapabilityCache）。
 * - ③ 缺项行为：本模块不参与 —— 由 createCapabilityCache 按 ctx.isDev 裁决。
 */
import type { Ref } from 'vue'
import type { CapabilityFactory } from './capabilities'
import {
  buildParentIndex,
  collectAncestors,
  isTransient,
  readDataPort,
  topoOrderFrom,
  upstreamDepth,
} from '@mini-canvas/canvas-data'
import type {
  Context,
  DataPortDef,
  GraphEdgeLike,
  GraphNodeLike,
  ResourcePutOptions,
  UpstreamGraphInput,
  UpstreamTraversalOptions,
} from '@mini-canvas/canvas-data'
import {
  placeAdjacent,
  type PlacementRect,
  type PlacementSide,
  type PlacementSize,
} from '../media/placement'
import type { FlowRect } from '../geometry/visibleArea'
import { viewportRectInFlow } from '../geometry/visibleArea'

/** node 能力：本节点的身份 / 数据 / 写回 */
export interface NodeCapability {
  readonly id: string
  readonly type: string
  /** 节点数据（活引用：外部改 data 这里立刻看得到） */
  readonly data: Readonly<Ref<Record<string, unknown>>>
  /** 当前标题（data.label；没设过 = undefined，调用方自行回落 type） */
  label(): string | undefined
  /** 就地改名（写回走唯一图写入口，自动进历史 + 落盘） */
  setLabel(label: string | undefined): void
  /** 写回任意 data 字段（同一个 patch = 一条历史） */
  update(patch: Record<string, unknown>): void
}

/** zoom 能力：读当前缩放 + 控制视口 */
export interface ZoomCapability {
  /** 当前缩放（活引用；已防零） */
  readonly zoom: Readonly<Ref<number>>
  /** 当前视口（x/y/zoom 快照） */
  viewport(): { x: number; y: number; zoom: number }
  zoomIn(): void
  zoomOut(): void
  zoomTo(level: number): void
  fitView(): void
  /** 把视图中心挪到某画布坐标（保留当前缩放） */
  centerOn(x: number, y: number): void
}

/** selected 能力：本节点的选中态 */
export interface SelectedCapability {
  /** 是否在选中集里（活引用） */
  readonly selected: Readonly<Ref<boolean>>
  /** 是否被**单独**选中（恰好一个且就是我；操作栏显隐的既有语义，活引用） */
  readonly solo: Readonly<Ref<boolean>>
}

/** tools 能力：调 ctx.tools 里的生成工具（文生图/图生文…），插件零 import */
export interface ToolsCapability {
  list(): Array<{ name: string; title?: string; description?: string; group?: string; produces?: string }>
  invoke(name: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>
}

/**
 * selection 能力：当前"选中的是哪一批"（多选框上的按钮用 —— 它不是某一个节点，是一批）。
 *
 * 与 SelectedCapability（"我（某个节点）是否被选中"）的区别：这个是**读者视角看整个选择集**，
 * 给多选框区域栏用。两者名字相邻但语义不同：selected 回答"我在不在里面"，selection 回答"里面有谁"。
 *
 * 为什么是方法（ids()/nodes()）而不是只读 Ref：选择集是多选框区域的**跨条目共享**输入，
 * 每帧都可能变；方法式快照让调用方在它真正需要的那一刻取值，避免把一份会变的值烘进注册时。
 */
export interface SelectionCapability {
  /** 当前选中的节点 id 列表（快照） */
  ids(): string[]
  /** 当前选中的节点对象列表（按 id 从 doc 取；快照） */
  nodes(): Array<{ id: string; type: string }>
}

/**
 * 上游节点（upstream 能力返回的只读视图）。
 *
 * 与"直接读 doc.getNode()"的区别：这里只暴露节点类型**声明过的**产出（produces），
 * 不把整包 data 交给消费方。字段改名只会改节点类型一处，消费方通过 outputs 取。
 *
 * 可以继续向上：每个 UpstreamNode 自己也有 upstream() / ancestors() / depth()，
 * 三层、五层、任意多层都能按需展开（实现是迭代 + 去重，不会爆栈）。
 */
export interface UpstreamNode {
  readonly id: string
  readonly type: string
  /** 该节点类型声明过的产出（produces 投影；未声明 = 空对象） */
  readonly outputs: Readonly<Record<string, unknown>>
  /** 这个节点自己的直接上游（source → 它） */
  upstream(options?: UpstreamTraversalOptions): UpstreamNode[]
  /** 整个祖先集合（去重，不含自己） */
  ancestors(options?: UpstreamTraversalOptions): UpstreamNode[]
  /** 到最远祖先的最大层数（直接上游 = 1；无上游 = 0） */
  depth(options?: UpstreamTraversalOptions): number
}

/** 上游的一个媒体产出（只给资源引用，不给解析后的地址） */
export interface UpstreamMedia {
  kind: string
  /** 持久资源引用（写进节点 data 的那个 ID） */
  resourceId: string
  width?: number
  height?: number
}

/**
 * upstream 能力：按当前节点读取上游数据。
 *
 * 为什么按节点创建：它回答的是"连进**我**这个节点的上游是谁、给了什么"。
 * 同一个组件（例如生成面板）在不同节点上要读不同上游，按节点实例化才不会串。
 */
export interface UpstreamCapability {
  /** 直接上游（边 source → 本节点 target；默认跳过分组与中间态） */
  nodes(): UpstreamNode[]
  /** 直接上游里，节点类型声明了产出该 kind 的那些 */
  ofType(kind: string): UpstreamNode[]
  /**
   * 取本节点某个 consumes 槽的第一项媒体。
   * 本节点类型没声明该槽、或上游没产出同 kind 的资源 → undefined。
   */
  /**
   * 取本节点某个 consumes 槽的媒体。
   * @param ordinal 同一槽有多个候选时取第几个（从 0 起；缺省 0 = 第一条连线）。
   */
  media(slot: string, ordinal?: number): UpstreamMedia | undefined
  /** 按边序拼接上游文本（节点类型声明了 produces.text 才读得到） */
  text(separator?: string): string
  /** 节点/边变化时通知；返回取消订阅函数 */
  subscribe(fn: () => void): () => void
  /**
   * 从本节点倒推整个依赖闭包，按拓扑序返回：最早依赖在前、本节点最后。
   * 分叉/菱形只出现一次。执行插件用这个顺序跑节点。
   */
  closure(options?: UpstreamTraversalOptions): UpstreamNode[]
  /** 与 closure 相同的拓扑序，只返回 id */
  order(options?: UpstreamTraversalOptions): string[]
}

/**
 * 媒体创建器注册场：键 = kind（image / video / audio / …），值 = 该 kind 的创建/写回实现。
 *
 * 为什么用注册场而不是服务名：加一种媒体类型只需要往这里放一条，调用方不必知道
 * "图片插件叫什么、它的方法签名是什么"。同 kind 多个提供方按 order 取赢家（与能力场一致）。
 */
export const MEDIA_CREATOR_FIELD = 'media/creator'

/** 媒体种类（与连接层 content type 同词表；允许插件扩展自定义字符串） */
export type MediaKind = string

/** media.addNode 的可选项（尺寸/宽高等由目标节点类型的创建器负责测量并写入） */
export interface MediaAddOptions {
  /** 指定具体节点类型（缺省由创建器自己决定） */
  nodeType?: string
  /** 一并交给创建器的元数据（来源、文件名等；创建器自己解释） */
  meta?: Record<string, unknown>
  /**
   * 源节点 id：新节点是它下游时给出（例如裁剪/剪辑/截图的结果）。
   *
   * 给了它，位置改成**按源节点自动找空位**（右 → 下 → 左 → 上，避让已有节点并留在视口内）；
   * 同时创建一个节点并连一条边，让一条撤销就退回“新节点 + 连线”。
   * 不给则沿用调用方传的 position（旧行为，保持兼容）。
   */
  sourceNodeId?: string
  /** 新节点与源节点的间距（缺省 40） */
  gap?: number
  /** 优先方向；缺省 auto = 右 → 下 → 左 → 上 */
  side?: PlacementSide
}

/** 创建器收到的"放一个媒体节点"请求 */
export interface MediaCreateRequest {
  kind: MediaKind
  /** 持久资源引用（不是地址） */
  resourceId: string
  position: { x: number; y: number }
  nodeType?: string
  meta?: Record<string, unknown>
}

/** 创建器收到的"把媒体写进已有节点"请求 */
export interface MediaApplyRequest {
  kind: MediaKind
  nodeId: string
  /** 目标节点 produces 里的槽名（由目标节点类型声明持久字段） */
  slot: string
  resourceId: string
  meta?: Record<string, unknown>
}

/**
 * 某一种媒体的创建器。
 *
 * addNode 负责"在画布上新建一个能承载该媒体的节点"；applyToNode 负责"写进已有节点"。
 * 两个都可有可无：只读的媒体类型可以只实现其中一个。
 */
export interface MediaKindCreator {
  addNode?(request: MediaCreateRequest): string | undefined
  applyToNode?(request: MediaApplyRequest): boolean
}

/**
 * media 能力：跨插件"加媒体"的唯一入口。
 *
 * 三条硬规则：
 * 1. put 只回持久引用（ID），不回解析后的地址；地址统一由 resolve 现取。
 * 2. addNode/applyToNode 只收 ID，不直接写节点 data 的字段；字段由目标节点类型自己写。
 * 3. 没装对应 kind 的创建器 → addNode 返回 undefined / applyToNode 返回 false，不静默建孤儿节点。
 */
export interface MediaCapability {
  /** 存一段字节，返回持久引用（ID） */
  put(blob: Blob, opts?: ResourcePutOptions): Promise<string>
  /** 持久引用 → 当前可显示地址（本地/云端差异只在资源服务内部） */
  resolve(id: string): Promise<string | undefined>
  /** 放一个媒体节点；该 kind 没有创建器 → undefined */
  addNode(
    kind: MediaKind,
    resourceId: string,
    position: { x: number; y: number },
    opts?: MediaAddOptions,
  ): string | undefined
  /**
   * 把媒体写进已有节点。slot 是目标节点类型 produces 的槽名；
   * 没声明该槽或没装对应 kind 的创建器 → false。
   */
  applyToNode(
    nodeId: string,
    slot: string,
    resourceId: string,
    meta?: Record<string, unknown>,
  ): boolean
  /** 当前能放的媒体种类（已注册且实现了 addNode 的 kind，按字典序） */
  available(): MediaKind[]
}

/** 本文件用到的 doc 服务最小形状（只读 + 订阅；不依赖完整 DocService） */
interface UpstreamDocNode {
  id: string
  type: string
  data?: Record<string, unknown>
  /** 节点自身坐标（落点回退用；分组子节点这里只用于“没有 nodeLayout 时”的近似） */
  position?: { x: number; y: number }
}

interface UpstreamDocEdge {
  source: string
  target: string
  data?: Record<string, unknown>
}

interface UpstreamTypeDef {
  produces?: Record<string, DataPortDef>
  consumes?: Record<string, DataPortDef>
  /** 节点没有自己的尺寸时用的默认尺寸（落点算法据此算新节点外框） */
  defaultSize?: { w: number; h: number }
}

interface UpstreamDoc {
  getNodes(): UpstreamDocNode[]
  getEdges(): UpstreamDocEdge[]
  getNode(id: string): UpstreamDocNode | undefined
  subscribe(fn: () => void): () => void
  readonly types?: ReadonlyMap<string, UpstreamTypeDef>
}

/** 资源服务最小形状（put/resolve；其余方法本能力不用） */
interface ResourceLike {
  put(blob: Blob, opts?: ResourcePutOptions): Promise<string>
  resolve(id: string): Promise<string | undefined>
}

/** 落点算法需要的 doc 最小面（读节点、类型默认尺寸、事务内连边） */
interface PlacementDoc extends UpstreamDoc {
  transaction<T>(reason: string, fn: (tx: {
    connectEdge(input: {
      source: string
      target: string
      sourceHandle?: string
      targetHandle?: string
    }): { edgeId: string; status: 'ok' | 'rejected' | 'duplicate' }
    removeNodes(ids: string[]): number
  }) => T): T
}

interface PlacementLayout {
  getNodeRect(id: string): { x: number; y: number; w: number; h: number } | null
  getAllRects(): Array<{ id: string; x: number; y: number; w: number; h: number }>
  nodeSize(id: string): { w: number; h: number }
}

interface PlacementViewport {
  getViewport(): { x: number; y: number; zoom: number }
  getPaneEl?(): HTMLElement | null
  getRendererEl?(): HTMLElement | null
}

/** 取 doc；宿主没装或取不到 → undefined（上游能力按"没有上游"处理，不抛） */
function upstreamDocOf(ctx: Context): UpstreamDoc | undefined {
  try {
    return ctx.get('doc') as unknown as UpstreamDoc | undefined
  } catch {
    return undefined
  }
}

/** 取资源服务；没装 → undefined */
function resourceServiceOf(ctx: Context): ResourceLike | undefined {
  try {
    return ctx.get('resources') as unknown as ResourceLike | undefined
  } catch {
    return undefined
  }
}

/** 取可选服务（命名空间统一收口，避免每个能力各写一遍 try/catch） */
function tryService<T>(ctx: Context, name: string): T | undefined {
  try {
    return ctx.get<T | undefined>(name)
  } catch {
    return undefined
  }
}

/** 当前可视区（flow 坐标）；拿不到 pane 尺寸时返回 null（落点算法会退化成只避让节点） */
function visibleRectOf(viewport: PlacementViewport | undefined): FlowRect | null {
  if (!viewport) return null
  const pane = viewport.getPaneEl?.() ?? viewport.getRendererEl?.()
  if (!pane) return null
  const w = pane.clientWidth
  const h = pane.clientHeight
  if (!(w > 0) || !(h > 0)) return null
  try {
    return viewportRectInFlow(viewport.getViewport(), w, h)
  } catch {
    return null
  }
}

/** 取媒体创建器场；宿主没装 registryOf → undefined */
function mediaCreatorFieldOf(ctx: Context) {
  try {
    return ctx.registryOf<MediaKindCreator>(MEDIA_CREATOR_FIELD)
  } catch {
    return undefined
  }
}

/**
 * 从 doc 现取一张图。
 *
 * 每次调用都重新读：节点/边随时可能变，缓存住会读到过期上游。
 * 中间态节点默认整条排除（它的入边/出边都不算数据依赖）；边上的中间态标记由 upstreamGraph 处理。
 */
function upstreamGraphOf(
  doc: UpstreamDoc,
  options: UpstreamTraversalOptions = {},
): UpstreamGraphInput {
  // 极简宿主/单测替身可能只实现了 getNode（没有 getNodes/getEdges）：
  // 上游能力按“读不到图 = 没有上游”处理，不能让组件因为缺一个方法就崩。
  const nodes = typeof doc.getNodes === 'function' ? (doc.getNodes() as GraphNodeLike[]) : []
  const rawEdges = typeof doc.getEdges === 'function' ? (doc.getEdges() as GraphEdgeLike[]) : []
  if (options.includeTransient === true) return { nodes, edges: rawEdges }
  const transientIds = new Set<string>()
  for (const node of nodes) if (isTransient(node)) transientIds.add(node.id)
  if (transientIds.size === 0) return { nodes, edges: rawEdges }
  return {
    nodes,
    edges: rawEdges.filter((e) => !transientIds.has(e.source) && !transientIds.has(e.target)),
  }
}

/** 一次读取的快照：doc + 图 + id→节点 */
interface UpstreamSnapshot {
  doc: UpstreamDoc | undefined
  graph: UpstreamGraphInput
  byId: Map<string, UpstreamDocNode>
}

/**
 * 造上游能力实例（每节点一份，由 createCapabilityCache 管生命周期）。
 *
 * 所有遍历都复用 canvas-data 的纯函数（buildParentIndex / collectAncestors /
 * topoOrderFrom / upstreamDepth），前端与后台因此算出同一顺序；本文件不自己 DFS。
 */
export function createUpstreamCapability(
  ctx: Context,
  self: { id: string; type: string },
): UpstreamCapability {
  const snapshot = (options?: UpstreamTraversalOptions): UpstreamSnapshot => {
    const doc = upstreamDocOf(ctx)
    if (!doc) return { doc: undefined, graph: { nodes: [], edges: [] }, byId: new Map() }
    const graph = upstreamGraphOf(doc, options)
    const byId = new Map<string, UpstreamDocNode>()
    for (const node of graph.nodes) byId.set(node.id, node)
    return { doc, graph, byId }
  }

  /** 某节点类型的 produces 表（没注册类型 = 空） */
  const producesOf = (snap: UpstreamSnapshot, node: UpstreamDocNode): Record<string, DataPortDef> =>
    snap.doc?.types?.get(node.type)?.produces ?? {}

  const makeNode = (snap: UpstreamSnapshot, node: UpstreamDocNode): UpstreamNode => {
    const outputs: Record<string, unknown> = {}
    for (const [slot, def] of Object.entries(producesOf(snap, node))) {
      const value = readDataPort(node, def)
      if (value !== undefined) outputs[slot] = value
    }
    return {
      id: node.id,
      type: node.type,
      outputs: Object.freeze(outputs),
      upstream: (options) => directNodes(node.id, options),
      ancestors: (options) => ancestorNodes(node.id, options),
      depth: (options) => {
        return upstreamDepth(snapshot(options).graph, node.id, options)
      },
    }
  }

  /** 直接上游 id（去重、保边序；去掉自连） */
  const directIds = (
    snap: UpstreamSnapshot,
    id: string,
    options?: UpstreamTraversalOptions,
  ): string[] =>
    [...(buildParentIndex(snap.graph, options).get(id) ?? [])].filter((pid) => pid !== id)

  const directNodes = (id: string, options?: UpstreamTraversalOptions): UpstreamNode[] => {
    const snap = snapshot(options)
    const out: UpstreamNode[] = []
    for (const pid of directIds(snap, id, options)) {
      const node = snap.byId.get(pid)
      if (node) out.push(makeNode(snap, node))
    }
    return out
  }

  const ancestorNodes = (id: string, options?: UpstreamTraversalOptions): UpstreamNode[] => {
    const snap = snapshot(options)
    const out: UpstreamNode[] = []
    for (const aid of collectAncestors(snap.graph, id, options)) {
      if (aid === id) continue // 环里的回边可能把起点收进来；ancestors 的语义是不含自己
      const node = snap.byId.get(aid)
      if (node) out.push(makeNode(snap, node))
    }
    return out
  }

  return {
    nodes: () => directNodes(self.id),

    ofType: (kind) => {
      const snap = snapshot()
      return directIds(snap, self.id)
        .map((pid) => snap.byId.get(pid))
        .filter((node): node is UpstreamDocNode => node !== undefined)
        .filter((node) =>
          Object.values(producesOf(snap, node)).some((def) => def.kind === kind),
        )
        .map((node) => makeNode(snap, node))
    },

    media: (slot, ordinal = 0) => {
      const snap = snapshot()
      const consume = snap.doc?.types?.get(self.type)?.consumes?.[slot]
      if (!consume) return undefined
      let hit = 0
      for (const pid of directIds(snap, self.id)) {
        const node = snap.byId.get(pid)
        if (!node) continue
        for (const def of Object.values(producesOf(snap, node))) {
          // 媒体槽必须是资源引用；普通值槽（text/json）不是 media 的职责
          if (def.kind !== consume.kind || !def.refField) continue
          const value = readDataPort(node, def)
          if (typeof value === 'string' && value !== '') {
            if (hit === ordinal) return { kind: def.kind, resourceId: value }
            hit += 1
          }
        }
      }
      return undefined
    },

    text: (separator = '\n') => {
      const snap = snapshot()
      const parts: string[] = []
      for (const pid of directIds(snap, self.id)) {
        const node = snap.byId.get(pid)
        if (!node) continue
        for (const def of Object.values(producesOf(snap, node))) {
          if (def.kind !== 'text' || !def.valueField) continue
          const value = readDataPort(node, def)
          if (typeof value === 'string' && value !== '') {
            parts.push(value)
            break // 同一节点只取第一个文本产出，避免多个槽重复拼接
          }
        }
      }
      return parts.join(separator)
    },

    subscribe: (fn) => {
      const doc = upstreamDocOf(ctx)
      if (!doc) return () => {}
      const off = doc.subscribe(() => fn())
      return () => off()
    },

    closure: (options) => {
      const snap = snapshot(options)
      const out: UpstreamNode[] = []
      for (const id of topoOrderFrom(snap.graph, self.id, options)) {
        const node = snap.byId.get(id)
        if (node) out.push(makeNode(snap, node))
      }
      return out
    },

    order: (options) => {
      const snap = snapshot(options)
      return topoOrderFrom(snap.graph, self.id, options)
    },
  }
}

/**
 * 造媒体能力实例。
 *
 * 它不自己存字节、不自己建节点：put/resolve 转发资源服务；addNode/applyToNode 按 kind
 * 路由到 registryOf('media/creator') 里注册的节点创建器。所有服务都在调用时现取，
 * 于是热换资源后端/热装节点插件立刻生效。
 */
export function createMediaCapability(ctx: Context): MediaCapability {
  return {
    put: (blob, opts) => {
      const resources = resourceServiceOf(ctx)
      if (typeof resources?.put !== 'function') {
        return Promise.reject(
          new Error('[capability] media.put 不可用：本宿主没装 ctx.resources（资源服务）'),
        )
      }
      // 只转发持久引用；不在这里把引用换成地址（那是 resolve 的职责）
      return resources.put(blob, opts)
    },

    resolve: (id) => {
      const resources = resourceServiceOf(ctx)
      if (typeof resources?.resolve !== 'function') return Promise.resolve(undefined)
      return resources.resolve(id)
    },

    addNode: (kind, resourceId, position, opts) => {
      const creator = mediaCreatorFieldOf(ctx)?.top(kind)?.value
      if (typeof creator?.addNode !== 'function') return undefined
      const request = {
        kind,
        resourceId,
        position,
        nodeType: opts?.nodeType,
        meta: opts?.meta,
      }

      // 没给源节点 = 旧行为：调用方算好坐标直接建，不擅自挪位置
      if (!opts?.sourceNodeId) return creator.addNode(request)

      const doc = upstreamDocOf(ctx) as PlacementDoc | undefined
      const sourceId = opts.sourceNodeId
      const source = doc?.getNode(sourceId)
      if (!doc || !source) return creator.addNode(request)

      // Spec 3.1：nodeLayout/viewport 已合并到 view；旧名只留给降级/旧宿主。
      const layout = tryService<PlacementLayout>(ctx, 'view') ?? tryService<PlacementLayout>(ctx, 'nodeLayout')
      const viewport = tryService<PlacementViewport>(ctx, 'view') ?? tryService<PlacementViewport>(ctx, 'viewport')
      const targetType = opts.nodeType ?? kind
      const typeSize = doc.types?.get(targetType)?.defaultSize
      const sourceRect = layout?.getNodeRect(sourceId) ?? {
        id: sourceId,
        x: source.position?.x ?? 0,
        y: source.position?.y ?? 0,
        w: layout?.nodeSize(sourceId).w ?? typeSize?.w ?? 320,
        h: layout?.nodeSize(sourceId).h ?? typeSize?.h ?? 240,
      }
      const obstacles: PlacementRect[] = layout?.getAllRects() ?? doc.getNodes().map((node) => ({
        id: node.id,
        x: node.position?.x ?? 0,
        y: node.position?.y ?? 0,
        w: doc.types?.get(node.type)?.defaultSize?.w ?? 320,
        h: doc.types?.get(node.type)?.defaultSize?.h ?? 240,
      }))
      const targetSize: PlacementSize = typeSize ?? { w: 320, h: 240 }
      const placed = placeAdjacent({
        size: targetSize,
        source: sourceRect,
        // 源节点也算障碍：没有这条，视口太小时网格搜索会把新节点压在源节点身上。
        obstacles,
        visible: visibleRectOf(viewport),
        ...(opts.gap !== undefined ? { gap: opts.gap } : {}),
        ...(opts.side !== undefined ? { side: opts.side } : {}),
      })

      // 建节点 + 连边包在同一个事务里：用户按一次撤销整体退回（creator 内部事务会嵌套合并）
      try {
        return doc.transaction('media-add-node', (tx) => {
          const nodeId = creator.addNode!({ ...request, position: placed })
          if (!nodeId) return undefined
          const edge = tx.connectEdge({
            source: sourceId,
            target: nodeId,
            sourceHandle: 'source',
            targetHandle: 'target',
          })
          // 连不上（类型不符/容量拒绝）就不留孤儿节点 —— 这个入口承诺的是“节点 + 连线”
          if (edge.status === 'rejected') {
            tx.removeNodes([nodeId])
            return undefined
          }
          return nodeId
        })
      } catch {
        return undefined
      }
    },

    applyToNode: (nodeId, slot, resourceId, meta) => {
      const doc = upstreamDocOf(ctx)
      const node = doc?.getNode(nodeId)
      if (!node) return false
      // 槽的 kind 由目标节点类型自己声明（produces）；调用方不需要再猜一遍
      const def = doc?.types?.get(node.type)?.produces?.[slot]
      if (!def) return false
      const creator = mediaCreatorFieldOf(ctx)?.top(def.kind)?.value
      if (typeof creator?.applyToNode !== 'function') return false
      return creator.applyToNode({ kind: def.kind, nodeId, slot, resourceId, meta }) === true
    },

    available: () => {
      const field = mediaCreatorFieldOf(ctx)
      if (!field) return []
      return field
        .keys()
        .filter((kind) => typeof field.top(kind)?.value.addNode === 'function')
        .sort()
    },
  }
}

/**
 * 给**插件代码**（apply / 命令 / 纯逻辑层）取 media 能力。
 *
 * media 是 `registryOf('capability')` 里的能力工厂，不是 ctx 服务：
 * `ctx.tryGet('media')` 永远拿不到（风格库 2026-10-23 踩过这个坑）。
 * 画布级代码没有“当前节点”，这里给工厂一个只带 ctx 的最小上下文 ——
 * put/resolve/addNode 都只读 ctx，不读节点 data，够用。
 */
export function mediaCapabilityOf(ctx: Context): MediaCapability | undefined {
  try {
    const factory = ctx.registryOf<CapabilityFactory>('capability').top('media')?.value
    if (typeof factory !== 'function') return undefined
    return factory({ ctx } as never) as MediaCapability
  } catch {
    return undefined
  }
}

/**
 * 造宿主的标准四件（在 createMiniCanvasHost 里注册进 registryOf('capability')）。
 *
 * 只依赖 ctx（与传入的节点上下文），不 import 任何节点插件 —— 保持"渲染层不认识业务节点"的边界。
 */
export function createStandardCapabilities(ctx: Context): Record<string, CapabilityFactory> {
  const viewportOf = () =>
    ctx.get<
      | {
          getViewport(): { x: number; y: number; zoom: number }
          zoomIn(): void
          zoomOut(): void
          zoomTo(level: number): void
          fitView(padding?: number): void
          setCenter(x: number, y: number, zoom?: number): void
        }
      | undefined
    >('view')
  const toolsOf = () =>
    ctx.get<
      | {
          list(): Array<{ name: string; title?: string; description?: string; group?: string; produces?: string }>
          invoke(name: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>
        }
      | undefined
    >('tools')

  return {
    // 本节点：身份 / 数据 / 写回
    node: (n): NodeCapability => ({
      id: n.id,
      type: n.type,
      data: n.data,
      label: () => {
        const v = n.data.value?.label
        return typeof v === 'string' && v.length > 0 ? v : undefined
      },
      setLabel: (label) => n.update({ label }),
      update: (patch) => n.update(patch),
    }),

    // 缩放 / 视口控制
    zoom: (n): ZoomCapability => ({
      zoom: n.zoom,
      viewport: () => viewportOf()?.getViewport() ?? { x: 0, y: 0, zoom: n.zoom.value },
      zoomIn: () => viewportOf()?.zoomIn(),
      zoomOut: () => viewportOf()?.zoomOut(),
      zoomTo: (level) => viewportOf()?.zoomTo(level),
      fitView: () => viewportOf()?.fitView(),
      centerOn: (x, y) => viewportOf()?.setCenter(x, y, n.zoom.value),
    }),

    // 选中态（读者视角：只看自己，不改选中集 —— 改选中集属 selection 服务的事）
    selected: (n): SelectedCapability => ({ selected: n.selected, solo: n.solo }),

    // 选择集（读者视角：看"选中的是哪一批"；多选框区域栏的按钮用）。
    // 与上面 selected 的区别：那个回答"我在不在里面"，这个回答"里面有谁"。
    selection: (): SelectionCapability => {
      const idsOf = (): string[] => {
        const s = ctx.get<{ ids: ReadonlySet<string> } | undefined>('selection')
        return s ? [...s.ids] : []
      }
      return {
        ids: idsOf,
        nodes: () => {
          const ids = new Set(idsOf())
          if (ids.size === 0) return []
          const doc = ctx.get<{ getNodes(): Array<{ id: string; type: string }> } | undefined>('doc')
          return (doc?.getNodes() ?? [])
            .filter((n) => ids.has(n.id))
            .map((n) => ({ id: n.id, type: n.type }))
        },
      }
    },

    // 生成工具：转发 ctx.tools（缺失时给空表 + 明确错误，不静默假装成功）
    tools: (): ToolsCapability => ({
      list: () => (toolsOf()?.list() ?? []).map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        group: t.group,
        produces: t.produces,
      })),
      invoke: (name, input, options) => {
        const tools = toolsOf()
        if (!tools) {
          return Promise.reject(
            new Error('[capability] tools 能力不可用：本宿主没装 ctx.tools（生成工具注册表）'),
          )
        }
        return tools.invoke(name, input, options)
      },
    }),

    // 上游数据：按当前节点读它连进来的节点（可继续向上，支持倒推执行顺序）
    upstream: (n): UpstreamCapability => createUpstreamCapability(n.ctx, { id: n.id, type: n.type }),

    // 媒体：跨插件"加图片/视频/音频"的唯一入口（资源只存 ID，地址现取）
    media: (n): MediaCapability => createMediaCapability(n.ctx),
  }
}
