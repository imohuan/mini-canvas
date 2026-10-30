/**
 * registerNodeType —— 节点类型"一次自描述"注册入口（插件作者视角的节点注册 API）。
 *
 * 归属：画布能力层（src/canvas）。原先住在 core/registry，因内容全是画布概念（节点类型/展示段），
 * 与"插件框架不认识画布"的边界冲突，故迁出；旧路径保留一行转发垫片。
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
 * 生命周期：本注册面向"启动时一次性装载"，宿主在 createMiniCanvasHost 里 create NodeRegistry 并注入 ctx
 * ('nodeRegistry')，插件 apply 时调用即完成落表；装载一次不卸载。HMR/热重载的可逆注销
 * 后续再按 dsh effect 语义补。
 */
import type { PluginScope } from '@mini-canvas/kernel'
// PortDef 是端口约束的**单一来源**（nodeStore 定义、connection 消费）。
// 这里以前手抄了一份字段列表，于是新增字段（evictOnFull）时插件写了会被类型拦下 —— 直接复用，不再重复。
import type { PortDef, CanvasNodeType, TitleExtraSource } from '../../nodeStore'
import type { NodeSegment } from './nodeRegistry'
import type { NodeRegistry } from './nodeRegistry'
import type { NodeDataTypeDef } from '../dataPorts'
import { assertDataPorts } from '../dataPorts'

/**
 * doc 门面里"节点类型表写口"的那一小块（本助手只用得到它）。
 * 只声明用到的两个方法，避免本文件与 docService 互相 import。
 */
interface NodeTypeStore {
  registerType(def: CanvasNodeType): void
  unregisterType(type: string): void
}

/** 节点类型注册的完整定义：数据字段 + 展示段（作者一次给全） */
export interface NodeTypeDef extends NodeDataTypeDef {
  type: string
  label: string
  defaultSize: { w: number; h: number }
  /** 新节点默认名称模板（{{ID}} = 该类型递增序号，{{NAME}} = label）。见 CanvasNodeType.nameTemplate。 */
  nameTemplate?: string
  /** 展示区域：in = 卡片内容组件（最常用）；title 等其余区域词可选（见 canvas/region.ts） */
  segments?: Partial<Record<NodeSegment, unknown>>
  /** 声明式连接约束（api.md §四） */
  inputs?: PortDef[]
  outputs?: PortDef[]
  /** 类型图标（opaque 句柄，同 content 语义；缺省 = 不显示图标） */
  icon?: unknown
  /**
   * 标题右侧附加文本（字符串或 `(data)=>string`；缺省 = 不显示）。
   * 见 CanvasNodeType.titleExtra —— 类型自己声明，默认壳只按声明渲染。
   */
  titleExtra?: TitleExtraSource
  /**
   * 标题右侧的**组件插槽**（Component）：调试标签这类运行态内容由声明方自持状态，
   * 壳只以 nodeId/data 挂载。与 titleExtra 同链透传（capabilities 的手写枚举别忘了加）。
   */
  titleExtraSlot?: import('vue').Component
  /** 一句话说明（可选）：菜单"新建节点"项 hover 小字；与 icon 同链，由类型自己声明 */
  description?: string
  /** 是否支持 resize + 拖拽方式（类型级能力；缺省 false = 不可缩放）。透传进 nodeStore 供渲染层读取。 */
  resizable?: boolean | 'width' | 'height' | 'aspect'
  /**
   * 等比例拖拽用的内容比例（宽/高，可选）：类型最清楚内容存在哪个字段，
   * 框架只调函数、不猜字段名。见 CanvasNodeType.resizeRatio。
   */
  resizeRatio?: (data: Record<string, unknown>) => number
  /** 无边框（类型级能力；缺省 false）。透传进 nodeStore 供渲染层读取 —— 内容铺满整张卡的类型用它去掉多余的一圈缝。 */
  frameless?: boolean
  /** 表面透明（类型级能力；缺省 false）。透传进 nodeStore 供渲染层读取 —— 容器型类型（分组）用它让连接线透出卡片区域。 */
  transparent?: boolean
  /** 加载态用类型默认尺寸（类型级能力；缺省 false）。透传进 nodeStore 供渲染层读取 —— 媒体型类型（图片/视频）重新生成时按默认宽高显示，不跟着媒体比例变竖。 */
  loadingDefaultSize?: boolean
}

/**
 * 插件里一次注册一个节点类型（数据 + 展示同时落表）。
 *
 * 返回的 revoke 会自动登记进当前插件 Scope：插件被 uninstallPlugin/stop 时，
 * nodeStore 的 type 与 nodeRegistry 的 content 一并注销 → 支持"同名插件重装"(热重载)。
 *
 * @param ctx 插件 apply/setup 拿到的 ctx（真会 ctx.get('doc'/'nodeRegistry')）；
 *   类型表的注册/注销走 doc 的写口（doc.registerType/unregisterType —— 5c 起 nodeStore 不再是服务名）。
 * @param def 节点类型完整定义
 */
export function registerNodeType(ctx: PluginScope, def: NodeTypeDef): () => void {
  const doc = ctx.get<NodeTypeStore>('doc')
  // 数据契约校验：refField / valueField / externalUrlField 恰好一个
  assertDataPorts('produces', def.produces)
  assertDataPorts('consumes', def.consumes)
  // ① 数据侧：type/label/defaultSize/图标/连接约束
  doc.registerType({
    type: def.type,
    label: def.label,
    defaultSize: def.defaultSize,
    nameTemplate: def.nameTemplate,
    icon: def.icon,
    titleExtra: def.titleExtra,
    titleExtraSlot: def.titleExtraSlot,
    description: def.description,
    inputs: def.inputs,
    outputs: def.outputs,
    resizable: def.resizable,
    resizeRatio: def.resizeRatio,
    frameless: def.frameless,
    transparent: def.transparent,
    loadingDefaultSize: def.loadingDefaultSize,
    produces: def.produces,
    consumes: def.consumes,
  })
  const revokers: Array<() => void> = [() => doc.unregisterType(def.type)]

  // ② 展示侧：各区域组件（opaque 句柄；区域词见 canvas/region.ts）
  //    宿主经 createMiniCanvasHost 注入 'nodeRegistry'；纯 Node 单测若未注入则只落数据、跳过展示。
  const segs = def.segments ?? {}
  const nodeRegistry = safeGet<NodeRegistry>(ctx, 'nodeRegistry')
  if (nodeRegistry && Object.keys(segs).length > 0) {
    try {
      nodeRegistry.register(def.type, segs)
    } catch (err) {
      // P2-9：展示侧注册失败（如 nodeRegistry 里该 type 已被他人占用而 nodeStore 没有）→ 回滚数据侧，
      // 保证"要么两表都注册、要么都不注册"的原子性，避免留下只落了一半的 type。
      doc.unregisterType(def.type)
      throw err
    }
    revokers.push(() => nodeRegistry.unregister(def.type))
  }

  // 把 revoke 挂到当前插件 scope：scope.dispose（uninstallPlugin/stop）时自动注销
  const revoke = () => {
    for (const r of revokers) r()
  }
  ctx.effect(() => revoke)
  return revoke
}

/** 尽力取一个 ctx 服务：取不到返回 undefined（不抛）。 */
function safeGet<T>(ctx: PluginScope, name: string): T | undefined {
  try {
    return ctx.get<T>(name)
  } catch {
    return undefined
  }
}
