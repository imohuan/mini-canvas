/**
 * Fiber —— 单个插件实例的"运行时句柄 + 生命周期状态机"（cordis 语义，自研、零第三方）。
 *
 * 目标：docs/plan/plugin-cordis-migration-plan.md P1。作者 `ctx.plugin(mod)`/`ctx.installPlugin(mod)`
 * 拿到一个 fiber，可查 state/config/deps、await 到稳定态（成功/失败）、dispose()。
 *
 * 状态机（对齐 cordis FiberState）：
 *   PENDING  →  LOADING  →  ACTIVE
 *       ↘         ↘
 *       (缺依赖)   FAILED（apply/config 抛错）
 *   卸载: ACTIVE/FAILED/PENDING → UNLOADING → DISPOSED（不可再启动）
 *
 * Fiber 也是插件的"副作用容器"：经 ctx 建立的注册（on/inject/provide/nodes.register…）都
 * onDispose/effect 进本 fiber，dispose() 时按注册逆序逐个跑清理，**支持异步 disposer**（逐项 await、
 * 单错不阻断），最终 DISPOSED。dispose() 幂等。
 *
 * 本类独立于 Context 可单测；Context 的插件装载路径逐步切到它（见 PLAN P1）。
 */
/** fiber 生命周期状态（cordis FiberState；用字符串名便于诊断/展示/比较） */
export const enum FiberState {
  /** 已声明 / 在等所需服务（P2 起：依赖未到齐即停留此态） */
  PENDING = 'pending',
  /** apply / config 正在跑 */
  LOADING = 'loading',
  /** 已加载并提供服务 */
  ACTIVE = 'active',
  /** apply 或 config 校验抛错 */
  FAILED = 'failed',
  /** disposer 正在跑（清理中） */
  UNLOADING = 'unloading',
  /** 已卸载，不可再启动 */
  DISPOSED = 'disposed',
}

/** fiber 清理函数：可同步返回、可返回 promise（异步 disposer） */
export type FiberDisposer = () => void | Promise<void>

/** fiber 事件回调（ctx 注入用：emit internal/status / lifecycle 事件） */
export interface FiberTransition {
  (next: FiberState, prev: FiberState, fiber: Fiber): void
}

/** Fiber 构造入参 */
export interface FiberInit {
  /** 插件唯一名 */
  name: string
  /** 依赖服务名（P2 PENDING 编排用） */
  deps?: string[]
  /** 初始状态（默认 PENDING） */
  state?: FiberState
}

/**
 * Fiber —— 插件实例的运行时句柄 + 状态机 + 副作用容器（自研 cordis 语义）。
 */
export class Fiber {
  /** 插件唯一名 */
  readonly name: string
  /** 依赖服务名（P2 用于 PENDING 编排） */
  readonly deps: string[]
  /** 装配 config（P4 起由 ctx 在激活前填好） */
  config: unknown

  private _state: FiberState
  private _error: unknown
  /** 登记在案的清理项（注册序；dispose 逆序跑） */
  private cleanups: Array<{ fn: FiberDisposer; done: boolean }> = []
  /** 在途的异步 effect（其 setup 尚未 resolve，清理尚未登记）；dispose 时先等齐再跑清理 */
  private inflight = new Set<Promise<void>>()
  private _disposeStarted = false
  private _settled?: Promise<void>

  /** 状态变化回调（ctx 注入，用于 emit internal/status） */
  onTransition: FiberTransition | undefined

  constructor(init: FiberInit) {
    this.name = init.name
    this.deps = init.deps ?? []
    this._state = init.state ?? FiberState.PENDING
  }

  /** 当前生命周期状态 */
  get state(): FiberState {
    return this._state
  }

  /** 当前状态可读名 */
  get stateName(): string {
    return this._state
  }

  /** 是否已释放（DISPOSED） */
  get isDisposed(): boolean {
    return this._state === FiberState.DISPOSED
  }

  /** 出错原因（FAILED 后可用） */
  get error(): unknown {
    return this._error
  }

  /**
   * 登记一个清理项（插件经 ctx 建立的注册副作用都进这里）。
   * 返回"提前手动执行并从队列移除"的句柄（幂等）。
   */
  onDispose(fn: FiberDisposer): () => void {
    if (this._state === FiberState.DISPOSED || this._disposeStarted) {
      // 已卸载：立即执行（防泄漏），幂等返回空操作
      void this.safeRun(fn)
      return () => {}
    }
    const item = { fn, done: false }
    this.cleanups.push(item)
    let removed = false
    return () => {
      if (removed || item.done) return
      removed = true
      const idx = this.cleanups.indexOf(item)
      if (idx >= 0) this.cleanups.splice(idx, 1)
    }
  }

  /**
   * effect(fn)：立即执行 fn；若 fn 返回清理函数（同步或 promise）则登记进本 fiber。
   * 对齐 cordis ctx.effect。fn 也可返回一个 generator/iterable，逐个登记其产出的清理。
   * @param label 诊断标签（预留，当前仅注释）
   */
  effect(fn: () => unknown, _label?: string): () => void {
    const result = fn()
    return this.collectResult(result)
  }

