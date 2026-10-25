/**
 * CanvasDocument —— MCP 与网页界面**共用同一份画布数据**的读写层。
 *
 * 为什么需要它：`npx mini-canvas-cloud serve` 同时提供网页画布与 MCP 接口，
 * 这两边必须看到同一张画布 —— 否则 AI 改的和用户在浏览器里看到的各是一份，
 * 那这个 MCP 就是摆设。所以 MCP 不另起一套存储，直接读写网页界面用的那套 key：
 *
  *   canvases/<id>/canvas.json   画布本体（节点 + 边 + 画布信息）
  *   canvases/<id>/view.json     视口
  *   canvases/<id>/history.json  任务记录
 *   canvases/<id>/resources/    本画布资源（节点里存逻辑 ID `<画布id>/<hash>`，地址由 resolve 现拼；
 *                               迁移期老存档里的同源 URL 仍可读）
  *
  * 一个画布一个文件夹：复制文件夹 = 复制画布，删文件夹 = 删干净，AI 也能直接读文件。
 *
 * 边界（有意如此）：
 * - 本模块只管"读出来 / 写回去"与批量增删改的语义，不认识 Vue、不认识渲染。
 * - **不动 viewport**：AI 加节点不该把用户当前看的视野重置掉。
 * - 类型定义就地写（不 import @mini-canvas/canvas-data）：本包要能独立 `npx` 跑，
 *   而 canvas-data 是 private 的工作区包，装不到用户机器上。字段形状由测试与
 *   canvas-data 的导出逐字比对守住（见 __tests__/canvasDoc.test.ts）。
 *
 * 步骤 8 的结论：这一处「就地重写」是有意保留，不与 mcp-server 合并（设计文档 §九 步骤 8 的路线乙）。
 * 理由是实测出来的，不是口味问题：
 *
 * 1. 前提没满足，且卡在本次范围外。canvas-data 要能发布，先得能编译出 .d.ts；
 *    而它有 39 处 import/export 直接依赖 @mini-canvas/kernel，kernel 也是 private 且同样只发 src/。
 *    也就是说「把 canvas-data 做成可发布」实际等于「先发布 kernel」——kernel 在本次步骤里禁止改动。
 *    探针（用 tsc 模拟本包 rootDir=./src + declaration，去消费一个 src-only 的包）实测：
 *    error TS6059: File ... is not under rootDir。
 * 2. 两边的「同一份画布」不是同一种东西，合并不省事反而危险。
 *    本文件的 CanvasNode.type 存的是语义类型（text/image…，与网页端 GraphDocument 同款）；
 *    mcp-server 的 GraphModel 存的是渲染类型：语义类型会被改写成 type=custom + data.nodeType
 *    （见 GraphModel.test.ts 的「语义类型节点自动转成 VueFlow 格式」）。
 *    边 id 也不同源：本文件与网页端统一用**自增数字**（取现有最大 + 1），
 *    而 GraphModel.createEdge 用 randomUUID()。
 *    把两套塞进同一个类，等于要在数据层里加一个「你那边用哪种形态」的开关——那才是真风险。
  * 3. 两个后端的存储形态本就不同：本包是一个画布一个文件夹，
  *    mcp-server 是 workspace/project-{id}/canvas.json（NodeStorage）。
 *    共用的只有「JSON 字段形状」，而那一层已经由 canvasDoc.test.ts 与本文件的类型逐字比对守住。
 *
 * 因此本步只做不加依赖、不动独立性的动作：把结论写在这里，免得下一个人重新评估一遍。
 * 若将来真要合并，正确顺序是：先发布 kernel → 再发布 canvas-data → 然后才是在两个后端之间抽共享内核。
 */
import { DEFAULT_CANVAS_ID } from '../store/canvasPaths.js'
import type { CanvasStore } from '../store/canvasStore.js'
import { extFromMime, safeExt, mimeOf, sniffMimeFromHead, kindOfMime } from '../store/mime.js'
import { toResourceUrl, type CanvasResourceStore } from '../store/canvasResources.js'

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
  /** 画布图版本（旧文件没有时是 0）；前端定时核对靠它 */
  revision: number
}

