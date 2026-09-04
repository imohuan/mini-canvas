import type { Disposable, EffectFn } from './types'

/**
 * Scope —— 作用域回收器（v2 与 v1 的分水岭核心增量）。
 *
 * v1 里插件卸载全靠手写 uninstall + 逐个 off，必漏副作用。
 * v2 里每个插件拥有一个 Scope：任何经 scope 登记的副作用（on/effect/inject/子作用域）
 * 都在 scope.dispose() 时一次逆序清光，插件无需写 uninstall。
 *
 * 语义：
 * - LIFO 逆序执行（后注册的先清理，天然贴合"依赖方先卸"）。
 * - 子作用域先于父清理（dispose 时先递归清子）。
 * - 每个清理函数独立 try/catch，一个抛错不阻断其余。
 * - dispose 幂等：重复调用安全。
 */
export class Scope {
  private disposables: Array<() => void> = []
  private children = new Set<Scope>()
  private disposed = false

  /** 是否已释放 */
  get isDisposed(): boolean {
    return this.disposed
  }

  /**
   * 登记一个清理函数到本 scope。返回一个可手动提前执行的句柄（执行后从队列移除）。
   */
  onDispose(fn: () => void): () => void {
    if (this.disposed) {
      // scope 已释放：立即执行（避免泄漏），但幂等返回
      try {
        fn()
      } catch {
        /* 忽略释放后清理的异常 */
      }
      return () => {}
    }
    this.disposables.push(fn)
    let removed = false
    return () => {
      if (removed || this.disposed) return
      removed = true
      const idx = this.disposables.indexOf(fn)
      if (idx >= 0) this.disposables.splice(idx, 1)
    }
  }

  /**
   * effect(fn)：执行 fn，若 fn 返回清理函数则登记进本 scope。
   * 统一覆盖 timer/setInterval/watch/DOM 监听/任何"创建了要清理的东西"的场景。
   * 例：ctx.effect(() => { const t = setInterval(...); return () => clearInterval(t) })
   */
  effect(fn: EffectFn): () => void {
    let cleanup: (() => void) | undefined
    const out = fn()
    if (typeof out === 'function') cleanup = out
    else if (out && typeof (out as Disposable).dispose === 'function') {
      const d = out as Disposable
      cleanup = () => d.dispose()
    }
    return cleanup ? this.onDispose(cleanup) : () => {}
  }

  /** 派生一个子作用域（子先于父释放） */
  child(): Scope {
    const child = new Scope()
    this.children.add(child)
    return child
  }

  /**
   * 释放本 scope：先逆序释放子作用域，再逆序执行本 scope 的清理函数。
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    // 先子后己
    for (const child of [...this.children].reverse()) {
      child.dispose()
    }
    this.children.clear()
    // 本 scope LIFO
    for (const fn of this.disposables.reverse()) {
      try {
        fn()
      } catch {
        /* 单个清理失败不阻断其余 */
      }
    }
    this.disposables = []
  }
}
