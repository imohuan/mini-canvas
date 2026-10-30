/**
 * History —— 撤销/重做实现（**5c 起不再是 ctx 服务名**：由 canvas-base 建好交给 doc，
 * 撤销重做消费方一律 ctx.get('doc')）。最小版：对"节点图整体快照"做差异栈。
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

export interface HistoryOptions {
  /**
   * 撤销栈上限（条）。超限时丢**最旧**的一条。
   *
   * 为什么必须有：每条记录都是「操作前的整图深拷贝」—— 200 节点的画布一张快照就几十 KB，
   * 不设上限时连续拖拽几百次就是几十 MB 常驻内存，且每次 withRecord 还要序列化两遍整图。
   * 用户报的「画布用久了越来越卡、最后崩」里有这一份。
   */
  limit?: number
}

export class History implements HistoryService {
  /**
   * 默认上限：100 条。
   *
   * 取值理由：普通用户一次会话里「想撤回去」的距离远小于 100 步；再往前翻靠刷新/重新打开
   * 也基本不会（历史不落盘）。100 × 单张快照的体量对常见画布是可接受的上限，
   * 同时足够覆盖「批量删除 + 连续拖拽」这类误操作。
   */
  static readonly DEFAULT_LIMIT = 100

  private undoStack: unknown[] = []
  private redoStack: unknown[] = []
  private capturing = false
  private readonly limit: number

  constructor(private store: HistorySnapshot, options: HistoryOptions = {}) {
    const raw = options.limit
    // 非法值（0 / 负数 / NaN / 非数）回落默认：宁可多留几条，也不要把撤销功能整个关掉
    this.limit = typeof raw === 'number' && Number.isFinite(raw) && raw > 0
      ? Math.floor(raw)
      : History.DEFAULT_LIMIT
  }

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
        // 超限丢最旧：新记录永远留住（用户刚做的操作最可能需要撤）
        while (this.undoStack.length > this.limit) this.undoStack.shift()
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
