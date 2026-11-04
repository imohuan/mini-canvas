import type { Ref } from "vue"

export interface MediaNavigationOptions {
  isMultiple: () => boolean
  list: () => string[]
  currentIdx: Ref<number>
  resetTransform: () => void
  resetRotationAndFlip: () => void
  emitIndex: (index: number) => void
}

/** 上一张 / 下一张与换张时的变换归零。 */
export function useMediaNavigation(options: MediaNavigationOptions) {
  /** 换张时把视频的旋转/镜像也归零（否则新视频会继承上一张的朝向） */
  function videoTransformReset(): void {
    options.resetRotationAndFlip()
  }

  // ===== 切换（多图） =====
  function prevImage(): void {
    if (!options.isMultiple()) return
    options.currentIdx.value = (options.currentIdx.value - 1 + options.list().length) % options.list().length
    options.resetTransform()
    videoTransformReset()
    options.emitIndex(options.currentIdx.value)
  }
  function nextImage(): void {
    if (!options.isMultiple()) return
    options.currentIdx.value = (options.currentIdx.value + 1) % options.list().length
    options.resetTransform()
    videoTransformReset()
    options.emitIndex(options.currentIdx.value)
  }

  return { prevImage, nextImage, videoTransformReset }
}

