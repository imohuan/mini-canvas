/**
 * Selection —— 节点/边选中集合服务（ctx.get('selection')）。
 * 纯逻辑、无 Vue：VueFlow 选中变化由宿主同步进来，命令(如 command:delete)读它删"选中"。
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
}

export class Selection implements SelectionService {
  private selected = new Set<string>()

  get ids(): ReadonlySet<string> {
    return this.selected
  }
  has(id: string): boolean {
    return this.selected.has(id)
  }
  set(ids: Iterable<string>): void {
    this.selected = new Set(ids)
  }
  add(id: string): void {
    this.selected.add(id)
  }
  remove(id: string): void {
    this.selected.delete(id)
  }
  clear(): void {
    this.selected.clear()
  }
  get size(): number {
    return this.selected.size
  }
}
