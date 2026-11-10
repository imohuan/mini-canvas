/**
 * @mini-canvas/plugin-bottom-bar —— 节点底部状态栏：可替换底栏 + 注册式动作 + 进度覆盖层。
 *
 * 作者入口（三条糖都是「落场用调用方 ctx」—— 条目归你，卸载自动摘除）：
 *   registerBarAction(ctx, action)
 *   registerBarApplier(ctx, kind, fn)
 *   publishToolActions(ctx, { types, produces, ... })   // Task 6c 实现
 *
 * 消费入口（组件里用 ctx.get，不要直访 ctx.nodeBar —— 根 ctx 没有服务代理）：
 *   ctx.get('nodeBar').list({ type }) / get(id) / state(nodeId)
 *   ctx.get('canvas').runBarAction(nodeId, actionId, input) / cancelBarAction(nodeId)
 * 底栏自己的组件要取消任务时，仍可用内部执行器 `nodeTask.cancel`（它不是基础服务）。
 *
 * 整体换皮（像主题那样）：ctx.theme.add('bottomBar', MyBar, { order: -1 })
 *
 * 任务只由后台执行（用户口径 2026-11-10）：这里没有「前端自己轮询」那条路，
 * 进度与终态由后台写节点、SSE 推回来，断线由 cloud-client 的一条全局定时器批量对账。
 */
export { pluginBottomBar } from './pluginBar'
export {
  BOTTOM_BAR_SLOT,
  BOTTOM_BAR_SLOT_NAME,
  BAR_FIELD,
  NodeBarService,
  NodeTaskService,
  registerBarAction,
  registerBarApplier,
  kindOf,
} from './nodeBarPlugin'
export { publishToolActions } from './toolActions'
export type {
  BarAction,
  BarRunInput,
  BarRunContext,
  BarApplier,
  BarLookup,
} from './barTypes'
export type { NodeRunState } from './runState'
export { readRunState, runningState, progressState, doneState, errorState } from './runState'
export { runAction } from './taskRuntime'
export type { TaskDeps } from './taskRuntime'
