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
  /**
   * 合成好的那一个：从里到外逐层套完；空键 undefined。
   *
   * @param base 最里层的**兜底值**（可选）。用于"场外还有一份默认实现"的场景：
   *   例如 `node/shell` 场外还有 theme 槽的默认壳，作者 `wrap` 时应当能收到那份默认壳当 inner，
   *   否则他这个 wrap 拿到的 inner 是 undefined、包不起来（设计文档案例 3/8 要的正是"原值不丢"）。
   *   只给 base、场里没条目时返回 **base 本身**（不是包裹结果）—— 与"'缺省 = 没覆盖'语义一致。
   */
  resolve(key: string, base?: T): T | undefined
  /** 变了通知我（渲染侧订阅重绘）；返回取消订阅句柄 */
  subscribe(fn: () => void): Disposable
}

/**
 * 场里的一格：**一个 id 下的一摞层**。
 *
 * 为什么一摞而不是一条：不同插件常用同一个 id（底栏动作就是活例：内置 web2api 与
 * cloud-client 都注册 web2api:*）。若同 id 直接覆盖，后注册者把先注册者**删掉**，
 * 后注册者一卸载，先注册者那条也整条不见了（用户实测报过："卸载 web2api 后云端配置也没了"）。
 * 叠层之后：后注册的在外（可见），撤销它就露出下面那层 —— 符合规则 1"永不覆盖，只往栈上叠"。
 *
 * 层内以 source（放置方）为身份：**同一插件**同 id 再 add = 替换自己那层（热更语义不变），
 * **不同插件**同 id = 各自一层。排序用 order（小者在外），同 order 保插入序。
 */
interface Slot<T> {
  /** 该 id 下的层，按插入序；对外顺序由 order 排序决定 */
  layers: Layer<T>[]
}

