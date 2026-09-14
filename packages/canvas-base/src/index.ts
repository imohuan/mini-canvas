/**
 * @mini-canvas/canvas-base —— 插件作者的友好收口薄层。
 *
 * 作用（docs/goal/plugin-system-goal.md 目标 B）：作者写插件**只认一个 Context**，不再散 import
 * registerNodeType/registerThemeSlot/register 裸函数。本包：
 * - 重导出 **框架层**（@mini-canvas/kernel）的 `Context` 类型 + `PluginModule` 形状 + 配置 helper
 * - 重导出**画布能力层**（@mini-canvas/canvas-data）的 `NodeRegisterDef` 等画布注册类型
 * - 提供少量 `define*` 助手把"一段声明式节点/主题/命令/槽"包装成可注册的裸导出模块
 *
 * 依赖方向：本薄层依赖 kernel（框架）与 canvas-data（画布能力），纯 TS 无 Vue；不新增引擎逻辑。
 *
 * 作者推荐的插件形态（裸导出三样）：
 * ```ts
 * import type { Context } from '@mini-canvas/canvas-base'
 *
 * export const name = 'my-node'
 * export const inject = []            // 依赖的服务/插件名，没有可省
 * export function apply(ctx: Context) {
 *   ctx.nodes.register({ type: 'my', label: '我的', size: { w: 200, h: 100 }, content: MyContent })
 * }
 * ```
 */

// —— 框架层（@mini-canvas/kernel）——
export type {
  PluginModule,
  PluginClassLike,
  ServiceClass,
  PluginScope,
  PluginCapabilities,
  Disposable,
  ConfigSchema,
  ConfigField,
  ConfigPrimitive,
  ConfigSelectOption,
  InferConfig,
  Events,
  EventName,
  EventArgsFor,
  EventHandlerFor,
  Services,
} from '@mini-canvas/kernel'
export { runPlugin, depsOf, Service, asPluginModule, F, resolveConfig, ConfigError } from '@mini-canvas/kernel'

// —— 画布层（@mini-canvas/canvas-data）——
// Context：画布消费方要的是"带画布能力段的 ctx"，故取画布层那份（它继承 kernel 的 Context 并默认装画布能力层）。
export type { Context } from '@mini-canvas/canvas-data'
export type { NodeRegisterDef } from '@mini-canvas/canvas-data'

export * from './define'
