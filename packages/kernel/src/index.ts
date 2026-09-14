/**
 * @mini-canvas/kernel —— 纯插件框架（Cordis 风格）：装载 / 依赖编排 / 事件 / 作用域回收 / 开槽。
 *
 * 这个包里**没有任何画布概念**：不认识 node / edge / command / tool。
 * 画布相关的一切（ctx.nodes/theme/commands/tools、nodeStore/selection/… 、渲染）住在别处，
 * 经"能力层"接缝装进来（见 ./capabilityLayer）。
 */
export { Context, runPlugin } from './Context'
export type { ContextState, PluginRuntimeStatus } from './Context'
export { Scope } from './Scope'
export { Fiber } from './fiber'
export type { FiberInit, FiberDisposer, FiberTransition } from './fiber'
export { FiberState } from './fiber'
export { Service } from './service'
export { asPluginModule } from './pluginClass'
export type { ServiceClass } from './pluginClass'
export { topoSort, depsOf } from './topo'
export { EventBus, registerEventName, isBailed, hasKnownEvent } from './EventBus'
export type { DispatchMode } from './EventBus'
export { SlotRegistry } from './registry/slotRegistry'
export type { SlotEntry, SlotAddRequest, SlotName } from './registry/slotRegistry'
// 内核自带能力：工具注册表（ctx.tools）——"注册一个外部能力、别人按名调用"，通用、与画布无关
export {
  ToolRegistry,
  resolveToolParams,
  resolveToolTemplates,
  DEFAULT_TOOL_INTERVAL,
  DEFAULT_TOOL_TIMEOUT,
} from './toolRegistry'
export type {
  ToolDef,
  ToolFilter,
  ToolInput,
  ToolInvokeOptions,
  ToolOutcome,
  ToolPollFn,
  ToolPollState,
  ToolParamDef,
  ToolParamOption,
  ToolProgress,
  ToolResource,
  ToolResourceKind,
  ToolResult,
  ToolRunContext,
  ToolService,
  ToolTemplate,
} from './toolRegistry'
// 通用命令注册表 + 键盘匹配（"注册一个内部动作、按 id/快捷键触发"，与画布无关）
export {
  CommandRegistry,
  commandMatchesKeys,
  keyComboMatches,
  findCommandByKeys,
} from './command'
export type { CommandDef, CommandService, CommandKeyEvent } from './command'
export { iconRenderMode } from './iconKind'
export type { IconRenderMode } from './iconKind'

export { SettingsStore } from './settingsStore'
export type { SettingSchema, SettingGroupDef, SettingEntry } from './settingsStore'
export { resolveConfig, ConfigError, F, optionValues, selectOptionEntry, isScalarField } from './configSchema'
export type {
  ConfigSchema,
  ConfigField,
  ConfigPrimitive,
  ConfigSelectOption,
  InferConfig,
} from './configSchema'
export {
  setDefaultCapabilityLayerFactory,
  getDefaultCapabilityLayerFactory,
} from './capabilityLayer'
export type { CapabilityLayer, CapabilityLayerFactory } from './capabilityLayer'
export type {
  PluginClassLike,
} from './types'
export {
  Lifecycle,
} from './types'
export type {
  EventMap,
  Disposable,
  EffectFn,
  EventArgsFor,
  EventHandlerFor,
  EventListener,
  EventName,
  Events,
  PluginModule,
  PluginScope,
  PluginCapabilities,
  Revoke,
  Services,
} from './types'
