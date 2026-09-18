/**
 * Registry —— 通用"注册场"（纯逻辑，零 Vue，Node 可单测）。
 *
 * 定位（见 docs/design/core-layers-and-registry.md §2.1）：把"按【种类】放/取一串【条目】"
 * 这件事收口成内核自带的一个原语。它和 ctx.on / ctx.effect 一样是 ctx 自带的方法，
 * **不占服务名**；画布那套 ctx.nodes / ctx.theme 将来只是它的糖。
 *
 * 与 SlotRegistry 的关系：SlotRegistry 是本接口的雏形（slot=key、occupant=entry），
 * 本类补齐 §2.1 要求而 SlotRegistry 缺的部分——wrap / resolve / keys / source，
 * 以及"add 返回 { id, dispose() }"（老调用方取 .id = 今天的 string，新调用方可 .dispose()）。
 * 步骤 1 只新增，SlotRegistry 原样保留。
 *
 * 栈序（决策 2，最易埋雷处）：**order 小者在最外**（= 覆盖者 / 优先级高）。
 * - list(key) 按 order 升序 = 从外到里；第一条就是覆盖者；
 * - top(key) = order 最小者，等价于 SlotRegistry.first() 与 ThemeRegistry.winner()；
 * - 同 order 稳定保放入序（后放者排在后，不覆盖）；想要覆盖就显式给更小的 order。
 */
import type { Disposable } from '../types'

/** 缺省 order：统一取 0（见决策 2；"已有最大 + 1"那种是节点段的语义，属糖，不属场） */
const DEFAULT_ORDER = 0

/**
 * 场里的一条。source = **谁放的**，是"分不清谁是谁"的解药。
 *
 * source 怎么来的：由 RegistryImpl 的 source 解析器给出。Context 挂给插件时，
 * 解析器 = 该插件的名字（registryOf 在插件 scope 上被调用，放置方就是那个插件）；
 * 宿主直接放置时为 '<host>'；独立 new RegistryImpl() 不传解析器时为 '<anonymous>'。
 */
export interface Entry<T> {
  /** 条目 id（同 key 内唯一；同 id 再 add = 替换该条） */
  id: string
  /** 值（组件 / 命令 / 描述，opaque） */
  value: T
  /** 排序：小 = 在外 / 覆盖者 */
  order: number
  /** 谁放的（插件名 / '<host>' / '<anonymous>'） */
  source: string
}

/** 叠加器：wrap 放的"包住下一层"的函数，收到 inner（下面那层）返回新的 T */
export type RegistryWrapper<T> = (inner: T, entry: Entry<T>) => T

/**
 * 注册场（设计文档 §2.1 逐字对齐）。
 *
 * 写：add / remove / clear / clearByPrefix
 * 读：list / top / get / has / ids / keys
 * 组合与订阅：wrap / resolve / subscribe
 */
export interface Registry<T> {
  /**
   * 放一条。同 id 重复 = 替换该 id 那条（不新增）。
   * @returns { id, dispose() }：老调用方取 .id（= 今天的 string），新调用方可 .dispose()。
   */
  add(key: string, value: T, opts?: { id?: string; order?: number }): { id: string; dispose(): void }
  /** 移除某条；不存在返回 false */
  remove(key: string, id: string): boolean
  /** 清空某键 */
  clear(key: string): void
  /** 清空某前缀下全部键 */
  clearByPrefix(prefix: string): void
  /** 整摞，按 order 升序 = 从外到里（覆盖者在最前）；空键 [] */
  list(key: string): Entry<T>[]
  /** 最外面那条 = order 最小者；空键 undefined（= 今天的 first()） */
  top(key: string): Entry<T> | undefined
  /** 按 id 精确取 */
  get(key: string, id: string): Entry<T> | undefined
  /** 某键是否已有条目 */
  has(key: string): boolean
  /** 某键已有条目的 id 列表（诊断 / 热卸用） */
  ids(key: string): string[]
  /** 已有条目的键列表（诊断 / 枚举用） */
  keys(): string[]
  /**
   * 包住下一层：fn 收到 inner（下面那层）返回新的 T。**缺省放在最外**（order = 当前最小 - 1）。
   * wrap 层在 list()/get() 里同样可见——它的 value 就是这个包函数本身（查历史层用）。
   * @returns 该层的撤销句柄（dispose 即移除这一层，其余层原位不动）
   */
  wrap(key: string, fn: RegistryWrapper<T>, opts?: { id?: string; order?: number }): Disposable
  /** 合成好的那一个：从里到外逐层套完；空键 undefined */
  resolve(key: string): T | undefined
  /** 变了通知我（渲染侧订阅重绘）；返回取消订阅句柄 */
  subscribe(fn: () => void): Disposable
}

