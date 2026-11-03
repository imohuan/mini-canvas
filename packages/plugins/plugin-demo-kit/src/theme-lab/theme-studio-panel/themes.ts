import { computed } from 'vue'
import { LAB_THEMES, writeLabState, type LabTheme } from '../storage'
import type { ThemeLabColorEntry, ThemeLabMode } from '../catalog'
import type { ThemeStudioState } from './state'

export function useThemeStudioThemes(
  state: ThemeStudioState,
  deps: { keyOf: (entry: ThemeLabColorEntry, forMode: ThemeLabMode) => string; isHex: (value: string) => boolean },
) {
  const { source, themes, activeId, activeTheme, mode, entries, fields, tick, previewRevision, toast, runtime } = state
  const keyOf = deps.keyOf
  const isHex = deps.isHex

  function persist(): void {
    clearTimeout(runtime.saveTimer)
    runtime.saveTimer = window.setTimeout(() => {
      const ok = writeLabState({ version: 1, themeId: activeId.value, mode: mode.value, themes: themes.value })
      if (!ok) showToast('浏览器不允许保存模板，刷新会丢')
    }, 220)
  }

  function showToast(message: string): void {
    toast.value = message
    clearTimeout(runtime.toastTimer)
    runtime.toastTimer = window.setTimeout(() => (toast.value = ''), 2400)
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

  function resetTheme(): void {
    const theme = activeTheme.value
    if (!theme) return
    theme.overrides = {}
    applyTheme(theme)
    persist()
    showToast('已恢复主题默认色')
  }

  function setValue(entry: ThemeLabColorEntry, next: string): void {
    const theme = activeTheme.value
    if (!theme) return
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
    if (value) theme.overrides[key] = value
    else delete theme.overrides[key]
    fields.value = state.readFields()
    tick.value += 1
    previewRevision.value += 1
    persist()
  }

  const activeIsPreset = computed(() => LAB_THEMES.some((theme) => theme.id === activeId.value))

  return { persist, showToast, applyTheme, selectTheme, duplicateTheme, resetTheme, setValue, activeIsPreset }
}
