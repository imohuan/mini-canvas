import { computed, ref } from 'vue'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'
import {
  GROUP_ORDER,
  PLUGIN_LABELS,
  buildColorEntries,
  type DeclaredColorField,
  type ThemeLabColorEntry,
  type ThemeLabMode,
} from './catalog'
import { CUSTOM_THEME_ID, clonePresets, cloneThemes, readLabState, type LabTheme } from './storage'
import type { LabSettingsStore } from './types'

export function useThemeStudioState(settingsSource: SettingsPanelSource) {
  const source = settingsSource as SettingsPanelSource & Partial<LabSettingsStore>
  const MODES: ThemeLabMode[] = ['light', 'dark']
  const stored = readLabState()
  /**
   * 显示用列表 = 代码里的预设（只读真源）+ 存档里的用户模板。
   *
   * 预设绝不从存档取：以前把预设也存了，界面上改一格就把「雾青」写坏，
   * 用户再也回不到原样。
   */
  const themes = ref<LabTheme[]>([...clonePresets(), ...cloneThemes(stored.themes)])
  // 首屏先按存档回显；随后 onMounted 会用真实 settings 反推（改过色 → 自动变成「自定义」）。
  const activeId = ref(
    stored.themeId === CUSTOM_THEME_ID || themes.value.some((theme) => theme.id === stored.themeId)
      ? stored.themeId
      : themes.value[0]?.id ?? 'mist',
  )
  const mode = ref<ThemeLabMode>(initialMode())
  const previewRevision = ref(0)
  const fields = ref<DeclaredColorField[]>([])
  const tick = ref(0)
  const toast = ref('')

  const disposers: Array<{ dispose(): void }> = []
  const runtime = { toastTimer: 0, saveTimer: 0 }

  function groupItems(group: string): Array<{ key: string; schema: DeclaredColorField['schema']; value: string | number | boolean }> {
    return source.groupOf(group)
  }

  function rawGet(key: string): unknown {
    void tick.value
    if (typeof source.get === 'function') return source.get(key)
    for (const group of source.groups()) {
      const item = groupItems(group).find((entry) => entry.key === key)
      if (item) return item.value
    }
    return undefined
  }

  function readFields(): DeclaredColorField[] {
    void tick.value
    const out: DeclaredColorField[] = []
    for (const group of source.groups()) {
      if (!group.startsWith('外观/')) continue
      for (const item of groupItems(group)) {
        if (item.schema.type !== 'color') continue
        out.push({ group, key: item.key, schema: item.schema, value: item.value })
      }
    }
    return out
  }

  // 首屏就按真实 settings 渲染颜色；onMounted 再补一次，保证挂在设置页时拿到的
  // 是外壳已经装配完成后的字段。SSR / 独立预览也因此不会先闪一屏“没有颜色”。
  fields.value = readFields()

  /** 字段存在 = 声明它的插件已装；不再拿插件名单二次过滤。 */
  const entries = computed(() => buildColorEntries(fields.value, new Set(Object.keys(PLUGIN_LABELS))))
  const activeTheme = computed(() => themes.value.find((theme) => theme.id === activeId.value) ?? themes.value[0])
  const groups = computed(() =>
    GROUP_ORDER.map((group) => ({ group, items: entries.value.filter((entry) => entry.group === group) })).filter(
      (group) => group.items.length > 0,
    ),
  )

  function entryOf(base: string): ThemeLabColorEntry | undefined {
    return entries.value.find((entry) => entry.id === base)
  }

  function initialMode(): ThemeLabMode {
    const raw = source.get?.('themeMode')
    if (raw === 'light' || raw === 'dark') return raw
    if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) return 'dark'
    return 'light'
  }

  return {
    source,
    MODES,
    themes,
    activeId,
    mode,
    previewRevision,
    fields,
    tick,
    toast,
    disposers,
    runtime,
    groupItems,
    rawGet,
    readFields,
    entries,
    activeTheme,
    groups,
    entryOf,
  }
}

export type ThemeStudioState = ReturnType<typeof useThemeStudioState>






