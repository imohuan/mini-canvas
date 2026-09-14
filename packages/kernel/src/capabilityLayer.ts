/**
 * capabilityLayer —— 插件框架的"能力层"接缝（通用，零画布概念）。
 *
 * 作者定调：插件框架只管"装插件 / 依赖编排 / 事件 / 作用域回收 / 开槽"，
 * 不该认识 node / edge / command / tool 这些画布语言。但插件作者确实需要
 * ctx.nodes / ctx.theme / ctx.commands / … 这类"能力段"。
 *
 * 解法：能力段由**能力层**产出，框架只负责把产出的段挂到每个 ctx 上并负责回收；
 * 具体有哪些段、段是什么含义，框架一概不知道。画布能力层的实现见
 * 画布层（@mini-canvas/canvas-data）装的就是这样一层，由该包入口注册为默认层。
 *
 * 未装能力层的 new Context() 就是纯插件内核：
 * 只有 on/once/emit/effect/inject/provide/get/plugin/registry。
 */
import type { ConfigSchema } from './configSchema'
import type { PluginScope } from './types'

/** 能力层：把"能力段 / 内置服务 / 配置登记"这三件事交给上层实现。 */
export interface CapabilityLayer {
  /**
   * 为某个 ctx 视图产出能力段（会被 Object.assign 到该视图上）。
   * 根上下文 scopeName="<host>"，插件用插件名。
   */
  buildSegments(ctx: PluginScope, scopeName: string): Record<string, unknown>
  /**
   * 内置服务实例（名 → 实例）。语义：ctx.get 恒可取到、依赖判定恒满足、
   * 不进服务表（因此不与 inject/provide 的重名检查冲突）。
   */
  builtins(): Record<string, unknown>
  /**
   * 生命周期重置（ctx.stop 时调用）：由实现决定哪些内置服务重建、哪些跨 stop 保留。
   * 插件副作用已随各自 fiber 回收，这里只清"表内残留"。
   */
  reset(): void
  /**
   * 把插件 Config schema 的标量字段登记进"配置单一数据源"（供 UI 面板长控件）。
   * @param dev 开发态（可给冲突告警）
   * @returns 随该插件回收的清理函数（由框架登记进插件 fiber）
   */
  declareConfig(
    schema: ConfigSchema,
    config: Record<string, unknown>,
    pluginName: string,
    dev: boolean,
  ): () => void
}

/**
 * 能力层工厂：每个 Context **各自建一份**能力层实例。
 *
 * 为什么是工厂而不是单例：能力层持有 slots/settings/tools 这些"每画布一份"的实例，
 * 若全局共用一个实例，两个画布会串数据。工厂保证 new Context() 各拿各的。
 */
export type CapabilityLayerFactory = () => CapabilityLayer

/** 全局默认能力层工厂：由组合根（包入口/宿主）装上；无则 ctx 不含任何能力段。 */
let defaultFactory: CapabilityLayerFactory | undefined

/** 装上/清空全局默认能力层工厂（组合根调用，例如包入口）。 */
export function setDefaultCapabilityLayerFactory(factory: CapabilityLayerFactory | undefined): void {
  defaultFactory = factory
}

/** 取当前全局默认能力层工厂（未装返回 undefined = 纯插件内核）。 */
export function getDefaultCapabilityLayerFactory(): CapabilityLayerFactory | undefined {
  return defaultFactory
}
