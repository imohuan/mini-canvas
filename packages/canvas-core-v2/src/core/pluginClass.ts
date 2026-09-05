/**
 * pluginClass —— "类插件"归一（cordis 类形态装载单元，自研、零第三方）。
 *
 * 目标：docs/plan/plugin-cordis-migration-plan.md P2b + 路线A能力①。让作者能**照 cordis 原文逐字抄**：
 * ```ts
 * import { Service, type Context } from '@mini-canvas/canvas-base'
 * export class GreeterService extends Service {
 *   static inject = [] as string[]
 *   static Config = { greeting: { type: 'string', default: 'Hi' } }
 *   constructor(ctx: Context, config?: any) { super(ctx, 'greeter') }
 *   greet(w: string) { return 'Hi ' + w }
 * }
 * // 装配：ctx.plugin(GreeterService) | 冷启动 plugins:[GreeterService] | manager.install(GreeterService)
 * ```
 * cordis 里"类"本身就是一种插件形态：由 fiber `new 类(ctx, config)` 装载（构造即 super(ctx,name) 上架服务）。
 * 本模块把类规整成内核装配统一认的 PluginModule（name/inject/Config/apply），之后走既有的
 * plugin/installPlugin/deps PENDING/config 校验/scope 卸载回收路径——与对象插件行为完全一致。
 */
import type { PluginClassLike, PluginModule, PluginScope } from './types'
import type { ConfigSchema } from './configSchema'

/** 可作插件装载的"类"（cordis 类形态）：可 new，通常 extends Service 并在构造里 super(ctx,name) 上架服务 */
export type ServiceClass = PluginClassLike

/** 粗糙判断"可 new 的类"：function 且有自己的 prototype（箭头/async 无 prototype；mini-canvas 无函数插件，故一律按类 new） */
function isConstructableClass(v: unknown): v is Function {
  return typeof v === 'function' && !!v.prototype
}

/**
 * 把"类插件"归一成 PluginModule（cordis 语义）：
 * - name   = 类静态 `provide`（单个字符串，若有）否则类名（.name）
 * - inject = 类静态 `inject`（数组，缺省 []）
 * - Config = 类静态 `Config`（schema，可选）
 * - apply  = (ctx, config) => { new 类(ctx, config) }（构造即 super(ctx,name) 上架服务，依赖/卸载随 scope）
 * 传入的若不是可 new 的类（已是 PluginModule 对象 / 函数无 prototype）则原样返回，交给上层处理。
 */
export function asPluginModule(input: PluginModule | PluginClassLike): PluginModule {
  if (typeof input !== 'function' || !isConstructableClass(input)) {
    return input as PluginModule
  }
  const Ctor = input as unknown as {
    name: string
    provide?: string | string[]
    inject?: string[]
    Config?: ConfigSchema
  }
  const provide = Array.isArray(Ctor.provide) ? Ctor.provide[0] : Ctor.provide
  const name = typeof provide === 'string' && provide ? provide : Ctor.name
  return {
    name,
    inject: Ctor.inject ?? [],
    Config: Ctor.Config,
    apply(ctx: PluginScope, config?: object) {
      // 类形态装载：new 类(ctx, config)——构造即 super(ctx,name) 把实例上架为服务（随本插件 scope 回收）
      // eslint-disable-next-line new-cap
      new (input as new (c: PluginScope, config?: object) => unknown)(ctx, config)
    },
  }
}
