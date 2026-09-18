/**
 * capabilityLayer —— 画布能力层（挂在 @mini-canvas/kernel 的"能力层"接缝上的那一层）。
 *
 * 框架（kernel）只认识"插件"这件事，不认识 node/theme/command/settings 这些画布概念。
 * 画布需要的那些能力段（ctx.nodes/theme/commands/slots/settings）由本层产出、并声明其内置服务：
 *   · slots    —— 通用 UI 槽容器（宿主按序渲染）
 *   · settings —— 分组配置单一数据源（UI 面板据此长控件）
 *   （tools 由框架自带，见 kernel 的 ctx.tools，本层不重复提供。）
 *
 * 依赖方向：canvas → kernel（只借通用容器与类型），零 Vue。
 */
import type { CapabilityLayer } from '@mini-canvas/kernel'
import { SettingsStore, SlotRegistry, isScalarField, optionValues, selectOptionEntry } from '@mini-canvas/kernel'
import type { ConfigField, ConfigSchema, PluginScope, SettingSchema } from '@mini-canvas/kernel'
import { buildCapabilities } from './capabilities'
import { createDocService } from '../docService'
import type { DocService } from '../docService'
import type { NodeStoreService } from '../nodeStore'
import type { EdgeStoreService } from '../edgeStore'
import type { GraphDocumentService } from '../graphDocument'
import type { HistoryService } from '../history'

/** 把 config schema 的标量字段映射成 SettingsStore 的 SettingSchema（string→text），供面板长控件。 */
function toSettingSchema(field: ConfigField): SettingSchema {
  // 调用处已用 isScalarField 过滤（仅标量字段进来）；此处断言 field.type 落在 scalar 5 型内
  const type = (field.type === 'string' ? 'text' : field.type) as
    | 'text'
    | 'color'
    | 'number'
    | 'select'
    | 'boolean'
  return {
    type,
    default: field.default as string | number | boolean,
    ...(field.label !== undefined ? { label: field.label } : {}),
    ...(field.description !== undefined ? { description: field.description } : {}),
    ...(field.min !== undefined ? { min: field.min } : {}),
    ...(field.max !== undefined ? { max: field.max } : {}),
    ...(field.step !== undefined ? { step: field.step } : {}),
    ...(field.options
      ? {
          options: optionValues(field.options).map((value) => {
            const entry = field.options!.find((o) => (typeof o === 'string' ? o === value : o.value === value))
            const withLabel = entry ? selectOptionEntry(entry) : { value }
            return { value: withLabel.value, label: withLabel.label }
          }),
        }
      : {}),
  }
}

/**
 * 建一个画布能力层实例（每 Context 一份：slots/settings 都不可跨画布共享）。
 * `new Context()`（canvas 版）默认装本层；宿主通常无需直接调用。
 */
export function createCanvasCapabilityLayer(): CapabilityLayer {
  const slots = new SlotRegistry()
  let settings = new SettingsStore()
  /** 根 ctx（首次 buildSegments 时捕获）—— doc 门面按名解析底层服务要靠它 */
  let rootCtx: PluginScope | undefined
  const builtins: Record<string, unknown> = { slots, settings }

  /**
   * doc 文档门面（§4.1：nodeStore + edgeStore + graph + history 合并成一个名字）。
   *
   * 为什么放在能力层内置服务（与 slots/settings 同类）而不是 canvas-base 注入：
   * ① 它是"画布数据那一格"的正式名字，任何带画布能力层的 ctx 都该有；
   * ② 迁移期（步骤 5a/5b）新老并存 —— 门面按名解析底层服务，于是"生产宿主（canvas-base 注入四个老名）"
   *    与"手工注入老名的最小 ctx（遍布插件包测试）"两种装配都能用同一个 doc，零测试改动。
   * 门面是惰性视图、零状态：底层服务后来被换掉也不会用到旧实例（见 docService.ts）。
   */
  function ensureDoc(): DocService {
    if (builtins.doc) return builtins.doc as DocService
    const resolve = () => ({
      nodeStore: rootCtx?.get<NodeStoreService | undefined>('nodeStore') ?? undefined,
      edgeStore: rootCtx?.get<EdgeStoreService | undefined>('edgeStore') ?? undefined,
      graph: rootCtx?.get<GraphDocumentService | undefined>('graph') ?? undefined,
      history: rootCtx?.get<HistoryService | undefined>('history') ?? undefined,
    })
    const doc = createDocService(resolve)
    builtins.doc = doc
    return doc
  }

  return {
    /**
     * 产出画布能力段。段本身由 canvas/capabilities.ts 收口实现；
     * 这里剥掉 tools —— 它已由框架自带（ctx.tools 恒在），避免两处各建一份。
     */
    buildSegments(ctx: PluginScope, scopeName: string): Record<string, unknown> {
      // 根 ctx 只在这里出现一次（构造末尾）；捕获它，doc 门面才有地方按名解析服务。
      if (!rootCtx) rootCtx = ctx
      ensureDoc()
      const segs = buildCapabilities(ctx, scopeName) as unknown as Record<string, unknown>
      delete segs.tools
      return segs
    },
    /** 画布层提供的内置服务：slots / settings / doc（tools 由框架自带，不在这里） */
    builtins(): Record<string, unknown> {
      ensureDoc()
      return builtins
    },
    /** 生命周期重置：分组配置随 stop 重建（重启可重新声明）；slots 跨 stop 保留（宿主容器） */
    reset(): void {
      settings = new SettingsStore()
      builtins.settings = settings
    },
    /**
     * 把插件 Config schema 的标量字段登记进 settings 单一数据源（供设置面板长控件）。
     * @returns 随该插件回收的清理函数（由框架登记进插件 fiber）
     */
    declareConfig(
      schema: ConfigSchema,
      config: Record<string, unknown>,
      pluginName: string,
      dev: boolean,
    ): () => void {
      for (const [key, field] of Object.entries(schema)) {
        // array/object 是"给 apply 的结构化配置"，settings 单一数据源只长标量控件 → 跳过登记
        if (!isScalarField(field)) continue
        const itemSchema = toSettingSchema(field)
        if (!settings.has(key)) {
          settings.define(field.group ?? pluginName, { [key]: itemSchema }, pluginName)
          // define 初值=itemSchema.default；装配校验后的 config 可能覆盖默认 → 补齐成单一数据源当前值
          settings.set(key, config[key] as string | number | boolean)
        } else if (dev) {
          // P1-4：该 key 已被其它插件声明 → 不静默覆盖（先占者保留所有权），仅提示
          // eslint-disable-next-line no-console
          console.warn(
            `[settings] config key "${key}" from "${pluginName}" collides with an existing declaration; skipping (keep first owner).`,
          )
        }
      }
      // 随插件回收：热卸/重载清掉它声明的配置项（防残留与重装撞 key）
      return () => settings.removeByScope(pluginName)
    },
  }
}
