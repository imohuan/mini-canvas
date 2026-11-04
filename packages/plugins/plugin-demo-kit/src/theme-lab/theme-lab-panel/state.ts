import { computed, reactive, ref } from 'vue'
import {
  currentThemeMode,
  type CanvasContext,
  type CanvasHostHandle,
  type UiComponentHandle,
} from '@mini-canvas/canvas-render'
import { themeComponentsPlugin } from '@mini-canvas/plugin-theme-components'
import { multiSelectPlugin } from '@mini-canvas/plugin-multi-select'
import { alignGuidePlugin } from '@mini-canvas/plugin-align-guide'
import { edgeCuttingPlugin } from '@mini-canvas/plugin-edge-cutting'
import { themeLabPlugin } from '../labPlugin'
import {
  buildColorEntries,
  GROUP_ORDER,
  OPTIONAL_PLUGINS,
  SCENE_META,
  type DeclaredColorField,
  type ThemeLabMode,
  type ThemeLabScene,
} from '../catalog'
import { LAB_THEMES, readLabState, cloneThemes, type LabTheme } from '../storage'
import type { LabSettingsStore } from '../types'
import { newAdapter } from './labCanvasData'

export interface ThemeLabProps {
  height?: number
  embedded?: boolean
  /** 设置页外壳传入的真实 settings（SettingsPanelSource）；独立页不传 */
  /** 外部注入的 settings（设置外壳给的是 SettingsPanelSource，可能缺 get） */
  settingsSource?: Partial<LabSettingsStore>
}

export interface ThemeLabRuntime {
  toastTimer: number
  saveTimer: number
  frame: number
  resizeObserver: ResizeObserver | null
  mutationObserver: MutationObserver | null
  settingsOff: { dispose(): void } | null
  selectionOff: { dispose(): void } | null
  replayToken: number
  fitTimer: number
  lastStageSize: string
}

export function useThemeLabState(props: ThemeLabProps, hostCanvas: CanvasContext | null) {
  const MODES: ThemeLabMode[] = ['light', 'dark']
  const saved = readLabState()
  const themes = ref<LabTheme[]>(cloneThemes(saved.themes.length ? saved.themes : LAB_THEMES))
  const activeId = ref(saved.themes.some((theme) => theme.id === saved.themeId) ? saved.themeId : themes.value[0]?.id ?? 'mist')
  const mode = ref<ThemeLabMode>(initialMode())
  const editing = ref<string | null>(null)
  const hovered = ref<string | null>(null)
  const toast = ref('')
  const ready = ref(false)
  const bootError = ref('')
  const stageEl = ref<HTMLElement | null>(null)
  const boardEl = ref<HTMLElement | null>(null)
  const host = ref<CanvasHostHandle | null>(null)
  const scene = ref<ThemeLabScene>('base')
  const providerKey = ref(0)
  const fields = ref<DeclaredColorField[]>([])
  const lines = ref<Array<{ id: string; color: string; d: string; start: { x: number; y: number }; end: { x: number; y: number } }>>([])
  const available = reactive(new Map<string, boolean>())
  const chipEls = reactive(new Map<string, HTMLElement>())
  const connectedPlugins = ref<string[]>(['theme-default', 'demo-theme-lab', ...OPTIONAL_PLUGINS])

  /**
   * 工作台自己的头部按钮：独立页在预览画布的 CanvasProvider 里，嵌入页在主应用的 Provider 里。
   * 两条路径都从画布 ctx 的 ui 目录取件（不直接 import 组件库）。
   */
  const Button = computed<UiComponentHandle>(() => {
    const ctx = host.value?.ctx ?? hostCanvas?.ctx
    return ctx?.registryOf<UiComponentHandle>('ui').top('Button')?.value
  })

  /** 预览里装了哪些可选插件（默认主题是整个画布的前提，始终在） */
  const enabledPlugins = ref<string[]>([...OPTIONAL_PLUGINS])

  const activePlugins = computed(() => {
    const out = [themeComponentsPlugin]
    if (enabledPlugins.value.includes('multi-select')) out.push(multiSelectPlugin)
    if (enabledPlugins.value.includes('align-guide')) out.push(alignGuidePlugin)
    if (enabledPlugins.value.includes('edge-cutting')) out.push(edgeCuttingPlugin)
    out.push(themeLabPlugin)
    return out
  })

  const activeTheme = computed(() => themes.value.find((theme) => theme.id === activeId.value) ?? themes.value[0])
  const installed = computed(() => new Set(connectedPlugins.value))
  const entries = computed(() => buildColorEntries(fields.value, installed.value))
  const editingEntry = computed(() => entries.value.find((entry) => entry.id === editing.value) ?? null)
  const groups = computed(() =>
    GROUP_ORDER.map((group) => ({ group, items: entries.value.filter((entry) => entry.group === group) })).filter((item) => item.items.length > 0),
  )
  const activeScene = computed(() => SCENE_META.find((item) => item.id === scene.value) ?? SCENE_META[0])
  const sceneAvailable = computed(
    () => !activeScene.value.plugin || enabledPlugins.value.includes(activeScene.value.plugin),
  )

  const runtime: ThemeLabRuntime = {
    toastTimer: 0,
    saveTimer: 0,
    frame: 0,
    resizeObserver: null,
    mutationObserver: null,
    settingsOff: null,
    selectionOff: null,
    replayToken: 0,
    fitTimer: 0,
    lastStageSize: '',
  }

  function initialMode(): ThemeLabMode {
    if (props.embedded) {
      const raw = hostCanvas?.ctx.tryGet<{ get(key: string): unknown }>('settings')?.get('themeMode')
      if (raw === 'light' || raw === 'dark') return raw
      return currentThemeMode()
    }
    return saved.mode === 'light' ? 'light' : 'dark'
  }

  return {
    props,
    hostCanvas,
    MODES,
    saved,
    themes,
    activeId,
    mode,
    editing,
    hovered,
    toast,
    ready,
    bootError,
    stageEl,
    boardEl,
    host,
    scene,
    providerKey,
    fields,
    lines,
    available,
    chipEls,
    connectedPlugins,
    Button,
    enabledPlugins,
    activePlugins,
    activeTheme,
    installed,
    entries,
    editingEntry,
    groups,
    activeScene,
    sceneAvailable,
    runtime,
    newAdapter,
  }
}

export type ThemeLabState = ReturnType<typeof useThemeLabState>
