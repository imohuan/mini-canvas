/**
 * NodeStore —— 节点数据实现（**5c 起不再是 ctx 服务名**：由 canvas-base 建好交给 doc，
 * 消费方一律 ctx.get('doc')；详见设计文档 §4.1 与 STATUS 步骤 5c）。
 *
 * M4 最小实体，验证：
 * - 节点 type 用业务类型（'text'），不再是 v1 的全 'custom'。
 * - 节点 id 短数字累加（createNodeId），废弃 v1 的 `node-{type}-{Date.now()}`。
 * - 内容组件经 updateNodeData 上报改动（治 v1 text 编辑不写回 data）。
 *
 * v2 写 API（用户拍板 1A）：
 * - CanvasNode 增加可选 parentId（组嵌套）+ size（声明尺寸）。两者均向后兼容：老数据无此字段不落盘。
 * - addNodes 批量带 id/data/size/parentId 插入；updateNode 任意 patch；updateNodes 批量改；removeNodes 批量删。
 * - 动态实测宽高不属于本包（那是渲染层 nodeLayout 服务的事），size 仅承载声明/落盘的静态尺寸。
 */
// 类型表要能**实时改默认尺寸**（设置面板调默认尺寸，未 resize 的节点立刻跟着变），
// 所以注册进类型表的对象包一层 shallowReactive：只让**顶层**可追踪（`updateTypeSize` 是整体替换
// `defaultSize` 这个属性），不深包装 icon/segments 等句柄 —— 深包装会把它们变成代理、破坏引用相等。
import { shallowReactive, type Component } from 'vue'

/** 画布节点数据的最小可持久化形状 */
export interface CanvasNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
  /** 父节点 id（组嵌套；可选，向后兼容老数据）。子节点 position 为相对父的局部坐标。 */
  parentId?: string
  /** 声明尺寸（可选；供布局/对齐等读静态值。运行时实测宽高走渲染层 nodeLayout）。 */
  size?: { w: number; h: number }
}

/** addNodes 的单条输入：除 type/position 外均可选（id 缺省自动分配） */
export interface AddNodeInput {
  type: string
  position: { x: number; y: number }
  id?: string
  data?: Record<string, unknown>
  parentId?: string
  size?: { w: number; h: number }
}

/** updateNode/updateNodes 的单条 patch：position/size/parentId/data 任意子集；显式 undefined 表示清该字段 */
export type NodePatch = Partial<Pick<CanvasNode, 'position' | 'data' | 'size'>> & {
  parentId?: string | undefined
  /**
   * 明确删除 data 里的这些 key（浅合并只能新增/覆盖，删不掉字段）。
   * 云端字段删除、插件清理派生字段都需要它；只在 data 合并之后执行。
   */
  dataUnset?: string[]
}

/** updateNodes 的批量条目：id + 该节点 patch */
export interface NodePatchEntry {
  id: string
  patch: NodePatch
}

/**
 * 写回结果：写口报告"本次实际改了哪个尺寸字段"。
 *
 * 为什么要有：v2 存量里卡片尺寸同时存在于 data.cardWidth/cardHeight 与正式字段 node.size，
 * 且以前的数据只写了 data 那一份。若 size 缺失而调用方只写 data.cardWidth，
 * size 就补不上（镜像断链）。写口把"补了镜像"这件事报回去，调用方（宿主）据此把 size 一并落盘。
 */
export interface NodeWriteResult {
  /**
   * true = size 是本次**首次**建立（此前该节点没有 size），补镜像时同时写进了 data。
   * 只有 size 写入发生在"size 原本不存在"时才为 true。
   */
  sizeFilled: boolean
}

/**
 * 从节点 data 读回一张卡片尺寸（仅认正有限数，其余视为没有）—— 存量迁移用。
 * 老节点（v1/旧存档/MCP 建的节点）只写了 data.cardWidth/cardHeight，node.size 是空的。
 */
export function nodeSizeOf(data: Record<string, unknown> | undefined): { w: number; h: number } | undefined {
  const w = data?.cardWidth
  const h = data?.cardHeight
  if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0) return undefined
  if (typeof h !== 'number' || !Number.isFinite(h) || h <= 0) return undefined
  return { w, h }
}