/** 摞里的一层 = 一个放置方放的一条 */
interface Layer<T> {
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
    const slot = slots.get(id)
    if (!slot) return false
    // remove 是"这个 id 整个不要了"：摘掉该 id 下的**整摞**（各放置方都算）
    const gone = slot.layers.map((l) => l.entry)
    slots.delete(id)
    if (slots.size === 0) this.byKey.delete(key) // 键空则回收
    for (const entry of gone) this.emitChange({ type: 'removed', key, entry })
    this.notify()
    return true
  }

  clear(key: string): void {
    const slots = this.byKey.get(key)
    if (!slots) return
    const gone: Entry<T>[] = []
    for (const slot of slots.values()) for (const l of slot.layers) gone.push(l.entry)
    this.byKey.delete(key)
    for (const entry of gone) this.emitChange({ type: 'removed', key, entry })
    this.notify()
  }

  clearByPrefix(prefix: string): void {
    if (!prefix) return
    let changed = false
    for (const key of [...this.byKey.keys()]) {
      if (key.startsWith(prefix)) {
        const gone: Entry<T>[] = []
        for (const slot of this.byKey.get(key)!.values()) for (const l of slot.layers) gone.push(l.entry)
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
    // 每个 id 只出**最外层**那一条（order 小者在外；同 order 后放者在外）——同 id 的层叠
    // 对消费方表现为"只看得见一条"，这正是底栏动作要的语义。
    const out: Entry<T>[] = []
    for (const slot of slots.values()) {
      const visible = this.visibleOf(slot)
      if (visible) out.push(visible.entry)
    }
    return out.sort((a, b) => a.order - b.order)
  }

  top(key: string): Entry<T> | undefined {
    return this.list(key)[0]
  }

  get(key: string, id: string): Entry<T> | undefined {
    const slot = this.byKey.get(key)?.get(id)
    return slot ? this.visibleOf(slot)?.entry : undefined
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
   * 空键返回 undefined（除非给了 base）；最里层是 wrap 且下面没有底时，inner 收到 base（缺省 undefined）。
  */
  resolve(key: string, base?: T): T | undefined {
    const slots = this.byKey.get(key)
    if (!slots || slots.size === 0) return base
    // 每个 id 只贡献**最外层**那一条参与合成（同 id 的多层对消费方是"只看得见最外那条"）。
    const visible: Layer<T>[] = []
    for (const slot of slots.values()) {
      const top = this.visibleOf(slot)
      if (top) visible.push(top)
    }
    const ordered = visible.sort((a, b) => a.entry.order - b.entry.order)
    let acc: T | undefined = base
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
      resolve: (key, base) => self.resolve(key, base),
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
    const entry: Entry<T> = { id, value, order, source }
    // 同 id：**同一个放置方**再放 = 替换自己那层（热更，不叠高）；
    // **不同放置方** = 各占一层（后放者默认在外，撤销它露出下面那层）。
    const previous = this.pushLayer(key, id, { entry })
    this.emitChange({ type: 'added', key, entry, ...(previous ? { previous } : {}) })
    this.notify()
    return { id, dispose: this.disposer(key, id, source, entry) }
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
    const previous = this.pushLayer(key, id, { entry, wrapper: fn })
    this.emitChange({ type: 'added', key, entry, ...(previous ? { previous } : {}) })
    this.notify()
    return { dispose: this.disposer(key, id, source, entry) }
  }

  /**
   * 撤销句柄：幂等（重复 dispose 安全）。**只摘自己放的那一层**，不碰同 id 别人的层。
   *
   * 为什么按 (source, entry) 认层而不是按 id：同 id 可能有多个放置方各一层，
   * 按 id 删会把别人的层一起带走 —— 那正是"卸载 web2api 后云端配置也消失"的成因。
   * 用 entry 引用兜底：同插件同 id 热更后，旧的撤销句柄再 dispose 不应摘掉新放的那层。
   */
  private disposer(key: string, id: string, source: string, entry: Entry<T>): () => void {
    let live = true
    return () => {
      if (!live) return
      live = false
      this.removeLayer(key, id, source, entry)
    }
  }

  /**
   * 把一条压进某 id 的摞里。
   * @returns 被替换掉的旧层（同放置方同 id 热更时），没有则 undefined
   */
  private pushLayer(key: string, id: string, layer: Layer<T>): Entry<T> | undefined {
    const slots = this.ensure(key)
    const slot = slots.get(id)
    if (!slot) {
      slots.set(id, { layers: [layer] })
      return undefined
    }
    // 同一个放置方同 id：替换它自己那层（保持原位置，避免反复热更把层越挪越外/越内）
    const idx = slot.layers.findIndex((l) => l.entry.source === layer.entry.source)
    if (idx >= 0) {
      const previous = slot.layers[idx].entry
      slot.layers[idx] = layer
      return previous
    }
    slot.layers.push(layer)
    return undefined
  }

  /**
   * 摘掉某一层（放置方 + entry 身份都对上才摘）。摘完该 id 一层不剩时连这个 id 一起回收。
   * 找不到那一层就什么都不做（例如句柄已被同插件同 id 的热更换掉）。
   */
  private removeLayer(key: string, id: string, source: string, entry: Entry<T>): void {
    const slots = this.byKey.get(key)
    const slot = slots?.get(id)
    if (!slots || !slot) return
    const idx = slot.layers.findIndex((l) => l.entry === entry && l.entry.source === source)
    if (idx < 0) return
    const [gone] = slot.layers.splice(idx, 1)
    if (slot.layers.length === 0) slots.delete(id)
    if (slots.size === 0) this.byKey.delete(key)
    this.emitChange({ type: 'removed', key, entry: gone.entry })
    this.notify()
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

  /**
   * 一摞层里当前"看得见"的那层 = order 最小者；同 order 取**最后放的**（后放者在外）。
   * 层的插入序天然是"先放的在先"，故同 order 时取数组末尾那条。
   */
  private visibleOf(slot: Slot<T>): Layer<T> | undefined {
    let best: Layer<T> | undefined
    for (const layer of slot.layers) {
      if (!best) {
        best = layer
        continue
      }
      // <= 而非 <：同 order 时后者（数组更靠后 = 更晚放）赢
      if (layer.entry.order <= best.entry.order) best = layer
    }
    return best
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
