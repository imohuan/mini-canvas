import { EventBus } from './EventBus'
import { Scope } from './Scope'
import { depsOf } from './topo'
import { buildCapabilities } from './capabilities'
import { SlotRegistry } from './registry/slotRegistry'
import { SettingsStore } from './settingsStore'
import { Fiber, FiberState } from './fiber'
import type {
  CanvasEventMap,
  Disposable,
  EffectFn,
  EventListener,
  EventName,
  PluginCapabilities,
  PluginModule,
  PluginScope,
} from './types'
import { Lifecycle } from './types'

/**
 * 每个插件在 setup(ctx) 里拿到的"能力视图"见 types.ts 的 PluginScope（Context 实现之）。
 */

/** Context 生命周期状态 */
export type ContextState = 'created' | 'started' | 'stopped'

/**
 * 跑一个插件的注册函数：Cordis 式用 apply，旧式用 setup，apply 优先。
 * 返回值（cleanup/Disposable）由调用方登记进插件 scope，卸载即清。
 */
export function runPlugin(
  mod: PluginModule,
  ctx: PluginScope,
): void | (() => void) | Disposable {
  if (mod.apply) return mod.apply(ctx)
  if (mod.setup) return mod.setup(ctx)
  return undefined
}

/**
 * Context —— 根上下文（宿主创建：createContext()，然后 plugin()×N，最后 start()）。
 *
 * 职责（API 契约定稿）：
 * - 装载/生命周期：plugin / start / stop
 * - 服务注入：inject / get
 * - 类型化事件：on / once / emit（单源）
 * - 作用域副作用：effect
 */
export class Context implements PluginScope {
  readonly bus: EventBus
  private readonly rootScope = new Scope()
  private services = new Map<string, unknown>()
  private plugins = new Map<string, PluginModule>()
  private pluginScopes = new Map<string, Scope>()
  private lifecycles = new Map<string, Lifecycle>()
  /** 每插件一个 fiber 运行时句柄（P1：状态机 + 可 await/dispose） */
  private fibers = new Map<string, Fiber>()
  private state: ContextState = 'created'
  private dev = false
  /** 依赖扫描是否进行中（防止 provide 在 drain 内触发 reentrant drain） */
  private draining = false
  /** 内置通用 UI 槽容器（ctx.slots 写这里，宿主可经 ctx.get('slots') 读同一实例渲染） */
  private readonly builtinSlots = new SlotRegistry()
  /** 内置分组配置单一数据源（ctx.settings 写这里；host 可经 ctx.get('settings') 读） */
  private builtinSettings = new SettingsStore()
  // 能力段（nodes/theme/commands/slots/settings）在构造里由 buildCapabilities 挂到根 Context（宿主也可经它注册）
  readonly nodes!: PluginCapabilities['nodes']
  readonly theme!: PluginCapabilities['theme']
  readonly commands!: PluginCapabilities['commands']
  readonly slots!: PluginCapabilities['slots']
  readonly settings!: PluginCapabilities['settings']

  constructor(options: { dev?: boolean } = {}) {
    this.dev = options.dev ?? false
    this.bus = new EventBus({ devWhitelistWarn: this.dev })
    Object.assign(this, buildCapabilities(this, '<host>'))
  }

  // ==================== 生命周期 ====================

  /**
   * 装载一个插件模块（登记；真正 setup 在 start()）。该插件的 fiber 句柄可经 ctx.fiber(name) 取得。
   */
  plugin(mod: PluginModule): this {
    this.assertState('created', 'plugin')
    if (this.plugins.has(mod.name)) {
      throw new Error(`[core] Duplicate plugin name: "${mod.name}"`)
    }
    this.plugins.set(mod.name, mod)
    this.attachFiber(mod.name, mod)
    return this
  }

  /** 启动：按"服务/插件依赖"确定性多轮激活 → 依赖满足的插件逐个 setup → 其余 PENDING → emit ctx:ready。 */
  async start(): Promise<void> {
    this.assertState('created', 'start')
    this.state = 'started'

    // 依赖满足即可激活：无依赖的插件先激活（登记序）；其 provide/inject 的服务与 ACTIVE 插件成为后续依赖的满足来源。
    const activated = this.drain()
    this.bus.emit('ctx:ready', { plugins: activated })
  }

