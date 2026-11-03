import { computed, ref } from "vue"

export interface ImageViewerOptions {
  isImage: () => boolean
}

/** 图片/视频变换：缩放、拖拽、旋转、翻转、重置。 */
export function useImageViewer(options: ImageViewerOptions) {
  // ===== 图片变换（AxImageViewer 同款：缩放 / 拖拽 / 旋转 / 翻转） =====
  const scale = ref(1)
  const rotation = ref(0)
  const flip = ref(false)
  const offsetX = ref(0)
  const offsetY = ref(0)
  const dragging = ref(false)
  let dragStartX = 0
  let dragStartY = 0

  const imageStyle = computed(() => ({
    transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${scale.value}) rotate(${rotation.value}deg) scaleX(${flip.value ? -1 : 1})`,
    transition: dragging.value ? "none" : "transform 0.2s ease",
  }))

  function resetTransform(): void {
    scale.value = 1
    rotation.value = 0
    flip.value = false
    offsetX.value = 0
    offsetY.value = 0
  }
  function zoomIn(): void { scale.value = Math.min(scale.value + 0.25, 5) }
  function zoomOut(): void { scale.value = Math.max(scale.value - 0.25, 0.25) }
  function rotateImg(): void { rotation.value = (rotation.value + 90) % 360 }
  function toggleFlip(): void { flip.value = !flip.value }

  /** 视频的旋转 / 翻转：套在**视频舞台盒**上（不碰插件内部的播放状态，也不改视频元素本身） */
  const videoTransform = computed(() => ({
    transform: `rotate(${rotation.value}deg) scaleX(${flip.value ? -1 : 1})`,
    transition: "transform 0.2s ease",
  }))

  function handleWheel(e: WheelEvent): void {
    if (!options.isImage()) return
    e.preventDefault()
    scale.value = Math.min(Math.max(scale.value + (e.deltaY > 0 ? -0.1 : 0.1), 0.25), 5)
  }
  function handleMouseDown(e: MouseEvent): void {
    if (!options.isImage()) return
    if ((e.target as HTMLElement).closest(".mv-controls")) return
    dragging.value = true
    dragStartX = e.clientX - offsetX.value
    dragStartY = e.clientY - offsetY.value
  }
  function handleMouseMove(e: MouseEvent): void {
    if (!dragging.value) return
    offsetX.value = e.clientX - dragStartX
    offsetY.value = e.clientY - dragStartY
  }
  function handleMouseUp(): void { dragging.value = false }

  return {
    scale,
    rotation,
    flip,
    offsetX,
    offsetY,
    dragging,
    imageStyle,
    videoTransform,
    resetTransform,
    zoomIn,
    zoomOut,
    rotateImg,
    toggleFlip,
    handleWheel,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  }
}

