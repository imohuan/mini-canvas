import { writeLabState } from '../storage'
import type { ThemeLabState } from './state'

export function useThemeLabPersistence(state: ThemeLabState) {
  const { toast, themes, activeId, mode, runtime } = state

  function showToast(message: string): void {
    toast.value = message
    clearTimeout(runtime.toastTimer)
    runtime.toastTimer = window.setTimeout(() => (toast.value = ''), 2600)
  }

  function persist(): void {
    clearTimeout(runtime.saveTimer)
    runtime.saveTimer = window.setTimeout(() => {
      const ok = writeLabState({ version: 1, themeId: activeId.value, mode: mode.value, themes: themes.value })
      if (!ok) showToast('浏览器不允许保存，刷新会丢')
    }, 260)
  }

  return { showToast, persist }
}
