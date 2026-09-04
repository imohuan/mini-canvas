import { EventBus } from './EventBus'
import { Scope } from './Scope'
import { topoSort } from './topo'
import type {
  CanvasEventMap,
  Disposable,
  EffectFn,
  EventListener,
  EventName,
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
  private state: ContextState = 'created'
  private dev = false

  constructor(options: { dev?: boolean } = {}) {
    this.dev = options.dev ?? false
    this.bus = new EventBus({ devWhitelistWarn: this.dev })
  }

  // ==================== 生命周期 ====================

  /** 装载一个插件模块（仅登记；真正 setup 在 start()）。 */
  plugin(mod: PluginModule): this {
    this.assertState('created', 'plugin')
    if (this.plugins.has(mod.name)) {
      throw new Error(`[core] Duplicate plugin name: "${mod.name}"`)
    }
    this.plugins.set(mod.name, mod)
    return this
  }

  /** 启动：拓扑排序 → 逐个 setup → 全部 ACTIVE → emit ctx:ready。 */
  async start(): Promise<void> {
    this.assertState('created', 'start')
    this.state = 'started'

    const modules = [...this.plugins.values()]
    const order = topoSort(modules)

    for (const name of order) {
      const mod = this.plugins.get(name)!
      this.setLifecycle(name, Lifecycle.INSTALLING)
      this.setLifecycle(name, Lifecycle.ACTIVATING)
      const scope = this.rootScope.child()
      this.pluginScopes.set(name, scope)
      const scopeCtx = this.deriveScope(scope)
      let cleanup: void | (() => void) | Disposable
      try {
        cleanup = mod.setup(scopeCtx)
      } catch (err) {
        this.setLifecycle(name, Lifecycle.ERROR)
        scope.dispose() // 半成品副作用也清掉
        throw err
      }
      if (cleanup) scope.effect(() => cleanup)
      this.setLifecycle(name, Lifecycle.ACTIVE)
      this.bus.emit('ctx:plugin-installed', { name })
    }

    this.bus.emit('ctx:ready', { plugins: order })
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
    this.pluginScopes.clear()
    this.plugins.clear()
    this.services.clear()
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
   * 运行中热装一个插件（start 之后调用）：为它建子 Scope → 跑 setup → 记录。
   * 成功后立即可见（注册的服务/UI/命令都生效），等价于冷启动时 plugin()。
   *
   * @throws 未 start / 插件名重复 / setup 抛错（半成品副作用已回收）
   * @returns 插件名
   */
  installPlugin(mod: PluginModule): string {
    this.assertState('started', 'installPlugin')
    if (this.plugins.has(mod.name)) {
      throw new Error(`[core] Duplicate plugin name: "${mod.name}"`)
    }
    // 登记进模块表（与冷启动共用），供诊断/list
    this.plugins.set(mod.name, mod)

    // 单插件建子 Scope + setup（与 start 内逐插件的逻辑一致）
    const scope = this.rootScope.child()
    this.pluginScopes.set(mod.name, scope)
    this.setLifecycle(mod.name, Lifecycle.INSTALLING)
    this.setLifecycle(mod.name, Lifecycle.ACTIVATING)
    const scopeCtx = this.deriveScope(scope)
    try {
      const cleanup = mod.setup(scopeCtx)
      if (cleanup) scope.effect(() => cleanup)
    } catch (err) {
      this.pluginScopes.delete(mod.name)
      this.plugins.delete(mod.name)
      scope.dispose() // 半成品副作用也清掉
      this.setLifecycle(mod.name, Lifecycle.ERROR)
      throw err
    }
    this.setLifecycle(mod.name, Lifecycle.ACTIVE)
    this.bus.emit('ctx:plugin-installed', { name: mod.name })
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
    return () => {
      if (this.services.get(name) === impl) this.services.delete(name)
    }
  }

  /** 取服务；缺则抛错（定稿：不静默降级）。 */
  get<Service = unknown>(name: string): Service {
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

  on<K extends EventName>(name: K, handler: EventListener<K>): Disposable {
    const off = this.bus.on(name, handler)
    return { dispose: off }
  }

  once<K extends EventName>(name: K, handler: EventListener<K>): Disposable {
    const off = this.bus.once(name, handler)
    return { dispose: off }
  }

  emit<K extends EventName>(name: K, payload: CanvasEventMap[K]): void {
    this.bus.emit(name, payload)
  }

  // ==================== 副作用 ====================

  effect(fn: EffectFn): Disposable {
    const off = this.rootScope.effect(fn)
    return { dispose: off }
  }

  // ==================== 内部 ====================

  private deriveScope(scope: Scope): PluginScope {
    const ctx = this
    const api: PluginScope = {
      on<K extends EventName>(name: K, handler: EventListener<K>): Disposable {
        const off = ctx.bus.on(name, handler)
        scope.onDispose(off)
        return { dispose: off }
      },
      once<K extends EventName>(name: K, handler: EventListener<K>): Disposable {
        const off = ctx.bus.once(name, handler)
        scope.onDispose(off)
        return { dispose: off }
      },
      emit: (name, payload) => ctx.bus.emit(name, payload),
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
      get: <Service>(name: string): Service => ctx.get<Service>(name),
      plugin(mod: PluginModule): PluginScope {
        // 嵌套插件：直接并入根（扁平管理），避免 M1 复杂化；可由子类覆盖
        ctx.plugin(mod)
        return api
      },
    }
    return api
  }

  private setLifecycle(name: string, target: Lifecycle): void {
    this.lifecycles.set(name, target)
    this.bus.emit('ctx:lifecycle-change', { name, lifecycle: target })
  }

  private assertState(expect: ContextState, op: string): void {
    if (this.state !== expect) {
      throw new Error(
        `[core] Cannot ${op} when state is "${this.state}" (expected "${expect}"). Call start() first.`,
      )
    }
  }
}