/** 场里的一格：对外是 entry，对内额外记住"它是不是叠加器" */
interface Slot<T> {
  entry: Entry<T>
  wrapper?: RegistryWrapper<T>
}

/**
 * 场的一次变化（**可选**订阅口，给"表本身"接事件的实现用，如模型可调用工具场的 tools/* 事件）。
 *
 * 为什么在 impl 这一层而不是在 bind 视图：注册/撤销可能来自任何插件（也可能被同 id 顶替），
 * 只有表本身知道每一次进出；接在这里才能保证观察者不漏事件。
 * 与 subscribe() 的分工：subscribe = "变了通知我重绘"（粗粒度）；onChange = "谁进谁出"（带明细）。
 */
export interface RegistryChange<T> {
  /** 'added' = 一条进表（同 id 顶替时先 removed 后 added）；'removed' = 一条离表 */
  type: 'added' | 'removed'
  key: string
  /** 本次变化涉及的那条 */
  entry: Entry<T>
  /** type='added' 且是同 id 顶替时，被顶替掉的旧条 */
  previous?: Entry<T>
}

/** RegistryImpl 构造项 */
export interface RegistryImplOptions<T = unknown> {
  /**
   * 取"当前放置方"的名字，写进 Entry.source。
   * Context 经 bind() 给每个插件盖 source，不需要这个构造项；不传时一律 '<anonymous>'。
   */
  source?: () => string
  /** 每条进出都回调一次（带明细）。缺省不回调——多数场不需要知道谁进谁出 */
  onChange?: (change: RegistryChange<T>) => void
}

/**
 * 注册场的默认实现：一张 Map<key, Map<id, Slot>>，零依赖。
 *
 * 单实例可直接用（测试 / 独立引用）；Context 为每种 kind 各持一份，
 * 经 bind() 给每个插件一个"记住谁在放、放置后自动回收"的视图。
 */
export class RegistryImpl<T> implements Registry<T> {
  /** key → (id → slot)，内层 Map 保 id 插入序（同 order 稳定排先后靠它） */
  private byKey = new Map<string, Map<string, Slot<T>>>()
  private listeners = new Set<() => void>()
  /** 当前放置方（bind 出来的视图各自盖住它） */
  private sourceResolver: () => string
  /** 变化回调（可选）：每条进出一次，带明细 */
  private onChange?: (change: RegistryChange<T>) => void

  constructor(opts: RegistryImplOptions<T> = {}) {
    this.sourceResolver = opts.source ?? (() => '<anonymous>')
    this.onChange = opts.onChange
  }

  // ==================== 写 ====================

  add(
    key: string,
    value: T,
    opts: { id?: string; order?: number } = {},
  ): { id: string; dispose(): void } {
    return this.place(this.sourceResolver(), key, value, opts)
  }

  wrap(
    key: string,
    fn: RegistryWrapper<T>,
    opts: { id?: string; order?: number } = {},
  ): Disposable {
    return this.placeWrapper(this.sourceResolver(), key, fn, opts)
  }