/**
 * 尺寸写回补丁（**唯一正身写法**）：只给正式字段 size，卡片镜像由 nodeStore 自动补齐。
 *
 * 为什么只给 size：以前每个写尺寸的地方都要手拼 `{ cardWidth, cardHeight, size }` 三件套，
 * 谁漏一个就出现"卡片变了、边还停在旧宽度"或反过来。现在尺寸只在一个地方成型（size），
 * 镜像由数据层统一生成 —— 写尺寸的地方只剩这一处要记。
 *
 * @param w 卡片宽（px）
 * @param h 卡片高（px）
 */
export function nodeSizePatch(w: number, h: number): { size: { w: number; h: number } } {
  return { size: { w, h } }
}

/** 声明式端口约束（缺省 = 人人可 source→target 连） */
export interface PortDef {
  /** 'target'(输入) / 'source'(输出) */
  port?: string
  /** 该端口接受的源节点类型列表；缺省/空 = 来者不拒 */
  accepts?: string[]
  /** 'single' = 该端口只允许一条连接；缺省 = 多条 */
  limit?: 'single' | 'multi'
  /** 输出口产出/输入口接收的内容类型；目标输入声明 acceptsTypes 时源产出必须 ∈ 它 */
  contentType?: string
  /** 输入口接受的内容类型列表 */
  acceptsTypes?: string[]
  /**
   * 输入口最多接几条入边。**不声明 = 不限条数**（可以接任意多条上游）。
   *
   * 只有确实需要限制的端口才写它（如 3d-preview 只接一张图、image-compare 只接两张）。
   * 满额时怎么处理由 evictOnFull 决定。
   */
  capacity?: number
  /**
   * 容量满时是否允许"先挤掉最老一条再加新边"。**缺省 true**（默认就是挤）。
   *
   * 为什么默认挤而不是拒：这是画布一贯的行为（image-compare 老版就是"超了挤最老"），
   * 也是用户拖一根线过来时最符合直觉的反馈 —— 线落下了、最旧的那条让位。
   * 设 false 才"满额直接拒"（拖过去连不上，报 limit-reached）。
   */
  evictOnFull?: boolean
}

