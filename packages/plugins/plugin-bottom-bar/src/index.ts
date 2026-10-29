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
 *   ctx.get('nodeTask').run(nodeId, actionId, input) / cancel(nodeId)
 *
 * 整体换皮（像主题那样）：ctx.theme.add('bottomBar', MyBar, { order: -1 })
 */
export { pluginBottomBar } from './pluginBar'
export {
  BOTTOM_BAR_SLOT,
  BOTTOM_BAR_SLOT_NAME,
  BAR_FIELD,
  BAR_APPLIER_FIELD,
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
  BarModeState,
} from './barTypes'
export type { NodeRunState } from './runState'
export { readRunState, runningState, progressState, doneState, errorState } from './runState'
export { runAction, resumeAction, DEFAULT_INTERVAL, DEFAULT_TIMEOUT, DEFAULT_THROTTLE } from './taskRuntime'
export type { TaskDeps } from './taskRuntime'
