import { ToolRegistry } from './toolRegistry'
import type { ToolDef, ToolFilter, ToolInput, ToolInvokeOptions, ToolResult } from './toolRegistry'
import type { Disposable, PluginModule, PluginScope } from './types'

/**
 * 跑一个插件的注册函数：apply(收校验后 config)。
 * 返回值（cleanup/Disposable）由调用方登记进插件 fiber，卸载即清。
 */
export function runPlugin(
  mod: PluginModule,
  ctx: PluginScope,
  config?: unknown,
): void | (() => void) | Disposable {
  return mod.apply(ctx, config as never)
}

/**
 * 内核自带的 `ctx.tools` 能力段：把工具注册表的操作收口成作者直接可用的形状。
 *
 * 注册随所属插件 scope 自动回收（ctx.effect）—— 插件卸载后它注册的工具从表里消失。
 * 表本身是内核单实例（`Context.builtinTools`），插件注册进它、别的插件/节点从它取，
 * 于是"加一个模型"= 装一个注册了新工具的插件，消费方零改动。
 *
 * @param ctx 插件 scope 或根 Context（需有 get + effect）
 */
export function buildToolSegment(ctx: PluginScope): {
  tools: {
    register(def: ToolDef): void
    unregister(name: string): boolean
    has(name: string): boolean
    get(name: string): ToolDef | undefined
    list(filter?: ToolFilter): ToolDef[]
    invoke(name: string, input: ToolInput, options?: ToolInvokeOptions): Promise<ToolResult>
  }
} {
  const reg = (): ToolRegistry | undefined => ctx.get<ToolRegistry | undefined>('tools') ?? undefined
  return {
    tools: {
      register(def: ToolDef): void {
        const r = reg()
        if (!r) throw new Error('[tools] 内核未提供 tools 服务')
        const handle = r.register(def)
        ctx.effect(() => () => handle.dispose())
      },
      unregister(name: string): boolean {
        return reg()?.unregister(name) ?? false
      },
      has(name: string): boolean {
        return reg()?.has(name) ?? false
      },
      get(name: string): ToolDef | undefined {
        return reg()?.get(name)
      },
      list(filter?: ToolFilter): ToolDef[] {
        return reg()?.list(filter) ?? []
      },
      invoke(name: string, input: ToolInput, options?: ToolInvokeOptions): Promise<ToolResult> {
        const r = reg()
        if (!r) return Promise.resolve({ ok: false, error: '内核未提供 tools 服务' })
        return r.invoke(name, input, options)
      },
    },
  }
}
