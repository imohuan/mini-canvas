/**
 * 独立验收页（theme-lab.html）的 settings / 预览上下文。
 *
 * 颜色配方本体已迁到 @plume-canvas/plugin-theme-components；这里只保留"造一个
 * 真实内核 store + 让四个插件注册预览层"的装配，供目验页面使用。
 */
import { SettingsStore } from '@plume-canvas/kernel'
import type { SettingsPanelSource } from '@plume-canvas/canvas-render'
import { defineThemePaletteSettings } from '@plume-canvas/canvas-render'
import { alignGuidePlugin } from '@plume-canvas/plugin-align-guide'
import { edgeCuttingPlugin } from '@plume-canvas/plugin-edge-cutting'
import { multiSelectPlugin } from '@plume-canvas/plugin-multi-select'
import { themeComponentsPlugin } from '@plume-canvas/plugin-theme-components'
import { Context } from '@plume-canvas/canvas-data'
import type { ConfigField, ConfigSchema } from '@plume-canvas/canvas-base'
import type { SettingSchema } from '@plume-canvas/kernel'
import { registerThemePreview as registerThemeDefaultPreview } from '@plume-canvas/plugin-theme-components'
import { registerThemePreview as registerMultiSelectPreview } from '@plume-canvas/plugin-multi-select'
import { registerThemePreview as registerAlignGuidePreview } from '@plume-canvas/plugin-align-guide'
import { registerThemePreview as registerEdgeCuttingPreview } from '@plume-canvas/plugin-edge-cutting'

export function createStudioPreviewContext(): Context {
  const ctx = new Context()
  registerThemeDefaultPreview(ctx as never)
  registerMultiSelectPreview(ctx as never)
  registerAlignGuidePreview(ctx as never)
  registerEdgeCuttingPreview(ctx as never)
  return ctx
}

export function settingsPanelSourceOf(store: SettingsStore): SettingsPanelSource {
  return {
    groups: () => store.groups(),
    groupOf: (group) => store.groupOf(group),
    set: (key, value) => store.set(key, value),
    onChange: (cb) => store.onChange(cb),
    get: (key: string) => store.get(key),
    onSchemaChange: (cb) => store.onSchemaChange(cb),
  } as SettingsPanelSource & { get(key: string): unknown; onSchemaChange(cb: () => void): { dispose(): void } }
}

function toSettingSchema(field: ConfigField): SettingSchema | null {
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

export function createStudioPreviewSource(): { store: SettingsStore; source: SettingsPanelSource } {
  const store = new SettingsStore()
  defineThemePaletteSettings(store)
  store.define(
    '外观/主题模式',
    {
      themeMode: {
        type: 'select',
        default: 'light',
        label: '主题模式',
        description: '整界面亮色 / 暗色。',
        options: [
          { value: 'light', label: '亮色' },
          { value: 'dark', label: '暗色' },
        ],
      },
    },
    'canvas-render',
  )

  definePluginConfig(store, themeComponentsPlugin.name, themeComponentsPlugin.Config ?? {})
  definePluginConfig(store, multiSelectPlugin.name, multiSelectPlugin.Config ?? {})
  definePluginConfig(store, alignGuidePlugin.name, alignGuidePlugin.Config ?? {})
  definePluginConfig(store, edgeCuttingPlugin.name, edgeCuttingPlugin.Config ?? {})

  return { store, source: settingsPanelSourceOf(store) }
}
