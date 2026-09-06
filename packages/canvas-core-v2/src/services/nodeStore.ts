/**
 * NodeStore —— 节点数据服务（ctx 注入：ctx.get('nodeStore')）。
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
}

/** updateNodes 的批量条目：id + 该节点 patch */
export interface NodePatchEntry {
  id: string
  patch: NodePatch
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
  /** 输入口最多接几条入边（缺省 1）；满额挤出由调用方(render commit)处理 */
  capacity?: number
}

/** 节点类型定义 */
export interface CanvasNodeType {
  type: string
  label: string
  defaultSize: { w: number; h: number }
  /** 声明式连接约束：target 输入/源类型/端口条数；缺省 = 人人可 source→target 连 */
  inputs?: PortDef[]
  outputs?: PortDef[]
}

/** NodeStore 作为 ctx 服务暴露的接口 */
export interface NodeStoreService {
  /** 已注册的节点类型（按 type） */
  readonly types: ReadonlyMap<string, CanvasNodeType>
  /** 注册一个节点类型 */
  registerType(def: CanvasNodeType): void
  /** 注销一个节点类型（热卸插件时回收；不存在则 no-op） */
  unregisterType(type: string): void
  /** 所有节点 */
  getNodes(): CanvasNode[]
  /** 按 type 在指定坐标建一个节点，返回短 id（如 '1'） */
  addNode(type: string, position: { x: number; y: number }): string
  /** 批量插入节点：可指定 id/data/size/parentId；返回实际插入数量。广播一次 add。 */
  addNodes(inputs: AddNodeInput[]): number
  /** 改某节点 data（内容组件上报改动入口；等价 updateNode(id,{data})） */
  updateNodeData(id: string, data: Record<string, unknown>): void
  /** 任意字段更新（position/size/parentId/data；显式 undefined 清字段）。节点不存在抛错。广播一次 update。 */
  updateNode(id: string, patch: NodePatch): void
  /** 批量更新：不同节点各自 patch；原子广播一次 update。 */
  updateNodes(entries: NodePatchEntry[]): void
  /** 取某节点 */
  getNode(id: string): CanvasNode | undefined
  /** 删除某节点（返回是否删到） */
  removeNode(id: string): boolean
  /** 批量删除；若删到父节点，自动清仍存活子节点的 parentId（防悬挂）。广播一次 remove。 */
  removeNodes(ids: string[]): number
  /** 某父节点直属子节点（无则空数组） */
  childNodesOf(parentId: string): CanvasNode[]
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
  private listeners = new Set<NodeStoreListener>()

  subscribe(listener: NodeStoreListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 广播节点集变化给订阅方 */
  private notify(reason: NodeStoreChangeReason, nodeId?: string): void {
    for (const l of this.listeners) l(reason, nodeId)
  }

  registerType(def: CanvasNodeType): void {
    if (this.types.has(def.type)) {
      throw new Error(`[nodeStore] node type "${def.type}" already registered`)
    }
    this.types.set(def.type, def)
  }

  unregisterType(type: string): void {
    this.types.delete(type)
  }

  getNodes(): CanvasNode[] {
    return [...this.nodes.values()]
  }

  addNode(type: string, position: { x: number; y: number }): string {
    const def = this.types.get(type)
    if (!def) {
      throw new Error(`[nodeStore] unknown node type "${type}". Register it first.`)
    }
    const id = this.createNodeId()
    this.nodes.set(id, { id, type, position, data: {} })
    this.notify('add', id)
    return id
  }

  addNodes(inputs: AddNodeInput[]): number {
    if (inputs.length === 0) return 0
    // 原子：先全量预校验 type 存在，任一非法即抛错且不产生部分插入
    for (const input of inputs) {
      if (!this.types.has(input.type)) {
        throw new Error(`[nodeStore] unknown node type "${input.type}". Register it first.`)
      }
    }
    for (const input of inputs) {
      const id = input.id ?? this.createNodeId()
      this.nodes.set(id, {
        id,
        type: input.type,
        position: { x: input.position.x, y: input.position.y },
        data: input.data ? { ...input.data } : {},
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.size !== undefined ? { size: { ...input.size } } : {}),
      })
    }
    this.notify('add')
    return inputs.length
  }

  updateNodeData(id: string, data: Record<string, unknown>): void {
    this.updateNode(id, { data })
  }

  updateNode(id: string, patch: NodePatch): void {
    const node = this.nodes.get(id)
    if (!node) throw new Error(`[nodeStore] no node "${id}"`)
    this.applyPatch(node, patch)
    this.notify('update', id)
  }

  updateNodes(entries: NodePatchEntry[]): void {
    if (entries.length === 0) return
    // 原子：先全量预校验 id 存在，任一缺失即抛错且不产生部分应用
    for (const { id } of entries) {
      if (!this.nodes.has(id)) throw new Error(`[nodeStore] no node "${id}"`)
    }
    for (const { id, patch } of entries) {
      this.applyPatch(this.nodes.get(id)!, patch)
    }
    this.notify('update')
  }

  /** 原地应用 patch；显式 undefined 的字段用 delete 移除（如 parentId: undefined 解除父子） */
  private applyPatch(node: CanvasNode, patch: NodePatch): void {
    if (patch.position !== undefined) node.position = { x: patch.position.x, y: patch.position.y }
    if (patch.data !== undefined) node.data = { ...node.data, ...patch.data }
    if ('size' in patch) {
      if (patch.size === undefined) delete node.size
      else node.size = { w: patch.size.w, h: patch.size.h }
    }
    if ('parentId' in patch) {
      if (patch.parentId === undefined) delete node.parentId
      else node.parentId = patch.parentId
    }
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
    this.nodes.clear()
    for (const n of nodes) this.nodes.set(n.id, n)
    // 重建计数器：保证新加的 id 不撞已有的数字 id
    let max = 0
    for (const n of nodes) {
      const num = Number.parseInt(n.id, 10)
      if (!Number.isNaN(num) && num > max) max = num
    }
    this.counter = max
    this.notify('replace')
  }

  /** 短数字 id：'1' '2' '3' …（画布内唯一） */
  private createNodeId(): string {
    this.counter += 1
    return String(this.counter)
  }
}



