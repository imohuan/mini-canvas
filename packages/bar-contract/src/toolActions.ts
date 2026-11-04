/**
 * publishToolActions —— 把 ctx.tools 里的工具映射成底栏动作。
 *
 * 从 plugin-bottom-bar 搬进契约包：节点插件发布工具动作时只依赖契约，
 * 不再 import 另一个业务插件。实现与语义保持不变。
 */
import type { PluginScope, ToolDef, ToolOutcome, ToolResourceKind } from '@mini-canvas/kernel'
import { BAR_FIELD, registerBarAction } from './registry'
import type { BarAction, BarRunContext, BarRunInput } from './types'

export interface PublishToolActionsOptions {
  types: string[]
  produces: ToolResourceKind
  needsPrompt?: boolean
  promptBinding?: 'none' | 'text'
  apply?: 'applier' | 'self'
  kindOf?: (nodeType: string) => ToolResourceKind
}

export function toolToAction(
  tool: ToolDef,
  opts: PublishToolActionsOptions,
  invoke: (input: BarRunInput, runCtx: BarRunContext) => Promise<unknown>,
): BarAction {
  return {
    id: 'tool:' + tool.name,
    types: [...opts.types],
    title: tool.title ?? tool.name,
    description: tool.description,
    group: tool.group,
    fields: tool.params ? tool.params.map((p) => ({ ...p })) : undefined,
    templates: tool.templates ? tool.templates.map((t) => ({ ...t })) : undefined,
    needsPrompt: opts.needsPrompt,
    promptBinding: opts.promptBinding,
    apply: opts.apply,
    async run(input: BarRunInput, runCtx: BarRunContext) {
      // 工具的返回值与底栏动作同契约（ToolOutcome）；invoke 的签名是 unknown，
      // 这里在边界收一次口，动作对象保持纯数据 + 明确结果类型。
      return (await invoke(input, runCtx)) as ToolOutcome
    },
  }
}

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

    for (const tool of wanted.values()) {
      registerBarAction(
        ctx,
        toolToAction(tool, opts, (input) =>
          tools.invoke(tool.name, { prompt: input.prompt, values: input.values, resources: input.resources }),
        ),
      )
    }
    const field = ctx.registryOf<BarAction>(BAR_FIELD)
    for (const key of field.keys()) {
      if (!key.startsWith('tool:')) continue
      if (!wanted.has(key)) field.remove(key, key)
    }
  }

  sync()
  ctx.on('ctx:plugin-installed', sync)
  ctx.on('ctx:plugin-uninstalled', sync)
  return sync
}
