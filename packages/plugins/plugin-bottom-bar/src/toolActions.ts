/**
 * toolActions —— 把 ctx.tools 里的工具映射成底栏动作（纯函数，实现在本插件内）。
 *
 * 别的插件不要 import 本文件：走 `ctx.get('nodeBar').publishTools(ctx, opts)`，
 * 条目会落在调用方自己的 scope 上，卸载自动摘除。
 */
import type { PluginScope, ToolDef, ToolOutcome, ToolResourceKind } from '@plume-canvas/kernel'
import { barToolToAction, type BarAction, type PublishToolActionsOptions } from '@plume-canvas/canvas-data'

export { barToolToAction as toolToAction }
export type { PublishToolActionsOptions }

/** 动作表所在的注册场（键前缀 actions/ 与 appliers/ 区分两类条目） */
export const BAR_FIELD = 'node/bar'

export function publishToolActions(ctx: PluginScope, opts: PublishToolActionsOptions): () => void {
  const kindFor = opts.kindOf ?? ((type: string) => type as ToolResourceKind)

  const sync = (): void => {
    const kind = kindFor(opts.types[0] ?? '')
    if (!kind) return
    const tools = ctx.get<{
      list(f?: { produces?: ToolResourceKind }): ToolDef[]
      invoke(name: string, input: unknown): Promise<unknown>
    } | undefined>('tools')
    if (!tools) return
    const wanted = new Map(tools.list({ produces: kind }).map((t) => ['tool:' + t.name, t] as const))
    const field = ctx.registryOf<BarAction>(BAR_FIELD)

    for (const tool of wanted.values()) {
      const action = barToolToAction(tool, opts, (input) =>
        tools.invoke(tool.name, { prompts: input.prompts, values: input.values, resources: input.resources }),
      )
      field.add(`actions/${action.id}`, action, { id: action.id })
    }
    for (const key of field.keys()) {
      if (!key.startsWith('actions/tool:')) continue
      if (!wanted.has(key.slice('actions/'.length))) field.remove(key, key.slice('actions/'.length))
    }
  }

  sync()
  ctx.on('ctx:plugin-installed', sync)
  ctx.on('ctx:plugin-uninstalled', sync)
  return sync
}