  /** 把 effect 产出归入清理列表（支持单清理函数 / 迭代器产出多个） */
  private collectResult(result: unknown): () => void {
    if (typeof result === 'function') {
      return this.onDispose(result as FiberDisposer)
    }
    if (result && typeof (result as { dispose?: unknown }).dispose === 'function') {
      const d = result as { dispose(): void | Promise<void> }
      return this.onDispose(() => d.dispose())
    }
    if (result && typeof (result as { then?: unknown }).then === 'function') {
      // 异步 effect：主体 resolve 后才知清理；登记进"在途"，dispose 时先等齐再跑
      let off: () => void = () => {}
      const p = Promise.resolve(result).then((v) => {
        if (this._disposeStarted || this._state === FiberState.DISPOSED) {
          // 卸载已在途/已完成：拿到的清理直接执行，不再入队
          if (typeof v === 'function') return this.safeRun(v as FiberDisposer)
          // 对象/迭代器形态在异步下从简：若带 dispose 则执行
          if (v && typeof (v as { dispose?: unknown }).dispose === 'function') {
            return this.safeRun(() => (v as { dispose(): void }).dispose())
          }
          return
        }
        off = this.collectResult(v)
      })
      const tracked = p.then(() => undefined, () => undefined)
      this.inflight.add(tracked)
      void tracked.finally(() => this.inflight.delete(tracked))
      return () => {
        if (!off) return
        off()
      }
    }
    if (result && typeof (result as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function') {
      const iterable = result as Iterable<unknown>
      const offs: Array<() => void> = []
      for (const v of iterable) offs.push(this.collectResult(v))
      return () => offs.forEach((o) => o())
    }
    return () => {}
  }

  /** 推进到指定状态；真变化才触发 onTransition */
  private transition(next: FiberState): void {
    if (this._state === next) return
    if (this._state === FiberState.DISPOSED) return // 已释放不再迁移
    const prev = this._state
    this._state = next
    this.onTransition?.(next, prev, this)
  }

  /** apply 开始跑前调用：PENDING→LOADING */
  markLoading(): void {
    this.transition(FiberState.LOADING)
  }

  /** apply 成功跑完：LOADING→ACTIVE */
  markActive(): void {
    this._error = undefined
    this.transition(FiberState.ACTIVE)
  }

  /**
   * 把 ACTIVE 的插件回退为 PENDING（P6/P2b2 语义：提供方被卸/换，依赖方随之回退等重载）。
   * 不清副作用清理队列（其副作用由调用方经 scope.dispose 回收），只翻转状态供 drain 重新装载。
   * 对 DISPOSED 无效（transition 在 DISPOSED 上 no-op）。
   */
  markPending(): void {
    this._error = undefined
    this.transition(FiberState.PENDING)
  }

  /** apply/config 抛错：LOADING→FAILED */
  markFailed(err: unknown): void {
    this._error = err
    this.transition(FiberState.FAILED)
  }

  /** 单个清理：跑 fn，吞掉自己的 rejection/异常（单错不阻断） */
  private async safeRun(fn: FiberDisposer): Promise<void> {
    try {
      await fn()
    } catch {
      /* 单错不阻断 */
    }
  }

  /**
   * 卸载本 fiber：逆序逐个跑清理（支持异步 disposer，逐项 await、单错不阻断），
   * 全部结束后置 DISPOSED。幂等：重复调用返回同一完成 promise。
   */
  dispose(): Promise<void> {
    if (this._settled) return this._settled
    this._disposeStarted = true
    if (this._state !== FiberState.DISPOSED) {
      this.transition(FiberState.UNLOADING)
    }
    this._settled = (async () => {
      // 先等齐在途异步 effect 的 setup（其清理登记好），避免卸载时漏跑
      if (this.inflight.size) {
        await Promise.allSettled([...this.inflight])
      }
      const items = this.cleanups.splice(0).reverse()
      // 逆序逐个 await，单错不阻断
      for (const item of items) {
        item.done = true
        await this.safeRun(item.fn)
      }
      this.cleanups = []
      if (this._state !== FiberState.DISPOSED) {
        this.transition(FiberState.DISPOSED)
      }
    })()
    return this._settled
  }

  /**
   * 等到 fiber 落到稳定态：
   * - ACTIVE / DISPOSED → resolve(本 fiber)
   * - FAILED → reject(error)
   * - 仍 PENDING/LOADING/UNLOADING → resolve(本 fiber 当前态)；真正的装载/卸载由 ctx 驱动
   */
  settle(): Promise<this> {
    if (this._state === FiberState.ACTIVE || this._state === FiberState.DISPOSED) {
      return Promise.resolve(this)
    }
    if (this._state === FiberState.FAILED) {
      return Promise.reject(this._error)
    }
    return Promise.resolve(this)
  }
}
