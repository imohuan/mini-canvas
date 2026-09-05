/**
 * @mini-canvas/canvas-base —— 插件作者的友好收口薄层。
 *
 * 作用（docs/goal/plugin-system-goal.md 目标 B）：作者写插件**只认一个 Context**，不再散 import 内核的
 * registerNodeType/registerThemeSlot/register 裸函数。本包：
 * - 重导出内核的 `Context` 类型 + `PluginModule` 形状（给 .ts 里的 apply(ctx) 与 name/inject 用）
 * - 提供少量 `define*` 助手把"一段声明式节点/主题/命令/槽"包装成可注册的裸导出模块
 *
 * 依赖方向：本薄层只依赖 @mini-canvas/canvas-core-v2（纯 TS，无 Vue），是作者入口；不新增引擎逻辑。
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
export type { Context } from '@mini-canvas/canvas-core-v2'
export { runPlugin, depsOf } from '@mini-canvas/canvas-core-v2'
export type {
  PluginModule,
  PluginScope,
  PluginCapabilities,
  NodeRegisterDef,
  Disposable,
} from '@mini-canvas/canvas-core-v2'

export * from './define'
