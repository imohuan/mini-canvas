/**
 * canvas-core-v2 内核核心类型
 *
 * 设计契约见 docs/plan/canvas-core-v2-api.md（API 契约定稿）。
 * M1 为纯 TypeScript 内核，零 Vue/pinia 依赖，可脱离 DOM 单测。
 */

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
 * PluginScope —— 单个插件在 setup(ctx) 里拿到的"能力视图"。
 *
 * 它把根 Context 的能力暴露给插件，但**所有副作用自动登记进本插件自己的 Scope**：
 * - on/effect/inject 登记进本插件 scope → 插件卸载(scope.dispose)即自动清光。
 * - get/emit 是读操作 / 广播，不登记。
 */
export interface PluginScope {
  /** 订阅事件（自动回收） */
  on<K extends EventName>(name: K, handler: EventListener<K>): Disposable
  once<K extends EventName>(name: K, handler: EventListener<K>): Disposable
  /** 广播事件（单源，不碰 window） */
  emit<K extends EventName>(name: K, payload: CanvasEventMap[K]): void
  /** 副作用（包 timer/watch/DOM，返回 cleanup 自动回收） */
  effect(fn: EffectFn): Disposable
  /** 提供服务（上架）；撤销自动登记进本插件 scope */
  inject<Service>(name: string, impl: Service): () => void
  /** 取服务（缺则抛错，不静默降级） */
  get<Service = unknown>(name: string): Service
  /** 嵌套插件（本插件子作用域） */
  plugin(mod: PluginModule): PluginScope
}

/**
 * 插件模块形状：一段式 setup，无 install/uninstall。
 * setup 的返回值或经 ctx 登记的副作用都自动归入本插件的 scope，卸载即清。
 */
export interface PluginModule<TConfig extends object = object> {
  /** 插件唯一名 */
  name: string
  /** 依赖的插件/服务名（真会 ctx.get 的才写；缺则报错） */
  deps?: string[]
  /**
   * setup(ctx)：返回一个 cleanup（Disposable 或纯函数）会被登记进本插件 scope，
   * 也可完全不返回，靠 ctx.on/effect/inject 自动登记。
   */
  setup(ctx: PluginScope): void | (() => void) | Disposable
  /** 配置：由 ctx.plugin(mod, config) 传入 */
  config?: TConfig
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
