import { computed, watch, type Ref } from 'vue'

interface FrameCaptureDeps {
  rootEl: Ref<HTMLElement | null>
  onPaneCaptureDown: (e: PointerEvent | MouseEvent) => void
  onOwnerCaptureClick: (e: MouseEvent) => void
}

/** 在画布实例根上挂捕获阶段监听；元素换/卸载时成对清理。 */
export function useFrameCapture(input: FrameCaptureDeps) {
  const hostEl = computed<HTMLElement | null>(() => input.rootEl.value ?? null)

  watch(
    hostEl,
    (el, _old, onCleanup) => {
      if (!el) return
      el.addEventListener('pointerdown', input.onPaneCaptureDown, { capture: true })
      el.addEventListener('mousedown', input.onPaneCaptureDown, { capture: true })
      el.addEventListener('click', input.onOwnerCaptureClick, { capture: true })
      onCleanup(() => {
        el.removeEventListener('pointerdown', input.onPaneCaptureDown, { capture: true })
        el.removeEventListener('mousedown', input.onPaneCaptureDown, { capture: true })
        el.removeEventListener('click', input.onOwnerCaptureClick, { capture: true })
      })
    },
    { immediate: true },
  )

  return { hostEl }
}