/**
 * 节点类型 → 中文名（与前端各节点插件声明的 label 对齐）。
 *
 * 为什么要在这一层也有一份：MCP 建出来的节点是**没有名字**的（以前 data 直接是 {}），
 * 而前端现在把「节点名」统一成只看 data.label —— MCP 建的节点在 @ 菜单 / 左侧树里就没名字。
 * 这份表让 MCP 建节点时也能补上和网页端同款的中文默认名。
 *
 * 类型名不认识时回落 type 本身（不猜、也不报错）。
 */
export const NODE_TYPE_LABELS: Record<string, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频',
  group: '分组',
  '3d-preview': '3D 预览',
  'image-compare': '图片对比',
  /**
   * 可视化节点（plugin-node-ui 的 type）。
   *
   * 为什么不能漏：MCP 建的节点名字取这张表（见 defaultNodeName）。没有它，AI 建的
   * 可视化节点在左侧树 / @ 菜单里就叫「ui 1」——用户口径「可视化节点描述不清晰」
   * 里最直白的一条就是它。插件自己声明的名字是「可视化」，两边要一致。
   */
  ui: '可视化',
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
    /** 明确删除 data 的哪些 key（浅合并删不掉；网页同步与 MCP 都用它表达字段删除） */
    dataUnset?: string[]
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

/** 深拷贝（快照隔离：读出去的数组被调用方改了也不能污染我们内部状态） */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** 稳定序列化：同一份数据换 key 顺序不算变化（用于判定“空提交”） */
function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']'
  const obj = v as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableJson(obj[k])).join(',') + '}'
}

/** 连接身份键：端点 + 端口（默认 handle 视同未指定）。去重按它判定，不按 id。 */
function edgeKey(e: { source: string; target: string; sourceHandle?: string; targetHandle?: string }): string {
  const sh = e.sourceHandle && e.sourceHandle !== 'source' ? e.sourceHandle : ''
  const th = e.targetHandle && e.targetHandle !== 'target' ? e.targetHandle : ''
  return `${e.source}|${e.target}|${sh}|${th}`
}

/**
 * 网页端节点壳真实渲染的端口 id：左侧输入 target、右侧输出 source。
 *
 * 为什么要挡住别的名字：VueFlow 画边时按 handle id 在节点的 handleBounds 里找锚点，
 * 找不到就回落到 source=Bottom / target=Top。于是 AI 写一个看起来合理的
 * sourceHandle:'out' / targetHandle:'in'，边照常落盘、不报错，画面上却从图片底部中心
 * 连到另一个节点顶部中心。端口名不是自由文本：它由 plugin-theme-default 的 BaseNode
 * 固定为 id="target"/"source"，数据层也按同一套名字校验。
 */
/**
 * 校验并归一一条边两端的 handle：省略 = 默认口；显式写了就必须是右出左入。
 * 不接受反向写法（sourceHandle='target'）：云端这条口不做端点翻正，原样落盘后
 * 渲染层仍会按 source 节点的 target 口找锚点，容易画出反向/底部线。
 * 默认口不返回字段（与网页端拖出来的边同形：edgeStore 不存默认 handle）。
 */
function normalizeEdgeHandles(e: {
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}): { sourceHandle?: string; targetHandle?: string; error?: string } {
  const sourceHandle = e.sourceHandle || 'source'
  const targetHandle = e.targetHandle || 'target'
  if (sourceHandle !== 'source') {
    return {
      error:
        'sourceHandle "' + sourceHandle + '" 不存在：网页端只有右侧输出口 source。' +
        '不写这个字段就是默认输出口；不要猜 out / output / right，也别把 target 写在源端（会被画成底部中心）。',
    }
  }
  if (targetHandle !== 'target') {
    return {
      error:
        'targetHandle "' + targetHandle + '" 不存在：网页端只有左侧输入口 target。' +
        '不写这个字段就是默认输入口；不要猜 in / input / left，也别把 source 写在目标端（会被画成顶部中心）。',
    }
  }
  return {
    ...(sourceHandle === 'source' ? {} : { sourceHandle }),
    ...(targetHandle === 'target' ? {} : { targetHandle }),
  }
}

