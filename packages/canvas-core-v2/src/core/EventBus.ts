/** 事件总线（cordis 语义分发 + 单源 emit，不碰 window）。
 *
 * 分发模式（对齐 cordis events.ts）：
 * - emit      同步广播；不等待/收集返回的 promise 与值。
 * - parallel  所有监听并发运行并一同等待。
 * - serial    按顺序 await；第一个非 null/false/undefined 返回(bail 值)胜出并停止。
 * - bail      serial 的同步版（同步短路）。
 * - waterfall 环绕中间件：最后参数是 next continuation；监听器可转写其返回值或短路。
 *
 * 底层监听统一 `(...args)=>void`（rest-arg），因此单 payload 事件（emit(name, obj)）与
 * cordis 多参事件（emit('stats/report', a, b)）都能承载。on 返回 off 句柄（可经 Scope/Fiber 自动回收）。
 * dev 白名单：对未在 CanvasEventMap/扩展登记的事件名 emit 给提示。
 */
export type DispatchMode = 'emit' | 'parallel' | 'serial' | 'bail' | 'waterfall'

/** bail 判定：返回非 null/false/undefined 即短路 */
export function isBailed(value: any): boolean {
  return value !== null && value !== false && value !== undefined
}

export class EventBus {
  private handlers = new Map<string, Set<(...args: any[]) => any>>()

  /** dev 下是否对"未在 CanvasEventMap 声明"的 emit 给 warn（治漏转发静默失效） */
  private devWhitelistWarn: boolean

  constructor(options: { devWhitelistWarn?: boolean } = {}) {
    this.devWhitelistWarn = options.devWhitelistWarn ?? false
  }

  /** 解析某事件名的监听列表（按注册序）。 */
  private hooks(name: string): Array<(...args: any[]) => any> {
    return [...(this.handlers.get(name) ?? [])]
  }

  /** 订阅事件（自动随所属 scope/fiber 回收由调用方 scope.onDispose 负责）。返回取消订阅句柄。 */
  on(name: string, handler: (...args: any[]) => any): () => void {
    let set = this.handlers.get(name)
    if (!set) {
      set = new Set()
      this.handlers.set(name, set)
    }
    set.add(handler)
    return () => this.off(name, handler)
  }

  /** 订阅一次。 */
  once(name: string, handler: (...args: any[]) => any): () => void {
    const off = this.on(name, (...args) => {
      off()
      handler(...args)
    })
    return off
  }

  /** 取消订阅。 */
  off(name: string, handler: (...args: any[]) => any): void {
    const set = this.handlers.get(name)
    if (!set) return
    set.delete(handler)
    if (set.size === 0) this.handlers.delete(name)
  }

  /** 派发：同步广播，忽略监听返回值（不等待 promise）。 */
  emit(name: string, ...args: any[]): void {
    for (const cb of this.hooks(name)) {
      try {
        cb(...args)
      } catch {
        /* 单个监听抛错不阻断其它 */
      }
    }
  }

  /** 并发跑所有监听并等待全部 settle（有拒绝则 AggregateError）。 */
  async parallel(name: string, ...args: any[]): Promise<void> {
    const results = await Promise.allSettled(this.hooks(name).map((cb) => cb(...args)))
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (rejected.length) {
      throw new AggregateError(rejected.map((r) => r.reason))
    }
  }

  /** 顺序 await，第一个 bail 值(non-null/false/undefined)胜出并停止。 */
  async serial(name: string, ...args: any[]): Promise<any> {
    for (const cb of this.hooks(name)) {
      const result = await cb(...args)
      if (isBailed(result)) return result
    }
  }

  /** 同步短路（serial 的同步版）。 */
  bail(name: string, ...args: any[]): any {
    for (const cb of this.hooks(name)) {
      const result = cb(...args)
      if (isBailed(result)) return result
    }
  }

  /**
   * 环绕中间件。最后一个参数视为"最内层 next"（内置行为）；监听器最外层先跑：
   * 调用 next() 进入下一层；不调用直接返回=有意短路（否决下游）。
   */
  waterfall(name: string, ...args: any[]): any {
    const cbs = this.hooks(name)
    const inner = args.pop()
    let idx = 0
    const next = () => {
      const cb = cbs[idx++] ?? inner
      return cb(...args)
    }
    args.push(next)
    return next()
  }

  /** 清空所有监听。 */
  clear(): void {
    this.handlers.clear()
  }

  /** 某事件是否有监听者（供决定是否需要构造昂贵 payload） */
  has(name: string): boolean {
    return (this.handlers.get(name)?.size ?? 0) > 0
  }
}

/**
 * 已知事件名的运行时登记表：让 dev 白名单 warn 能工作。
 * 纯编译期 interface 无法被运行时枚举，故以登记表代替；插件/内核扩展时 registerEventName 追加。
 */
const knownEvents = new Set<string>(['ctx:ready', 'ctx:plugin-installed', 'ctx:plugin-uninstalled', 'ctx:lifecycle-change'])

/** 插件扩展事件时，把新增事件名登记进来（配合 dev 白名单 warn）。 */
export function registerEventName(name: string): void {
  knownEvents.add(name)
}

/** 是否已知事件名 */
export function hasKnownEvent(name: string): boolean {
  return knownEvents.has(name)
}
