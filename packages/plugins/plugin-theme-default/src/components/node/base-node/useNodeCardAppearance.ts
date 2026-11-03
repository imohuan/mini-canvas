import { computed, onBeforeUnmount, ref } from 'vue'
import type { CanvasRenderContext } from '@mini-canvas/canvas-render'
import {
  CULLED_RENDERING_DEFAULT,
  culledPolicy,
  normalizeCulledRendering,
} from '../culledRenderingPolicy'
import {
  resolveMultiRadio,
  applyMultiRadioChange,
  MULTI_RADIO_KEY_SET,
} from '../multiRadio'

type SettingsStoreLike = {
  get(key: string): unknown
  onChange(cb: (key: string, value: unknown) => void): { dispose(): void }
}

export interface NodeCardAppearanceInput {
  ctx: CanvasRenderContext['ctx']
  viewport: CanvasRenderContext['flow']['viewport']
  data: () => Record<string, unknown> | undefined
}

/**
 * 节点壳的缩放、LOD、标题/多选配置和视口外降级策略。
 *
 * 这里是原 BaseNode setup 的前半段，只搬家不改行为：仍然是一份全局 settings 订阅，
 * 仍然按 key 过滤，culledNodeRendering 也仍然走自己那条独立订阅。
 */
export function useNodeCardAppearance(input: NodeCardAppearanceInput) {
  const zoom = computed(() => Math.max(input.viewport.value?.zoom || 1, 0.01))
  const settingsStore = () => input.ctx?.get<SettingsStoreLike>('settings')
  const numOf = (key: string, fallback: number): number => {
    const v = settingsStore()?.get(key)
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback
  }
  const boolOf = (key: string, fallback: boolean): boolean => {
    const v = settingsStore()?.get(key)
    return typeof v === 'boolean' ? v : fallback
  }

  const TITLE_OFFSET = ref(numOf('titleOffset', 12))
  const TITLE_MIN_ZOOM = ref(numOf('titleScaleMinZoom', 0.5))
  const TITLE_VISIBLE = ref(boolOf('titleVisible', true))
  const LOW_DETAIL_ZOOM = ref(numOf('nodeLodLowDetailZoom', 0.4))
  const CANVAS_NODES_DRAGGABLE = ref(boolOf('nodesDraggable', true))
  const isHandTool = computed(() => !CANVAS_NODES_DRAGGABLE.value)
  const MULTI_RADIO = ref(resolveMultiRadio((key) => settingsStore()?.get(key)))
  const HIDE_TITLES_ON_MULTI = ref(settingsStore()?.get('multiSelectHideTitles') === true)

  const applyTitleSetting = (key: string, value: unknown): void => {
    if (key === 'multiSelectHideTitles') {
      HIDE_TITLES_ON_MULTI.value = value === true
      return
    }
    if (key === 'nodesDraggable') {
      CANVAS_NODES_DRAGGABLE.value = value !== false
      return
    }
    if (key === 'titleVisible') {
      TITLE_VISIBLE.value = value !== false
      return
    }
    if (MULTI_RADIO_KEY_SET.has(key)) {
      MULTI_RADIO.value = applyMultiRadioChange(MULTI_RADIO.value, key, value)
      return
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) return
    if (key === 'titleOffset') TITLE_OFFSET.value = value
    else if (key === 'titleScaleMinZoom') TITLE_MIN_ZOOM.value = value
    else if (key === 'nodeLodLowDetailZoom') LOW_DETAIL_ZOOM.value = value
  }

  const titleSettingOff = settingsStore()?.onChange((key, value) => applyTitleSetting(key, value))
  onBeforeUnmount(() => titleSettingOff?.dispose())

  const lowDetail = computed(() => zoom.value < LOW_DETAIL_ZOOM.value)

  const CULLED_STATE_KEY = '_cullState'
  const rawCullState = computed(() => input.data()?.[CULLED_STATE_KEY])
  const isCulled = computed(
    () => rawCullState.value === 'culled' || rawCullState.value === 'culled-linked',
  )
  const isCulledLinked = computed(() => rawCullState.value === 'culled-linked')

  const CULLED_RENDERING_KEY = 'culledNodeRendering'
  type CulledRendering = 'skeleton' | 'full' | 'ghost'
  const culledRendering = ref<CulledRendering>(CULLED_RENDERING_DEFAULT)
  const applyCulledRendering = (key: string, value: unknown): void => {
    if (key !== CULLED_RENDERING_KEY) return
    culledRendering.value = normalizeCulledRendering(value)
  }
  const culledSettingsOff = settingsStore()?.onChange((key, value) =>
    applyCulledRendering(key, value),
  )
  {
    const v = settingsStore()?.get(CULLED_RENDERING_KEY)
    culledRendering.value = normalizeCulledRendering(v)
  }
  onBeforeUnmount(() => culledSettingsOff?.dispose())

  const culledReduced = computed(
    () => culledPolicy(rawCullState.value, culledRendering.value).reduced,
  )
  const culledGhost = computed(
    () => culledPolicy(rawCullState.value, culledRendering.value).ghost,
  )
  const titleScale = computed(() => 1 / Math.max(zoom.value, TITLE_MIN_ZOOM.value))
  const resizeHandleScale = computed(() => 1 / Math.max(zoom.value, TITLE_MIN_ZOOM.value))

  return {
    zoom,
    lowDetail,
    TITLE_OFFSET,
    TITLE_MIN_ZOOM,
    TITLE_VISIBLE,
    MULTI_RADIO,
    HIDE_TITLES_ON_MULTI,
    isHandTool,
    isCulled,
    isCulledLinked,
    culledReduced,
    culledGhost,
    titleScale,
    resizeHandleScale,
  }
}
