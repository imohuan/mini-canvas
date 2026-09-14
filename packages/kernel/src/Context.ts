import { EventBus } from './EventBus'
import { Scope } from './Scope'
import { depsOf } from './topo'
import type { CapabilityLayer } from './capabilityLayer'
import { getDefaultCapabilityLayerFactory } from './capabilityLayer'
import { ToolRegistry } from './toolRegistry'
import type {
  ToolDef,
  ToolFilter,
  ToolInput,
  ToolInvokeOptions,
  ToolResult,
} from './toolRegistry'
import { Fiber, FiberState } from './fiber'
import { resolveConfig } from './configSchema'
import type { ConfigSchema } from './configSchema'
import type {
  Disposable,
  EffectFn,
  EventArgsFor,
  EventHandlerFor,
  PluginCapabilities,
  PluginClassLike,
  PluginModule,
  PluginScope,
} from './types'
import { Lifecycle } from './types'
import { asPluginModule } from './pluginClass'

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
 * 返回值（cleanup/Disposable）由调用方登记进插件 fiber，卸载即清。
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

/**
 * 内核自带的 `ctx.tools` 能力段：把工具注册表的操作收口成作者直接可用的形状。
 *
 * 注册随所属插件 scope 自动回收（ctx.effect）—— 插件卸载后它注册的工具从表里消失。
 * 表本身是内核单实例（`Context.builtinTools`），插件注册进它、别的插件/节点从它取，
 * 于是"加一个模型"= 装一个注册了新工具的插件，消费方零改动。
 *
 * @param ctx 插件 scope 或根 Context（需有 get + effect）
 */
