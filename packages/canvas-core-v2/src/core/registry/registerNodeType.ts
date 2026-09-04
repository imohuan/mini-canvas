/**
 * registerNodeType —— 节点类型"一次自描述"注册入口（插件作者视角的节点注册 API）。
 *
 * 解决 v2 现状的"分家 + 宿主手 seed"：
 *   - 现状：插件(逻辑)在 src/plugins 只调 nodeStore.registerType(数据)，content 组件由宿主
 *     在 CanvasDemo 手动 registry.register(type,{content}) seed。UI 与逻辑拆两处、注册权在宿主。
 *   - 本助手：插件在 apply(ctx) 里调一次 registerNodeType(ctx, def)，同时写
 *       ① nodeStore 数据注册表（type/label/defaultSize/inputs/outputs）
 *       ② nodeRegistry 展示注册表（content 等段组件，opaque 句柄）
 *    宿主不再手 seed 该 type 的 content。
 *
 * 依赖方向：内核→插件为空（内核不 import 插件）；插件/宿主 → 内核（import 本助手）。
 * content 组件句柄 opaque，内核不 import Vue。
 *
 * 生命周期：本注册面向"启动时一次性装载"，宿主在 bootCanvas 里 create NodeRegistry 并注入 ctx
 * ('nodeRegistry')，插件 apply 时调用即完成落表；装载一次不卸载。HMR/热重载的可逆注销
 * 后续再按 dsh effect 语义补。
 */
import type { PluginScope } from '../types'
import type { NodeStoreService } from '../../services/nodeStore'
import type { NodeSegment } from './nodeRegistry'
import type { NodeRegistry } from './nodeRegistry'

/** 节点类型注册的完整定义：数据字段 + 展示段（作者一次给全） */
export interface NodeTypeDef {
  type: string
  label: string
  defaultSize: { w: number; h: number }
  /** 展示段：content = 内容组件；title/top-toolbar/bottom-toolbar 可选 */
  segments?: Partial<Record<NodeSegment, unknown>>
  /** 声明式连接约束（api.md §四） */
  inputs?: Array<{ port?: string; accepts?: string[]; limit?: 'single' | 'multi' }>
  outputs?: Array<{ port?: string }>
}

/**
 * 插件里一次注册一个节点类型（数据 + 展示同时落表）。
 *
 * @param ctx 插件 apply/setup 拿到的 ctx（真会 ctx.get('nodeStore'/'nodeRegistry')）
 * @param def 节点类型完整定义
 */
export function registerNodeType(ctx: PluginScope, def: NodeTypeDef): void {
  // ① 数据侧：type/label/defaultSize/连接约束
  ctx.get<NodeStoreService>('nodeStore').registerType({
    type: def.type,
    label: def.label,
    defaultSize: def.defaultSize,
    inputs: def.inputs,
    outputs: def.outputs,
  })
  // ② 展示侧：content/title/toolbar 段组件（opaque 句柄）
  //    宿主经 bootCanvas 注入 'nodeRegistry'；纯 Node 单测若未注入则只落数据、跳过展示。
  const segs = def.segments ?? {}
  if (Object.keys(segs).length === 0) return
  const nodeRegistry = safeGet<NodeRegistry>(ctx, 'nodeRegistry')
  if (nodeRegistry) {
    nodeRegistry.register(def.type, segs)
  }
}

/** 尽力取一个 ctx 服务：取不到返回 undefined（不抛）。 */
function safeGet<T>(ctx: PluginScope, name: string): T | undefined {
  try {
    return ctx.get<T>(name)
  } catch {
    return undefined
  }
}
