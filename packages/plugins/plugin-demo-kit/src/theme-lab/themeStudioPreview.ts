/**
 * themeStudioPreview —— 独立验收页的 settings 适配。
 *
 * 与设置页拿到的是同一类数据：真实 SettingsStore 里已声明的 `type: 'color'` 字段。
 * 独立页没有主应用设置外壳，所以在这里把内核 SettingsStore 适配上 SettingsPanelSource，
 * 让 ThemeStudio 走同一条真实读写链路，而不是为了预览另造一套假颜色。
 *
 * 预览图层同一条原则：建一个真实内核 ctx，让四个插件按各自 apply 里的同名函数
 * 往 `theme-preview` 槽注册；页面用 SlotHost 读注册结果，不认识任何具体插件。
 */
import { SettingsStore } from '@mini-canvas/kernel'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'
import { defineThemePaletteSettings } from '@mini-canvas/canvas-render'
import { alignGuidePlugin } from '@mini-canvas/plugin-align-guide'
import { edgeCuttingPlugin } from '@mini-canvas/plugin-edge-cutting'
import { multiSelectPlugin } from '@mini-canvas/plugin-multi-select'
import { themeComponentsPlugin } from '@mini-canvas/plugin-theme-components'
import { Context } from '@mini-canvas/canvas-data'
import type { ConfigField, ConfigSchema } from '@mini-canvas/canvas-base'
import type { SettingSchema } from '@mini-canvas/kernel'
import { registerThemePreview as registerThemeDefaultPreview } from '@mini-canvas/plugin-theme-components'
import { registerThemePreview as registerMultiSelectPreview } from '@mini-canvas/plugin-multi-select'
import { registerThemePreview as registerAlignGuidePreview } from '@mini-canvas/plugin-align-guide'
import { registerThemePreview as registerEdgeCuttingPreview } from '@mini-canvas/plugin-edge-cutting'

/**
 * 独立验收页的预览上下文：一个真实的内核 ctx + 四个插件的预览注册。
 * 工作台与设置页走同一条 SlotHost 链路，页面本身不认识任何具体插件。
 */
export function createStudioPreviewContext(): Context {
  const ctx = new Context()
  registerThemeDefaultPreview(ctx as never)
  registerMultiSelectPreview(ctx as never)
  registerAlignGuidePreview(ctx as never)
  registerEdgeCuttingPreview(ctx as never)
  return ctx
}

/** 内核 SettingsStore → 设置面板消费的最小接口。 */
export function settingsPanelSourceOf(store: SettingsStore): SettingsPanelSource {
  return {
    groups: () => store.groups(),
    groupOf: (group) => store.groupOf(group),
    set: (key, value) => store.set(key, value),
    onChange: (cb) => store.onChange(cb),
    // 面板用 onChange 已经能跟着值刷新；schema 变更也转成一次普通通知即可。
    get: (key: string) => store.get(key),
    onSchemaChange: (cb) => store.onSchemaChange(cb),
  } as SettingsPanelSource & { get(key: string): unknown; onSchemaChange(cb: () => void): { dispose(): void } }
}

/** 把插件 Config 里声明过的字段装进 store（与内核装配同一条 define 路径）。 */
function toSettingSchema(field: ConfigField): SettingSchema | null {
  // 面板只吃标量；array/object 这类结构化配置不属于主题色板。
  if (field.type === 'array' || field.type === 'object' || field.type === 'string') return null
  return {
    type: field.type,
    default: field.default as string | number | boolean,
    label: field.label,
    description: field.description,
    ...(field.optional !== undefined ? { optional: field.optional } : {}),
    ...(field.min !== undefined ? { min: field.min } : {}),
    ...(field.max !== undefined ? { max: field.max } : {}),
    ...(field.step !== undefined ? { step: field.step } : {}),
    ...(field.options !== undefined
      ? { options: field.options.map((option) => (typeof option === 'string' ? { value: option } : option)) }
      : {}),
  }
}

/** 把插件 Config 里声明过的标量字段装进 store（与内核装配同一条 define 路径）。 */
function definePluginConfig(store: SettingsStore, scope: string, config: ConfigSchema): void {
  const byGroup = new Map<string, Record<string, SettingSchema>>()
  for (const [key, field] of Object.entries(config)) {
    const schema = toSettingSchema(field)
    if (!schema) continue
    const group = field.group ?? '通用/基础'
    const bucket = byGroup.get(group) ?? {}
    bucket[key] = schema
    byGroup.set(group, bucket)
  }
  for (const [group, items] of byGroup) store.define(group, items, scope)
}

/**
 * 独立页的真实配置源：默认主题 + 三个可选插件的 Config，按内核同样的方式声明进 store。
 * 这样「插件没装 → 颜色不存在」的规则在验收页里也是真的。
 */
export function createStudioPreviewSource(): { store: SettingsStore; source: SettingsPanelSource } {
  const store = new SettingsStore()
  // 宿主级色板（强调色 / 危险色 / 连线色…）：与真实画布同一条声明路径。
  defineThemePaletteSettings(store)
  // 主题模式也声明，工作台才能读到并切亮暗。
  store.define('外观/主题模式', {
    themeMode: {
      type: 'select',
      default: 'light',
      label: '主题模式',
      description: '整界面亮色 / 暗色。',
      options: [{ value: 'light', label: '亮色' }, { value: 'dark', label: '暗色' }],
    },
  }, 'canvas-render')

  // 默认主题 + 三个可选插件：颜色格和“插件没装就没有”都走真实 Config。
  definePluginConfig(store, themeComponentsPlugin.name, themeComponentsPlugin.Config ?? {})
  definePluginConfig(store, multiSelectPlugin.name, multiSelectPlugin.Config ?? {})
  definePluginConfig(store, alignGuidePlugin.name, alignGuidePlugin.Config ?? {})
  definePluginConfig(store, edgeCuttingPlugin.name, edgeCuttingPlugin.Config ?? {})

  return { store, source: settingsPanelSourceOf(store) }
}
