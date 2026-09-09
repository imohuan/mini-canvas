/**
 * EdgeStore —— 边(edge)数据服务（ctx 注入：ctx.get('edgeStore')）。纯逻辑、零 Vue、Node 可单测。
 *
 * 动机（settings-panel-slot-host-plan §三.D / 边下沉内核）：v2 里边原本只是 CanvasHost 的本地 VueFlow
 * 视觉态(edges ref)，不落盘、不进历史、无法撤销；换 canvas 渲染后端时没有任何"边数据源"可画。
 * 本服务把边的数据/增删/订阅收进内核，与 NodeStore 同构：
 * - 边的最小可持久化形状 = CanvasEdge { id, source, target, type?, sourceHandle?, targetHandle? }。
 * - 提供增删、按节点连带清边(删节点时)、按存活节点清悬挂边、整体回填(replaceAll/刷新恢复)、订阅。
 * - 渲染层(VueFlow/canvas)只读 edgeStore.getEdges() + subscribe 自动刷渲染态；数据的变更/历史/落盘全在内核。
 */
export interface CanvasEdge {
  id: string
  source: string
  target: string
  /** 边渲染类型键（VueFlow edge type / canvas 后端 type）；缺省 'custom' */
  type?: string
  /** 多端口节点预留：源/目标端口（现单进单出可省略） */
  sourceHandle?: string
  targetHandle?: string
}

/** 新建一条边的请求（id 可不给，由本 store 用 source/target 生成稳定 id） */
export interface AddEdgeRequest {
  source: string
  target: string
  type?: string
  sourceHandle?: string
  targetHandle?: string
}

/** 回填(整体替换)可接受的边：id 可选(缺省按 source/target 生成)，其余同 CanvasEdge */
export type StoredEdgeInput = AddEdgeRequest & { id?: string }

/** 边集变化原因 */
export type EdgeStoreChangeReason = 'add' | 'remove' | 'replace'

/** 订阅回调：reason = 变化类型；edgeId = 本次涉及边（remove/replace 时可能为 undefined） */
export type EdgeStoreListener = (reason: EdgeStoreChangeReason, edgeId?: string) => void

/** EdgeStore 作为 ctx 服务暴露的接口 */
export interface EdgeStoreService {
  /** 所有边（按加入序） */
  getEdges(): CanvasEdge[]
  /** 深拷贝快照（P1-10：安全只读，外部改动不污染 store） */
  getSnapshot(): CanvasEdge[]
  /** 加一条边；id 缺省用 `edgeId(source,target)`，已有同 id 则替换(去重)。返回边 id */
  addEdge(req: AddEdgeRequest): string
  /** 按 id 移除一条边；不存在 no-op。返回是否真移除 */
  removeEdge(id: string): boolean
  /** 移除所有与给定节点相连的边(删节点连带清边)。返回移除的边数 */
  removeEdgesOfNode(nodeId: string): number
  /** 清掉 source/target 不在存活节点集里的悬挂边(整体替换/删除节点后兜底)。返回移除的边数 */
  pruneDanglingEdges(aliveNodeIds: Set<string>): number
  /** 整体回填(刷新恢复/历史 restore)；id 冲突去重、清空重建；无 id 自动按 source/target 生成 */
  replaceAll(edges: StoredEdgeInput[]): void
  /** 取某条边 */
  getEdge(id: string): CanvasEdge | undefined
  /** 订阅边集变化(add/remove/replace 任一触发)。返回取消函数。宿主据此自动把 edgeStore 刷到渲染态 */
  subscribe(listener: EdgeStoreListener): () => void
}

/** 稳定边 id：源→目标。带显式端口时纳入 handle 维度（同源同目标不同端口互不覆盖，P0-5）。
 *  无 handle（或 handle 为默认 'source'/'target'）保持旧格式 e-{s}-{t}，单端口存量零改动。 */
export function edgeStoreId(
  source: string,
  target: string,
  sourceHandle?: string,
  targetHandle?: string,
): string {
  const sh = sourceHandle && sourceHandle !== 'source' ? sourceHandle : ''
  const th = targetHandle && targetHandle !== 'target' ? targetHandle : ''
  if (!sh && !th) return `e-${source}-${target}`
  const srcPart = sh ? `${source}:${sh}` : source
  const tgtPart = th ? `${target}:${th}` : target
  return `e-${srcPart}-${tgtPart}`
}

/** 实现：边数据列表（保序），按 id 索引去重 */
export class EdgeStore implements EdgeStoreService {
  private edges = new Map<string, CanvasEdge>()
  private listeners = new Set<EdgeStoreListener>()

  subscribe(listener: EdgeStoreListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 广播边集变化给订阅方 */
  private notify(reason: EdgeStoreChangeReason, edgeId?: string): void {
    // P2-6：坏订阅者异常不阻断其它订阅者/写操作
    for (const l of this.listeners) {
      try { l(reason, edgeId) } catch { /* 忽略单个订阅者异常 */ }
    }
  }

  getEdges(): CanvasEdge[] {
    return [...this.edges.values()]
  }

  getSnapshot(): CanvasEdge[] {
    return JSON.parse(JSON.stringify([...this.edges.values()])) as CanvasEdge[]
  }

  getEdge(id: string): CanvasEdge | undefined {
    return this.edges.get(id)
  }

  addEdge(req: AddEdgeRequest): string {
    const id = req.source && req.target
      ? edgeStoreId(req.source, req.target, req.sourceHandle, req.targetHandle)
      : `${Date.now()}`
    this.edges.set(id, {
      id,
      source: req.source,
      target: req.target,
      type: req.type ?? 'custom',
      sourceHandle: req.sourceHandle,
      targetHandle: req.targetHandle,
    })
    this.notify('add', id)
    return id
  }

  removeEdge(id: string): boolean {
    const removed = this.edges.delete(id)
    if (removed) this.notify('remove', id)
    return removed
  }

  removeEdgesOfNode(nodeId: string): number {
    let n = 0
    for (const [id, e] of this.edges) {
      if (e.source === nodeId || e.target === nodeId) {
        this.edges.delete(id)
        n++
      }
    }
    if (n > 0) this.notify('remove')
    return n
  }

  pruneDanglingEdges(aliveNodeIds: Set<string>): number {
    let n = 0
    for (const [id, e] of this.edges) {
      if (!aliveNodeIds.has(e.source) || !aliveNodeIds.has(e.target)) {
        this.edges.delete(id)
        n++
      }
    }
    if (n > 0) this.notify('remove')
    return n
  }

  replaceAll(edges: StoredEdgeInput[]): void {
    this.edges.clear()
    for (const e of edges) {
      const id = e.id ?? edgeStoreId(e.source, e.target, e.sourceHandle, e.targetHandle)
      this.edges.set(id, { ...e, id } as CanvasEdge) // 归一化：无 id 者补齐，让对象上 id 与存储键一致
    }
    this.notify('replace')
  }
}






