/**
 * useTheme — 主题状态管理
 */
import { computed } from 'vue'
import type { ThemeAPI, ThemePresetName } from '../plugins/theme/types'
import type { usePluginSystem } from './usePluginSystem'

export function useTheme(ps: ReturnType<typeof usePluginSystem>) {
  const themeState = computed(() => {
    const api = ps.getPluginAPI<ThemeAPI>('theme')
    if (!api) return {
      activePreset: 'slate' as ThemePresetName,
      accent: '#111827',
      surface: '#ffffff',
    }
    return {
      activePreset: api.state.activePreset,
      accent: api.state.accent,
      surface: api.state.surface,
    }
  })

  function applyPreset(name: ThemePresetName) {
    const api = ps.getPluginAPI<ThemeAPI>('theme')
    if (api) api.applyPreset(name)
  }

  function applyCustom(accent: string) {
    const api = ps.getPluginAPI<ThemeAPI>('theme')
    if (api) api.applyCustom(accent)
  }

  return {
    themeState,
    applyPreset,
    applyCustom,
  }
}
