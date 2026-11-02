import { ref, watch, type Ref } from 'vue'
import type { CanvasRenderContext } from '@mini-canvas/canvas-render'

export interface VideoCaptureOptions {
  nodeId: () => string
  ctx: CanvasRenderContext['ctx']
  videoUrl: Ref<string>
  videoRef: { value: HTMLVideoElement | null }
  currentTime: Ref<number>
  duration: Ref<number>
  clipRange: () => { start: number; end: number }
}

/**
 * 截取画面：走命令统一处理“图片插件没装”等边界，菜单只负责选时刻。
 */
export function useVideoCapture(options: VideoCaptureOptions) {
  const { nodeId, ctx, videoUrl, videoRef, currentTime, duration, clipRange } = options
  const captureBusy = ref(false)
  const captureMenuOpen = ref(false)
  const captureMenuRef = ref<HTMLElement | null>(null)

  async function captureFrameNode(at: number): Promise<void> {
    ctx.get('canvas').runCommand('video:capture-frame', { nodeId: nodeId(), at })
  }

  async function onCaptureFrame(): Promise<void> {
    if (captureBusy.value || !videoUrl.value) return
    captureBusy.value = true
    try {
      const at = videoRef.value?.currentTime ?? currentTime.value
      await captureFrameNode(at)
    } finally {
      captureBusy.value = false
    }
  }

  async function captureFrameAt(at: number): Promise<void> {
    if (captureBusy.value || !videoUrl.value) return
    captureBusy.value = true
    try {
      await captureFrameNode(at)
    } finally {
      captureBusy.value = false
    }
  }

  function onCaptureMenuPick(kind: 'current' | 'first' | 'last'): void {
    captureMenuOpen.value = false
    if (kind === 'current') { void onCaptureFrame(); return }
    const { start, end } = clipRange()
    void captureFrameAt(kind === 'first' ? start : end > start ? end : duration.value)
  }

  function onCaptureMenuOutside(e: PointerEvent): void {
    if (!captureMenuOpen.value) return
    const host = captureMenuRef.value
    if (host && !host.contains(e.target as Node)) captureMenuOpen.value = false
  }

  watch(captureMenuOpen, (open) => {
    if (open) document.addEventListener('pointerdown', onCaptureMenuOutside, true)
    else document.removeEventListener('pointerdown', onCaptureMenuOutside, true)
  })

  function dispose(): void {
    document.removeEventListener('pointerdown', onCaptureMenuOutside, true)
  }

  return {
    captureBusy,
    captureMenuOpen,
    captureMenuRef,
    onCaptureFrame,
    onCaptureMenuPick,
    onCaptureMenuOutside,
    dispose,
  }
}
