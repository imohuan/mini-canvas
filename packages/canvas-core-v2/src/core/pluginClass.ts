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
import { Service } from './service'

/** 可作插件装载的"类"（cordis 类形态）：可 new，通常 extends Service 并在构造里 super(ctx,name) 上架服务 */
export type ServiceClass = PluginClassLike

/**
 * 判断一个函数是否"Service 子类"（= 类形态插件）。
 * 类形态插件 = extends Service 的可 new 类(构造 super(ctx,name) 上架服务)；
 * 普通函数(不管有没有 prototype)= DSH 的函数形态插件,应以 apply(ctx,config) 调用而非 new。
 * 判定:沿 prototype 链找 Service.prototype。
 */
function isServiceSubclass(v: unknown): v is Function {
  if (typeof v !== 'function' || !v.prototype) return false
  let proto: unknown = v.prototype
  while (proto && proto !== Object.prototype) {
    if (proto === Service.prototype) return true
    proto = Object.getPrototypeOf(proto)
  }
  return false
}

/**
 * 把"类/函数插件"归一成 PluginModule（cordis 语义）：
 * - Service 子类(类形态):name=类静态 provide 或类名;apply=(ctx,config)=>{ new 类(ctx,config) }
 *   (构造即 super(ctx,name) 上架服务,依赖/卸载随 fiber)。
 * - 其它函数(DSH 函数形态,如 `ctx.plugin(heartbeat)`):name=函数名;apply=(ctx,config)=> fn(ctx,config)。
 * 传入的若不是函数(已是 PluginModule 对象)则原样返回,交给上层处理。
 */
export function asPluginModule(input: PluginModule | PluginClassLike): PluginModule {
  if (typeof input !== 'function') {
    return input as PluginModule
  }
  if (isServiceSubclass(input)) {
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
        // 类形态装载：new 类(ctx, config)——构造即 super(ctx,name) 把实例上架为服务（随本插件 fiber 回收）
        // eslint-disable-next-line new-cap
        new (input as new (c: PluginScope, config?: object) => unknown)(ctx, config)
      },
    }
  }
  // 函数形态插件（DSH ch1/ch2）：直接以 apply(ctx, config) 调用该函数；名称供诊断/装配寻址
  const fn = input as unknown as ((ctx: PluginScope, config?: object) => unknown) & { name: string }
  const name = fn.name || ''
  if (!name) {
    throw new Error('[core] 函数形态插件需具名（不能是匿名函数），以便装配寻址/诊断。')
  }
  return {
    name,
    inject: [],
    apply(ctx: PluginScope, config?: object) {
      fn(ctx, config) // 函数形态插件的返回值不属于框架约定的 cleanup 形状，直接丢弃
    },
  }
}
