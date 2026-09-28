/**
 * publishToolActions —— 把 ctx.tools 里的工具映射成底栏动作（「加一个模型 = 装一个工具插件」的保持点）。
 *
 * 为什么不是默认皮自动展开（计划 §0.3）：默认皮不认识任何模型；且自动展开会让
 * 「显式动作 + N 个工具动作」重复列出、归属说不清。工具动作的唯一来源是**节点插件**
 * 调本糖发布 —— 条目落调用方作用域，插件卸载自动摘除。
 *
 * 增量同步：工具可能晚于节点插件注册（工具表变化），也可能随提供方卸载而消失，
 * 所以 installed 与 uninstalled 两个方向都要订阅；返回的句柄 = 立即重新同步（测试用）。
 *
 * 工具调用怎么接：动作的 run 需要真正调到 ctx.tools.invoke。ctx 不能塞进动作对象
 * （动作是纯数据，序列化/热更都要求它可拷贝），所以这里用**调用方 scope 的闭包**：
 * 本糖在调用方插件的作用域里跑，直接把 ctx.get('tools') 的 invoke 闭包进 run。
 */
import type { PluginScope } from '@mini-canvas/kernel'
import type { ToolDef, ToolResourceKind } from '@mini-canvas/kernel'
import { registerBarAction, BAR_FIELD } from './nodeBarPlugin'
import type { BarAction, BarRunContext, BarRunInput } from './barTypes'

export interface PublishToolActionsOptions {
  /** 发布给哪些节点类型（如 ['image']） */
  types: string[]
  /** 发布 produces 匹配的工具 */
  produces: ToolResourceKind
  /** 要不要大输入框 */
  needsPrompt?: boolean
  /** 输入框绑定（'text' = 编辑即写回 data.text） */
  promptBinding?: 'none' | 'text'
  /** 结果写法（默认 'applier'） */
  apply?: 'applier' | 'self'
  /** 类型 → 内容 kind 的映射；缺省 = opts.types 里唯一那个类型当 kind（单类型场景够用） */
  kindOf?: (nodeType: string) => ToolResourceKind
}

/** 组装一条工具动作（纯函数，node 可单测；invoke 由调用方闭包注入） */
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
      const out = (await invoke(input, runCtx)) as { ok: boolean; error?: string; urls?: string[]; text?: string; taskId?: string }
      return out
    },
  }
}

/**
 * 发布「本类型可用的工具动作」到调用方作用域，并随工具表变化增量同步。
 * @returns 立即重新同步的函数（测试与宿主都可调）
 */
export function publishToolActions(ctx: PluginScope, opts: PublishToolActionsOptions): () => void {
  const kindFor = opts.kindOf ?? ((type: string) => type as ToolResourceKind)
  // invoke 走调用方 scope 的工具表（ctx 在这里就是调用方的 scope ctx）
  const invoke = (input: BarRunInput): Promise<unknown> => {
    const tools = ctx.get<{ invoke(name: string, input: unknown): Promise<unknown> }>('tools')
    return tools.invoke('__bar_input__', input)
  }
  void invoke // 真正的 invoke 在 sync 里闭包（见下）

  const sync = (): void => {
    const kind = kindFor(opts.types[0] ?? '')
    if (!kind) return
    const tools = ctx.get<{ list(f?: { produces?: ToolResourceKind }): ToolDef[]; invoke(name: string, input: unknown): Promise<unknown> } | undefined>('tools')
    if (!tools) return
    const wanted = new Map(tools.list({ produces: kind }).map((t) => ['tool:' + t.name, t] as const))

    for (const tool of wanted.values()) {
      registerBarAction(
        ctx,
        toolToAction(tool, opts, (input) => tools.invoke(tool.name, { prompt: input.prompt, values: input.values, resources: input.resources })),
      )
    }
    // 消失的移除（不能留指向已消失工具的僵尸动作）
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
