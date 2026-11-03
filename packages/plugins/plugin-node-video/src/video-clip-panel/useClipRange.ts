import { computed, type Ref } from 'vue'
import {
  clampClipEnd,
  clampClipRange,
  clampClipStart,
  readClipRange,
} from '../videoClip'
import { overlayDraft, setOverlayDraft } from '../videoSession'
import { readPlayhead } from '../videoClipStore'

export interface ClipRangeOptions {
  nodeId: string
  data: () => Record<string, unknown>
  duration: Ref<number>
  minClip: Ref<number>
}

/**
 * 当前剪辑范围与百分比标签，以及一次性的草稿提交。
 */
export function useClipRange(options: ClipRangeOptions) {
  const { nodeId, data, duration, minClip } = options

  /** 当前显示范围：草稿优先，其次已保存的，最后整段 */
  const range = computed(() => {
    const draft = overlayDraft(nodeId)._clipRange as { start: number; end: number } | undefined
    if (draft && Number.isFinite(draft.start) && Number.isFinite(draft.end)) {
      return clampClipRange({ start: draft.start, end: draft.end, duration: duration.value, minDuration: minClip.value })
    }
    return readClipRange(data(), minClip.value)
  })

  const startPct = computed(() => (duration.value > 0 ? (range.value.start / duration.value) * 100 : 0))
  const endPct = computed(() => (duration.value > 0 ? (range.value.end / duration.value) * 100 : 100))
  const lengthLabel = computed(() => (range.value.end - range.value.start).toFixed(2) + ' s')

  function commit(next: { start: number; end: number }): void {
    setOverlayDraft(nodeId, { ...overlayDraft(nodeId), _clipRange: next })
  }

  /** I/O 设出入点：以播放头当前位置为准 */
  function setInPoint(): void {
    const t = readPlayhead(nodeId)
    if (t === null) return
    commit(clampClipStart({ start: t, end: range.value.end, duration: duration.value, minDuration: minClip.value }))
  }

  function setOutPoint(): void {
    const t = readPlayhead(nodeId)
    if (t === null) return
    commit(clampClipEnd({ start: range.value.start, end: t, duration: duration.value, minDuration: minClip.value }))
  }

  return {
    range,
    startPct,
    endPct,
    lengthLabel,
    commit,
    setInPoint,
    setOutPoint,
  }
}

