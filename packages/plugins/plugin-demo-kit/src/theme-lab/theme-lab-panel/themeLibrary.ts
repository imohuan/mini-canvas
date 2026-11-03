import { nextTick } from 'vue'
import type { ThemeLabMode } from '../catalog'
import type { LabSettingsStore } from '../types'
import type { ThemeLabState } from './state'

export function useThemeLabThemeLibrary(
  state: ThemeLabState,
  deps: {
    settings: () => LabSettingsStore | undefined
    applyThemeToSettings: () => void
    scheduleRedraw: () => void
    showToast: (message: string) => void
    persist: () => void
  },
) {
  const { activeId, editing, mode, activeTheme, themes, props } = state
  const settings = deps.settings
  const applyThemeToSettings = deps.applyThemeToSettings
  const scheduleRedraw = deps.scheduleRedraw
  const showToast = deps.showToast
  const persist = deps.persist

  function selectTheme(id: string): void {
    activeId.value = id
    editing.value = null
    persist()
    nextTick(() => {
      applyThemeToSettings()
      scheduleRedraw()
    })
  }

  function duplicateTheme(): void {
    const source = activeTheme.value
    if (!source) return
    const id = 'lab-' + Date.now().toString(36)
    const name = uniqueName(source.name + ' 副本')
    themes.value.push({ id, name, overrides: { ...source.overrides } })
    activeId.value = id
    persist()
    applyThemeToSettings()
    showToast('已复制成「' + name + '」')
  }

  function removeTheme(id: string): void {
    if (themes.value.length <= 1) return showToast('至少留一套主题')
    const theme = themes.value.find((item) => item.id === id)
    if (!theme) return
    themes.value = themes.value.filter((item) => item.id !== id)
    if (activeId.value === id) activeId.value = themes.value[0].id
    persist()
    applyThemeToSettings()
    showToast('已删除「' + theme.name + '」')
  }

  function uniqueName(base: string): string {
    let name = base
    let n = 2
    while (themes.value.some((theme) => theme.name === name)) name = base + ' ' + n++
    return name
  }

  function setMode(next: ThemeLabMode): void {
    if (mode.value === next) return
    mode.value = next
    if (props.embedded) {
      // 设置页里的亮暗只切换这张样张，不改用户整页主题；主应用仍由「外观/主题模式」控制。
      nextTick(scheduleRedraw)
      return
    }
    // 主题模式是渲染层的真实配置：只切 <html> class 会在下一次 settings 同步时被打回去
    try {
      settings()?.set('themeMode', next)
    } catch {
      /* 画布还没启动/字段被别的宿主占用：DOM class 仍按用户选择先落 */
    }
    persist()
    if (!props.embedded) syncMode()
    nextTick(scheduleRedraw)
  }

  function syncMode(): void {
    // 嵌入设置页时，主题模式归主应用所有：工作台不能替用户改整页亮暗
    if (props.embedded) return
    if (typeof document !== 'undefined') document.documentElement.classList.toggle('dark', mode.value === 'dark')
  }

  function exportTheme(): void {
    const theme = activeTheme.value
    if (!theme?.overrides || Object.keys(theme.overrides).length === 0) {
      showToast('当前主题还没有覆盖任何颜色')
      return
    }
    const payload = {
      name: theme.name,
      mode: mode.value,
      colors: Object.fromEntries(Object.entries(theme.overrides)),
    }
    void navigator.clipboard
      ?.writeText(JSON.stringify(payload, null, 2))
      .then(() => showToast('主题 JSON 已复制'))
      .catch(() => showToast('复制失败，请手动选择'))
  }

  return { selectTheme, duplicateTheme, removeTheme, setMode, syncMode, exportTheme }
}
