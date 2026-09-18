/**
 * @mini-canvas/kernel —— 插件框架核心类型（纯插件，无任何画布概念）。
 *
 * 这里只有"插件"这件事：插件模块形态、生命周期、事件表、作用域类型，
 * 以及内核自带的 `tools` 能力（"注册一个外部能力、别人按名调用"，通用、与画布无关）。
 * 画布相关类型（节点/连线/命令）住在 @mini-canvas/canvas-data。
 */
import type { ConfigSchema } from './configSchema'
import type {
  ToolDef,
  ToolFilter,
  ToolInput,
  ToolInvokeOptions,
  ToolResult,
} from './toolRegistry'
import type { Registry } from './registry/registry'
import type { ToolCallResult, ToolExecView, ToolSpec } from './modelTool'
import type { SurfaceReport } from './surface'

/** 可释放对象：调用即执行清理，幂等安全 */
export interface Disposable {
  dispose(): void
}

/**
 * `ctx.canUninstall(name)` 的判定结果（决策 1：调用方"先问再动"）。
 *
 * 为什么要这个三态而不是布尔：`uninstallPlugin` 沿用既有契约返回 `false`，但 `false` 既可能是
 * "核心插件不让卸"也可能是"根本没这个插件"——不区分原因就会写出"先删了配置才发现卸不动"的副作用。
 */
export type CanUninstallResult =
  | { ok: true }
  | { ok: false; reason: 'core' | 'not-found' | 'not-started' }

/**
 * 插件私有状态（ctx.state）：内核只存值、不做响应式。
 *
 * 为什么不占服务名：它是插件自己的数据，不是"别人按名取的能力"（设计文档规则 7）。
 * 响应式由渲染层决定（要响应式的消费方把这个对象塞进 reactive/ref 里）。
 */
export interface State<T> {
  value: T
}

/** 生命周期状态（裁掉 v1 无调用路径的 deactivate/inactive 三态） */
export enum Lifecycle {
  INSTALLING = 'installing',
  INSTALLED = 'installed',
  ACTIVATING = 'activating',
  ACTIVE = 'active',
  UNINSTALLING = 'uninstalling',
  UNINSTALLED = 'uninstalled',
  ERROR = 'error',
}

/**
 * 事件契约表：事件名 → payload 类型。
 * 内置内核事件在此；插件用 `declare module './types' { interface EventMap { ... } }` 扩展。
 */
export interface EventMap {
  /** 内核就绪（所有插件激活完毕） */
  'ctx:ready': { plugins: string[] }
  /** 插件安装完成 */
  'ctx:plugin-installed': { name: string }
  /** 插件卸载完成 */
  'ctx:plugin-uninstalled': { name: string }
  /** 生命周期状态变化 */
  'ctx:lifecycle-change': { name: string; lifecycle: Lifecycle }
}

/** 事件名 = EventMap 的键（供泛型约束用） */
export type EventName = keyof EventMap & string

/**
 * 全局"事件表"（cordis ch4 声明合并缝）：作者 declare module 扩展：
 * ```ts
 * declare module '@mini-canvas/kernel' {
 *   interface Events { 'stats/report'(name: string, count: number): void }
 * }
 * ```
 * 每个键=事件名，其值=监听函数签名（参数即事件参数）。内置内核事件也在此列出
 * （与 EventMap 同键，监听签名=单 payload 形态），保证 `keyof Events` 非空——
 * ctx.on/once/emit/parallel/serial/bail/waterfall 据此做 K extends keyof Events 的类型化重载；
 * 声明合并补的条目（如 'stats/report'）自动获得参数类型提示。
 */
