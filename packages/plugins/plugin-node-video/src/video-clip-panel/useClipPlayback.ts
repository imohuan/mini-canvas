import type { Ref } from 'vue'

export interface ClipPlaybackOptions {
  nodeId: string
  duration: Ref<number>
  range: Ref<{ start: number; end: number }>
}

/**
 * 内容区 video 元素查找、播放切换与拖动时的画面预览。
 */
export function useClipPlayback(options: ClipPlaybackOptions) {
  const { nodeId, duration, range } = options

  let lastPreviewAt = 0
  /** 当前这次拖拽拖的是哪一端（松手时按它再对一次画面） */
  let previewEdge: 'start' | 'end' = 'start'

  function contentVideo(): HTMLVideoElement | null {
    const node = (document.querySelector('[data-id="' + nodeId + '"]')
      ?? document.querySelector('.vue-flow__node-' + nodeId)) as HTMLElement | null
    return node?.querySelector('video') ?? null
  }

  /**
   * 拖动时让视频跟着时间线走（demo 的 previewBoundary，用户口径 2026-10-31）。
   *
   * 拖哪一端就把画面 seek 到那一端：内容区上报 currentTime → 白色时间线自然跟着动，
   * 用户能在拖的过程中直接看到这一帧。限制与 demo 相同：
   * - 距离上一帧不到 90ms 就跳过（拖动会一次发几十个 pointermove，逐个 seek 会卡）；
   * - 拖起点时取 start + 0.01（避开边界那半帧）；拖终点取 end - 0.03（留一点余量）；
   * - 不在播放时才做（正在播时用户看的是播放，不该被拖拽打断）。
   */
  function previewAtBoundary(edge: 'start' | 'end', force: boolean): void {
    if (duration.value <= 0) return
    previewEdge = edge
    const v = contentVideo()
    if (!v || !v.paused) return
    const now = Date.now()
    if (!force && now - lastPreviewAt < 90) return
    lastPreviewAt = now
    const { start, end } = range.value
    const target = edge === 'end'
      ? Math.max(start, end - 0.03)
      : Math.min(end - 0.01, start + 0.01)
    const safe = Math.min(Math.max(target, 0), Math.max(0, duration.value - 0.001))
    try {
      v.currentTime = safe
    } catch {
      // 元数据还没就绪时浏览器会抛：拖拽下一帧再试即可，不必打断
    }
  }

  function togglePlay(): void {
    const v = contentVideo()
    if (!v) return
    const { start, end } = range.value
    if (v.paused) {
      if (v.currentTime < start || (end > start && v.currentTime >= end)) v.currentTime = start
      void v.play().catch(() => {})
    } else {
      v.pause()
    }
  }

  function currentPreviewEdge(): 'start' | 'end' {
    return previewEdge
  }

  return {
    contentVideo,
    previewAtBoundary,
    togglePlay,
    currentPreviewEdge,
  }
}
