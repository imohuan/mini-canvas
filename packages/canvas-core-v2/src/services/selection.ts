/**
 * Selection —— 节点/边选中集合服务（ctx.get('selection')）。
 * 纯逻辑、无 Vue：VueFlow 选中变化由宿主同步进来，命令(如 command:delete)读它删"选中"。
 *
 * v2 双集（用户拍板 2A）：ids 保持"节点 id 集"语义不变（现有命令/删除零改动），
 * 新增 edgeIds 边 id 集 + 边专属增删。onChange 在任一桶变化后触发。
 *
 * 订阅：`onChange(cb)` 在选中集变化(set/add/remove/clear)后触发，供 UI(高亮/派生 ref)跟随单源更新，
 * 避免宿主再另存一份"选中"手工同步。
 */
export interface SelectionService {
  /** 当前选中的节点 id 集合（只读快照） */
  readonly ids: ReadonlySet<string>
  /** 当前选中的边 id 集合（只读快照；v2 新增，节点与边分开跟踪） */
  readonly edgeIds: ReadonlySet<string>
  /** 是否选中了指定节点 id */
  has(id: string): boolean
  /** 是否选中了指定边 id */
  hasEdge(id: string): boolean
  /** 整体设节点选中集 */
  set(ids: Iterable<string>): void
  /** 整体设边选中集 */
  setEdges(ids: Iterable<string>): void
  /** 追加选中一个节点 */
  add(id: string): void
  /** 追加选中一条边 */
  addEdge(id: string): void
  /** 取消选中一个节点 */
  remove(id: string): void
  /** 取消选中一条边 */
  removeEdge(id: string): void
  /** 清空（节点与边两桶一起清） */
  clear(): void
  /** 只清空节点选中桶（保留边选中） */
  clearNodes(): void
  /** 只清空边选中桶（保留节点选中） */
  clearEdges(): void
  /** 选中数量（节点 + 边合计） */
  get size(): number
  /** 订阅选中集变化（任一桶 set/add/remove/clear 后触发）；返回取消订阅函数。 */
  onChange(cb: () => void): () => void
}

export class Selection implements SelectionService {
  private selected = new Set<string>()
  private selectedEdges = new Set<string>()
  private listeners = new Set<() => void>()

  get ids(): ReadonlySet<string> {
    return this.selected
  }
  get edgeIds(): ReadonlySet<string> {
    return this.selectedEdges
  }
  has(id: string): boolean {
    return this.selected.has(id)
  }
  hasEdge(id: string): boolean {
    return this.selectedEdges.has(id)
  }
  set(ids: Iterable<string>): void {
    this.selected = new Set(ids)
    this.notify()
  }
  setEdges(ids: Iterable<string>): void {
    this.selectedEdges = new Set(ids)
    this.notify()
  }
  add(id: string): void {
    this.selected.add(id)
    this.notify()
  }
  addEdge(id: string): void {
    this.selectedEdges.add(id)
    this.notify()
  }
  remove(id: string): void {
    this.selected.delete(id)
    this.notify()
  }
  removeEdge(id: string): void {
    this.selectedEdges.delete(id)
    this.notify()
  }
  clear(): void {
    this.selected.clear()
    this.selectedEdges.clear()
    this.notify()
  }
  clearNodes(): void {
    this.selected.clear()
    this.notify()
  }
  clearEdges(): void {
    this.selectedEdges.clear()
    this.notify()
  }
  get size(): number {
    return this.selected.size + this.selectedEdges.size
  }
  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  private notify(): void {
    for (const l of this.listeners) l()
  }
}