export interface Events {
  /** 内核就绪（所有插件激活完毕） */
  'ctx:ready'(payload: { plugins: string[] }): void
  /** 插件安装完成 */
  'ctx:plugin-installed'(payload: { name: string }): void
  /** 插件卸载完成 */
  'ctx:plugin-uninstalled'(payload: { name: string }): void
  /** 生命周期状态变化 */
  'ctx:lifecycle-change'(payload: { name: string; lifecycle: Lifecycle }): void
  /**
   * 模型可调用工具进表（设计文档 §7.2 缺口①）。
   *
   * 参数：工具名（= \`registryOf('tool')\` 里的键）、工具定义、谁放的（插件名）。
   * 同 id 顶替时也会发（此前先发一条 \`tools/unregistered\`）。
   * 事件名已在 modelTool 模块加载时 registerEventName 登记（否则 dev 下会 warn，§7.4）。
   */
  'tools/registered'(name: string, tool: ToolSpec, source: string): void
  /** 模型可调用工具离表（显式撤销 / 清空 / 被同 id 顶替）。参数：工具名、此前谁放的 */
  'tools/unregistered'(name: string, source: string): void
  /**
   * 一次模型可调用工具调用的**权威结果**（结果物化时发，先于调用方 promise 兑现）。
   *
   * 观察者插件靠它就能记录每次调用，且它**不需要 inject 任何服务**——
   * 这就是"今天根本写不出来"的那条缝（教程第 7 章的 tool-logger）。
   */
  'tools/result'(exec: ToolExecView, result: ToolCallResult): void
}

/**
 * 服务注册表类型：插件可 declare module 扩展 `interface Services { ... }`
 * 以便 ctx.get<Services['foo']>('foo') 拿到类型。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Services {}

/**
 * 能力段形状：挂在插件 ctx 上的注册收口。
 *
 * 分两类：
 * - **内核自带**：`tools`（注册外部能力、按名调用；通用、与画布无关，恒在）。
 * - **能力层提供**：如画布的 `nodes/theme/commands/slots/settings`——框架不认识它们，
 *   形状由能力层经声明合并补进本接口（见 @mini-canvas/canvas-data 的 canvas/capabilityTypes.ts）。
 */
export interface PluginCapabilities {
  /**
   * 工具（外部能力调用：文生图 / 文生文 / 任意可注册能力），自动回收。
   *
   * 工具作者：`export const inject = ['tools']` + `ctx.tools.register(def)`，
   * 加一个新能力 = 装一个注册了新工具的插件，消费方零改动。
   * 消费方：`ctx.tools.list({ produces: 'image' })` 挑工具 → `ctx.tools.invoke(name, input, opts)` 调用。
   */
  tools: {
    /** 注册一个工具（返回撤销句柄，同名重复抛错）。注册随所属插件卸载自动回收 */
    register(def: ToolDef): Disposable
    /** 按名注销；不存在返回 false */
    unregister(name: string): boolean
    has(name: string): boolean
    get(name: string): ToolDef | undefined
    /** 枚举工具（可按分组 / 产出类型 / 可接受输入筛选） */
    list(filter?: ToolFilter): ToolDef[]
    /** 调用工具（自动驱动异步轮询 / 超时，进度经 onProgress 转发） */
    invoke(name: string, input: ToolInput, options?: ToolInvokeOptions): Promise<ToolResult>
  }
}

/**
 * PluginScope —— 单个插件在 setup(ctx) 里拿到的"能力视图"。
 *
 * 它把根 Context 的能力暴露给插件，但**所有副作用自动登记进本插件自己的 Scope**：
 * - on/effect/inject 登记进本插件 scope → 插件卸载(scope.dispose)即自动清光。
 * - get/emit 是读操作 / 广播，不登记。
 * - nodes/theme/commands/slots 是注册收口（见 PluginCapabilities）。
 */
/**
 * 事件监听回调按事件名解析：
 * - K 在 `interface Events` 里（含内置与作者 declare module 扩展）→ Events[K]（监听函数签名，参数即事件参数）
 * - K 仅在 EventMap（单 payload 对象事件，向后兼容）→ EventListener<K>
 * - 否则（未登记任意事件名）→ 松 (...args) => any
 */
export type EventHandlerFor<K extends string> = K extends keyof Events
  ? Events[K]
  : K extends EventName
    ? EventListener<K & EventName>
    : (...args: any[]) => any

/** 事件分发参数按事件名解析（emit/parallel/serial/bail/waterfall 的 rest 参） */
export type EventArgsFor<K extends string> = K extends keyof Events
  ? Parameters<Events[K]>
  : K extends EventName
    ? [payload: EventMap[K & EventName]]
    : any[]

/**
 * 类形态插件装载单元（cordis 03）：可 new 的类，通常 extends Service（构造即 super(ctx,name) 上架服务）。
 *
 * 核心插件标识也走静态字段：`static core = true` → `asPluginModule` 归一后透传进
 * PluginModule.core（决策 1）。类型上不强制声明（静态字段不在实例类型里）。
 */