  /**
   * 确定性多轮扫描：反复激活"所有 inject 依赖现已满足"的插件，直到无新进展。
   * 依赖满足判定（每项 d）：
   *   - 已注入/提供 的服务名（services map，含内置 slots/settings）→ 满足；
   *   - 或 是已登记插件名且其 fiber 已 ACTIVE → 满足；
   *   - 否则该插件停留 PENDING（cordis 语义：不抛，等提供方出现后由 wakePending 唤醒）。
   * 激活顺序 = plugins map 登记序（确定性）。
   * @returns 本批实际激活(含已 ACTIVE 的计数)的插件名数组
   */
  private drain(): string[] {
    if (this.draining) return [] // 已在扫描中（避免 provide 触发 reentrant drain）
    this.draining = true
    const activated: string[] = []
    try {
      let progressed = true
      while (progressed) {
        progressed = false
        for (const name of this.listPlugins()) {
          if (this.fibers.get(name)?.state === 'active') continue // 已激活
          if (this.plugins.has(name) && this.tryActivate(name)) {
            activated.push(name)
            progressed = true
          }
        }
      }
    } finally {
      this.draining = false
    }
    return activated
  }

  /** 判定某插件 inject 依赖项是否现已满足 */
  private depSatisfied(d: string): boolean {
    if (d === 'slots' || d === 'settings') return true // 内置实例恒在
    if (this.services.has(d)) return true // 已注入/提供的服务
    // 已登记插件名且 ACTIVE
    if (this.plugins.has(d)) {
      const fiber = this.fibers.get(d)
      if (fiber && fiber.state === 'active') return true
    }
    return false
  }

  /**
   * 尝试激活一个插件：依赖满足则 setup 并置 ACTIVE，返回 true；依赖不满足则保持 PENDING 返回 false。
   * setup 抛错：置 FAILED 并抛出（半成品副作用已回收）。
   */
  private tryActivate(name: string): boolean {
    const mod = this.plugins.get(name)!
    const deps = depsOf(mod)
    if (deps.some((d) => !this.depSatisfied(d))) return false // PENDING，等依赖

    this.setLifecycle(name, Lifecycle.INSTALLING)
    this.setLifecycle(name, Lifecycle.ACTIVATING)
    const fiber = this.attachFiber(name, mod)
    fiber.markLoading()
    const scope = this.rootScope.child()
    this.pluginScopes.set(name, scope)
    const scopeCtx = this.deriveScope(scope, name)
    let cleanup: void | (() => void) | Disposable
    try {
      cleanup = runPlugin(mod, scopeCtx)
    } catch (err) {
      this.pluginScopes.delete(name)
      this.plugins.delete(name) // 加载失败：移出插件表（可重装），fiber 保留 FAILED 供诊断
      this.setLifecycle(name, Lifecycle.ERROR)
      scope.dispose() // 半成品副作用也清掉
      fiber.markFailed(err) // 保留 FAILED fiber 供诊断（可重装复用）
      throw err
    }
    if (cleanup) scope.effect(() => cleanup)
    this.setLifecycle(name, Lifecycle.ACTIVE)
    fiber.markActive()
    this.bus.emit('ctx:plugin-installed', { name })
    return true
  }

  /** 唤醒依赖现已满足但仍在 PENDING 的插件（服务被 provide/插件被激活后调用） */
  private wakePending(): void {
    if (this.state !== 'started') return
    this.drain()
  }

  /** 停止：逆序释放各插件 scope（含全部副作用），回到 created 可重新 start。 */
  stop(): void {
    if (this.state !== 'started') return
    // 逆序卸载（依赖方先卸）
    for (const [name, scope] of [...this.pluginScopes.entries()].reverse()) {
      this.setLifecycle(name, Lifecycle.UNINSTALLING)
      scope.dispose()
      this.setLifecycle(name, Lifecycle.UNINSTALLED)
      this.bus.emit('ctx:plugin-uninstalled', { name })
    }
    // 每插件 fiber 同步置 DISPOSED（复用其空容器即时翻转；副作用已由 scope 回收）
    for (const fiber of this.fibers.values()) {
      void fiber.dispose()
    }
    this.pluginScopes.clear()
    this.plugins.clear()
    this.fibers.clear()
    this.services.clear()
    this.builtinSettings = new SettingsStore() // 分组配置随生命周期重置(重启可重新 define)
    this.lifecycles.clear()
    this.state = 'created'
  }

