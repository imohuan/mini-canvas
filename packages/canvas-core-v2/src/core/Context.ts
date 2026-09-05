import { EventBus } from './EventBus'
import { Scope } from './Scope'
import { depsOf } from './topo'
import { buildCapabilities } from './capabilities'
import { SlotRegistry } from './registry/slotRegistry'
import { SettingsStore } from './settingsStore'
import { Fiber, FiberState } from './fiber'
import { resolveConfig, optionValues, selectOptionEntry } from './configSchema'
import type { ConfigSchema, ConfigField } from './configSchema'
import type { SettingSchema } from './settingsStore'
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

/** 单个插件的运行时态快照（P5：宿主/管理器/console 做 fiber 状态可查与 PENDING 诊断的只读视图） */
export interface PluginRuntimeStatus {
  /** 插件唯一名 */
  name: string
  /** fiber 状态名（pending/loading/active/failed/unloading/disposed，字符串便于展示/比较） */
  state: string
  /** 该插件 deps 中此刻仍未满足的依赖（仅当 state!=='active' 才可能非空；对齐 depSatisfied 判定） */
  missingDeps: string[]
  /** FAILED 时的错误信息（message 字符串，便于面板/console 展示）；非 FAILED 缺省 */
  error?: string
}

/** 把错误归一成可展示的 message（Error 取 message，其余 String 兜底） */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 跑一个插件的注册函数：Cordis 式用 apply(收校验后 config)，旧式用 setup，apply 优先。
 * 返回值（cleanup/Disposable）由调用方登记进插件 scope，卸载即清。
 */
export function runPlugin(
  mod: PluginModule,
  ctx: PluginScope,
  config?: unknown,
): void | (() => void) | Disposable {
  if (mod.apply) return mod.apply(ctx, config as never)
  if (mod.setup) return mod.setup(ctx)
  return undefined
}

