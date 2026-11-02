import { computed, ref, watch, type Ref } from 'vue'
import type { RefTile } from '../refTiles'
import { placeHoverPreview } from '../hoverPreviewPlacement'
import { fitPreviewBox, HOVER_PREVIEW_MAX_SIDE } from '../previewBoxSize'

interface PreviewDeps {
  refTiles: Ref<RefTile[]>
  cardImageOf(tile: { url?: string; kind?: string | null }): string
  openFullscreen(tile: RefTile): void
}

/** 卡片 hover 预览：计时、定位、媒体尺寸、音频播放。 */
export function useBottomBarPreview(deps: PreviewDeps) {
  const previewTile = ref<RefTile | null>(null)
  const previewPos = ref({ left: 0, top: 0, above: true })
  const previewBox = ref<{ width: number; height: number }>({ width: HOVER_PREVIEW_MAX_SIDE, height: HOVER_PREVIEW_MAX_SIDE })
  let previewTimer: ReturnType<typeof setTimeout> | null = null
  let previewCloseTimer: ReturnType<typeof setTimeout> | null = null
  let previewAnchor: DOMRect | null = null

  function schedulePreview(tile: RefTile, anchorRect: DOMRect): void {
    cancelPreviewClose()
    if (previewTimer) clearTimeout(previewTimer)
    previewTimer = setTimeout(() => {
      if (!deps.cardImageOf(tile) && tile.kind !== 'video') return
      previewTile.value = tile
      previewAnchor = anchorRect
      previewBox.value = { width: HOVER_PREVIEW_MAX_SIDE, height: HOVER_PREVIEW_MAX_SIDE }
      previewPos.value = placeHoverPreview(anchorRect, { width: window.innerWidth, height: window.innerHeight }, previewBox.value)
    }, 600)
  }

  function onPreviewMediaReady(tileKey: string, w: number, h: number): void {
    const cur = previewTile.value
    if (!cur || cur.key !== tileKey) return
    const next = fitPreviewBox(w, h)
    const same = next.width === previewBox.value.width && next.height === previewBox.value.height
    if (same) return
    previewBox.value = next
    if (previewAnchor) {
      previewPos.value = placeHoverPreview(previewAnchor, { width: window.innerWidth, height: window.innerHeight }, next)
    } else {
      previewPos.value = clampPreviewLeft(previewPos.value, next)
    }
  }

  function clampPreviewLeft(pos: { left: number; top: number; above: boolean }, box: { width: number; height: number }): { left: number; top: number; above: boolean } {
    const margin = 8
    const left = Math.round(Math.min(Math.max(margin, pos.left + 0), Math.max(margin, window.innerWidth - box.width - margin)))
    return { ...pos, left }
  }
  function cancelPreviewSchedule(): void {
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = null }
  }
  function schedulePreviewClose(): void {
    if (previewCloseTimer) clearTimeout(previewCloseTimer)
    previewCloseTimer = setTimeout(() => { previewTile.value = null }, 300)
  }
  function cancelPreviewClose(): void {
    if (previewCloseTimer) { clearTimeout(previewCloseTimer); previewCloseTimer = null }
  }
  function closePreviewNow(): void {
    cancelPreviewSchedule()
    cancelPreviewClose()
    previewTile.value = null
  }

  const livePreviewTile = computed<RefTile | null>(() => {
    const current = previewTile.value
    if (!current) return null
    const tile = deps.refTiles.value.find((t) => t.key === current.key) ?? null
    return tile && !tile.invalid ? tile : null
  })
  watch(livePreviewTile, (v) => {
    if (!v && previewTile.value) closePreviewNow()
  })

  function openFullscreenFromPreview(tile: RefTile): void {
    closePreviewNow()
    deps.openFullscreen(tile)
  }

  let previewAudio: HTMLAudioElement | null = null
  function toggleAudioPlay(tile: RefTile): void {
    if (!tile.url) return
    const same = previewAudio && previewAudio.dataset.tile === tile.key
    stopPreviewAudio()
    if (same) return
    const a = new Audio(tile.url)
    a.dataset.tile = tile.key
    void a.play().catch(() => { /* 自动播放被拦等：忽略 */ })
    previewAudio = a
  }
  function stopPreviewAudio(): void {
    if (previewAudio) { previewAudio.pause(); previewAudio = null }
  }
  return {
    previewTile,
    previewPos,
    previewBox,
    livePreviewTile,
    schedulePreview,
    onPreviewMediaReady,
    cancelPreviewSchedule,
    schedulePreviewClose,
    cancelPreviewClose,
    closePreviewNow,
    openFullscreenFromPreview,
    toggleAudioPlay,
    stopPreviewAudio,
  }
}
