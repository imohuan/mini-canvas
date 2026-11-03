import type { CanvasContext } from '@mini-canvas/canvas-render'
import type { ReplayContext } from '../replay'
import { useThemeLabCanvas } from './canvas'
import { useThemeLabDisplay } from './display'
import { useThemeLabGuide } from './guide'
import { useThemeLabPersistence } from './persistence'
import { useThemeLabScenes } from './scenes'
import { useThemeLabSettings } from './settings'
import { useThemeLabState, type ThemeLabProps } from './state'
import { useThemeLabThemeLibrary } from './themeLibrary'

/**
 * ThemeLab 的模块装配。
 *
 * 各 composable 之间有三处环：重绘、场景回放上下文、主题模式。
 * 这里用惰性转发把环接上，实际函数仍是各模块里原来那一个，调用顺序保持不变。
 */
export function useThemeLab(props: ThemeLabProps, hostCanvas: CanvasContext | null) {
  const state = useThemeLabState(props, hostCanvas)
  const { persist, showToast } = useThemeLabPersistence(state)
  let scheduleRedraw: () => void = () => {}
  const settingsApi = useThemeLabSettings(state, { persist, showToast, scheduleRedraw: () => scheduleRedraw() })
  const settings = settingsApi.settings
  const valueOf = settingsApi.valueOf

  const library = useThemeLabThemeLibrary(state, {
    settings,
    applyThemeToSettings: settingsApi.applyThemeToSettings,
    scheduleRedraw: () => scheduleRedraw(),
    showToast,
    persist,
  })

  const scenes = useThemeLabScenes(state, {
    showToast,
    scheduleRedraw: () => scheduleRedraw(),
    syncMode: () => library.syncMode(),
    replayCtx: () => replayCtx(),
  })

  const guide = useThemeLabGuide(state, { valueOf })
  scheduleRedraw = guide.scheduleRedraw
  const display = useThemeLabDisplay(state, { valueOf })

  const replayCtx = (): ReplayContext => ({
    stage: state.stageEl.value!,
    frame: () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    notify: () => scheduleRedraw(),
    resetStage: () => scenes.resetAllNodes(),
  })

  const canvas = useThemeLabCanvas(state, {
    settings,
    readFields: settingsApi.readFields,
    applyThemeToSettings: settingsApi.applyThemeToSettings,
    mirrorThemeToPreview: settingsApi.mirrorThemeToPreview,
    persist,
    scheduleRedraw,
    syncMode: library.syncMode,
    replayCtx,
    sceneAvailableFor: scenes.sceneAvailableFor,
    seekSceneSelection: scenes.seekSceneSelection,
    burstRedraw: scenes.burstRedraw,
    fitPreview: scenes.fitPreview,
    fitOnStageResize: scenes.fitOnStageResize,
  })

  return {
    state,
    settings: settingsApi,
    library,
    scenes,
    guide,
    display,
    canvas,
  }
}
