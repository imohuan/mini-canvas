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
  /** 分组化配置（单一数据源 + 按作用域订阅变化）—— 见 2.4 / 目标 B2 */
  settings: {
    /** 申报一组配置（同 key 重复抛错） */
    define(req: {
      group: string
      items: Record<
        string,
        {
          type: 'color' | 'number' | 'select' | 'boolean' | 'text'
          default: string | number | boolean
          label?: string
          min?: number
          max?: number
          options?: Array<{ value: string; label?: string }>
        }
      >
    }): void
    /** 改一项（未知 key 抛错；越界夹取） */
    set(key: string, value: string | number | boolean): boolean
    /** 读一项当前值 */
    get(key: string): string | number | boolean
    /** 订阅变化：scope 本插件名(默认只收本插件的变更)；可不传 scope 全局 */
    onChange(scope: string, cb: (key: string, value: unknown) => void): { dispose(): void }
    /** 已申报的组名（UI 面板用） */
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
 * 插件模块形状（对齐 docs/goal/plugin-system-goal.md 2.1b 的 Cordis 式写法，兼容旧 setup/deps）。
 *
 * Cordis 式（推荐，教程主推）：`.ts` 裸导出三样 `name / inject / apply`——
 * - `name`：插件唯一名
 * - `inject`：依赖的服务/插件名数组（没有可省）
 * - `apply(ctx)`：注册函数，ctx 是能力台(ctx.nodes/theme/commands/slots/services)，注册自动回收
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
  /** 注册函数：ctx 是能力台。Cordis 用 apply，旧式用 setup，二者至少给一个。 */
  setup?(ctx: PluginScope): void | (() => void) | Disposable
  apply?(ctx: PluginScope): void | (() => void) | Disposable
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