/** 节点类型定义 */
export interface CanvasNodeType {
  type: string
  label: string
  defaultSize: { w: number; h: number }
  /**
   * 新节点默认名称的模板（可选）。
   *
   * 支持两个占位符：
   * - {{ID}}   —— 该类型自己的递增序号（**按类型独立计数**：图片 1、图片 2、文本 1…）
   * - {{NAME}} —— 类型的 label（图片 / 文本…）
   *
   * 例：nameTemplate: '图片 {{ID}}' → 第一个图片节点叫「图片 1」。
   * 不写则用 label 兜底（同类型多开几个时用 label+序号 区分）。
   *
   * 为什么把"默认名"交给注册处声明：以前没有人为新节点写过名字，标题条只能回落成
   * 英文类型名（text / image），@ 菜单与左侧树又各自按字段猜 → 三处不一致。
   * 名字模板由**最清楚自己是什么**的类型声明，建节点时由数据层统一生成。
   */
  nameTemplate?: string
  /** 声明式连接约束：target 输入/源类型/端口条数；缺省 = 人人可 source→target 连 */
  inputs?: PortDef[]
  outputs?: PortDef[]
  /** 节点类型图标（opaque 句柄：SVG 字符串或 Vue 组件；内核不解析）。菜单"新建节点"与节点标题共用。 */
  icon?: unknown
  /**
   * 节点标题右侧的附加文本（节点类型自述；缺省 = 不显示）。
   *
   * 为什么放在类型声明里（与 icon 同层、同一个理由）：标题右上角该不该有字、显示什么，
   * **最清楚的是类型自己** —— 图片/视频节点要显示"1280×720"，文本节点可能要显示字数。
   * 默认壳（BaseNode）不认识任何业务类型，只按声明渲染，不给节点类型写分支。
   *
   * 两种形态：
   * - 字符串：静态文案（"预览" / "草稿"）；
   * - 函数：按节点 data 现算（见 TitleExtraSource）。派生值（宽高、字数、时长）走函数形态 ——
   *   它们**不该写进 data**：写进去就成了落盘字段，每次尺寸变化多一条历史噪音，
   *   还会被后台/MCP 复制粘贴带跑。
   *
   * 函数返回空串/undefined 时该节点不渲染这一格（拿不到尺寸就什么都不显示）。
   */
  titleExtra?: TitleExtraSource
  /**
   * 标题右侧的**组件插槽**（2026-10-16 升级）：除文本外，节点类型还可以直接给一个
   * **组件**（插件用自己的 Vue 副本定义的纯对象组件，宿主统一挂载）。组件内部自己
   * 持响应式状态 —— 典型用途：调试连接建立后，标题右侧常驻"调试"标签并随调试事件
   * 更新内容（收到了什么消息、执行了什么），壳不参与任何业务。
   */
  titleExtraSlot?: Component
  /**
   * 一句话说明这个节点是干什么的（可选）。菜单"新建节点"项的 hover 小字读它。
   *
   * 与 icon 同一条链、同一个理由：类型自己最清楚自己是什么，声明在本处即免去
   * 菜单层维护"type 名字 → 文案"对照表（那种表每加一个节点类型都得回去补，必漏）。
   */
  description?: string
  /**
   * 是否支持 resize + 拖拽方式（类型级能力，缺省 false = 不可缩放）。
   *
   * - true = 自由拖拽（宽高各算各的，老语义不变）；
   * - 'width'  = 只能改宽度，高度锁在起手值；
   * - 'height' = 只能改高度，宽度锁在起手值；
   * - 'aspect' = 等比例拖拽：比例在按下那一刻取 —— 类型声明了 resizeRatio(data) 就用内容比例，
   *              没声明就用当前卡片的宽高比。框架不认识各节点的字段，内容比例由类型自己报。
   *
   * 渲染层据此显示拖柄与选拖拽方式；节点实例仍可经 data.resizable（同类型值）单独覆盖。
   */
  resizable?: boolean | 'width' | 'height' | 'aspect'
  /**
   * 等比例拖拽用的内容比例（宽/高，可选）：只在 resizable='aspect' 且拖拽起手时调用。
   * 类型最清楚自己的内容存在哪个字段（图片 imageWidth/Height、视频裁框/画面宽高…），
   * 框架只调函数、不猜字段名。返回非正数/非法值 = 「拿不到」→ 拖拽退回当前卡片比例。
   */
  resizeRatio?: (data: Record<string, unknown>) => number
  /**
   * 无边框（类型级能力，缺省 false = 由外壳画默认卡片边框）。
   *
   * 给"内容铺满整张卡"的类型用（如图片）：外壳的 1px 边框在它们身上没有分层价值，
   * 只会变成内容边缘一圈多余的缝。由类型自己声明，渲染层读，不让外壳猜节点类型。
   */
  frameless?: boolean
  /**
   * 表面透明（类型级能力，缺省 false = 外壳默认不透明卡片底）。
   *
   * 给"容器型"类型（分组）用：卡片底是不透明色块会盖住穿过容器区域的连接线
   * （VueFlow 边层 z 恒低于节点层）。声明 transparent = 外壳不画卡片底色/投影，
   * 由 content 自己铺半透明色 → 连接线透出来，视觉对齐"容器"语义。
   */
  transparent?: boolean
  /**
   * 加载态用类型默认尺寸（类型级能力，缺省 false）。
   *
   * 给"内容尺寸跟随媒体"的类型用（图片 / 视频）：它们一旦有内容，`node.size` 就被按图片/视频
   * 真实比例写死（9:16 的图 → 169×300 竖版）。于是**重新生成**时那张竖版卡片不会重置，加载态
   * （整卡覆盖层）也铺在竖版上 —— 用户看到的"重新生成时变成竖屏"。
   *
   * 声明本能力 = 该类型在 `data.runState.status === 'running'` 期间按**类型默认尺寸**渲染
   * （用户在设置里配的图片/视频默认宽高），任务结束立刻回到媒体真实比例。只改渲染，**不动数据**，
   * 所以生成失败/取消时原图与尺寸都原样还在（删图删尺寸的写法会把用户作品弄丢）。
   */
  loadingDefaultSize?: boolean
  /** 数据契约：本节点对外产出的槽（只做声明与校验；读取走 upstream 能力） */
  produces?: Record<string, import('./canvas/dataPorts').DataPortDef>
  /** 数据契约：本节点从上游读取的槽 */
  consumes?: Record<string, import('./canvas/dataPorts').DataPortDef>
}