  remove(key: string, id: string): boolean {
    const slots = this.byKey.get(key)
    if (!slots) return false
    const removed = slots.get(id)?.entry
    const ok = slots.delete(id)
    if (slots.size === 0) this.byKey.delete(key) // 键空则回收
    if (ok) {
      this.emitChange({ type: 'removed', key, entry: removed! })
      this.notify() // no-op 不广播（订阅方不必为没发生的事重绘）
    }
    return ok
  }

  clear(key: string): void {
    const slots = this.byKey.get(key)
    if (!slots) return
    const gone = [...slots.values()].map((s) => s.entry)
    this.byKey.delete(key)
    for (const entry of gone) this.emitChange({ type: 'removed', key, entry })
    this.notify()
  }

  clearByPrefix(prefix: string): void {
    if (!prefix) return
    let changed = false
    for (const key of [...this.byKey.keys()]) {
      if (key.startsWith(prefix)) {
        const gone = [...this.byKey.get(key)!.values()].map((s) => s.entry)
        this.byKey.delete(key)
        for (const entry of gone) this.emitChange({ type: 'removed', key, entry })
        changed = true
      }
    }
    if (changed) this.notify()
  }

  // ==================== 读 ====================

  list(key: string): Entry<T>[] {
    const slots = this.byKey.get(key)
    if (!slots) return []
    return [...slots.values()].map((s) => s.entry).sort((a, b) => a.order - b.order)
  }

  top(key: string): Entry<T> | undefined {
    return this.list(key)[0]
  }

  get(key: string, id: string): Entry<T> | undefined {
    return this.byKey.get(key)?.get(id)?.entry
  }

  has(key: string): boolean {
    return (this.byKey.get(key)?.size ?? 0) > 0
  }

  ids(key: string): string[] {
    return [...(this.byKey.get(key)?.keys() ?? [])]
  }

  keys(): string[] {
    return [...this.byKey.keys()]
  }

  // ==================== 组合与订阅 ====================

  /**
   * 从里到外逐层合成：list() 是"外→里"，故**倒着走**（先取最里层当底，再被一层层包上）。
   * - 普通条目 → 它就是当前这层的值（外面有普通条目时会盖住里面那层，这正是"覆盖"）；
   * - wrap 条目 → 调它的 fn(inner) 包住下面那层。
   * 空键返回 undefined；最里层是 wrap 且下面没有底时，inner 收到 undefined。
   */
  resolve(key: string): T | undefined {
    const slots = this.byKey.get(key)
    if (!slots || slots.size === 0) return undefined
    const ordered = [...slots.values()].sort((a, b) => a.entry.order - b.entry.order)
    let acc: T | undefined
    for (let i = ordered.length - 1; i >= 0; i--) {
      const slot = ordered[i]
      acc = slot.wrapper ? slot.wrapper(acc as T, slot.entry) : slot.entry.value
    }
    return acc
  }

  subscribe(fn: () => void): Disposable {
    this.listeners.add(fn)
    return {
      dispose: () => {
        this.listeners.delete(fn)
      },
    }
  }

  // ==================== 绑定视图（Context 给每个插件用的那一层） ====================

  /**
   * 产出一个"知道谁在放"的视图：同一张表、同一个 kind，
   * 但 add/wrap 写进 source（放置方），并把撤销登记进放置方的回收器（插件 fiber / 根 scope）。
   *
   * 为什么要有这一层：表的实例必须各插件共享（不然互相看不见），
   * 但"谁放的"与"卸载时撤哪条"必须按调用方区分 —— 两者只能拆开。
   * @param source 放置方名字（插件名 / '<host>'）
   * @param onDispose 把撤销登记进放置方回收器（缺省不自动回收）
   */
  bind(source: string, onDispose?: (fn: () => void) => void): Registry<T> {
    const self = this
    const safe = (opts?: { id?: string; order?: number }): { id?: string; order?: number } =>
      opts ?? {}
    const keep = (h: { dispose(): void }): void => {
      if (onDispose) onDispose(() => h.dispose())
    }
    return {
      add(key, value, opts) {
        const h = self.place(source, key, value, safe(opts))
        keep(h)
        return h
      },
      wrap(key, fn, opts) {
        const d = self.placeWrapper(source, key, fn, safe(opts))
        keep(d)
        return d
      },
      remove: (key, id) => self.remove(key, id),
      clear: (key) => self.clear(key),
      clearByPrefix: (prefix) => self.clearByPrefix(prefix),
      list: (key) => self.list(key),
      top: (key) => self.top(key),
      get: (key, id) => self.get(key, id),
      has: (key) => self.has(key),
      ids: (key) => self.ids(key),
      keys: () => self.keys(),
      resolve: (key) => self.resolve(key),
      subscribe(fn) {
        // 订阅与放置同权：视图带回收器时（插件视图），监听也随作用域自动解除
        const sub = self.subscribe(fn)
        keep(sub)
        return sub
      },
    }
  }

