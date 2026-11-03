import { computed, ref } from "vue"
import { progressRatio } from "../audioPlayback"

export interface AudioTransportOptions {
  url: () => string
  knownDuration: () => number
  onProgress: () => void
}

/** 播放器状态与 audio 元素控制（播放 / 暂停 / rAF 跟随 / 元数据与结束事件）。 */
export function useAudioTransport(options: AudioTransportOptions) {
  const audioRef = ref<HTMLAudioElement | null>(null)

  const ratio = ref(0)
  const playing = ref(false)
  const current = ref(0)
  /** 解码读出来的时长 */
  const decodedDuration = ref(0)

  /** 当前音频时长（秒）：优先解码结果，元数据没到之前用调用方给的已知值 */
  const duration = computed(() =>
    decodedDuration.value > 0 ? decodedDuration.value : options.knownDuration() > 0 ? options.knownDuration() : 0,
  )

  let rafId = 0

  /** 每帧读一次播放位置（只在播放中跑；暂停立即停 —— 不空转 rAF） */
  function tick(): void {
    const el = audioRef.value
    if (!el) {
      playing.value = false
      return
    }
    current.value = el.currentTime
    ratio.value = progressRatio(el.currentTime, duration.value)
    options.onProgress()
    if (!el.paused && !el.ended) rafId = requestAnimationFrame(tick)
    else playing.value = false
  }

  function startLoop(): void {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(tick)
  }

  function stopLoop(): void {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
  }

  async function togglePlay(): Promise<void> {
    const el = audioRef.value
    if (!el || !options.url()) return
    if (el.paused) {
      try {
        await el.play()
      } catch {
        playing.value = false
        return
      }
      playing.value = true
      startLoop()
    } else {
      el.pause()
      playing.value = false
      stopLoop()
      current.value = el.currentTime
      ratio.value = progressRatio(el.currentTime, duration.value)
    }
  }

  function onLoadedMetadata(): void {
    const el = audioRef.value
    if (!el) return
    if (Number.isFinite(el.duration) && el.duration > 0) decodedDuration.value = el.duration
    options.onProgress()
  }

  /** 暂停中的位置变化（如进度条 seek 后）也要反映到画面 */
  function onTimeUpdate(): void {
    const el = audioRef.value
    if (!el || playing.value) return
    current.value = el.currentTime
    ratio.value = progressRatio(el.currentTime, duration.value)
    options.onProgress()
  }

  function onEnded(): void {
    playing.value = false
    stopLoop()
    current.value = duration.value
    ratio.value = duration.value > 0 ? 1 : 0
  }

  function setDecodedDuration(value: number): void {
    decodedDuration.value = value
  }

  /** url 变了：回到片头并清掉旧解码时长（与原来 watch(url) 的赋值顺序一致） */
  function resetForNewUrl(): void {
    current.value = 0
    ratio.value = 0
    playing.value = false
    decodedDuration.value = 0
    stopLoop()
  }

  const progressPct = computed(() => (Math.min(1, Math.max(0, ratio.value)) * 100).toFixed(4) + "%")

  return {
    audioRef,
    ratio,
    playing,
    current,
    decodedDuration,
    duration,
    progressPct,
    tick,
    startLoop,
    stopLoop,
    togglePlay,
    onLoadedMetadata,
    onTimeUpdate,
    onEnded,
    setDecodedDuration,
    resetForNewUrl,
  }
}

