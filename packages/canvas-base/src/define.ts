/**
 * define* 助手 —— 把"作者声明的一段内容"包装成可在 apply(ctx) 里用 ctx 能力段注册的裸导出插件模块。
 *
 * 每个 define* 返回的对象都满足 PluginModule：`{ name, inject?, apply(ctx){ ...register } }`，
 * 经 ctx.nodes/theme/commands/slots 注册并自动回收。作者拿它搭插件文件更省事：
 *
 * ```ts
 * export default defineNode({ type:'audio', label:'音频', size:{w:200,h:80}, in: AudioNode, create })
 * ```
 */
// 类型从画布层直接取，不走本包 package name：包内自引用会形成"包 → 自己"的解析环，
// 独立打包/类型解析都要多绕一圈（T02）。
import type { Context, NodeRegisterDef } from '@mini-canvas/canvas-data'

/**
 * ctx.nodes.register 的一次给全定义（段名即区域词；步骤 9 起老段名 content/… 已下线）。
 *
 * **字段清单不在这里再抄一遍**：它就是 NodeRegisterDef。抄一份的下场已经踩过 ——
 * 类型上放行的 icon/resizable/frameless/transparent/segments 在运行时被静默丢掉，
 * 作者写了不报错也不生效（T02）。
 */
export type DefineNodeDef = NodeRegisterDef

/**
 * defineNode —— 声明"一种画布节点"（数据+展示+可选建节点实现）。
 * @returns PluginModule（name=type，apply 里 ctx.nodes.register）
 */
export function defineNode(def: DefineNodeDef) {
  return {
    name: def.type,
    inject: [] as string[],
    apply(ctx: Context) {
      // 原样转发：NodeRegisterDef 是字段的单一来源，这里不再手写透传清单。
      // ctx.nodes.register 自己负责 in/title 与 segments 的合并、类型能力与连接声明的落表。
      ctx.nodes.register({ ...def })
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
