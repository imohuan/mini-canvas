/**
 * History —— 撤销/重做服务（ctx.get('history')）。最小版：对"节点图整体快照"做差异栈。
 *
 * 契约见 api.md §3.3：内核默认"变更即历史"——命令/节点操作经 `withRecord` 包一层即自动入历史，
 * 不再各插件手写 record。本实现用最简的"操作前后快照"栈（非逐字段 diff，够 M3 用）。
 *
 * 设计：不依赖具体 nodeStore，靠构造时注入 `snapshot()/restore(s)` 一对能力（内存/深度拷贝交给调用方），
 * 因此可独立单测。
 */
export interface HistorySnapshot<T = unknown> {
  snapshot(): T
  restore(s: T): void
}

export interface HistoryService {
  /** 撤销上一次记录（无则 no-op） */
  undo(): void
  /** 重做（无则 no-op） */
  redo(): void
  /**
   * 包一层执行 fn 并自动记录进历史：
   * - fn 执行前后各拍一次快照，若前后不同则入 undo 栈、清空 redo 栈。
   */
  withRecord<TResult>(fn: () => TResult): TResult
  canUndo(): boolean
  canRedo(): boolean
  /** 历史长度（测试/诊断用） */
  get undoDepth(): number
}

export class History implements HistoryService {
  private undoStack: unknown[] = []
  private redoStack: unknown[] = []
  private capturing = false

  constructor(private store: HistorySnapshot) {}

  undo(): void {
    const before = this.undoStack.pop()
    if (before === undefined) return
    this.redoStack.push(this.store.snapshot())
    this.store.restore(before)
  }

  redo(): void {
    const after = this.redoStack.pop()
    if (after === undefined) return
    this.undoStack.push(this.store.snapshot())
    this.store.restore(after)
  }

  withRecord<TResult>(fn: () => TResult): TResult {
    // 嵌套 withRecord 只记最外层：内层不重复拍快照
    if (this.capturing) return fn()
    this.capturing = true
    const before = this.store.snapshot()
    try {
      const out = fn()
      const after = this.store.snapshot()
      // 只有真变了才记（原子操作内部多次改，合并成一条历史）
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        this.undoStack.push(before)
        this.redoStack = []
      }
      return out
    } finally {
      this.capturing = false
    }
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }
  canRedo(): boolean {
    return this.redoStack.length > 0
  }
  get undoDepth(): number {
    return this.undoStack.length
  }
}
