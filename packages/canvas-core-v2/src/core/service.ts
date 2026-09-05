/**
 * Service —— 插件"向别人公开一项能力"的类形态基座（cordis 语义，自研、零第三方）。
 *
 * 目标：docs/plan/plugin-cordis-migration-plan.md P2a。作者写一个 Service 子类：
 * ```ts
 * import { Service, type Context } from '@mini-canvas/canvas-core-v2'
 * declare module '@mini-canvas/canvas-core-v2' {
 *   interface Services { greeter: GreeterService }
 * }
 * export class GreeterService extends Service {
 *   constructor(ctx: Context) { super(ctx, 'greeter') }
 *   greet(who: string) { return `Hello, ${who}!` }
 * }
 * export const name = 'greeter'
 * export function apply(ctx: Context) { new GreeterService(ctx) }
 * ```
 * `super(ctx, name)` 会 `ctx.provide(name, this)`：服务上架、撤销随所属插件 scope 自动回收（插件卸载即移除）。
 * 消费方用 `export const inject = ['greeter']` 声明硬依赖，或 `ctx.get('greeter')` 读取。
 *
 * 类也满足"插件三形态"里的类形态：可作为 `ctx.plugin(SomeService)` 的装载单元（P2b 接入依赖编排后完整生效）。
 * 命名：构造传 name，或子类给静态 `provide` 字段，二选一。
 */
import type { PluginScope } from './types'

/** Service 基类：构造即把本实例以 name 上架到 ctx 服务表（随所属 scope 自动回收）。 */
export abstract class Service {
  /** 所属上下文（上架的服务表） */
  readonly ctx: PluginScope
  /** 服务名 */
  readonly name: string

  /**
   * @param ctx 插件 ctx（作者在 apply(ctx) 里 new 时传入）
   * @param name 服务名；缺省取子类的静态 `provide` 字段
   */
  constructor(ctx: PluginScope, name?: string) {
    this.ctx = ctx
    const provideName = name ?? (this.constructor as { provide?: string }).provide
    if (!provideName) {
      throw new Error('[core] Service 需传 name 或给子类静态 provide 字段')
    }
    this.name = provideName
    // 上架服务（effect 语义：随提供方 scope 自动移除）
    ctx.provide(provideName, this)
  }
}

/** Service 类形态的静态声明（可选）：类也标注自己提供哪些服务名，供装配/依赖编排读取 */
export namespace Service {
  /** 由 Service 子类静态字段提供：默认服务名；可多个 */
  export type Metadata = { provide?: string | string[] }
}
