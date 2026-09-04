/**
 * NodeStore —— 节点数据服务（ctx 注入：ctx.get('nodeStore')）。
 *
 * M4 最小实体，验证：
 * - 节点 type 用业务类型（'text'），不再是 v1 的全 'custom'。
 * - 节点 id 短数字累加（createNodeId），废弃 v1 的 `node-{type}-{Date.now()}`。
 * - 内容组件经 updateNodeData 上报改动（治 v1 text 编辑不写回 data）。
 */

/** 画布节点数据的最小可持久化形状 */
export interface CanvasNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}

/** 节点类型定义（M4 只关心 content 组件 + 默认尺寸；完整 schema 见 M3） */
export interface CanvasNodeType {
  type: string
  label: string
  defaultSize: { w: number; h: number }
  /** 声明式连接约束（M5，api.md §四）：target 输入/源类型/端口条数；缺省 = 人人可 source→target 连 */
  inputs?: Array<{ port?: string; accepts?: string[]; limit?: 'single' | 'multi' }>
  outputs?: Array<{ port?: string }>
}

/** NodeStore 作为 ctx 服务暴露的接口 */
export interface NodeStoreService {
  /** 已注册的节点类型（按 type） */
  readonly types: ReadonlyMap<string, CanvasNodeType>
  /** 注册一个节点类型 */
  registerType(def: CanvasNodeType): void
  /** 所有节点 */
  getNodes(): CanvasNode[]
  /** 按 type 在指定坐标建一个节点，返回短 id（如 '1'） */
  addNode(type: string, position: { x: number; y: number }): string
  /** 改某节点 data（内容组件上报改动入口） */
  updateNodeData(id: string, data: Record<string, unknown>): void
  /** 取某节点 */
  getNode(id: string): CanvasNode | undefined
  /** 删除某节点（返回是否删到） */
  removeNode(id: string): boolean
  /** 用持久化数据整体回填（刷新恢复） */
  replaceAll(nodes: CanvasNode[]): void
}

/** 实现：节点数据 + 每画布自增 id 计数器 */
export class NodeStore implements NodeStoreService {
  readonly types = new Map<string, CanvasNodeType>()
  private nodes = new Map<string, CanvasNode>()
  private counter = 0

  registerType(def: CanvasNodeType): void {
    if (this.types.has(def.type)) {
      throw new Error(`[nodeStore] node type "${def.type}" already registered`)
    }
    this.types.set(def.type, def)
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
    this.nodes.set(id, {
      id,
      type,
      position,
      data: {},
    })
    return id
  }

  updateNodeData(id: string, data: Record<string, unknown>): void {
    const node = this.nodes.get(id)
    if (!node) throw new Error(`[nodeStore] no node "${id}"`)
    node.data = { ...node.data, ...data }
  }

  getNode(id: string): CanvasNode | undefined {
    return this.nodes.get(id)
  }

  removeNode(id: string): boolean {
    return this.nodes.delete(id)
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
  }

  /** 短数字 id：'1' '2' '3' …（画布内唯一） */
  private createNodeId(): string {
    this.counter += 1
    return String(this.counter)
  }
}
