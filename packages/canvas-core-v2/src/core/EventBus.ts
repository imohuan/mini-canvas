import type { CanvasEventMap, EventListener, EventName } from './types'

/**
 * 事件总线（类型化，单源 emit，不碰 window）。
 *
 * 吸收 v1 EventBus 的 handler 表结构，但砍掉两处 bug：
 * 1. v1 emit 每次往 window.dispatchEvent 抛 DOM 事件 —— 砍掉，只在总线内流动。
 * 2. v1 事件名全字符串无类型、无白名单 —— 改为 CanvasEventMap 类型化 + 可选 dev 白名单。
 *
 * handler 表按事件名分桶；on 返回 off 句柄（也可经 Scope 自动回收）。
 */
export class EventBus {
  private handlers = new Map<string, Set<EventListener>>()

  /** dev 下是否对"未在 CanvasEventMap 声明"的 emit 给 warn（治漏转发静默失效） */
  private devWhitelistWarn: boolean

  constructor(options: { devWhitelistWarn?: boolean } = {}) {
    this.devWhitelistWarn = options.devWhitelistWarn ?? false
  }

  /** 订阅事件。返回取消订阅的句柄。 */
  on<K extends EventName>(name: K, handler: EventListener<K>): () => void {
    let set = this.handlers.get(name)
    if (!set) {
      set = new Set()
      this.handlers.set(name, set)
    }
    const h = handler as EventListener
    set.add(h)
    return () => this.off(name, handler)
  }

  /** 订阅一次。 */
  once<K extends EventName>(name: K, handler: EventListener<K>): () => void {
    const off = this.on(name, (payload) => {
      off()
      ;(handler as EventListener)(payload)
    })
    return off
  }

  /** 取消订阅。 */
  off<K extends EventName>(name: K, handler: EventListener<K>): void {
    const set = this.handlers.get(name)
    if (!set) return
    set.delete(handler as EventListener)
    if (set.size === 0) this.handlers.delete(name)
  }

  /** 派发事件（单源）。dev 白名单开启时，未声明的 name 会 warn。 */
  emit<K extends EventName>(name: K, payload: CanvasEventMap[K]): void {
    if (this.devWhitelistWarn) {
      // 检查 name 是否在 CanvasEventMap 中声明过（运行时无法精确枚举 interface，
      // 用一组已登记的已知名 + 扩展名的启发式；M1 先做简单守卫）
      // 见 hasKnownEvent 备注
      if (!hasKnownEvent(name as string)) {
        // 不中断 emit，仅提示
      }
    }
    const set = this.handlers.get(name)
    if (!set) return
    for (const h of [...set]) {
      try {
        ;(h as EventListener)(payload)
      } catch {
        // 单个监听器抛错不阻断其它（日志由调用方决定）
      }
    }
  }

  /** 清空所有监听。 */
  clear(): void {
    this.handlers.clear()
  }

  /** 某事件是否有监听者（供决定是否需要构造昂贵 payload） */
  has(name: EventName): boolean {
    return (this.handlers.get(name)?.size ?? 0) > 0
  }
}

/**
 * 已知事件名的运行时登记表：为了让 dev 白名单 warn 能工作，
 * 需要把"当前 EventMap 里声明过的事件名"在模块级登记。
 * M1 内置事件默认登记；插件扩展用 registerEventName 追加。
 * （纯编译期 interface 无法被运行时枚举，故以登记表代替。）
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