/**
 * 标题右侧附加文本的来源：静态字符串，或按节点 data 现算的函数。
 * 见 CanvasNodeType.titleExtra —— 函数形态专供派生值（宽高/字数/时长），不落盘。
 */
export type TitleExtraSource = string | ((data: Record<string, unknown>) => string | undefined)

/** NodeStore 作为 ctx 服务暴露的接口 */
export interface NodeStoreService {
  /** 已注册的节点类型（按 type） */
  readonly types: ReadonlyMap<string, CanvasNodeType>
  /** 注册一个节点类型 */
  registerType(def: CanvasNodeType): void
  /** 注销一个节点类型（热卸插件时回收；不存在则 no-op） */
  unregisterType(type: string): void
  /**
   * 改某类型的默认尺寸（设置面板调默认尺寸时调用）。
   * 只影响没有显式尺寸（没被 resize 过）的节点。
   */
  updateTypeSize(type: string, size: { w: number; h: number }): void
  /** 改某类型的 resizable 能力（设置面板开关/拖拽方式）。未知类型 no-op。 */
  updateTypeResizability(type: string, resizable: CanvasNodeType['resizable']): void
  /**
   * 取该类型**下一个默认名**（"图片 3" / "分组 2"）并推进该类型的序号计数。
   *
   * 与建节点自动补名走的是同一份计数：给既有节点补默认名（存量空标题的分组）时用它，
   * 否则「补的名字」与「之后新建的名字」各数各的、必然撞号（两个「分组 1」）。
   * 类型没注册 / 取不到模板时回落类型 label。
   */
  nextTypeName(type: string): string
  /** 所有节点 */
  getNodes(): CanvasNode[]
  /** 深拷贝快照（P1-10：安全只读——返回与内部引用隔离的副本，外部改动不污染 store） */
  getSnapshot(): CanvasNode[]
  /** 按 type 在指定坐标建一个节点，返回短 id（如 '1'） */
  addNode(type: string, position: { x: number; y: number }): string
  /**
   * 取下一个可用节点 id（短数字：'1' '2' '3' …），**并把它占掉**。
   *
   * 为什么要暴露出来：插件（复制粘贴、拖入文件、打组…）需要在建节点**之前**拿到 id
   * （要拿它连边、要把它加进选中集）。各自造 id 就会出现 fd- / group- / xxx-copy- 这些形态，
   * 画布里 id 五花八门。统一向这里要，形态就只有一个。
   *
   * 与 addNodes 的差别：addNodes 不给 id 时内部也会取号；本方法给"我要先拿到号"的场景用。
   */
  nextId(): string
  /** 批量插入节点：可指定 id/data/size/parentId；返回实际插入数量。广播一次 add。 */
  addNodes(inputs: AddNodeInput[]): number
  /** 改某节点 data（内容组件上报改动入口；等价 updateNode(id,{data})） */
  updateNodeData(id: string, data: Record<string, unknown>): void
  /**
   * 任意字段更新（position/size/parentId/data；显式 undefined 清字段）。节点不存在抛错。广播一次 update。
   *
   * size 是唯一正身：给了 size 自动刷卡片镜像；只给 data.cardWidth/cardHeight 会自动提升为 size。
   * @returns sizeFilled = 本次是否首次建立了 size（老节点迁移完成；宿主据此把 size 落盘）
   */
  updateNode(id: string, patch: NodePatch): NodeWriteResult
  /** 批量更新：不同节点各自 patch；原子广播一次 update。返回每条的结果（顺序同入参）。 */
  updateNodes(entries: NodePatchEntry[]): NodeWriteResult[]
  /** 取某节点 */
  getNode(id: string): CanvasNode | undefined
  /** 删除某节点（返回是否删到） */
  removeNode(id: string): boolean
  /** 批量删除；若删到父节点，自动清仍存活子节点的 parentId（防悬挂）。广播一次 remove。 */
  removeNodes(ids: string[]): number
  /** 某父节点直属子节点（无则空数组） */
  childNodesOf(parentId: string): CanvasNode[]
  /** 有存量节点但类型已注销的 type 列表（P1-9 orphan policy 感知：插件热卸后存量节点变孤儿） */
  orphanTypes(): string[]
  /** 用持久化数据整体回填（刷新恢复） */
  replaceAll(nodes: CanvasNode[]): void
  /**
   * 订阅节点集变化（add/remove/update/replace 任一触发）。返回取消函数。
   * 宿主(CanvasHost)据此自动把内核 nodeStore 重灌到渲染态，业务代码无需手动同步。
   * 纯逻辑、零 Vue：addNode 后立刻回调，供渲染层 flush。
   */
  subscribe(listener: NodeStoreListener): () => void
}

