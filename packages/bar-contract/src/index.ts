/**
 * bar-contract —— 节点底栏的共享契约（纯类型 + 两个注册函数）。
 *
 * 为什么单独成包：业务插件之间不能互相 import。底栏的「动作 / 写入器」是
 * 多个插件都要写的东西，抽成契约包后，插件依赖它，而不是依赖 plugin-bottom-bar。
 *
 * 实现仍然是往 registryOf('node/bar') 注册，条目归调用方插件作用域，卸载自动回收。
 */
export type {
  BarAction,
  BarApplier,
  BarRunContext,
  BarRunInput,
} from './types'
export { BAR_FIELD, registerBarAction, registerBarApplier } from './registry'
export { publishToolActions, toolToAction } from './toolActions'
export type { PublishToolActionsOptions } from './toolActions'
