import { ref, type Ref } from 'vue'
import { clampClipEnd, clampClipStart, moveClipRange } from '../videoClip'
import type { ClipPrefs } from '../videoClipStore'
import { snapLength as snapLengthValue } from './snapLength'

export interface ClipDragOptions {
  duration: Ref<number>
  minClip: Ref<number>
  range: Ref<{ start: number; end: number }>
  prefs: ClipPrefs
  effectiveRadius: Ref<number>
  filmEl: () => HTMLElement | null
  commit: (next: { start: number; end: number }) => void
  contentVideo: () => HTMLVideoElement | null
  previewAtBoundary: (edge: 'start' | 'end', force: boolean) => void
  currentPreviewEdge: () => 'start' | 'end'
}

/**
 * 时间轴指针拖拽：起点、终点与整段平移，包含时长吸附。
 */
export function useClipDrag(options: ClipDragOptions) {
  const {
    duration,
    minClip,
    range,
    prefs,
    effectiveRadius,
    filmEl,
    commit,
    contentVideo,
    previewAtBoundary,
    currentPreviewEdge,
  } = options

  /** 拖拽：吸附作用于「色块时长」（demo 铁律 2），背景位置自由 */
  let drag: { kind: 'start' | 'end' | 'move'; startX: number; width: number; from: { start: number; end: number } } | null = null
  const isDragging = ref(false)

  function snapLength(length: number): number {
    return snapLengthValue(length, {
      snap: prefs.snap,
      snapStep: prefs.snapStep,
      effectiveRadius: effectiveRadius.value,
    })
  }

  function onHandleDown(ev: PointerEvent, kind: 'start' | 'end' | 'move'): void {
    if (ev.button !== 0 || duration.value <= 0) return
    ev.preventDefault()
    ev.stopPropagation()
    const box = filmEl()?.getBoundingClientRect()
    drag = { kind, startX: ev.clientX, width: box && box.width > 0 ? box.width : 1, from: { ...range.value } }
    isDragging.value = true
    /**
     * 先暂停再拖（demo beginDrag 同款）。
     *
     * 为什么必须：内容区在「悬停 / 单选」时会自动播放，拖拽时它常常正播着。
     * 播放中的 video 不接 seek 预览（见 previewAtBoundary 的 paused 判断），
     * 于是画面继续从自己的时间线往前跑 —— 用户看到的就是「拖了起点，视频没跟着走」。
     */
    contentVideo()?.pause()
    // 按下就先把画面摆到被拖的那一端（demo 同款：拖起来立刻有参照）
    previewAtBoundary(kind === 'end' ? 'end' : 'start', true)
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', onDragUp)
    window.addEventListener('pointercancel', onDragUp)
  }

  function onDragMove(ev: PointerEvent): void {
    if (!drag) return
    ev.preventDefault()
    const delta = ((ev.clientX - drag.startX) / drag.width) * duration.value
    const opts = { duration: duration.value, minDuration: minClip.value }
    if (drag.kind === 'start') {
      const rawLength = drag.from.end - (drag.from.start + delta)
      const length = Math.max(minClip.value, snapLength(rawLength))
      commit(clampClipStart({ start: drag.from.end - length, end: drag.from.end, ...opts }))
    } else if (drag.kind === 'end') {
      const rawLength = drag.from.end + delta - drag.from.start
      const length = Math.max(minClip.value, snapLength(rawLength))
      commit(clampClipEnd({ start: drag.from.start, end: drag.from.start + length, ...opts }))
    } else {
      commit(moveClipRange({ ...drag.from, nextStart: drag.from.start + delta, ...opts }))
    }
    previewAtBoundary(drag.kind === 'end' ? 'end' : 'start', false)
  }

  function onDragUp(): void {
    drag = null
    isDragging.value = false
    // 松手再对一次（拖动中每 90ms 才 seek 一次，最后一帧要保证停在被拖的端点）
    previewAtBoundary(currentPreviewEdge(), true)
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragUp)
    window.removeEventListener('pointercancel', onDragUp)
  }

  return {
    isDragging,
    snapLength,
    onHandleDown,
    onDragMove,
    onDragUp,
  }
}