export class CanvasDocument {
  /**
   * @param store     画布文件夹（canvas.json / view.json）
   * @param resources 本画布资源（节点里存逻辑 ID `<画布id>/<hash>`；迁移期旧同源 URL 仍可读）
   * @param canvasId  画布 id（前端界面当前只有一张，默认 default）
   */
  constructor(
    private readonly store: CanvasStore,
    private readonly resources?: CanvasResourceStore,
    private readonly canvasId: string = DEFAULT_CANVAS_ID,
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
   * 存一个资源（图片/视频等字节），返回**同源 URL**。
   *
   * 为什么 MCP 需要这个：AI 要往画布里放图，得先把字节交给服务器 —— 否则节点里只能写
   * 一个外链（可能挂、可能跨域、用户换机器就取不到）。
   *
   * 节点里现在存 **URL**（`/api/canvases/<画布id>/resources/<hash>`，浏览器直接就能请求）：
   * 渲染、下单、资产登记都不必再拼一次地址。
   */
  async saveResource(bytes: Uint8Array, opts: { fileName?: string; mime?: string } = {}) {
    if (!this.resources) throw new Error('[mcp] 未配置资源存储，无法保存资源')
    if (bytes.byteLength === 0) throw new Error('[mcp] 资源内容为空')
    // 扩展名来源：文件名 → MIME 反查。白名单外（含 .html/.js）回落空扩展名，
    // 与网页端同规则（同源托管下这些会造成 XSS 面）。
    const ext = safeExt(opts.fileName ?? '') || extFromMime(opts.mime ?? '')
    const saved = await this.resources.save(this.canvasId, bytes, ext)
    return {
      hashName: saved.hashName,
      url: saved.url,
      size: saved.size,
      mime: opts.mime ?? mimeOf(saved.hashName),
    }
  }

  /** 列出本画布已存资源（AI 排查"我传的图在不在"用） */
  async listResources(): Promise<string[]> {
    return this.resources ? this.resources.list(this.canvasId) : []
  }

  /**
   * 带**类型信息**的资源清单（给 MCP 的 resource_list 用）。
   *
   * 为什么不能只给文件名：资源按内容哈希落盘、很多没有扩展名 —— 调用方拿到一串名字
   * 只能拿名字猜类型，音频会被塞进 `<img>` 当图片渲染，表现就是裂图（用户报过）。
   * 这里把 mime / kind 一并给出，调用方照着 kind 决定怎么展示。
   *
   * mime 先按扩展名（便宜的查表）；查不出（octet-stream = 没扩展名）时才开文件读**前 16 字节**嗅探
   * —— 只读头部，不整读（资源里有不少几 MB 的图，列表一次要判几十个）。
   */
  async listResourceInfos(): Promise<
    Array<{ name: string; mime: string; kind: 'image' | 'video' | 'audio' | 'other'; url: string }>
  > {
    if (!this.resources) return []
    const names = await this.resources.list(this.canvasId)
    const out: Array<{ name: string; mime: string; kind: 'image' | 'video' | 'audio' | 'other'; url: string }> = []
    for (const name of names) {
      let mime = mimeOf(name)
      if (mime === 'application/octet-stream') {
        const head = await this.resources.readHead(this.canvasId, name)
        const sniffed = head ? sniffMimeFromHead(head) : undefined
        if (sniffed) mime = sniffed
      }
      out.push({
        name,
        mime,
        kind: kindOfMime(mime),
        url: toResourceUrl(this.canvasId, name),
      })
    }
    return out
  }

  /** 读整张画布。从未保存过 = 空画布（不是错误） */
  async read(): Promise<CanvasSnapshot> {
    const data = (await this.store.readCanvas(this.canvasId)) ?? { nodes: [], edges: [] }
    const viewport = await this.store.readView(this.canvasId)
    return {
      nodes: clone(data.nodes) as CanvasNode[],
      edges: clone(data.edges) as CanvasEdge[],
      ...(viewport ? { viewport: clone(viewport) } : {}),
      revision: data.revision ?? 0,
    }
  }

  /**
   * 只读图版本（客户端定时核对用）。
   * 画布不存在时返回 undefined，由路由翻译成 404 —— 不要用 0 冒充“存在但为空”。
   */
  async readRevision(): Promise<number | undefined> {
    const data = await this.store.readCanvas(this.canvasId)
    return data ? (data.revision ?? 0) : undefined
  }

  /**
   * 写整张画布。
   * 只写 nodes/edges 两个 key（**不碰 viewport**：AI 编辑不该重置用户当前视野）。
   */
  async write(snapshot: { nodes: CanvasNode[]; edges: CanvasEdge[] }): Promise<void> {
    await this.commitGraph(snapshot)
  }

  /**
   * 图提交的唯一入口（已持锁时调用）：先判断节点/边**确实变了**，再发 revision + 1，
   * 并把 `{nodes, edges, revision}` 作为**同一次 canvas.json 原子写**落盘。
   *
   * 为什么必须在这里、而不是 CanvasStore.writeCanvas：
   * - 那是通用写口，改名 / 复制也走它，无法判断“这是不是一次有效图变更”；
   * - 版本号必须与图数据同一次原子写，且只由一个地方发号；
   * - 空操作（如 lenient 删除不存在的边）不能涨版本，否则客户端会做无意义整包拉取。
   *
   * @returns 这次是否真的写盘（无变化时返回 false，调用方可据此跳过通知）
   */
  private async commitGraph(snapshot: { nodes: CanvasNode[]; edges: CanvasEdge[] }): Promise<boolean> {
    const prev = await this.store.readCanvas(this.canvasId)
    const nextNodes = snapshot.nodes ?? []
    const nextEdges = snapshot.edges ?? []
    // 无变化：不写文件、不涨版本（避免定时核对把“空操作”当成变化）
    if (prev && stableJson(prev.nodes) === stableJson(nextNodes) && stableJson(prev.edges) === stableJson(nextEdges)) {
      return false
    }
    const revision = (prev?.revision ?? 0) + 1
    await this.store.writeCanvas(this.canvasId, { nodes: nextNodes, edges: nextEdges, revision })
    return true
  }

  /**
   * 「以这份为准」整体重写（网页端整包保存走这条）。
   *
   * 与 batchNodes 的区别：batch 是「在现有画布上增删改」，这条是「整个换成我这份」。
   * 用户删光节点、恢复历史、导入画布这类操作必须用它 —— 用 batch 表达不出
   * 「删掉你没提到的那些」。同样进串行链：否则它与 AI 的增量写并发时会互相覆盖。
   */
  async replaceAll(nodes: unknown[], edges: unknown[]): Promise<void> {
    return this.runExclusive(async () => {
      await this.commitGraph({ nodes: nodes as CanvasNode[], edges: edges as CanvasEdge[] })
    })
  }

  /**
   * 视图状态（视口）整体改写。
   *
   * 与 `write`（画布本体）分开：改动视野不该重写整份节点边。
   * 同样进串行链 —— 它也是一次落盘。
   */
  async writeView(view: unknown): Promise<void> {
    return this.runExclusive(async () => {
      await this.store.writeView(this.canvasId, view)
    })
  }

  /** 读视口（宿主恢复视野用） */
  async readView<T = { x: number; y: number; zoom: number }>(): Promise<T | undefined> {
    return this.store.readView<T>(this.canvasId)
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

  /**
   * 生成一个不与现有节点冲突的节点 id：**自增数字**（与网页端同一套规则）。
   *
   * 过去用 `ai-` 前缀是为了和网页端的数字 id 区分开；现在两边统一成数字了，
   * AI 建的节点与网页建的节点就是同一种东西（用户要求：AI 加节点不必自己指定 id，
   * 由服务端发号并在 added 里回给调用方）。
   */
  private newNodeId(taken: Set<string>): string {
    let max = 0
    for (const id of taken) {
      const n = Number.parseInt(id, 10)
      if (!Number.isNaN(n) && n > max) max = n
    }
    let candidate = ''
    do {
      max += 1
      candidate = String(max)
    } while (taken.has(candidate))
    return candidate
  }

  /**
   * 给 MCP 新建的节点补一个默认名（写进 data.label），与网页端"图片 1"同款。
   *
   * 语义与前端 nodeStore.nextDefaultName 对齐：
   * - 名字 = `<类型中文名> <序号>`，序号**按类型独立计数**；
   * - 序号从**现有同类型节点的名字**里推断（找名字末尾的数字取最大），所以
   *   "先由 AI 建两个图片、再让 AI 建第三个"会得到「图片 3」，而不是从头开始；
   * - 调用方已显式给 label 时不生成（尊重调用方的名字）。
   *
   * 为什么在这里做、而不是让前端补：MCP 写的是同一份 canvas.json，写进去就该是完整的；
   * 等前端补等于"没打开页面时建的节点永远没名字"。
   */
  private defaultNodeName(type: string, nodes: CanvasNode[]): string {
    const base = NODE_TYPE_LABELS[type] ?? type
    let max = 0
    for (const n of nodes) {
      if (n.type !== type) continue
      const label = n.data?.label
      if (typeof label !== 'string') continue
      const m = /(\d+)\s*$/.exec(label.trim())
      if (!m) continue
      const num = Number.parseInt(m[1], 10)
      if (!Number.isNaN(num) && num > max) max = num
    }
    return base + ' ' + (max + 1)
  }

  /**
   * 生成一个不与现有边冲突的 id：**自增数字**（与网页端同一套规则）。
   *
   * 为什么不沿用过去的 `e-{source}-{target}`：那边 id 形态五花八门（见 canvas-data 的 edgeStore），
   * 现在统一成数字，AI 建的边与网页建的边才是同一种东西。取「现有最大数字 + 1」，
   * 并跳过已被其它 id 占用的号。
   */
  private nextEdgeId(existing: Array<{ id: string }>): string {
    const taken = new Set(existing.map((e) => e.id))
    let max = 0
    for (const e of existing) {
      const n = Number.parseInt(e.id, 10)
      if (!Number.isNaN(n) && n > max) max = n
    }
    let candidate = ''
    do {
      max += 1
      candidate = String(max)
    } while (taken.has(candidate))
    return candidate
  }

  /**
   * 节点批量增删改（一次调用合并执行）。
   *
   * 语义与 mcp-server 的 canvas_batch_nodes 对齐：**先整体预校验，再按 delete→add→update 应用**。
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
        // 调用方没给 label 就补默认名（「图片 1」这种，与网页端同款）。
        // 不补的话 MCP 建的节点在 @ 菜单 / 左侧树里就没名字（那里现在只看 data.label）。
        data: {
          ...(a.data ?? {}),
          ...(a.data?.label === undefined ? { label: this.defaultNodeName(a.type, kept) } : {}),
        },
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
      if (u.dataUnset) for (const key of u.dataUnset) delete node.data[key]
      // 尺寸：给了就写（nil 之外的形状由 schema 保证）；没给就保持原样
      if (u.size) node.size = { w: u.size.w, h: u.size.h }
      // 父节点：null 是「解除父子」的显式表达，undefined 才是「没提这个字段」
      if (u.parentId === null) delete node.parentId
      else if (u.parentId !== undefined) node.parentId = u.parentId
      result.updated.push(u.id)
    }

    await this.commitGraph({ nodes: kept, edges })
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
      const handles = normalizeEdgeHandles(a)
      if (handles.error) error('add', i, handles.error)
      // 同 id 已存在：同步口（upsert）当成更新，MCP 口保持严格（对 AI 来说说重复了就该报错）
      if (a.id !== undefined && existing.has(a.id) && !input.upsert) error('add', i, `连线 id 重复: ${a.id}`)
    }
    for (const id of dels) {
      if (!existing.has(id) && !input.lenient) error('delete', 0, `要删除的连线不存在: ${id}`)
    }
    for (const u of ups) {
      if (!existing.has(u.id) && !input.lenient) error('update', 0, `要更新的连线不存在: ${u.id}`)
      if (u.sourceHandle !== undefined || u.targetHandle !== undefined) {
        const current = snap.edges.find((e) => e.id === u.id)
        const handles = normalizeEdgeHandles({
          source: u.source ?? current?.source ?? '',
          target: u.target ?? current?.target ?? '',
          sourceHandle: u.sourceHandle ?? current?.sourceHandle,
          targetHandle: u.targetHandle ?? current?.targetHandle,
        })
        if (handles.error) error('update', 0, `更新连线 ${u.id}：${handles.error}`)
      }
    }
    if (result.errors.length > 0) {
      result.ok = false
      return result
    }

    const delSet = new Set(dels)
    let edges = snap.edges.filter((e) => !delSet.has(e.id))

    for (const a of adds) {
      const id = a.id ?? this.nextEdgeId(snap.edges.concat(edges))
      // 去重看**连接本身**（端点 + 端口），不是 id —— id 已是自增数字，
      // 「同一条线再加一次」不再自动得到同一个 id，必须显式比端点，
      // 否则会写出两条端点相同的边（与数据层 addEdge 的去重语义对齐）。
      const handles = normalizeEdgeHandles(a)
      const key = edgeKey({ ...a, ...handles })
      const dup = edges.find((e) => edgeKey(e) === key)
      if (dup) {
        // upsert：已存在就按新内容更新它（端点/端口/data/type 都跟上）
        if (input.upsert) {
          dup.source = a.source
          dup.target = a.target
          dup.type = a.type ?? dup.type ?? 'custom'
          // 端口只接受 source/target（校验已过）；默认口不写字段，与拖拽出来的边同形。
          if (handles.sourceHandle === undefined) delete dup.sourceHandle
          else dup.sourceHandle = handles.sourceHandle
          if (handles.targetHandle === undefined) delete dup.targetHandle
          else dup.targetHandle = handles.targetHandle
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
        ...(handles.sourceHandle ? { sourceHandle: handles.sourceHandle } : {}),
        ...(handles.targetHandle ? { targetHandle: handles.targetHandle } : {}),
        ...(a.data ? { data: { ...a.data } } : {}),
      })
      result.added.push(id)
    }

    for (const u of ups) {
      const edge = edges.find((e) => e.id === u.id)
      if (!edge) continue
      if (u.source) edge.source = u.source
      if (u.target) edge.target = u.target
      if (u.sourceHandle !== undefined || u.targetHandle !== undefined) {
        const handles = normalizeEdgeHandles({
          source: u.source ?? edge.source,
          target: u.target ?? edge.target,
          sourceHandle: u.sourceHandle ?? edge.sourceHandle,
          targetHandle: u.targetHandle ?? edge.targetHandle,
        })
        if (handles.sourceHandle === undefined) delete edge.sourceHandle
        else edge.sourceHandle = handles.sourceHandle
        if (handles.targetHandle === undefined) delete edge.targetHandle
        else edge.targetHandle = handles.targetHandle
      }
      if (u.data) edge.data = { ...(edge.data ?? {}), ...u.data }
      result.updated.push(u.id)
    }

    await this.commitGraph({ nodes: snap.nodes, edges })
    result.deleted = dels.filter((id) => existing.has(id))
    return result
  }
}
