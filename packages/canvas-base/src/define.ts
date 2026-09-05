/**
 * define* 助手 —— 把"作者声明的一段内容"包装成可在 apply(ctx) 里用 ctx 能力段注册的裸导出插件模块。
 *
 * 每个 define* 返回的对象都满足 PluginModule：`{ name, inject?, apply(ctx){ ...register } }`，
 * 经 ctx.nodes/theme/commands/slots 注册并自动回收。作者拿它搭插件文件更省事：
 *
 * ```ts
 * export default defineNode({ type:'audio', label:'音频', size:{w:200,h:80}, content: AudioNode, create })
 * ```
 */
import type { Context, NodeRegisterDef } from '@mini-canvas/canvas-core-v2'

/** ctx.nodes.register 的一次给全定义 */
export interface DefineNodeDef extends Omit<NodeRegisterDef, 'segments'> {
  content?: unknown
  title?: unknown
}

/**
 * defineNode —— 声明"一种画布节点"（数据+展示+可选建节点实现）。
 * @returns PluginModule（name=type，apply 里 ctx.nodes.register）
 */
export function defineNode(def: DefineNodeDef) {
  return {
    name: def.type,
    inject: [] as string[],
    apply(ctx: Context) {
      const reg: NodeRegisterDef = {
        type: def.type,
        label: def.label,
        size: def.size,
        content: def.content,
        title: def.title,
        inputs: def.inputs,
        outputs: def.outputs,
        create: def.create,
      }
      ctx.nodes.register(reg)
    },
  }
}

/** ctx.theme.register 的 occupant 信息 */
export interface DefineThemeReq {
  slot: string
  id?: string
  order?: number
  component: unknown
}

/**
 * defineThemeSlot —— 声明"顶替/叠加一块主题 UI"。
 * @returns PluginModule（name='theme:'+id，apply 里 ctx.theme.register）
 */
export function defineThemeSlot(req: DefineThemeReq) {
  const id = req.id ?? 'theme'
  return {
    name: `theme:${id}`,
    inject: [] as string[],
    apply(ctx: Context) {
      ctx.theme.register(req.slot, req.component, { id, order: req.order })
    },
  }
}

/** ctx.commands.register 的一次定义 */
export interface DefineCommandDef {
  id: string
  title?: string
  keys?: string[]
  run(ctx: unknown, ...payload: unknown[]): unknown
  when?: (ctx: unknown) => boolean
}

/** defineCommand —— 声明"一条命令"。@returns PluginModule（name='cmd:'+id） */
export function defineCommand(def: DefineCommandDef) {
  return {
    name: `cmd:${def.id}`,
    inject: [] as string[],
    apply(ctx: Context) {
      ctx.commands.register(def)
    },
  }
}

/** ctx.slots.register 的一次请求 */
export interface DefineSlotReq {
  slot: string
  id?: string
  order?: number
  component: unknown
}

/** defineSlot —— 声明"往某 UI 槽叠一个组件"。@returns PluginModule（name='slot:'+id） */
export function defineSlot(req: DefineSlotReq) {
  const id = req.id ?? req.slot
  return {
    name: `slot:${id}`,
    inject: [] as string[],
    apply(ctx: Context) {
      ctx.slots.register(req.slot, { id, order: req.order, component: req.component })
    },
  }
}
