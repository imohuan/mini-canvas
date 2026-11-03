import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import { RenderEvents } from '@mini-canvas/canvas-render'
import type { CanvasHostHandle } from '@mini-canvas/canvas-render'
import { OPTIONAL_PLUGINS } from '../catalog'
import type { DeclaredColorField, ThemeLabScene } from '../catalog'
import { replayScene, releaseHeld, type ReplayContext } from '../replay'
import type { LabSettingsStore } from '../types'
import type { ThemeLabState } from './state'

export function useThemeLabCanvas(
  state: ThemeLabState,
  deps: {
    settings: () => LabSettingsStore | undefined
    readFields: () => DeclaredColorField[]
    applyThemeToSettings: () => void
    mirrorThemeToPreview: () => void
    persist: () => void
    scheduleRedraw: () => void
    syncMode: () => void
    replayCtx: () => ReplayContext
    sceneAvailableFor: (id: ThemeLabScene) => boolean
    seekSceneSelection: (id: ThemeLabScene) => void
    burstRedraw: () => void
    fitPreview: () => void
    fitOnStageResize: () => void
  },
) {
  const { props, host, ready, bootError, fields, mode, scene, boardEl, stageEl, connectedPlugins, runtime } = state
  const settings = deps.settings
  const readFields = deps.readFields
  const applyThemeToSettings = deps.applyThemeToSettings
  const mirrorThemeToPreview = deps.mirrorThemeToPreview
  const persist = deps.persist
  const scheduleRedraw = deps.scheduleRedraw
  const syncMode = deps.syncMode
  const replayCtx = deps.replayCtx
  const sceneAvailableFor = deps.sceneAvailableFor
  const seekSceneSelection = deps.seekSceneSelection
  const burstRedraw = deps.burstRedraw
  const fitPreview = deps.fitPreview
  const fitOnStageResize = deps.fitOnStageResize

  function onReady(nextHost: CanvasHostHandle): void {
    host.value = nextHost
    ready.value = true
    // 嵌入时颜色是否显示由“主应用 settings 有没有这个字段”决定：
    // 字段只在声明它的插件已安装时存在，不再拿预览开关二次过滤。
    connectedPlugins.value = props.embedded
      ? ['theme-default', 'demo-theme-lab', ...OPTIONAL_PLUGINS]
      : ['theme-default', 'demo-theme-lab', ...state.enabledPlugins.value]
    runtime.settingsOff?.dispose()
    runtime.selectionOff?.dispose()
    const store = settings()
    if (store) {
      fields.value = readFields()
      runtime.settingsOff = store.onChange((key) => {
        fields.value = readFields()
        if (key === 'themeMode') {
          const next = store.get('themeMode')
          if ((next === 'light' || next === 'dark') && next !== mode.value) {
            mode.value = next
            persist()
          }
        }
        if (key.endsWith('Color') || key.startsWith('multiSelect') || key === 'pathColor' || key === 'bladeColor') {
          if (props.embedded) mirrorThemeToPreview()
          scheduleRedraw()
        }
      })
      // schema 变化 = 插件装/卸：颜色格跟着增减
      const schemaOff = store.onSchemaChange?.(() => {
        fields.value = readFields()
        nextTick(scheduleRedraw)
      })
      if (schemaOff) {
        const prev = runtime.settingsOff
        runtime.settingsOff = {
          dispose: () => {
            prev?.dispose()
            schemaOff.dispose()
          },
        }
      }
      if (props.embedded) {
        // 主应用是唯一真源：打开工作台不改用户已经选好的主题
        const current = store.get('themeMode')
        if (current === 'light' || current === 'dark') mode.value = current
      } else {
        // 独立页：工作台选择优先，刷新后仍按存档的亮/暗显示
        try {
          store.set('themeMode', mode.value)
        } catch {
          /* 设置字段缺失时保持 DOM 现状 */
        }
        applyThemeToSettings()
      }
      mirrorThemeToPreview()
    }
    runtime.selectionOff = nextHost.ctx.on(RenderEvents.SelectionChange, () => scheduleRedraw())
    // 插件开关会重建 CanvasProvider：重新按当前场景布景，别让多选/对齐/框选停在空画布上
    if (scene.value === 'base') {
      seekSceneSelection('base')
    } else {
      seekSceneSelection(scene.value)
      if (sceneAvailableFor(scene.value) && scene.value !== 'multi') {
        const token = ++runtime.replayToken
        window.setTimeout(() => {
          if (!ready.value || token !== runtime.replayToken) return
          void replayScene(scene.value, replayCtx()).then(() => {
            if (token === runtime.replayToken) burstRedraw()
          })
        }, 220)
      }
    }
    scheduleRedraw()
    burstRedraw()
    // 节点尺寸是挂载后量出来的：等两轮量测落定再取景一次
    window.setTimeout(fitPreview, 80)
    window.setTimeout(fitPreview, 360)
  }

  function onBootError(error: Error): void {
    bootError.value = error.message
    ready.value = false
  }

  /**
   * 嵌入设置页：没有预览画布，直接读主应用 settings。
   *
   * 这里只订阅主应用的变化，不再往任何 DOM 根写主题变量。配色值本来就已经由
   * canvas-render 的色板桥写到 document.documentElement，工作台只负责读它、改它。
   */
  function bindAppSettings(): void {
    const store = settings()
    if (!store) return
    fields.value = readFields()
    connectedPlugins.value = ['theme-default', 'demo-theme-lab', ...OPTIONAL_PLUGINS]
    const current = store.get('themeMode')
    if (current === 'light' || current === 'dark') mode.value = current
    runtime.settingsOff = store.onChange((key) => {
      fields.value = readFields()
      if (key === 'themeMode') {
        const next = store.get('themeMode')
        if ((next === 'light' || next === 'dark') && next !== mode.value) mode.value = next
      }
    })
    const schemaOff = store.onSchemaChange?.(() => {
      fields.value = readFields()
    })
    if (schemaOff) {
      const prev = runtime.settingsOff
      runtime.settingsOff = {
        dispose: () => {
          prev?.dispose()
          schemaOff.dispose()
        },
      }
    }
  }

  function mountObservers(): void {
    if (typeof ResizeObserver !== 'undefined') {
      runtime.resizeObserver = new ResizeObserver(() => {
        scheduleRedraw()
        fitOnStageResize()
      })
      if (boardEl.value) runtime.resizeObserver.observe(boardEl.value)
      if (stageEl.value) runtime.resizeObserver.observe(stageEl.value)
    }
    if (typeof MutationObserver !== 'undefined' && stageEl.value) {
      runtime.mutationObserver = new MutationObserver(() => scheduleRedraw())
      runtime.mutationObserver.observe(stageEl.value, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] })
    }
    window.addEventListener('resize', scheduleRedraw)
    window.addEventListener('scroll', scheduleRedraw, true)
  }

  onMounted(() => {
    syncMode()
    mountObservers()
    if (props.embedded) {
      // 嵌入设置页时没有预览画布，onReady 不会触发；直接绑定主应用的 settings。
      bindAppSettings()
    }
  })

  onBeforeUnmount(() => {
    releaseHeld(replayCtx())
    runtime.resizeObserver?.disconnect()
    runtime.mutationObserver?.disconnect()
    window.removeEventListener('resize', scheduleRedraw)
    window.removeEventListener('scroll', scheduleRedraw, true)
    runtime.settingsOff?.dispose()
    runtime.selectionOff?.dispose()
    cancelAnimationFrame(runtime.frame)
    clearTimeout(runtime.fitTimer)
    clearTimeout(runtime.saveTimer)
    clearTimeout(runtime.toastTimer)
  })

  watch(mode, () => {
    syncMode()
    scheduleRedraw()
  })

  return { onReady, onBootError, bindAppSettings, mountObservers }
}
