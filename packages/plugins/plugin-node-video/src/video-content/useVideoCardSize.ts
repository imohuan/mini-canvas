import { computed, nextTick, watch, type Ref } from 'vue'
import type { VideoOpsContext } from '../videoOps'
import {
  followedVideoCardSizePatch,
  missingVideoCardSizePatch,
  videoCardSizePatch,
  type CardSizePatch,
} from '../videoFit'

export interface VideoCardSizeOptions {
  nodeId: () => string
  data: () => Record<string, unknown>
  ops: VideoOpsContext
  sourceFields: Ref<{ resourceId: string; legacyUrl: string }>
  onSourceChanged: () => void
}

/**
 * 卡片尺寸兜底：挂载时补缺、换源时按新视频重算，两者都保持幂等。
 */
export function useVideoCardSize(options: VideoCardSizeOptions) {
  const { nodeId, data, ops, sourceFields, onSourceChanged } = options

  const sourceKey = computed(() => sourceFields.value.resourceId + '|' + sourceFields.value.legacyUrl)

  function syncCardSize(patch: CardSizePatch | null): void {
    if (!patch) return
    const current = ops.read(nodeId()) ?? data()
    ops.write(nodeId(), current, patch.size)
  }

  /** 挂载时补缺：推迟到 nextTick，让写入落在挂载完成之后 */
  function mountSize(): void {
    void nextTick(() => syncCardSize(missingVideoCardSizePatch(data(), ops.fitLimits?.())))
  }

  watch(sourceKey, () => {
    onSourceChanged()
    syncCardSize(followedVideoCardSizePatch(data(), ops.fitLimits?.()))
  })

  /** 视频元数据到手时补一次缺失的宽高（不覆盖用户已设的卡片尺寸） */
  function onMeta(v: HTMLVideoElement): void {
    const w = v.videoWidth
    const h = v.videoHeight
    const hasCard = positiveNum(data().cardWidth) !== null && positiveNum(data().cardHeight) !== null
    if (w > 0 && h > 0 && !hasCard) {
      const patch = videoCardSizePatch(w, h, ops.fitLimits?.())
      if (patch) ops.write(nodeId(), { ...(ops.read(nodeId()) ?? data()), videoWidth: w, videoHeight: h }, patch.size)
    }
  }

  return {
    syncCardSize,
    mountSize,
    onMeta,
  }
}

function positiveNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}