  /** 当前状态 */
  getState(): ContextState {
    return this.state
  }

  // ==================== 动态装载（运行中热装/热卸/热重载） ====================

  /** 是否已处于运行中（started）且可接受动态装/卸 */
  get running(): boolean {
    return this.state === 'started'
  }

  /**
   * 运行中热装一个插件（start 之后调用）：依赖满足则立即可用；否则保持 PENDING 待提供方出现。
   * 等价于冷启动时 plugin()。
   *
   * @throws 未 start / 插件名重复 / setup 抛错（半成品副作用已回收）
   * @returns 插件名
   */
  installPlugin(mod: PluginModule): string {
    this.assertState('started', 'installPlugin')
    if (this.plugins.has(mod.name)) {
      throw new Error(`[core] Duplicate plugin name: "${mod.name}"`)
    }
    this.plugins.set(mod.name, mod)
    this.attachFiber(mod.name, mod) // PENDING fiber 句柄
    try {
      this.tryActivate(mod.name) // 依赖满足→ACTIVE；不满足→保持 PENDING
    } catch (err) {
      this.plugins.delete(mod.name)
      throw err
    }
    // 可能因本插件 provide 的服务满足了先前 PENDING 的插件 → 唤醒
    this.wakePending()
    return mod.name
  }

  /**
   * 运行中热卸一个插件：dispose 它的 Scope → 全部副作用/注册/UI 自动回收。
   * @returns 是否真卸到（未装/已卸返回 false）
   */
  uninstallPlugin(name: string): boolean {
    if (this.state !== 'started') return false
    const scope = this.pluginScopes.get(name)
    if (!scope) return false
    this.setLifecycle(name, Lifecycle.UNINSTALLING)
    scope.dispose()
    this.pluginScopes.delete(name)
    this.plugins.delete(name)
    this.lifecycles.delete(name)
    const fiber = this.fibers.get(name)
    if (fiber) {
      this.fibers.delete(name)
      void fiber.dispose()
    }
    this.bus.emit('ctx:plugin-uninstalled', { name })
    return true
  }

  /** 已装载(含动态)的插件名 */
  listPlugins(): string[] {
    return [...this.plugins.keys()]
  }

  // ==================== 服务注入 ====================

  /** 提供服务；返回撤销（撤销自动登记进当前调用方 scope，若在 setup 内经插件 scope）。 */
  inject<Service>(name: string, impl: Service): () => void {
    if (this.services.has(name)) {
      throw new Error(`[core] Service "${name}" is already injected`)
    }
    this.services.set(name, impl)
    // 服务到位：唤醒依赖它而 PENDING 的插件（running 且非 drain 中才有意义）
    this.wakePending()
    return () => {
      if (this.services.get(name) === impl) this.services.delete(name)
    }
  }

  /** 提供服务（cordis 语义，与 inject 等价）；Service 子类 super(ctx,name) 内部调用。 */
  provide<Service>(name: string, impl: Service): () => void {
    return this.inject(name, impl)
  }

  /** 取服务；缺则抛错（定稿：不静默降级）。'slots'/'settings' 恒为内置实例。 */
  get<Service = unknown>(name: string): Service {
    if (name === 'slots') return this.builtinSlots as unknown as Service
    if (name === 'settings') return this.builtinSettings as unknown as Service
    if (!this.services.has(name)) {
      throw new Error(
        `[core] Service "${name}" is not injected. If a plugin should provide it, declare it in that plugin's deps and inject it.`,
      )
    }
    return this.services.get(name) as Service
  }

  /** 已注入的服务名列表（供 dev 诊断） */
  injectedServices(): string[] {
    return [...this.services.keys()]
  }

  // ==================== 事件 ====================

  on(name: string, handler: (...args: any[]) => any): Disposable {
    const off = this.bus.on(name, handler)
    return { dispose: off }
  }

  once(name: string, handler: (...args: any[]) => any): Disposable {
    const off = this.bus.once(name, handler)
    return { dispose: off }
  }

  emit(name: string, ...args: any[]): void {
    this.bus.emit(name, ...args)
  }

