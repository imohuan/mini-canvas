/**
 * canvas-core-v2 内核核心类型
 *
 * 设计契约见 docs/plan/canvas-core-v2-api.md（API 契约定稿）。
 * M1 为纯 TypeScript 内核，零 Vue/pinia 依赖，可脱离 DOM 单测。
 */
import type { ConfigSchema } from './configSchema'

/** 可释放对象：调用即执行清理，幂等安全 */
export interface Disposable {
  dispose(): void
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
 * M1 给最小内置事件；插件用 `declare module './types' { interface CanvasEventMap { ... } }` 扩展。
 */
export interface CanvasEventMap {
  /** 内核就绪（所有插件激活完毕） */
  'ctx:ready': { plugins: string[] }
  /** 插件安装完成 */
  'ctx:plugin-installed': { name: string }
  /** 插件卸载完成 */
  'ctx:plugin-uninstalled': { name: string }
  /** 生命周期状态变化 */
  'ctx:lifecycle-change': { name: string; lifecycle: Lifecycle }
}

/** 事件名 = CanvasEventMap 的键（供泛型约束用） */
export type EventName = keyof CanvasEventMap & string

/**
 * 服务注册表类型：插件可 declare module 扩展 `interface Services { ... }`
 * 以便 ctx.get<Services['foo']>('foo') 拿到类型。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Services {}

/**
 * 能力段形状：挂在插件 ctx 上的注册收口（ctx.nodes/theme/commands/slots）。
 * 结构由 core/capabilities.ts 的 buildCapabilities 实现；此处只声明类型供作者侧类型提示。
 * 每个注册都自动回收（revoke 经插件 scope 的 effect 登记），作者不手写 uninstall。
 */
export interface PluginCapabilities {
  /** 注册一个节点类型（数据+展示+可选建节点），自动回收 */
  nodes: {
    register(def: {
      type: string
      label: string
      size: { w: number; h: number }
      content?: unknown
      title?: unknown
      segments?: Partial<Record<'content' | 'title' | 'top-toolbar' | 'bottom-toolbar', unknown>>
      inputs?: Array<{ port?: string; accepts?: string[]; limit?: 'single' | 'multi' }>
      outputs?: Array<{ port?: string }>
      create?: (position: { x: number; y: number }) => string
    }): void
  }
  /** 往主题槽叠 occupant（order 最小者获胜），自动回收 */
  theme: {
    register(slot: string, component: unknown, opts?: { id?: string; order?: number }): void
    add(slot: string, component: unknown, opts?: { id?: string; order?: number }): void
    remove(slot: string, id: string): void
  }
  /** 注册命令，自动回收 */
  commands: {
    register(def: { id: string; title?: string; run(ctx: unknown, ...payload: unknown[]): unknown; keys?: string[]; when?: (ctx: unknown) => boolean }): void
    has(id: string): boolean
  }
  /** 往通用 UI 槽叠 occupant（宿主按序渲染），自动回收 */
  slots: {
    register(slot: string, req: { id?: string; order?: number; component: unknown }): string
    remove(slot: string, id: string): boolean
    occupants(slot: string): Array<{ id: string; order: number; component: unknown }>
  }
  /**
   * 配置（cordis P4 形态）：插件在模块级导出 `Config` schema，装配处给 config，
   * 内核校验+补默认后 `apply(ctx, config)` 收到完整 config。此段是"已装配 config"的读 + 订阅
   * （可监听本插件 config 变化→就地窄更新、实时生效，逻辑同旧 settings.onChange；不再有 define 声明入口）。
   */
  settings: {
    /** 改一项已装配 config 的值（未知 key 抛错；number 越界夹取，实时生效） */
    set(key: string, value: string | number | boolean): boolean
    /** 读一项已装配 config 的当前值 */
    get(key: string): string | number | boolean
    /** 订阅某作用域(插件)的 config 变化：scope 传本插件名=只收自己的；不传全局 */
    onChange(scope: string, cb: (key: string, value: unknown) => void): { dispose(): void }
    /** 已装配(声明)的组名（UI 面板用） */
    groups(): string[]
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
export interface PluginScope extends PluginCapabilities {
  /** 订阅事件（自动回收）——CanvasEventMap 事件 */
  on<K extends EventName>(name: K, handler: EventListener<K>): Disposable
  /** 订阅扩展事件（cordis 多参事件名，非 CanvasEventMap） */
  on(name: string, handler: (...args: any[]) => any): Disposable
  once<K extends EventName>(name: K, handler: EventListener<K>): Disposable
  once(name: string, handler: (...args: any[]) => any): Disposable
  /** 广播事件（单源，不碰 window）；cordis 多参事件经扩展事件名注册 */
  emit<K extends EventName>(name: K, payload: CanvasEventMap[K]): void
  /** 广播扩展事件（cordis 多参事件名，非 CanvasEventMap） */
  emit(name: string, ...args: any[]): void
  /** 副作用（包 timer/watch/DOM，返回 cleanup 自动回收） */
  effect(fn: EffectFn): Disposable
  /** 提供服务（上架）；撤销自动登记进本插件 scope */
  inject<Service>(name: string, impl: Service): () => void
  /** 提供服务（cordis 语义，与 inject 等价）；Service 子类 super(ctx,name) 内部调用 */
  provide<Service>(name: string, impl: Service): () => void
  /** 取服务（缺则抛错，不静默降级） */
  get<Service = unknown>(name: string): Service
  /** 嵌套插件（本插件子作用域） */
  plugin(mod: PluginModule): PluginScope

  // ====== 事件分发模式（cordis ch4）——扩展事件名走 declare module Events 类型化 ======
  /** 并发跑所有监听并一同等待 */
  parallel<K extends string>(name: K, ...args: any[]): Promise<void>
  /** 顺序 await，第一个 bail 值胜出并停止 */
  serial<K extends string>(name: K, ...args: any[]): Promise<any>
  /** serial 的同步版（同步短路） */
  bail<K extends string>(name: K, ...args: any[]): any
  /** 环绕中间件：监听器可转写 next() 返回值或短路 */
  waterfall<K extends string>(name: K, ...args: any[]): any
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
  /** 依赖的插件/服务名（真会 ctx.get 的才写；缺则报错）。Cordis 用 inject，旧式用 deps。 */
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
  payload: CanvasEventMap[K],
) => void

/** inject 的撤销函数 */
export type Revoke = () => void

/**
 * effect 回调：可返回一个清理函数（会被登记进当前 scope）。
 */
export type EffectFn = () => void | (() => void) | Disposable
