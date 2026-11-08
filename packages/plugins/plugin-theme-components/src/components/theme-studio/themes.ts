import { computed } from 'vue'
import {
  CUSTOM_THEME_ID,
  isCustomThemeId,
  isEditableTheme,
  isPresetTheme,
  writeLabState,
  type LabTheme,
} from './storage'
import { matchesThemeValues, themeIdForValues } from './themeMatch'
import type { ThemeLabColorEntry, ThemeLabMode } from './catalog'
import type { ThemeStudioState } from './state'

export function useThemeStudioThemes(
  state: ThemeStudioState,
  deps: { keyOf: (entry: ThemeLabColorEntry, forMode: ThemeLabMode) => string; isHex: (value: string) => boolean },
) {
  const { source, themes, activeId, activeTheme, mode, entries, fields, tick, previewRevision, toast, runtime, rawGet } = state
  const keyOf = deps.keyOf
  const isHex = deps.isHex

  function persist(): void {
    clearTimeout(runtime.saveTimer)
    runtime.saveTimer = window.setTimeout(() => {
      // 只存用户自建模板：预设是真源，永远不落存档（否则改一格就把预设写坏）
      const custom = themes.value.filter((theme) => !isPresetTheme(theme))
      const ok = writeLabState({ version: 1, themeId: activeId.value, mode: mode.value, themes: custom })
      if (!ok) showToast('浏览器不允许保存模板，刷新会丢')
    }, 220)
  }

  function showToast(message: string): void {
    toast.value = message
    clearTimeout(runtime.toastTimer)
    runtime.toastTimer = window.setTimeout(() => (toast.value = ''), 2400)
  }

  /**
   * 当前 settings 里的配色是否正好等于某套模板。
   *
   * 判定只比"这套模板声明过的 key"：模板没声明的格子用字段默认值，因此
   * 雾青（overrides 为空）等价于"全部回归默认"。
   */
  function matchesTheme(theme: LabTheme): boolean {
    return matchesThemeValues(theme, entries.value, state.MODES, currentValues())
  }

  /** 找到与当前配色一致的第一套模板；都不一致 → 自定义 */
  function detectThemeId(): string {
    return themeIdForValues(themes.value, entries.value, state.MODES, currentValues())
  }

  /** 当前 settings 里每格的颜色（settings key → 值），供模板匹配用。 */
  function currentValues(): Record<string, string> {
    const values: Record<string, string> = {}
    for (const entry of entries.value) {
      for (const forMode of state.MODES) {
        const key = keyOf(entry, forMode)
        values[key] = String(rawGet(key) ?? '').trim()
      }
    }
    return values
  }

  /**
   * 根据 settings 现状刷新"当前选中哪一格"。
   * 用于：进入页面、外部改了颜色、撤销/重做之后。
   */
  function syncActiveFromSettings(): void {
    activeId.value = detectThemeId()
  }

  /** 手动点了「自定义」：不改任何颜色，只是不再声称跟某套模板一致 */
  function selectCustom(): void {
    activeId.value = CUSTOM_THEME_ID
    persist()
  }

  function uniqueName(base: string): string {
    let name = base
    let index = 2
    while (themes.value.some((theme) => theme.name === name)) name = base + ' ' + index++
    return name
  }

  function applyTheme(theme: LabTheme): void {
    for (const entry of entries.value) {
      for (const forMode of state.MODES) {
        const key = keyOf(entry, forMode)
        const value = theme.overrides[key] ?? (forMode === 'light' ? entry.defaults.light : entry.defaults.dark)
        try {
          source.set(key, value)
        } catch {
          /* 插件刚卸掉：对应字段已经不存在 */
        }
      }
    }
    fields.value = state.readFields()
    tick.value += 1
    previewRevision.value += 1
  }

  function selectTheme(theme: LabTheme): void {
    activeId.value = theme.id
    applyTheme(theme)
    persist()
    showToast('已换成「' + theme.name + '」')
  }

  function duplicateTheme(): void {
    const from = activeTheme.value
    if (!from) return
    const name = uniqueName(from.name + ' 副本')
    const theme: LabTheme = { id: 'lab-' + Date.now().toString(36), name, overrides: { ...from.overrides } }
    themes.value.push(theme)
    activeId.value = theme.id
    applyTheme(theme)
    persist()
    showToast('已新建「' + name + '」')
  }

  /**
   * 删除模板：只允许删用户自己新建的。
   * 预设是代码里的真源，不能删（删了下次打开又出现，反而更困惑）。
   * 删掉的若是当前选中项，回落到「自定义」并保留现有颜色。
   */
  function removeTheme(theme: LabTheme): void {
    if (!isEditableTheme(theme)) {
      showToast(isPresetTheme(theme) ? '内置模板不能删除' : '这一项不能删除')
      return
    }
    const index = themes.value.findIndex((item) => item.id === theme.id)
    if (index < 0) return
    themes.value.splice(index, 1)
    if (activeId.value === theme.id) {
      activeId.value = CUSTOM_THEME_ID
    }
    persist()
    showToast('已删除「' + theme.name + '」')
  }

  function resetTheme(): void {
    /**
     * 还原：回到当前模板的"原始配置"。
     *
     * 预设本身不可改，所以"还原"= 把 settings 重新写成预设原值；
     * 用户模板则把 overrides 清空后按字段默认值重写。
     */
    const theme = activeTheme.value
    if (!theme) return
    if (activeId.value === CUSTOM_THEME_ID) {
      showToast('自定义配色没有可还原的模板')
      return
    }
    if (isPresetTheme(theme)) {
      applyTheme(theme)
      persist()
      showToast('已恢复「' + theme.name + '」的原始配色')
      return
    }
    theme.overrides = {}
    applyTheme(theme)
    persist()
    showToast('已恢复主题默认色')
  }

  function setValue(entry: ThemeLabColorEntry, next: string): void {
    // 改单个颜色 = 改"当前配色"，不改模板本体。
    // 自定义态下没有模板可写，只把值写进 settings。
    const theme = isCustomThemeId(activeId.value) ? null : activeTheme.value
    const value = String(next || '').trim()
    if (value && !isHex(value)) {
      showToast('颜色要写成 #RRGGBB 或 #RRGGBBAA')
      return
    }
    if (!value && !entry.optional) return
    const key = keyOf(entry, mode.value)
    try {
      source.set(key, value)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '这个颜色已经不可用')
      return
    }
    /**
     * 只有"用户自建模板"才把改动写回模板本身。
     *
     * 预设永远不写：以前这里没拦住，改一格就把「雾青」的预设存档覆盖了，
     * 而且再也回不到原样。现在预设只读，改了颜色只是切到「自定义」。
     */
    if (theme && isEditableTheme(theme)) {
      if (value) theme.overrides[key] = value
      else delete theme.overrides[key]
    }
    fields.value = state.readFields()
    tick.value += 1
    previewRevision.value += 1
    // 检测"现在是否还跟选中模板一致"：不一致就切自定义（用户口径）
    syncActiveFromSettings()
    persist()
  }

  const activeIsPreset = computed(() => activeTheme.value ? isPresetTheme(activeTheme.value) : false)
  const canEditActive = computed(() => (activeTheme.value ? isEditableTheme(activeTheme.value) : false))
  const isCustom = computed(() => isCustomThemeId(activeId.value))

  return {
    persist,
    showToast,
    applyTheme,
    selectTheme,
    selectCustom,
    duplicateTheme,
    removeTheme,
    resetTheme,
    setValue,
    matchesTheme,
    detectThemeId,
    syncActiveFromSettings,
    activeIsPreset,
    canEditActive,
    isCustom,
  }
}