function buildToolSegment(ctx: PluginScope): {
  tools: {
    register(def: ToolDef): void
    unregister(name: string): boolean
    has(name: string): boolean
    get(name: string): ToolDef | undefined
    list(filter?: ToolFilter): ToolDef[]
    invoke(name: string, input: ToolInput, options?: ToolInvokeOptions): Promise<ToolResult>
  }
} {
  const reg = (): ToolRegistry | undefined => ctx.get<ToolRegistry | undefined>('tools') ?? undefined
  return {
    tools: {
      register(def: ToolDef): void {
        const r = reg()
        if (!r) throw new Error('[tools] 内核未提供 tools 服务')
        const handle = r.register(def)
        ctx.effect(() => () => handle.dispose())
      },
      unregister(name: string): boolean {
        return reg()?.unregister(name) ?? false
      },
      has(name: string): boolean {
        return reg()?.has(name) ?? false
      },
      get(name: string): ToolDef | undefined {
        return reg()?.get(name)
      },
      list(filter?: ToolFilter): ToolDef[] {
        return reg()?.list(filter) ?? []
      },
      invoke(name: string, input: ToolInput, options?: ToolInvokeOptions): Promise<ToolResult> {
        const r = reg()
        if (!r) return Promise.resolve({ ok: false, error: '内核未提供 tools 服务' })
        return r.invoke(name, input, options)
      },
    },
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
 *
 * 类型增强缝（cordis ch3 声明合并）：作者 declare module '@mini-canvas/kernel'
 * { interface Context { greeter: GreeterService } } 与下方 class Context 同名 interface 合并，
 * 使 `ctx.greeter` 在本文件声明的 Context 类型上也可见（运行时靠服务解析 Proxy / ctx.get 提供）。
 */
/**
 * Context 的类型 = 框架自身成员 + 能力段（PluginCapabilities）。
 *
 * 为什么用 extends 而非在类里重声明 nodes/theme/…：类的类型只含它自己声明的成员，
 * `implements PluginScope` 不会把属性带进来。让接口继承（空的）能力段接口，能力层经
 * 声明合并补进来的段就自动出现在 ctx 上 —— 于是框架包不必写下任何画布字眼。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Context extends PluginCapabilities {}
export class Context implements PluginScope {
  readonly bus: EventBus
  /** 根作用域：只服务根 ctx.effect（宿主/非插件的顶层副作用）；插件副作用一律归各自 fiber */
  private rootScope = new Scope()
  private services = new Map<string, unknown>()
  private plugins = new Map<string, PluginModule>()
  private lifecycles = new Map<string, Lifecycle>()
  /** 每插件一个 fiber 运行时句柄（P1：状态机 + 副作用容器；卸载即 runDisposers/移除） */
  private fibers = new Map<string, Fiber>()
  /** 每插件的装配 config（P4：ctx.plugin/installPlugin 第二参存入，激活时经其 Config schema 校验） */
  private configs = new Map<string, unknown>()
  private state: ContextState = 'created'
  private dev = false
  /** 依赖扫描是否进行中（防止 provide 在 drain 内触发 reentrant drain） */
  private draining = false
  /**
   * 能力层（可选）：框架不认识的"能力段"由它产出（画布层示例：ctx.nodes/theme/commands/tools/slots/settings）。
   * 来源优先级：构造时显式传入 > 组合根装的全局默认（见 capabilityLayer.setDefaultCapabilityLayerFactory）。
   * 不装能力层的 Context 就是纯插件内核。
   */
  private readonly capabilityLayer?: CapabilityLayer
  /**
   * 内核自带的"工具"注册表（ctx.tools / ctx.get('tools')）。
   *
   * 为什么由内核自带：工具是通用能力——"注册一个外部能力、别人按名调用"，
   * 与画布无关（画布只是消费方之一：把能出图的工具列出给节点）。所以它属框架自带服务，
   * 与 `slots/settings` 这类由能力层提供的段不同：`tools` 不装能力层也**恒在**。
   */
  private builtinTools = new ToolRegistry()

  constructor(options: { dev?: boolean; capabilityLayer?: CapabilityLayer } = {}) {
    this.dev = options.dev ?? false
    this.bus = new EventBus({ devWhitelistWarn: this.dev })
    this.capabilityLayer = options.capabilityLayer ?? getDefaultCapabilityLayerFactory()?.()
    // 内核自带能力段：ctx.tools（恒在）
    Object.assign(this, buildToolSegment(this))
    // 根上下文也要有那层能力段（宿主直接 ctx.nodes.register(...) 时用）
    if (this.capabilityLayer) {
      Object.assign(this, this.capabilityLayer.buildSegments(this, '<host>'))
    }
  }

  // ==================== 生命周期 ====================

  /**
   * 装载一个插件模块（登记；真正 setup 在 start()）。该插件的 fiber 句柄可经 ctx.fiber(name) 取得。
   * 支持类形态（cordis 03）：直接传 Service 子类（如 GreeterService），内核归一成 {name, inject, Config, apply:new 类}
   * 后走与对象插件一致的依赖 PENDING / config 校验 / fiber 回收路径。
   * @param config 装配 config（可选）：start 激活时经插件 `Config` schema 校验+补默认，再传给 apply(ctx, config)。
   */
  plugin(mod: PluginModule, config?: unknown): this
  plugin(mod: PluginClassLike, config?: unknown): this
  plugin(mod: PluginModule | PluginClassLike, config?: unknown): this {
    this.assertState('created', 'plugin')
    const m = asPluginModule(mod)
    if (this.plugins.has(m.name)) {
      throw new Error(`[core] Duplicate plugin name: "${m.name}"`)
    }
    this.plugins.set(m.name, m)
    if (config !== undefined) this.configs.set(m.name, config)
    this.attachFiber(m.name, m)
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
    if (this.builtinService(d) !== undefined) return true // 能力层内置服务恒在
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
    // config 字段声明进配置单一数据源（scope=插件名）；清理随插件 fiber 回收（热卸/重载清）
    if (mod.Config && this.capabilityLayer) {
      const disposeDeclared = this.capabilityLayer.declareConfig(
        mod.Config,
        config as Record<string, unknown>,
        name,
        this.dev,
      )
      fiber.onDispose(disposeDeclared)
    }
    const scopeCtx = this.deriveScope(fiber, name)
    let cleanup: void | (() => void) | Disposable
    try {
      cleanup = runPlugin(mod, scopeCtx, config)
    } catch (err) {
      this.plugins.delete(name) // 加载失败：移出插件表（可重装），fiber 保留 FAILED 供诊断
      this.configs.delete(name)
      this.setLifecycle(name, Lifecycle.ERROR)
      fiber.runDisposers() // 半成品副作用也清掉（不置 DISPOSED，fiber 仍可重装）
      fiber.markFailed(err) // 保留 FAILED fiber 供诊断（可重装复用）
      throw err
    }
    if (cleanup) {
      // runPlugin 返回的 cleanup 一并归入本插件 fiber
      fiber.onDispose(() => {
        if (typeof cleanup === 'function') cleanup()
        else if (cleanup && typeof (cleanup as Disposable).dispose === 'function') (cleanup as Disposable).dispose()
      })
    }
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

  /** 停止：逆序释放各插件 fiber（含全部副作用，async disposer 也会被触发/等待），回到 created 可重新 start。 */
  stop(): void {
    if (this.state !== 'started') return
    // 逆序卸载（依赖方先卸）；dispose() 同步跑掉同步 disposer、并启动异步 disposer 结算
    for (const name of [...this.fibers.keys()].reverse()) {
      this.setLifecycle(name, Lifecycle.UNINSTALLING)
      void this.fibers.get(name)?.dispose()
      this.setLifecycle(name, Lifecycle.UNINSTALLED)
      this.bus.emit('ctx:plugin-uninstalled', { name })
    }
    // 释放根作用域（宿主 ctx.effect 注册的顶层副作用随 stop 一起回收，防 restart 泄漏）
    this.rootScope.dispose()
    this.rootScope = new Scope()
    this.plugins.clear()
    this.fibers.clear()
    this.configs.clear()
    this.services.clear()
    this.builtinTools = new ToolRegistry() // 内核自带工具表随生命周期重置（插件工具已随 fiber 注销，这里清残留）
    this.capabilityLayer?.reset() // 能力层内置服务随生命周期重置（由能力层决定重建什么）
    this.lifecycles.clear()
    this.state = 'created'
  }

  /**
   * 同步停止 + 等待全部插件异步 disposer 结算（P1-3）。
   * 页面关闭/宿主卸载需确保最后一批异步清理（如异步保存）完成时调用；
   * 内部先执行与 stop() 相同的同步清理，再 await 各 fiber 的 dispose 结算。
   */
  async stopAsync(): Promise<void> {
    // 先同步触发全部 fiber dispose（disposers 同步项立即跑；异步项进结算），
    // 收集其 settle promise 供下方等待 —— 顺序与 stop() 一致（逆序卸载）
    const settling: Array<Promise<unknown>> = []
    for (const name of [...this.fibers.keys()].reverse()) {
      const d = this.fibers.get(name)?.dispose()
      if (d) settling.push(d)
    }
    this.stop() // 同步清理 + 重置状态（与现 stop 同语义）
    if (settling.length) await Promise.allSettled(settling)
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
   * 等价于冷启动时 plugin()。支持类形态（Service 子类）与 PluginModule 对象。
   *
   * @param config 装配 config（可选）：激活时经插件 `Config` schema 校验+补默认再传 apply；校验失败 → fiber FAILED + 抛错。
   * @throws 未 start / 插件名重复 / config 校验失败 / setup 抛错（半成品副作用已回收）
   * @returns 插件名
   */
  installPlugin(mod: PluginModule, config?: unknown): string
  installPlugin(mod: PluginClassLike, config?: unknown): string
  installPlugin(mod: PluginModule | PluginClassLike, config?: unknown): string {
    this.assertState('started', 'installPlugin')
    const m = asPluginModule(mod)
    if (this.plugins.has(m.name)) {
      throw new Error(`[core] Duplicate plugin name: "${m.name}"`)
    }
    this.plugins.set(m.name, m)
    if (config !== undefined) this.configs.set(m.name, config)
    this.attachFiber(m.name, m) // PENDING fiber 句柄
    try {
      this.tryActivate(m.name) // 依赖满足→ACTIVE；不满足→保持 PENDING
    } catch (err) {
      this.plugins.delete(m.name)
      this.configs.delete(m.name)
      throw err
    }
    // 可能因本插件 provide 的服务满足了先前 PENDING 的插件 → 唤醒
    this.wakePending()
    return m.name
  }

  /**
   * 运行中热卸一个插件：dispose 它的 Scope → 全部副作用/注册/UI 自动回收；
   * 随后把「现在因它消失而不满足其声明依赖」的已 ACTIVE 依赖方一并回退 PENDING（等依赖恢复后重载）。
   * @returns 是否真卸到（未装/已卸返回 false）
   */
  uninstallPlugin(name: string): boolean {
    if (this.state !== 'started') return false
    const fiber = this.fibers.get(name)
    // 守卫按"有无 fiber"：既覆盖已 ACTIVE 插件，也让冷启动 PENDING(缺依赖) / FAILED 遗留 fiber 可被清理（原 scope 守卫会漏）
    if (!fiber) return false
    this.setLifecycle(name, Lifecycle.UNINSTALLING)
    fiber.dispose() // 终结卸载：同步 disposer 立即执行 + 启动 async disposer 结算；fiber 随即移出 map
    this.fibers.delete(name)
    this.plugins.delete(name)
    this.configs.delete(name)
    this.lifecycles.delete(name)
    this.bus.emit('ctx:plugin-uninstalled', { name })
    // P6/P2b2：提供方被卸，凡依赖它(或其提供的服务名)而仍 ACTIVE 的插件 → 回收副作用并回退 PENDING，
    // 待服务恢复(重 provide / 插件重装)后经 wakePending→drain 自动重载（cordis：callback 随依赖方卸载/重跑）。
    this.retractUnsatisfiedActives()
    return true
  }

  /**
   * 提供方被卸/换后调用：回收「此刻不再满足其声明依赖」的 ACTIVE 插件并回退 PENDING。
   * 迭代处理传递链——D 被回退时其 fiber 连带摘除它提供的服务，故下一轮 E(依赖 D 的服务)也会被回退。
   * 被回退插件仍保留在 plugins/fibers/configs 登记（还是已装插件），依赖恢复后由 wakePending→drain 重载。
   * 判定依据 = depSatisfied(d)（依赖的是插件名或它提供的服务名皆被覆盖：P 的插件名/服务已随 fiber.runDisposers
   * 与 plugins.delete 从满足集消失）。
   */
  private retractUnsatisfiedActives(): void {
    if (this.state !== 'started') return
    let progressed = true
    while (progressed) {
      progressed = false
      for (const depName of this.listPlugins()) {
        const fiber = this.fibers.get(depName)
        if (!fiber || fiber.state !== 'active') continue // 只回退当前 ACTIVE 者
        const mod = this.plugins.get(depName)
        if (!mod) continue
        const deps = depsOf(mod)
        if (!deps.some((d) => !this.depSatisfied(d))) continue // 依赖仍全满足，不受影响
        // 回收副作用 + 摘除它提供的服务 → 回退 PENDING（fiber 保留供 drain 重载）
        this.retractPlugin(depName)
        progressed = true
      }
    }
  }

  /** 回收单个 ACTIVE 插件的副作用并置回 PENDING（保留 plugins/fibers/configs 登记，可重载复用） */
  private retractPlugin(name: string): void {
    const fiber = this.fibers.get(name)
    if (fiber) {
      this.setLifecycle(name, Lifecycle.UNINSTALLING)
      fiber.runDisposers() // 清副作用 + 摘除它提供的服务（不置 DISPOSED，供重载复用）
      fiber.markPending() // ACTIVE→PENDING
    }
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

  /**
   * 插件注册表只读视图（cordis 06：诊断 PENDING / 可枚举每插件 fiber）。
   * 每次访问现算返回一个 name → { status, fiber } 的只读 Map；fiber 供 await/dispose、
   * status 供 PENDING 诊断（缺哪个依赖）。纯只读，不改装载/激活。
   */
  get registry(): ReadonlyMap<string, { status: PluginRuntimeStatus; fiber: Fiber | undefined }> {
    const m = new Map<string, { status: PluginRuntimeStatus; fiber: Fiber | undefined }>()
    for (const status of this.inspectPlugins()) {
      m.set(status.name, { status, fiber: this.fibers.get(status.name) })
    }
    return m
  }

  // ==================== 服务注入 ====================

  /** 提供服务（宿主/根层用）；返回撤销函数。注：本根方法不自动登记清理，撤销由调用方持有并执行；插件层请走注入的 PluginScope.provide（撤销随插件 fiber 自动清）。 */
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

  /**
   * 取服务。
   *
   * **首选写法是在模块顶层用 `export const inject = ['xxx']` 声明依赖**（对齐
   * docs/user/develop/framework/service.zh.md）：框架保证 apply 执行时依赖已就绪；
   * 缺提供方该插件停留 PENDING 不跑；提供方被卸/换时依赖方自动回收、恢复后自动重载。
   *
   * 本方法用于**可选依赖**：某能力缺失插件也能跑时，跳过 inject、在使用处探测 ——
   * 缺服务返回 `undefined`（不抛）。即"能不用就不用"的是本方法，而不是 inject。
   */
  get<Service = unknown>(name: string): Service {
    const builtin = this.builtinService(name)
    if (builtin !== undefined) return builtin as Service
    return this.services.get(name) as Service
  }

  /** 取内置服务（内核自带 tools，或能力层提供的其它内置服务）；无此名 → undefined */
  private builtinService(name: string): unknown {
    if (name === 'tools') return this.builtinTools
    return this.capabilityLayer?.builtins()[name]
  }

  /**
   * `get` 的显式别名：缺服务返回 undefined（不抛）。
   * 供作者把"这里是可选依赖"表达清楚——硬依赖请改在模块顶层写 `export const inject = [...]`。
   */
  tryGet<Service = unknown>(name: string): Service | undefined {
    return this.get<Service | undefined>(name)
  }

  /** 是否已注入某服务（含能力层内置服务） */
  hasService(name: string): boolean {
    if (this.builtinService(name) !== undefined) return true
    return this.services.has(name)
  }

 /** 已注入的服务名列表（供 dev 诊断） */
  injectedServices(): string[] {
    return [...this.services.keys()]
  }

  // ==================== 事件 ====================
  // 类型化：事件名在 Events/EventMap 里则 on/emit 参数有类型（作者 declare module 扩展 Events 即得
  // 多参类型提示）；否则松类型。实现统一 rest-arg 走 EventBus（单 payload 也当多参的第一参传给 on/emit）。

  on<K extends string>(name: K, handler: EventHandlerFor<K>): Disposable
  on(name: string, handler: (...args: any[]) => any): Disposable {
    const off = this.bus.on(name, handler)
    return { dispose: off }
  }

  once<K extends string>(name: K, handler: EventHandlerFor<K>): Disposable
  once(name: string, handler: (...args: any[]) => any): Disposable {
    const off = this.bus.once(name, handler)
    return { dispose: off }
  }

  emit<K extends string>(name: K, ...args: EventArgsFor<K>): void
  emit(name: string, ...args: any[]): void {
    this.bus.emit(name, ...args)
  }

  /** 并发跑所有监听并一同等待 */
  parallel<K extends string>(name: K, ...args: EventArgsFor<K>): Promise<void>
  parallel(name: string, ...args: any[]): Promise<void> {
    return this.bus.parallel(name, ...args)
  }

  /** 顺序 await，第一个 bail 值胜出并停止 */
  serial<K extends string>(name: K, ...args: EventArgsFor<K>): Promise<any>
  serial(name: string, ...args: any[]): Promise<any> {
    return this.bus.serial(name, ...args)
  }

  /** serial 的同步版（同步短路） */
  bail<K extends string>(name: K, ...args: EventArgsFor<K>): any
  bail(name: string, ...args: any[]): any {
    return this.bus.bail(name, ...args)
  }

  /** 环绕中间件 */
  waterfall<K extends string>(name: K, ...args: EventArgsFor<K>): any
  waterfall(name: string, ...args: any[]): any {
    return this.bus.waterfall(name, ...args)
  }

  // ==================== 副作用 ====================

  effect(fn: EffectFn): Disposable {
    const off = this.rootScope.effect(fn)
    return { dispose: off }
  }

  // ==================== 内部 ====================

  private deriveScope(fiber: Fiber, pluginName: string): PluginScope {
    const ctx = this
    const api: PluginScope = {
      on(name: string, handler: (...args: any[]) => any): Disposable {
        const off = ctx.bus.on(name, handler)
        fiber.onDispose(off)
        return { dispose: off }
      },
      once(name: string, handler: (...args: any[]) => any): Disposable {
        const off = ctx.bus.once(name, handler)
        fiber.onDispose(off)
        return { dispose: off }
      },
      emit: (name: string, ...args: any[]) => ctx.bus.emit(name, ...args),
      parallel: (name: string, ...args: any[]) => ctx.bus.parallel(name, ...args),
      serial: (name: string, ...args: any[]) => ctx.bus.serial(name, ...args),
      bail: (name: string, ...args: any[]) => ctx.bus.bail(name, ...args),
      waterfall: (name: string, ...args: any[]) => ctx.bus.waterfall(name, ...args),
      effect(fn: EffectFn): Disposable {
        const off = fiber.effect(fn)
        return { dispose: off }
      },
      inject<Service>(name: string, impl: Service): () => void {
        // 经根服务表登记，但撤销挂到本插件 fiber（卸载自动清）
        if (ctx.services.has(name)) {
          throw new Error(`[core] Service "${name}" is already injected`)
        }
        ctx.services.set(name, impl)
        const cleanup = () => {
          if (ctx.services.get(name) === impl) ctx.services.delete(name)
        }
        fiber.onDispose(cleanup)
        return cleanup
      },
      provide<Service>(name: string, impl: Service): () => void {
        // 与 inject 同义：经根服务表登记、撤销挂本插件 fiber
        if (ctx.services.has(name)) {
          throw new Error(`[core] Service "${name}" is already injected`)
        }
        ctx.services.set(name, impl)
        const cleanup = () => {
          if (ctx.services.get(name) === impl) ctx.services.delete(name)
        }
        fiber.onDispose(cleanup)
        return cleanup
      },
      get: <Service>(name: string): Service => ctx.get<Service>(name),
      get registry() {
        return ctx.registry
      },
      plugin(mod: PluginModule | PluginClassLike): PluginScope {
        // 嵌套插件：插件在 apply 里想再装子插件时，运行态必须是 installPlugin（热装语义），
        // 走根 plugin() 会因 state!=='created' 抛错。扁平并入根服务/插件表，返回自身便于链式。
        if (ctx.running) {
          ctx.installPlugin(mod)
        } else {
          ctx.plugin(mod)
        }
        return self
      },
    } as PluginScope
    // 挂内核自带能力段：ctx.tools（恒在；注册随本插件 fiber 回收）
    Object.assign(api, buildToolSegment(api))
    // 挂能力层产出的段：由能力层决定有哪些（框架不认识具体是什么段）
    if (this.capabilityLayer) {
      Object.assign(api, this.capabilityLayer.buildSegments(api, pluginName))
    }
    // 服务解析 Proxy（cordis 语义）：属性读命中"本插件可见服务名"→ 返回该服务实例；否则回退普通字段/undefined。
    // 这样 `inject:['greeter']` 后 `ctx.greeter` 与 `ctx.get('greeter')` 运行时等价；能力段(真实成员)不受影响。
    const self: PluginScope = new Proxy(api, {
      get(target, prop, receiver) {
        // 真实成员（on/emit/nodes/theme/commands/slots/settings/…）原样返回，不动能力段
        if (prop in target) return Reflect.get(target, prop, receiver)
        // 字符串属性名 → 尝试解析为已上架服务（缺返回 undefined，不抛，cordis proxy 语义）
        if (typeof prop === 'string') return ctx.get(prop as string)
        return undefined
      },
    }) as PluginScope
    return self
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