  // ==================== 内部 ====================

  /** 放一条普通条目 */
  private place(
    source: string,
    key: string,
    value: T,
    opts: { id?: string; order?: number },
  ): { id: string; dispose(): void } {
    const id = opts.id ?? this.genId(key)
    const order = opts.order ?? DEFAULT_ORDER
    const previous = this.byKey.get(key)?.get(id)?.entry
    // 同 id 再放 = 替换该条（连同它原来的 wrapper 身份一起丢掉：它现在是一条普通值）
    const entry: Entry<T> = { id, value, order, source }
    this.ensure(key).set(id, { entry })
    if (previous) this.emitChange({ type: 'removed', key, entry: previous })
    this.emitChange({ type: 'added', key, entry, ...(previous ? { previous } : {}) })
    this.notify()
    return { id, dispose: this.disposer(key, id) }
  }

  /** 放一条叠加器 */
  private placeWrapper(
    source: string,
    key: string,
    fn: RegistryWrapper<T>,
    opts: { id?: string; order?: number },
  ): Disposable {
    const id = opts.id ?? this.genId(key)
    // 缺省放在最外：取当前最小 order 再减一（空键则 0）
    const order = opts.order ?? this.outermostOrder(key)
    const entry: Entry<T> = { id, value: fn as unknown as T, order, source }
    const previous = this.byKey.get(key)?.get(id)?.entry
    this.ensure(key).set(id, { entry, wrapper: fn })
    if (previous) this.emitChange({ type: 'removed', key, entry: previous })
    this.emitChange({ type: 'added', key, entry, ...(previous ? { previous } : {}) })
    this.notify()
    return { dispose: this.disposer(key, id) }
  }

  /** 撤销句柄：幂等（重复 dispose 安全），执行后该条从表里消失 */
  private disposer(key: string, id: string): () => void {
    let live = true
    return () => {
      if (!live) return
      live = false
      this.remove(key, id)
    }
  }

  /** 缺省 wrap 位置 = 最外 = 当前最小 order - 1；空键 0 */
  private outermostOrder(key: string): number {
    const first = this.list(key)[0]
    return first ? first.order - 1 : DEFAULT_ORDER
  }

  private ensure(key: string): Map<string, Slot<T>> {
    let m = this.byKey.get(key)
    if (!m) {
      m = new Map()
      this.byKey.set(key, m)
    }
    return m
  }

  /** 自动 id：key#n（与 SlotRegistry 同形状，便于将来糖薄转发时 id 不变） */
  private genId(key: string): string {
    let n = this.byKey.get(key)?.size ?? 0
    let id = key + '#' + n
    while (this.byKey.get(key)?.has(id)) {
      n++
      id = key + '#' + n
    }
    return id
  }

  private notify(): void {
    for (const l of this.listeners) {
      try {
        l()
      } catch {
        /* 单个订阅者异常不阻断其它 */
      }
    }
  }

  /** 变化回调：与 notify 同一条原则——单个观察者异常不阻断注册本身 */
  private emitChange(change: RegistryChange<T>): void {
    if (!this.onChange) return
    try {
      this.onChange(change)
    } catch {
      /* 观察者抛错不影响表的状态 */
    }
  }
}
