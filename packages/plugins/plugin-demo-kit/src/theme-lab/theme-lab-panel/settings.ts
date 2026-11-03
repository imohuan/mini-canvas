import type { DeclaredColorField, ThemeLabColorEntry, ThemeLabMode } from '../catalog'
import type { LabSettingsStore } from '../types'
import type { ThemeLabState } from './state'

export function useThemeLabSettings(
  state: ThemeLabState,
  deps: { persist: () => void; showToast: (message: string) => void; scheduleRedraw: () => void },
) {
  const { host, hostCanvas, activeTheme, mode, fields, entries, props } = state
  const persist = deps.persist
  const showToast = deps.showToast
  const scheduleRedraw = deps.scheduleRedraw

  /** 预览画布自己的 settings：实时样张用 */
  function previewSettings(): LabSettingsStore | undefined {
    return host.value?.ctx.tryGet<LabSettingsStore>('settings')
  }

  /** 主应用的 settings（只有嵌进设置页时存在） */
  function appSettings(): LabSettingsStore | undefined {
    if (!props.embedded) return undefined
    const source = props.settingsSource as unknown as Partial<LabSettingsStore> | undefined
    if (source) {
      // 设置外壳给的是 SettingsPanelSource（没有 get / onSchemaChange）：补成工作台要的最小接口。
      return {
        has: source.has,
        get: (key) => {
          if (typeof source.get === 'function') return source.get(key)
          if (!source.groups || !source.groupOf) return undefined
          for (const group of source.groups()) {
            const item = source.groupOf(group).find((entry) => entry.key === key)
            if (item) return item.value
          }
          return undefined
        },
        set: (key, value) => source.set?.(key, value) ?? false,
        groups: () => source.groups?.() ?? [],
        groupOf: (group) => source.groupOf?.(group) ?? [],
        onChange: (cb) => source.onChange?.(cb) ?? { dispose: () => {} },
        onSchemaChange: (cb) => source.onSchemaChange?.(cb) ?? { dispose: () => {} },
      }
    }
    return hostCanvas?.ctx.tryGet<LabSettingsStore>('settings')
  }

  /** 编辑的写入口：嵌入时改主应用，独立页改预览画布 */
  function settings(): LabSettingsStore | undefined {
    return props.embedded ? appSettings() : previewSettings()
  }

  /**
   * 把主应用当前配色镜像进预览画布。
   *
   * 预览是另一块内核（内存存储、不碰用户画布），不会自动获得主应用的 settings；
   * 这里只复制已声明的 color 字段，让样张看到的就是主界面正在用的颜色。
   */
  function mirrorThemeToPreview(): void {
    if (!props.embedded) return
    const source = settings()
    const target = previewSettings()
    if (!source || !target) return
    for (const entry of entries.value) {
      for (const key of [entry.keys.light, entry.keys.dark]) {
        if (target.has && !target.has(key)) continue
        const value = source.get(key)
        if (typeof value !== 'string') continue
        try {
          target.set(key, value)
        } catch {
          /* 预览里该插件没装：这一格没有预览宿主，跳过 */
        }
      }
    }
    requestAnimationFrame(scheduleRedraw)
  }

  /** 从 settings 的「外观/主题配色」「外观/暗色主题配色」两组里收真实 color 字段 */
  function readFields(): DeclaredColorField[] {
    const store = settings()
    if (!store) return []
    const out: DeclaredColorField[] = []
    for (const group of store.groups()) {
      if (!group.startsWith('外观/')) continue
      for (const item of store.groupOf(group)) {
        if (item.schema.type !== 'color') continue
        out.push({ group, key: item.key, schema: item.schema, value: item.value })
      }
    }
    return out
  }

  function keyFor(entry: ThemeLabColorEntry, forMode: ThemeLabMode = mode.value): string {
    return forMode === 'light' ? entry.keys.light : entry.keys.dark
  }

  function valueOf(entry: ThemeLabColorEntry, forMode: ThemeLabMode = mode.value): string {
    const store = settings()
    const key = keyFor(entry, forMode)
    const raw = store?.get(key)
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (value) return value
    if (entry.followKey) return followColor(entry.followKey, forMode)
    return forMode === 'light' ? entry.defaults.light : entry.defaults.dark
  }

  /** 清空 = 跟随主题；实时预览要把“跟随”解析成看得见的颜色 */
  function followColor(base: string, forMode: ThemeLabMode): string {
    const store = settings()
    if (!store) return ''
    const target = entries.value.find((item) => item.id === base)
    if (!target) return ''
    return valueOf(target, forMode)
  }

  /**
   * 把主题套进真实 settings。
   *
   * 这里只有一个通道：settings.set → 插件订阅 → 组件。没有另存一份“预览覆盖值”，
   * 所以色块显示什么、画布就是什么；切换主题 = 把这份 JSON 写进同一批字段。
   */
  function applyThemeToSettings(): void {
    const store = settings()
    const theme = activeTheme.value
    if (!store || !theme) return
    const known = new Set(entries.value.flatMap((entry) => [entry.keys.light, entry.keys.dark]))
    for (const [key, value] of Object.entries(theme.overrides)) {
      if (!known.has(key)) continue
      try {
        store.set(key, value)
      } catch {
        /* 插件可能刚被卸掉：忽略已消失的 key */
      }
    }
    // 主题里没写的格子恢复成默认值，避免“切主题后还留着上一套的颜色”
    for (const entry of entries.value) {
      for (const key of [entry.keys.light, entry.keys.dark]) {
        if (key in theme.overrides) continue
        const fallback = key.endsWith('Dark') ? entry.defaults.dark : entry.defaults.light
        const schemaDefault = fieldDefault(key, fallback)
        try {
          if (String(store.get(key) ?? '') !== schemaDefault) store.set(key, schemaDefault)
        } catch {
          /* 同上 */
        }
      }
    }
  }

  function fieldDefault(key: string, fallback: string): string {
    return fields.value.find((field) => field.key === key)?.schema.default?.toString() ?? fallback
  }

  function setValue(entry: ThemeLabColorEntry, next: string): void {
    const store = settings()
    const theme = activeTheme.value
    if (!store || !theme) return
    const key = keyFor(entry)
    const value = (next || '').trim()
    if (value && !/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) {
      showToast('颜色要写成 #RRGGBB 或 #RRGGBBAA')
      return
    }
    if (!value && !entry.optional) return
    try {
      store.set(key, value)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '这个字段已经不可用')
      return
    }
    if (value) theme.overrides[key] = value
    else delete theme.overrides[key]
    persist()
    requestAnimationFrame(scheduleRedraw)
  }

  function clearValue(entry: ThemeLabColorEntry): void {
    setValue(entry, '')
  }

  return {
    previewSettings,
    appSettings,
    settings,
    mirrorThemeToPreview,
    readFields,
    keyFor,
    valueOf,
    followColor,
    applyThemeToSettings,
    fieldDefault,
    setValue,
    clearValue,
  }
}