  /** 并发跑所有监听并一同等待 */
  parallel(name: string, ...args: any[]): Promise<void> {
    return this.bus.parallel(name, ...args)
  }

  /** 顺序 await，第一个 bail 值胜出并停止 */
  serial(name: string, ...args: any[]): Promise<any> {
    return this.bus.serial(name, ...args)
  }

  /** serial 的同步版（同步短路） */
  bail(name: string, ...args: any[]): any {
    return this.bus.bail(name, ...args)
  }

  /** 环绕中间件 */
  waterfall(name: string, ...args: any[]): any {
    return this.bus.waterfall(name, ...args)
  }

  // ==================== 副作用 ====================

  effect(fn: EffectFn): Disposable {
    const off = this.rootScope.effect(fn)
    return { dispose: off }
  }

  // ==================== 内部 ====================

  private deriveScope(scope: Scope, pluginName: string): PluginScope {
    const ctx = this
    const api: PluginScope = {
      on(name: string, handler: (...args: any[]) => any): Disposable {
        const off = ctx.bus.on(name, handler)
        scope.onDispose(off)
        return { dispose: off }
      },
      once(name: string, handler: (...args: any[]) => any): Disposable {
        const off = ctx.bus.once(name, handler)
        scope.onDispose(off)
        return { dispose: off }
      },
      emit: (name: string, ...args: any[]) => ctx.bus.emit(name, ...args),
      parallel: (name: string, ...args: any[]) => ctx.bus.parallel(name, ...args),
      serial: (name: string, ...args: any[]) => ctx.bus.serial(name, ...args),
      bail: (name: string, ...args: any[]) => ctx.bus.bail(name, ...args),
      waterfall: (name: string, ...args: any[]) => ctx.bus.waterfall(name, ...args),
      effect(fn: EffectFn): Disposable {
        const off = scope.effect(fn)
        return { dispose: off }
      },
      inject<Service>(name: string, impl: Service): () => void {
        // 经根服务表登记，但撤销挂到本插件 scope（卸载自动清）
        if (ctx.services.has(name)) {
          throw new Error(`[core] Service "${name}" is already injected`)
        }
        ctx.services.set(name, impl)
        const cleanup = () => {
          if (ctx.services.get(name) === impl) ctx.services.delete(name)
        }
        scope.onDispose(cleanup)
        return cleanup
      },
      provide<Service>(name: string, impl: Service): () => void {
        // 与 inject 同义：经根服务表登记、撤销挂本插件 scope
        if (ctx.services.has(name)) {
          throw new Error(`[core] Service "${name}" is already injected`)
        }
        ctx.services.set(name, impl)
        const cleanup = () => {
          if (ctx.services.get(name) === impl) ctx.services.delete(name)
        }
        scope.onDispose(cleanup)
        return cleanup
      },
      get: <Service>(name: string): Service => ctx.get<Service>(name),
      plugin(mod: PluginModule): PluginScope {
        // 嵌套插件：直接并入根（扁平管理），避免 M1 复杂化；可由子类覆盖
        ctx.plugin(mod)
        return api
      },
    } as PluginScope
    // 挂能力段（nodes/theme/commands/slots）：buildCapabilities 只用 api.get + api.effect(插件 scope 绑定)
    Object.assign(api, buildCapabilities(api, pluginName))
    return api
  }

  private setLifecycle(name: string, target: Lifecycle): void {
    this.lifecycles.set(name, target)
    this.bus.emit('ctx:lifecycle-change', { name, lifecycle: target })
  }

  /**
   * 取某插件的 fiber 句柄（查状态/await/dispose）。未装/已卸返回 undefined。
   * @param name 插件名
   */
  fiber(name: string): Fiber | undefined {
    return this.fibers.get(name)
  }

  /** 建/取某插件的 fiber；deps 以插件 inject 字段初始化。 */
  private attachFiber(name: string, mod: PluginModule): Fiber {
    let fiber = this.fibers.get(name)
    if (fiber) return fiber
    fiber = new Fiber({ name, deps: mod.inject ?? mod.deps ?? [] })
    this.fibers.set(name, fiber)
    return fiber
  }

  private assertState(expect: ContextState, op: string): void {
    if (this.state !== expect) {
      throw new Error(
        `[core] Cannot ${op} when state is "${this.state}" (expected "${expect}"). Call start() first.`,
      )
    }
  }
}
