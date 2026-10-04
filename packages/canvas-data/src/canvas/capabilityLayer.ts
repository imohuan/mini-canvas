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
    ...(field.optional !== undefined ? { optional: field.optional } : {}),
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
  const builtins: Record<string, unknown> = { slots, settings }

  /**
   * 注：`doc`（§4.1 的"画布数据那一格"）**不在本层**（步骤 5c 起）。
   *
   * 5a/5b 期它在这里当"按名解析的内置视图"，好处是新老并存时两边零改动；但 5c 删掉了四个老名，
   * 内置视图再按名解析只会拿到 undefined —— 而且内置优先于真服务，会把 canvas-base 注入的那个
   * doc 挡掉。所以现在 doc 是**由 canvasBasePlugin 建好四个实例后注入的真服务**（与 save/selection
   * 同类），`builtins()` 只留 slots/settings。
   */

  return {
    /**
     * 产出画布能力段。段本身由 canvas/capabilities.ts 收口实现；
     * 这里剥掉 tools —— 它已由框架自带（ctx.tools 恒在），避免两处各建一份。
     */
    buildSegments(ctx: PluginScope, scopeName: string): Record<string, unknown> {
      const segs = buildCapabilities(ctx, scopeName) as unknown as Record<string, unknown>
      delete segs.tools
      return segs
    },
    /** 画布层提供的内置服务：slots / settings（tools 由框架自带；doc 由 canvas-base 注入） */
    builtins(): Record<string, unknown> {
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
          // define 初值：优先用**用户已保存值**（define 命中快照时会自动取它），其次才用装配 config。
          //
          // 为什么不能无条件 set 成 config[key]：插件可能是**运行期热装**的（云端清单装进来的那些，
          // 如 mini-map）。刷新时宿主先按本地后端恢复设置（快照里已有用户改过的值），随后才热装插件 ——
          // 此时 define 已经把用户值作为初值取到了，再 set 一次 config[key]（= schema 默认）会把它盖回去。
          // 用户看到的现象就是「改了配置、刷新就回退」（小地图宽高即此）。
          const saved = settings.getSavedSnapshot()
          const hasSaved = !!saved && Object.prototype.hasOwnProperty.call(saved, key)
          if (!hasSaved) {
            settings.set(key, config[key] as string | number | boolean)
          }
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
