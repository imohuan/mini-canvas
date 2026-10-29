import { ref, computed } from 'vue'

interface LayoutState {
  direction: string
  intraSpacingX: number
  intraSpacingY: number
  interSpacingX: number
  interSpacingY: number
  focusHeightRatio: number
}

/**
 * 提取 Canvas.vue 中的 panel state 管理逻辑（storage/theme/layout）
 * 注意：此模块仅提供函数定义，Canvas.vue 需要手动集成
 */
export function useCanvasPanelState(manager: any, _canvas: any) {
  // --- Storage state ---
  const storageState = ref<any>({ mode: 'none', isConnected: false, workspaceName: '', projectCount: 0, currentProjectId: null, projects: [] })

  function refreshStorageState() {
    const api = manager.getPluginAPI('storage')
    storageState.value = {
      mode: (api?.connectionMode ?? 'none') as 'none' | 'localStorage' | 'filesystem',
      workspaceName: api?.workspaceName ?? '',
      projectCount: api?.projectIndex?.length ?? 0,
      currentProjectId: api?.currentProjectId ?? null,
      projects: api?.projectIndex ?? [],
    }
  }

  // --- Theme state ---
  const themeState = computed(() => {
    const api = manager.getPluginAPI('theme')
    return {
      activePreset: api?.activePreset ?? null,
      accent: api?.accent ?? null,
      surface: api?.surface ?? null,
    }
  })

  // --- Layout state ---
  const layoutState = ref<LayoutState>({
    direction: 'TB',
    intraSpacingX: 80,
    intraSpacingY: 80,
    interSpacingX: 120,
    interSpacingY: 120,
    focusHeightRatio: 0.5,
  })

  function syncLayoutState() {
    const api = manager.getPluginAPI('auto-layout')
    if (!api?.config) return
    layoutState.value = {
      direction: api.config.direction ?? 'TB',
      intraSpacingX: api.config.intraSpacing?.x ?? 80,
      intraSpacingY: api.config.intraSpacing?.y ?? 80,
      interSpacingX: api.config.interSpacing?.x ?? 120,
      interSpacingY: api.config.interSpacing?.y ?? 120,
      focusHeightRatio: api.config.focusHeightRatio ?? 0.5,
    }
  }

  function pushLayoutConfig() {
    const api = manager.getPluginAPI('auto-layout')
    if (!api) return null
    api.updateConfig({
      direction: layoutState.value.direction,
      intraSpacing: { x: layoutState.value.intraSpacingX, y: layoutState.value.intraSpacingY },
      interSpacing: { x: layoutState.value.interSpacingX, y: layoutState.value.interSpacingY },
      focusHeightRatio: layoutState.value.focusHeightRatio,
    })
    return api
  }

  return {
    storageState, refreshStorageState,
    themeState,
    layoutState, syncLayoutState, pushLayoutConfig,
  }
}