export type PluginClassLike = new (ctx: PluginScope, config?: any) => unknown

/**
 * PluginScope —— 单个插件在 setup(ctx) 里拿到的"能力视图"。
 *
 * 它把根 Context 的能力暴露给插件，但**所有副作用自动登记进本插件自己的 Scope**：
 * - on/effect/inject 登记进本插件 scope → 插件卸载(scope.dispose)即自动清光。
 * - get/emit 是读操作 / 广播，不登记。
 * - nodes/theme/commands/slots 是注册收口（见 PluginCapabilities）。
 */
export interface PluginScope extends PluginCapabilities {
  /** 订阅事件（自动回收）。事件名在 Events/EventMap 里则监听参数有类型；否则松类型。 */
  on<K extends string>(name: K, handler: EventHandlerFor<K>): Disposable
  once<K extends string>(name: K, handler: EventHandlerFor<K>): Disposable
  /** 广播事件（单源，不碰 window）。多参/单 payload 视事件表形态而定。 */
  emit<K extends string>(name: K, ...args: EventArgsFor<K>): void
  /** 副作用（包 timer/watch/DOM，返回 cleanup 自动回收） */
  effect(fn: EffectFn): Disposable
  /** 提供服务（上架）；撤销自动登记进本插件 scope */
  inject<Service>(name: string, impl: Service): () => void
  /** 提供服务（cordis 语义，与 inject 等价）；Service 子类 super(ctx,name) 内部调用 */
  provide<Service>(name: string, impl: Service): () => void
  /**
   * 取服务。
   *
   * 首选写法是模块顶层 `export const inject = ['xxx']` 声明依赖（框架保证 apply 时就绪；
   * 缺提供方则停在 PENDING）。本方法用于**可选依赖**：能力缺失时插件仍能跑，则跳过 inject、
   * 在此探测 —— 缺服务返回 undefined（不抛）。
   */
  get<Service = unknown>(name: string): Service
  /** 嵌套插件（本插件子作用域）。支持类形态（Service 子类）与 PluginModule 对象。 */
  plugin(mod: PluginModule | PluginClassLike): PluginScope
  /**
   * 插件注册表只读视图（cordis 06）：可枚举每插件的 fiber（含 PENDING 诊断/await）。
   * 返回 name → { status, fiber } 的只读 Map；纯只读。
   */
  readonly registry: ReadonlyMap<
    string,
    { status: { name: string; state: string; missingDeps: string[]; error?: string }; fiber: unknown }
  >

  /**
   * 取某 kind 的注册场（设计文档 §2.1 / 决策 6）。
   *
   * 同一 kind 各插件拿到的是同一张表（互相看得见，这正是"别人放的东西我能继续包"的前提）；
   * 本插件视图只多两件事：写进条目的 source = 本插件名（谁放的，可诊断），
   * 以及本插件放置（add/wrap）的条目随本插件卸载自动回收。
   *
   * 注意：ctx.registry 是插件运行态诊断（cordis 06），与本方法无关，名字也不要改。
   */
  registryOf<T>(kind: string): Registry<T>
  /**
   * 插件私有状态（§二 原语 ⑥）：内核只存值、不做响应式（响应式由渲染层决定）。
   * 不占服务名——它是插件自己的数据，不是"别人按名取的能力"（规则 7）。
   * 随本插件 scope 自动回收：卸载后 value 清空，状态不再可达。
   */
  state<T>(initial: T): State<T>
  /** 是否开发态（内核构造时的 dev 选项；原来只是 private 字段，插件读不到） */
  readonly isDev: boolean

  /**
   * 能否动态卸载某插件（决策 1：调用方"先问再动"）。
   *
   * `ctx.uninstallPlugin(name)` 把"核心插件拒卸"与"插件不存在"同值成 `false`（沿用既有契约），
  * 本方法给出原因，供调用方（pluginManager / 宿主 UI）在动手前分流，从根上避免
  * "先删了配置才发现卸不动"这类副作用。
  */
  canUninstall(name: string): CanUninstallResult
  /**
   * 自省快照：一次列出三根轴（服务 / 注册场 / 命令与工具）上「注册了什么、各自支持什么」。
   * 只读、零副作用，随时可调。诊断面板 / 文档生成 / AI 探查用。
   */
  surface(): SurfaceReport