/** 节点集变化原因 */
export type NodeStoreChangeReason = 'add' | 'remove' | 'update' | 'replace'

/** 订阅回调：reason = 变化类型；nodeId = 本次涉及节点（replace 时为 undefined） */
export type NodeStoreListener = (reason: NodeStoreChangeReason, nodeId?: string) => void

/** 实现：节点数据 + 每画布自增 id 计数器 */
export class NodeStore implements NodeStoreService {
  readonly types = new Map<string, CanvasNodeType>()
  private nodes = new Map<string, CanvasNode>()
  private counter = 0
  /**
   * 每类型的名称序号（按类型独立计数：图片 1、图片 2、文本 1…）。
   *
   * 与 counter（节点 id）分开：id 是全画布唯一自增，名称序号只服务于默认名，
   * 二者语义不同（删除节点后 id 不复用，名称序号也不必回退）。
   */
  private typeCounters = new Map<string, number>()
  private listeners = new Set<NodeStoreListener>()

  subscribe(listener: NodeStoreListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 广播节点集变化给订阅方 */
  private notify(reason: NodeStoreChangeReason, nodeId?: string): void {
    // P2-6：坏订阅者异常不阻断其它订阅者/写操作（与 EventBus 同语义）
    for (const l of this.listeners) {
      try { l(reason, nodeId) } catch { /* 忽略单个订阅者异常 */ }
    }
  }

  registerType(def: CanvasNodeType): void {
    if (this.types.has(def.type)) {
      throw new Error(`[nodeStore] node type "${def.type}" already registered`)
    }
    // 存响应式副本：类型默认尺寸要能**实时改**（设置面板调默认尺寸，未 resize 的节点立刻跟着变）。
    // 不改调用方传进来的对象（作者模块级的字面量可能被复用），只派生一份可追踪的。
    this.types.set(def.type, shallowReactive({ ...def }) as CanvasNodeType)
  }

  /**
   * 改某类型的默认尺寸（设置面板改「默认尺寸」时调用）。
   *
   * 只动 `defaultSize` 里的值（原地改响应式对象 → 依赖它的卡片尺寸 computed 自动重算）。
   * 语义：**只影响没有显式尺寸的节点**（没 `node.size`/`data.cardWidth` 的），
   * 已经 resize 过、有自己尺寸的节点不受影响 —— 由「实测 > node.size > type.defaultSize」这条链天然保证。
   */
  updateTypeSize(type: string, size: { w: number; h: number }): void {
    const t = this.types.get(type) as (CanvasNodeType & { defaultSize: { w: number; h: number } }) | undefined
    if (!t) return
    t.defaultSize = { w: size.w, h: size.h }
    this.notify('update', type)
  }

  /**
   * 改某类型的 resizable 能力（设置面板改「允许拖拽调整尺寸 / 拖拽方式」时调用）。
   *
   * 与 updateTypeSize 同一条链：类型表是 shallowReactive 的，原地改顶层属性 →
   * 依赖它的拖柄显隐 computed 立刻重算，画布上已有节点不用刷新。
   * 未知类型 no-op（与 updateTypeSize 同语义）。
   */
  updateTypeResizability(type: string, resizable: CanvasNodeType['resizable']): void {
    const t = this.types.get(type)
    if (!t) return
    t.resizable = resizable
    this.notify('update', type)
  }

  /**
   * 取某类型的下一个默认名（并推进该类型计数）—— 见服务接口处的说明。
   * 类型没注册就返回个安全值（调用方通常是批量补名循环，不该因为一个未知类型整批炸）。
   */
  nextTypeName(type: string): string {
    const def = this.types.get(type)
    if (!def) return type
    return this.nextDefaultName(def)
  }

  /**
   * 尺寸单向同步：**node.size 是唯一正身**，data.cardWidth/cardHeight 是从它生成的镜像。
   *
   * 卡片壳（BaseNode）读不到 node.size（它只拿得到 VueFlow 摊平的 props.data），
   * 所以渲染要的那份必须由数据层顺手镜像过去 —— 而不是让每个写尺寸的插件各写一份。
   * 镜像直接**改内存对象**、不经 applyPatch：它要活在被历史快照深拷贝的那一份里，
   * 否则 undo 只还原 size、镜像会残留成"卡片尺寸和 size 不一致"。
   *
   * size 被删（size: undefined）时镜像一并删掉 —— 否则卡片会停在旧尺寸（镜像比正身活得久）。
   *
   * @returns 是否因为这次写入而首次建立了 size（老节点迁移完成的信号）
   */
  private syncSizeMirror(node: CanvasNode): boolean {
    if (node.size === undefined) {
      // 正身没了，镜像也一并清掉：否则卡片读镜像会停在旧尺寸
      if ('cardWidth' in node.data) delete node.data.cardWidth
      if ('cardHeight' in node.data) delete node.data.cardHeight
      return false
    }
    const before = nodeSizeOf(node.data)
    node.data.cardWidth = node.size.w
    node.data.cardHeight = node.size.h
    return before?.w !== node.size.w || before?.h !== node.size.h
  }

  unregisterType(type: string): void {
    this.types.delete(type)
  }

  /** 有存量节点但类型定义已注销的 type 列表（插件热卸后遗留节点 = orphan） */
  orphanTypes(): string[] {
    const used = new Set<string>()
    for (const n of this.nodes.values()) used.add(n.type)
    return [...used].filter((t) => !this.types.has(t))
  }

  getNodes(): CanvasNode[] {
    return [...this.nodes.values()]
  }

  getSnapshot(): CanvasNode[] {
    return JSON.parse(JSON.stringify([...this.nodes.values()])) as CanvasNode[]
  }

  addNode(type: string, position: { x: number; y: number }): string {
    const def = this.types.get(type)
    if (!def) {
      throw new Error(`[nodeStore] unknown node type "${type}". Register it first.`)
    }
    const id = this.createNodeId()
    this.nodes.set(id, { id, type, position, data: { label: this.nextDefaultName(def) } })
    this.notify('add', id)
    return id
  }

  addNodes(inputs: AddNodeInput[]): number {
    if (inputs.length === 0) return 0
    // 原子：先全量预校验（type 存在 + 批内/存量 id 不冲突），任一非法即抛错且不产生部分插入
    const seenIds = new Set<string>()
    for (const input of inputs) {
      if (!this.types.has(input.type)) {
        throw new Error(`[nodeStore] unknown node type "${input.type}". Register it first.`)
      }
      const id = input.id ?? undefined
      if (id !== undefined) {
        // P1-11：显式 id 与存量节点或批内前序 id 冲突 → 抛错（防静默覆盖已有数据）
        if (this.nodes.has(id) || seenIds.has(id)) {
          throw new Error(`[nodeStore] node id "${id}" already exists`)
        }
        seenIds.add(id)
      }
    }
    for (const input of inputs) {
      const id = input.id ?? this.createNodeId()
      const data = input.data ? { ...input.data } : {}
      // 没给 label 就补默认名（见 nextDefaultName）：显式带 label 的（复制粘贴、后台建节点）
      // 保留原样，不被模板覆盖。
      if (data.label === undefined) data.label = this.nextDefaultName(this.types.get(input.type)!)
      const node: CanvasNode = {
        id,
        type: input.type,
        position: { x: input.position.x, y: input.position.y },
        data,
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.size !== undefined ? { size: { ...input.size } } : {}),
      }
      // 显式给了 size（复制/粘贴、分组、后台建节点）→ 顺手镜像给卡片壳。
      // 没给 size 就保持缺席：缺席 = 用类型默认尺寸（布局回退链与卡片壳都认这条），
      // 不在这里凭空造一个尺寸。
      this.syncSizeMirror(node)
      this.nodes.set(id, node)
      // 显式数字 id（复制粘贴 / AI 后台 / 云端合并进来的）也把计数器抬起来：
      // 否则之后发号要一个个跳过，白跑若干轮。
      const numeric = Number.parseInt(id, 10)
      if (!Number.isNaN(numeric) && numeric > this.counter) this.counter = numeric
    }
    this.notify('add')
    return inputs.length
  }

