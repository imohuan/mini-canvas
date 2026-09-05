/**
 * Selection —— 节点/边选中集合服务（ctx.get('selection')）。
 * 纯逻辑、无 Vue：VueFlow 选中变化由宿主同步进来，命令(如 command:delete)读它删"选中"。
 *
 * 订阅：`onChange(cb)` 在选中集变化(set/add/remove/clear)后触发，供 UI(高亮/派生 ref)跟随单源更新，
 * 避免宿主再另存一份"选中"手工同步。
 */
export interface SelectionService {
  /** 当前选中的节点 id 集合（只读快照） */
  readonly ids: ReadonlySet<string>
  /** 是否选中了指定 id */
  has(id: string): boolean
  /** 整体设选中集 */
  set(ids: Iterable<string>): void
  /** 追加选中一个 */
  add(id: string): void
  /** 取消选中一个 */
  remove(id: string): void
  /** 清空 */
  clear(): void
  /** 选中数量 */
  get size(): number
  /** 订阅选中集变化（set/add/remove/clear 后触发）；返回取消订阅函数。 */
  onChange(cb: () => void): () => void
}

export class Selection implements SelectionService {
  private selected = new Set<string>()
  private listeners = new Set<() => void>()

  get ids(): ReadonlySet<string> {
    return this.selected
  }
  has(id: string): boolean {
    return this.selected.has(id)
  }
  set(ids: Iterable<string>): void {
    this.selected = new Set(ids)
    this.notify()
  }
  add(id: string): void {
    this.selected.add(id)
    this.notify()
  }
  remove(id: string): void {
    this.selected.delete(id)
    this.notify()
  }
  clear(): void {
    this.selected.clear()
    this.notify()
  }
  get size(): number {
    return this.selected.size
  }
  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  private notify(): void {
    for (const l of this.listeners) l()
  }
}
