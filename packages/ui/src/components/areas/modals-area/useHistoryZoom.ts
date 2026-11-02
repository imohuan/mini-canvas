import { computed } from 'vue'

/**
 * 生成历史的自绘缩放滑块。
 *
 * 从 HistoryModal.vue 原样搬出：原生 range 只有 thumb 附近才能拖，
 * 这里整条轨道接管 pointerdown/move/up。只改 histZoom，不碰卡片 DOM。
 */
export function useHistoryZoom(s: { histZoom: number }) {
  const ZOOM_MIN = 1
  // 用户口径 2026-10-28：删掉最小的那一档（原第 5 档只有 120px，效果太小）
  const ZOOM_MAX = 4
  const zoomPct = computed(() => ((s.histZoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100)
  let zoomDragging = false

  function zoomApply(clientX: number, track: HTMLElement): void {
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) return
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    s.histZoom = Math.round(ZOOM_MIN + f * (ZOOM_MAX - ZOOM_MIN))
  }

  function onZoomPointerDown(e: PointerEvent): void {
    const track = e.currentTarget as HTMLElement | null
    if (!track) return
    zoomDragging = true
    track.setPointerCapture(e.pointerId)
    zoomApply(e.clientX, track)
  }
  function onZoomPointerMove(e: PointerEvent): void {
    if (!zoomDragging) return
    zoomApply(e.clientX, e.currentTarget as HTMLElement)
  }
  function onZoomPointerUp(e: PointerEvent): void {
    zoomDragging = false
    ;(e.currentTarget as HTMLElement | null)?.releasePointerCapture?.(e.pointerId)
  }

  return { ZOOM_MIN, ZOOM_MAX, zoomPct, onZoomPointerDown, onZoomPointerMove, onZoomPointerUp }
}