  updateNodeData(id: string, data: Record<string, unknown>): void {
    this.updateNode(id, { data })
  }

  updateNode(id: string, patch: NodePatch): NodeWriteResult {
    const node = this.nodes.get(id)
    if (!node) throw new Error(`[nodeStore] no node "${id}"`)
    const sizeFilled = this.applyPatch(node, patch)
    this.notify('update', id)
    return { sizeFilled }
  }

  updateNodes(entries: NodePatchEntry[]): NodeWriteResult[] {
    if (entries.length === 0) return []
    // 原子：先全量预校验 id 存在，任一缺失即抛错且不产生部分应用
    for (const { id } of entries) {
      if (!this.nodes.has(id)) throw new Error(`[nodeStore] no node "${id}"`)
    }
    const results: NodeWriteResult[] = []
    for (const { id, patch } of entries) {
      results.push({ sizeFilled: this.applyPatch(this.nodes.get(id)!, patch) })
    }
    this.notify('update')
    return results
  }

  /**
   * 原地应用 patch；显式 undefined 的字段用 delete 移除（如 parentId: undefined 解除父子）。
   *
   * 尺寸这一路有两条规则：
   * 1. patch 给了 size → size 是正身，写完顺手把镜像刷成同值；
   * 2. patch 只给了 data.cardWidth/cardHeight（老插件、后台、MCP 那些只写 data 的写法）→
   *    把它们提升成 node.size，让 size 补上、不再恒空。
   *
   * @returns 是否首次建立了 size（供调用方落盘；老节点迁移完成的信号）
   */
  private applyPatch(node: CanvasNode, patch: NodePatch): boolean {
    if (patch.position !== undefined) node.position = { x: patch.position.x, y: patch.position.y }
    if (patch.data !== undefined) node.data = { ...node.data, ...patch.data }
    // 先合并、后删除：同一批既写新值又想清掉的 key，以“删除”为最终意图。
    if (patch.dataUnset !== undefined) {
      for (const key of patch.dataUnset) delete node.data[key]
    }
    if ('size' in patch) {
      if (patch.size === undefined) delete node.size
      else node.size = { w: patch.size.w, h: patch.size.h }
      this.syncSizeMirror(node)
    } else {
      // 只写 data 的旧路径：data 里的卡片尺寸提升为正式 size
      const promoted = nodeSizeOf(node.data)
      if (promoted !== undefined && node.size === undefined) {
        node.size = { ...promoted }
      }
    }
    if ('parentId' in patch) {
      if (patch.parentId === undefined) delete node.parentId
      else node.parentId = patch.parentId
    }
    const current = nodeSizeOf(node.data)
    return node.size !== undefined && (current?.w !== node.size.w || current?.h !== node.size.h)
  }