/** 把 config schema 字段映射成 SettingsStore 的 SettingSchema（type 收敛：string→text），供面板长控件。 */
function toSettingSchema(field: ConfigField): SettingSchema {
  const type = field.type === 'string' ? 'text' : field.type
  return {
    type,
    default: field.default,
    ...(field.label !== undefined ? { label: field.label } : {}),
    ...(field.min !== undefined ? { min: field.min } : {}),
    ...(field.max !== undefined ? { max: field.max } : {}),
    ...(field.options
      ? { options: optionValues(field.options).map((value) => {
          const entry = field.options!.find((o) => (typeof o === 'string' ? o === value : o.value === value))
          const withLabel = entry ? selectOptionEntry(entry) : { value }
          return { value: withLabel.value, label: withLabel.label }
        }) }
      : {}),
  }
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
  /** 每插件的装配 config（P4：ctx.plugin/installPlugin 第二参存入，激活时经其 Config schema 校验） */
  private configs = new Map<string, unknown>()
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
   * @param config 装配 config（可选）：start 激活时经插件 `Config` schema 校验+补默认，再传给 apply(ctx, config)。
   */
  plugin(mod: PluginModule, config?: unknown): this {
    this.assertState('created', 'plugin')
    if (this.plugins.has(mod.name)) {
      throw new Error(`[core] Duplicate plugin name: "${mod.name}"`)
    }
    this.plugins.set(mod.name, mod)
    if (config !== undefined) this.configs.set(mod.name, config)
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
   * 装配 config 经其 `Config` schema 校验（缺默认补齐），失败 → fiber FAILED 并抛出（响亮报错）。
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
    // P4：装配 config 经 schema 校验 + 补默认 → 填 fiber.config、声明进 settings 单一数据源、传给 apply
    let config: object | undefined
    try {
      config = resolveConfig(mod.Config, this.configs.get(name))
    } catch (err) {
      this.plugins.delete(name) // 校验失败：移出插件表（可重装），fiber 保留 FAILED 供诊断
      this.configs.delete(name)
      this.setLifecycle(name, Lifecycle.ERROR)
      fiber.markFailed(err)
      throw err
    }
    fiber.config = config
    const scope = this.rootScope.child()
    this.pluginScopes.set(name, scope)
    // config 字段声明进 settings 单一数据源（scope=插件名），并随插件 scope 回收（热卸/重载清）
    if (mod.Config) {
      this.declareConfigIntoStore(mod.Config, config as Record<string, unknown>, name, scope)
    }
    const scopeCtx = this.deriveScope(scope, name)
    let cleanup: void | (() => void) | Disposable
    try {
      cleanup = runPlugin(mod, scopeCtx, config)
    } catch (err) {
      this.pluginScopes.delete(name)
      this.plugins.delete(name) // 加载失败：移出插件表（可重装），fiber 保留 FAILED 供诊断
      this.configs.delete(name)
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

  /**
   * 把插件 `Config` schema 的字段登记进内置 settings 单一数据源（scope=声明该 config 的插件）。
   * 每个字段按它携带的 group 分组（缺省=插件名），初值=装配校验后的 config 值；UI 面板据此长控件并实时 set。
   */
  private declareConfigIntoStore(
    schema: ConfigSchema,
    config: Record<string, unknown>,
    pluginName: string,
    scope: Scope,
  ): void {
    const store = this.builtinSettings
    for (const [key, field] of Object.entries(schema)) {
      const itemSchema = toSettingSchema(field)
      if (!store.has(key)) store.define(field.group ?? pluginName, { [key]: itemSchema }, pluginName)
      // define 初值=itemSchema.default(=schema 默认)；装配校验后的 config 可能覆盖默认 → 补齐成单一数据源当前值
      store.set(key, config[key] as string | number | boolean)
    }
    // 随插件 scope 回收：热卸/重载清掉它声明的配置项（防残留与重装撞 key）
    scope.onDispose(() => store.removeByScope(pluginName))
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
    this.configs.clear()
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
   * @param config 装配 config（可选）：激活时经插件 `Config` schema 校验+补默认再传 apply；校验失败 → fiber FAILED + 抛错。
   * @throws 未 start / 插件名重复 / config 校验失败 / setup 抛错（半成品副作用已回收）
   * @returns 插件名
   */
  installPlugin(mod: PluginModule, config?: unknown): string {
    this.assertState('started', 'installPlugin')
    if (this.plugins.has(mod.name)) {
      throw new Error(`[core] Duplicate plugin name: "${mod.name}"`)
    }
    this.plugins.set(mod.name, mod)
    if (config !== undefined) this.configs.set(mod.name, config)
    this.attachFiber(mod.name, mod) // PENDING fiber 句柄
    try {
      this.tryActivate(mod.name) // 依赖满足→ACTIVE；不满足→保持 PENDING
    } catch (err) {
      this.plugins.delete(mod.name)
      this.configs.delete(mod.name)
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
    this.configs.delete(name)
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

  /**
   * P5 只读查询：每个"已装/仍在 runtime"插件的运行时态快照，供宿主/管理器/console 诊断。
   *
   * 覆盖两类条目：
   * - `plugins` 表里的插件（ACTIVE / PENDING…）；
   * - 已从 `plugins` 表移出但 fiber 仍保留的 **FAILED** 插件（config/setup 抛错后保留供诊断，可重装复用）。
   * `missingDeps` = 该插件 deps 中此刻未满足的项（判定对齐私有 depSatisfied：既非内置 slots/settings、也非已注入
   * 服务名、也非"已登记且 ACTIVE"的插件名）。state!=='active' 时据此回答"到底缺哪个依赖"。
   * 纯只读，不改动装载/编排/激活逻辑。
   */
  inspectPlugins(): PluginRuntimeStatus[] {
    const names = new Set<string>([...this.plugins.keys(), ...this.fibers.keys()])
    return [...names].map((name): PluginRuntimeStatus => {
      const fiber = this.fibers.get(name)
      const state = fiber?.stateName ?? 'pending'
      const deps = fiber?.deps ?? depsOf(this.plugins.get(name) ?? {}) ?? []
      const missingDeps = state === 'active' ? [] : deps.filter((d) => !this.depSatisfied(d))
      const base: PluginRuntimeStatus = { name, state, missingDeps }
      if (state === 'failed' && fiber?.error !== undefined) base.error = errorMessage(fiber.error)
      return base
    })
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
