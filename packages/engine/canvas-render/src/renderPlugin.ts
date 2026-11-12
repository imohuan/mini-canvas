/**
 * renderPlugin —— 渲染层自己的插件身份。
 *
 * 它只提供「渲染层基础设施」：标准能力包（registryOf('capability') 里的 node/zoom/… 默认实现）。
 * 它**不**注入 doc / selection / view：这三个是画布会话的服务，由 canvas-data 在进入画布时提供；
 * 渲染层插件在根级常驻，项目页也要能用，不能把画布会话的生命周期绑在自己身上。
 *
 * 为什么能力注册要收进插件：宿主（createPlumeHost）也走同一条装配路径，
 * 把注册逻辑留在这里，宿主与插件就不会各写一份、order/id 各说各话。
 */
import type { PluginModule, PluginScope, Registry } from '@plume-canvas/kernel'
import type { CapabilityFactory } from './contracts/capabilities'
import { createStandardCapabilities } from './contracts/standardCapabilities'

/** 渲染层插件名（宿主/应用装配按这个名字识别它） */
export const name = 'canvas-render'

/** 与 `name` 同一份值，供拼写更明确的调用方使用（导出别名，不另造字符串）。 */
export { name as canvasRenderPluginName }

/**
 * 渲染层不依赖任何服务：能力工厂在**被调用时**才按需 get('view') / get('doc')，
 * 所以插件可以在项目页（没有 doc/selection/view）就先启动。
 */
export const inject = [] as string[]

/** 标准能力的条目 id / order：同一个 id = 同一条，任何来源都不该再叠一份。 */
const STANDARD_CAPABILITY_ID = 'host:standard'
const STANDARD_CAPABILITY_ORDER = 100

/** 能力注册只需要「读服务 + 取注册场」这两件，宿主与插件作用域都满足。 */
interface CapabilityRegistryHost {
  get<Service = unknown>(name: string): Service
  registryOf<T>(kind: string): Registry<T>
}

/**
 * 把标准能力包注册进 `registryOf('capability')`。
 *
 * 可重复调用：已经存在同 id 的条目就跳过，避免「插件先启动、宿主又注册一遍」造成两份。
 * order 固定为 100（宿主默认实现）；主题/业务插件可以用更小的 order 覆盖它。
 */
export function registerStandardCapabilities(ctx: CapabilityRegistryHost): void {
  const field = ctx.registryOf<CapabilityFactory>('capability')
  for (const [capabilityName, factory] of Object.entries(createStandardCapabilities(ctx))) {
    // 同 id 已有条目（无论来源）就不再放：保持一条、同一 order。
    if (field.get(capabilityName, STANDARD_CAPABILITY_ID)) continue
    field.add(capabilityName, factory, {
      id: STANDARD_CAPABILITY_ID,
      order: STANDARD_CAPABILITY_ORDER,
    })
  }
}

/**
 * 渲染层插件：目前只注册标准能力。
 *
 * 关于 UI 目录（registryOf('ui')）：canvas-render 自己没有往里放组件 ——
 * 通用组件由主题插件（如 theme-default）登记，渲染层只提供 useUiComponent 这类读取入口。
 * 所以这里没有 ui.add；以后渲染层真有了自己的通用件，再在这里补。
 */
export const canvasRenderPlugin: PluginModule = {
  name,
  inject,
  apply(ctx: PluginScope) {
    registerStandardCapabilities(ctx)
  },
}