  getNode(id: string): CanvasNode | undefined {
    return this.nodes.get(id)
  }

  removeNode(id: string): boolean {
    const removed = this.nodes.delete(id)
    if (removed) this.notify('remove', id)
    return removed
  }

  removeNodes(ids: string[]): number {
    if (ids.length === 0) return 0
    const idSet = new Set(ids)
    let removed = 0
    for (const id of ids) {
      if (this.nodes.delete(id)) removed += 1
    }
    if (removed > 0) {
      // 清掉仍存活子节点指向被删父节点的引用（防悬挂）
      for (const n of this.nodes.values()) {
        if (n.parentId !== undefined && idSet.has(n.parentId)) delete n.parentId
      }
      this.notify('remove')
    }
    return removed
  }

  childNodesOf(parentId: string): CanvasNode[] {
    return [...this.nodes.values()].filter((n) => n.parentId === parentId)
  }

  replaceAll(nodes: CanvasNode[]): void {
    // 存量迁移（一次性）：老存档只写了 data.cardWidth/cardHeight，没有正式字段 size。
    // 回填时把它们提升为 size，并向下刷镜像；size 与镜像都缺的，用类型默认尺寸补上。
    // 不补的话，卡片壳依赖 data 兜底、布局读 size 恒空，两边会长期各说各话。
    const migrated = nodes.map((n) => {
      const data = n.data ? { ...n.data } : {}
      const next: CanvasNode = { ...n, data }
      if (next.size === undefined) {
        const fromData = nodeSizeOf(data)
        if (fromData !== undefined) next.size = { ...fromData }
      }
      this.syncSizeMirror(next)
      return next
    })
    this.nodes.clear()
    for (const n of migrated) this.nodes.set(n.id, n)
    // 重建"每类型名称序号"：让之后新节点的默认名不与存档里已有的撞号
    //（存档里「图片 1」「图片 2」已存在 → 下一个新图片从 3 起）。
    this.typeCounters.clear()
    for (const n of migrated) {
      const label = n.data?.label
      if (typeof label !== 'string') continue
      const m = /(\d+)\s*$/.exec(label.trim())
      if (!m) continue
      const num = Number.parseInt(m[1], 10)
      if (Number.isNaN(num)) continue
      this.typeCounters.set(n.type, Math.max(this.typeCounters.get(n.type) ?? 0, num))
    }
    // 重建计数器：保证新加的 id 不撞已有的数字 id
    let max = 0
    for (const n of migrated) {
      const num = Number.parseInt(n.id, 10)
      if (!Number.isNaN(num) && num > max) max = num
    }
    this.counter = max
    this.notify('replace')
  }

