import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref } from 'vue'
import type { CanvasRenderContext } from '@mini-canvas/canvas-render'
import {
  RASTER_TIER_PREFIX,
  rasterScaleFor,
  rasterTierKeys,
  readRasterTiers,
  resolveRasterTier,
  type RasterTierConfig,
} from '../rasterTier'

/**
 * Vue 的 :style 需要可索引的 CSS 属性表；`zoom` 是 iframe 的渲染倍数，保持原值。
 * 这里不改样式内容，只把形状标成可被 Vue 接受的样式对象。
 */
export interface UiFrameStyle {
  width: string
  height: string
  transform: string
  zoom: string
  transformOrigin: string
  [key: string]: string
}

/** iframe 渲染倍数样式：四个属性必须由同一个倍数算出来（原 frameStyle 的算式）。 */
export function createUiFrameStyle(n: number): UiFrameStyle | undefined {
  if (!Number.isFinite(n) || Math.abs(n - 1) < 1e-6) return undefined
  return {
    width: n * 100 + '%',
    height: n * 100 + '%',
    transform: 'scale(' + 1 / n + ')',
    zoom: String(n),
    transformOrigin: 'top left',
  }
}

export interface UseUiFrameOptions {
  ctx: CanvasRenderContext['ctx']
  flow: CanvasRenderContext['flow'] | undefined
}

export interface UseUiFrameResult {
  iframeEl: Ref<HTMLIFrameElement | null>
  rasterScale: ComputedRef<number>
  frameStyle: ComputedRef<UiFrameStyle | undefined>
}

/**
 * iframe 元素与渲染倍数样式。
 *
 * 原样搬出 UiContent.vue 的档位读取、缩放监听与 frameStyle；行为不变。
 */
export function useUiFrame(options: UseUiFrameOptions): UseUiFrameResult {
  const settingsSvc = options.ctx.tryGet<{ get(k: string): unknown; onChange?(cb: (k: string, v: unknown) => void): { dispose(): void } }>('settings')

  const readCfg = (): RasterTierConfig => {
    const safeCtx = typeof options.ctx?.get === 'function'
      ? options.ctx
      : ({ get: () => undefined } as never)
    return readRasterTiers(RASTER_TIER_PREFIX, safeCtx)
  }
  const rasterCfg = ref<RasterTierConfig>(readCfg())
  const rasterSettingOff = settingsSvc?.onChange?.((key) => {
    if (!rasterTierKeys(RASTER_TIER_PREFIX).includes(key)) return
    rasterCfg.value = readCfg()
  })
  onBeforeUnmount(() => rasterSettingOff?.dispose())

  const zoom = computed(() => options.flow?.viewport?.value?.zoom ?? 1)
  const canvasMinZoom = computed(() => settingsSvc?.get('minZoom'))
  const rasterTier = computed(() => resolveRasterTier(zoom.value, rasterCfg.value, canvasMinZoom.value))
  const rasterScale = computed(() => rasterScaleFor(rasterTier.value, rasterCfg.value))
  const frameStyle = computed(() => createUiFrameStyle(rasterScale.value))
  const iframeEl = ref<HTMLIFrameElement | null>(null)

  return { iframeEl, rasterScale, frameStyle }
}
