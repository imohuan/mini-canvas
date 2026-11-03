import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { CANVAS_CONTEXT_KEY, createThemePreviewScene, provideThemePreviewScene } from '@mini-canvas/canvas-render'
import type { ThemeStudioState } from './state'

export function useThemeStudioPreview(state: ThemeStudioState) {
  const { mode, previewRevision, fields, tick, rawGet, readFields, disposers, runtime } = state

  const canvasContext = inject(CANVAS_CONTEXT_KEY, null)
  const hasCanvasContext = computed(() => Boolean(canvasContext?.ctx?.slots))
  const scene = createThemePreviewScene({
    mode,
    revision: previewRevision,
    settings: {
      get: (key: string) => rawGet(key),
    },
  })
  provideThemePreviewScene(scene)

  /** 预览画板尺寸（flow 坐标）；所有插件图层都按这套坐标画 */
  const ARTBOARD_W = 640
  const ARTBOARD_H = 400
  const PREVIEW_PAD = 26

  const previewBox = ref<HTMLElement | null>(null)
  const previewSize = ref({ w: 0, h: 0 })
  let previewObserver: ResizeObserver | null = null

  /** 量一次画布可见尺寸（ResizeObserver 不可用时用窗口 resize 兜底） */
  function measurePreview(): void {
    const box = previewBox.value
    if (!box) return
    const rect = box.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) previewSize.value = { w: rect.width, h: rect.height }
  }

  const fittedStageStyle = computed(() => {
    const bounds = scene.bounds.value
    const w = bounds.w + PREVIEW_PAD * 2
    const h = bounds.h + PREVIEW_PAD * 2
    const viewW = previewSize.value.w || 620
    const viewH = previewSize.value.h || 340
    const scale = Math.min(viewW / w, viewH / h, 1.5)
    const offsetX = (viewW - w * scale) / 2 - (bounds.x - PREVIEW_PAD) * scale
    const offsetY = (viewH - h * scale) / 2 - (bounds.y - PREVIEW_PAD) * scale
    return {
      width: ARTBOARD_W + 'px',
      height: ARTBOARD_H + 'px',
      transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
    }
  })

  onMounted(() => {
    fields.value = readFields()
    previewRevision.value += 1
    measurePreview()
    window.addEventListener('resize', measurePreview)
    const box = previewBox.value
    if (box && typeof ResizeObserver !== 'undefined') {
      previewObserver = new ResizeObserver(measurePreview)
      previewObserver.observe(box)
    }
    const current = rawGet('themeMode')
    if (current === 'light' || current === 'dark') mode.value = current
    disposers.push(
      state.source.onChange((key, value) => {
        fields.value = readFields()
        tick.value += 1
        previewRevision.value += 1
        if (key === 'themeMode' && (value === 'light' || value === 'dark')) mode.value = value
      }),
    )
    const off = state.source.onSchemaChange?.(() => {
      fields.value = readFields()
      tick.value += 1
      previewRevision.value += 1
    })
    if (off) disposers.push(off)
  })

  onBeforeUnmount(() => {
    previewObserver?.disconnect()
    previewObserver = null
    window.removeEventListener('resize', measurePreview)
    for (const disposer of disposers) disposer.dispose()
    clearTimeout(runtime.toastTimer)
    clearTimeout(runtime.saveTimer)
  })

  return { canvasContext, hasCanvasContext, scene, previewBox, fittedStageStyle }
}