  /**
   * 生成某类型的下一个默认名称（新建节点时写进 data.label）。
   *
   * 模板优先用类型声明的 nameTemplate；没声明就用 label 兜底。
   * - {{ID}}   → 该类型自己的递增序号（**按类型独立**；每个类型一份计数器）
   * - {{NAME}} → 类型的 label
   *
   * 序号只在这里自增：同一次调用拿号即用，不会被用来"试"而浪费。
   */
  private nextDefaultName(def: CanvasNodeType): string {
    const seq = (this.typeCounters.get(def.type) ?? 0) + 1
    this.typeCounters.set(def.type, seq)
    // 兜底也带序号（不是光秃秃的 label）：用户报的问题里"两个节点同名分不清"就是它。
    // 确实想要固定名（如单例节点）的类型，显式写 nameTemplate: '分组' 即可关掉序号。
    const template = def.nameTemplate ?? def.label + ' {{ID}}'
    const name = template.replace(/\{\{ID\}\}/g, String(seq)).replace(/\{\{NAME\}\}/g, def.label)
    return name.trim() || def.label
  }

  /** 短数字 id：'1' '2' '3' …（画布内唯一） */
  private createNodeId(): string {
    this.counter += 1
    return String(this.counter)
  }

  /**
   * 取下一个可用 id 并占掉它。
   *
   * "跳过已被占用的号"这条是必须的：有人用显式 id 插过节点（复制粘贴早期版本、AI 后台建节点、
   * 云端合并进来的）时，计数器可能与实际存量不一致 —— 直接吐号会撞已有的节点，
   * 撞了就会覆盖别人的数据。
   */
  nextId(): string {
    let id = this.createNodeId()
    while (this.nodes.has(id)) id = this.createNodeId()
    return id
  }
}
