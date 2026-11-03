import type { Ref } from "vue"
import { openAudioSource, type AudioSource } from "../audioSource"

export interface PeakWindowOptions {
  url: () => string
  duration: () => number
  windowStart: Ref<number>
  windowSeconds: Ref<number>
  secondsPerBar: Ref<number>
  barCount: Ref<number>
  windowPeaks: Ref<number[] | null>
  windowPeaksFrom: { value: number }
  setDecodedDuration: (value: number) => void
}

/** 按需解码源与可视窗口峰值缓存。 */
export function usePeakWindow(options: PeakWindowOptions) {
  let source: AudioSource | null = null
  let sourceGeneration = 0
  let lastPeakRequest = ""

  async function refreshWindowPeaks(): Promise<void> {
    const src = source
    if (!src) return
    const span = options.windowSeconds.value
    const start = options.windowStart.value
    if (!(span > 0)) return
    const key = start.toFixed(3) + "|" + span.toFixed(3) + "|" + options.barCount.value
    if (key === lastPeakRequest) return
    lastPeakRequest = key
    const generation = sourceGeneration
    try {
      const perBar = options.secondsPerBar.value
      const firstCell = Math.max(0, Math.floor(start / perBar))
      const askedFrom = firstCell * perBar
      const askedTo = Math.min(options.duration(), askedFrom + span)
      const peaks = await src.peaks(askedFrom, askedTo, options.barCount.value)
      if (generation !== sourceGeneration) return
      options.windowPeaksFrom.value = firstCell
      options.windowPeaks.value = peaks
    } catch {
      /* 单次取样失败不影响已有画面 */
    }
  }

  /** 打开（或重开）按需解码源；url 变化与"刷新"都走这里 */
  async function openSource(): Promise<void> {
    const generation = ++sourceGeneration
    source?.dispose()
    source = null
    options.windowPeaks.value = null
    lastPeakRequest = ""
    if (!options.url()) return
    const next = await openAudioSource(options.url())
    if (generation !== sourceGeneration) {
      next?.dispose()
      return
    }
    source = next
    if (!next) return
    if (next.duration > 0) options.setDecodedDuration(next.duration)
    void refreshWindowPeaks()
  }

  function invalidatePeakRequest(): void {
    lastPeakRequest = ""
  }

  function dispose(): void {
    sourceGeneration++
    source?.dispose()
    source = null
  }

  return { refreshWindowPeaks, openSource, invalidatePeakRequest, dispose }
}

