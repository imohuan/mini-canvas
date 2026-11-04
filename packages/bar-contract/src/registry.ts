/** 注册糖：条目落调用方插件作用域（卸载自动摘除、同 id 替换）。 */
import type { PluginScope } from '@mini-canvas/kernel'
import type { BarAction, BarApplier } from './types'

export const BAR_FIELD = 'node/bar'

export function registerBarAction(ctx: PluginScope, action: BarAction): void {
  ctx.registryOf<BarAction>(BAR_FIELD).add(`actions/${action.id}`, action, { id: action.id })
}

export function registerBarApplier(ctx: PluginScope, kind: string, fn: BarApplier): void {
  const field = ctx.registryOf<BarApplier>(BAR_FIELD)
  const key = `appliers/${kind}`
  if (field.has(key)) throw new Error('[bottom-bar] applier already registered: ' + kind)
  field.add(key, fn, { id: kind })
}