  // ====== 事件分发模式（cordis ch4）——扩展事件名走 declare module Events 类型化 ======
  /** 并发跑所有监听并一同等待 */
  parallel<K extends string>(name: K, ...args: EventArgsFor<K>): Promise<void>
  /** 顺序 await，第一个 bail 值胜出并停止 */
  serial<K extends string>(name: K, ...args: EventArgsFor<K>): Promise<any>
  /** serial 的同步版（同步短路） */
  bail<K extends string>(name: K, ...args: EventArgsFor<K>): any
  /** 环绕中间件：监听器可转写 next() 返回值或短路 */
  waterfall<K extends string>(name: K, ...args: EventArgsFor<K>): any
}

/**
 * 插件模块形状（对齐 docs/goal/plugin-system-goal.md 2.1b 的 Cordis 式写法，兼容旧 setup/deps）。
 *
 * Cordis 式（推荐，教程主推）：`.ts` 裸导出四样 `name / inject / Config / apply`——
 * - `name`：插件唯一名
 * - `inject`：依赖的服务/插件名数组（没有可省）
 * - `Config`（可选）：本插件可配置项的 schema（cordis ch5 形态）。装配处给的 config 经它校验、
 *   默认补齐后，内核以第二个实参 `apply(ctx, config)` 传入；校验失败 → fiber FAILED + 响亮报错。
 * - `apply(ctx, config)`：注册函数，ctx 是能力台(ctx.nodes/theme/commands/slots/settings)，注册自动回收
 *
 * 旧式（向后兼容）：`setup(ctx)` 同 apply，`deps` 同 inject。二者可混用，apply 优先于 setup、inject 优先于 deps。
 * setup/apply 的返回值（cleanup）或经 ctx 登记的副作用都自动归入本插件的 scope，卸载即清。
 */
export interface PluginModule<TConfig extends object = object> {
  /** 插件唯一名 */
  name: string
  /**
   * 核心插件标识（决策 1）：`true` = 拒绝动态热卸（`ctx.uninstallPlugin` 返回 `false`，
   * 且不 dispose fiber、不发 `ctx:plugin-uninstalled`、不连带回退依赖方）。
   *
   * 为什么必须：提供方一卸，依赖它的插件全部回退 PENDING。若画布基础服务由普通插件提供，
   * 它一被卸画布直接瘫——所以"谁能被卸"必须有答案。
   *
   * 只挡"动态卸载"：整体生命周期终结（`ctx.stop()` / `stopAsync()`）不拦，页面关闭时核心插件
   * 也要正常回收。
   *
   * 两种形态都给得出来：对象形态 `{ name, core: true, apply }`；类形态 `static core = true`。
   */
  core?: boolean
  /**
   * 依赖的服务/插件名（**硬依赖**）：缺失则该插件停在 PENDING、不加载。
   * 首选写法是模块顶层 `export const inject = ['tools']`（框架保证 apply 时就绪）。
   * 可选依赖不要写这里 —— 在使用处用 `ctx.get(name)` 探测。
   * （旧式字段名 `deps` 等价；两者都给时以 inject 为准。）
   */
  deps?: string[]
  inject?: string[]
  /** 本插件的 config schema（cordis ch5）。装配 config 经它校验+补默认；apply(ctx,config) 收结果。 */
  Config?: ConfigSchema
  /** 注册函数：ctx 是能力台。Cordis 用 apply(收校验后 config)，旧式用 setup，二者至少给一个。 */
  setup?(ctx: PluginScope): void | (() => void) | Disposable
  apply?(ctx: PluginScope, config?: TConfig): void | (() => void) | Disposable
}

/**
 * 一个事件总线的监听句柄：dispose 即取消监听（幂等）。
 */
export type EventListener<K extends EventName = EventName> = (
  payload: EventMap[K],
) => void

/** inject 的撤销函数 */
export type Revoke = () => void

/**
 * effect 回调：可返回一个清理函数（会被登记进当前 scope）。
 */
export type EffectFn = () => void | (() => void) | Disposable
