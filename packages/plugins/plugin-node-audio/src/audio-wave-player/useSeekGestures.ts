import type { Ref } from "vue"
import { progressRatio, ratioFromPointer } from "../audioPlayback"

export interface SeekGesturesOptions {
  url: () => string
  compact: () => boolean
  audioRef: Ref<HTMLAudioElement | null>
  waveRef: Ref<HTMLElement | null>
  knobRef: Ref<HTMLElement | null>
  trackRef: Ref<HTMLElement | null>
  duration: () => number
  current: Ref<number>
  ratio: Ref<number>
  playing: Ref<boolean>
  frozenStart: Ref<number | null>
  windowStart: Ref<number>
  windowSeconds: Ref<number>
  startLoop: () => void
  stopLoop: () => void
  refreshWindowPeaks: () => Promise<void>
  invalidatePeakRequest: () => void
}

/** 播放头 / 整体进度条 / 紧凑波形拖动、搓碟节流与边缘滚动。 */
export function useSeekGestures(options: SeekGesturesOptions) {
  let seeking = false
  /** 拖动前是否正在播放：松手后只在这种情况下才恢复播放 */
  let wasPlayingBeforeSeek = false
  /** 是否正在拖那条整体进度条 */
  let trackSeeking = false
  /** 拖动中指针的横向位置（不夹取）：用来判断是否进入边缘滚动区 */
  let pointerClientX = 0
  /** 边缘滚动区宽度（px）：指针进到这个范围里，波纹就往那一侧滚 */
  const EDGE_ZONE_PX = 28
  /** 边缘滚动的每帧推进量（秒/帧）—— 与帧率无关地按 60fps 折算 */
  const EDGE_SCROLL_SECONDS_PER_FRAME = 0.12
  let edgeScrollRaf = 0
  /**
   * 拖动出声的节流窗口（毫秒）：每次指针移动就重置定时器，到点还没再动就暂停。
   * 用户口径：拖的时候一直响，手一停（60ms）就静音；按住不放不会自己往前溜。
   */
  const SCRUB_IDLE_MS = 60
  /** 停手后"该暂停"的定时器 */
  let scrubIdleTimer = 0
  /** 指针停手后音频是否已暂停（下次移动要重新播放） */
  let scrubPaused = false

  /** 指针横坐标 → 目标时间（拖动中窗口冻结，所以换算用的是同一把尺子） */
  function seekTo(clientX: number): void {
    const el = options.audioRef.value
    const wave = options.waveRef.value
    if (!el || !wave) return
    const rect = wave.getBoundingClientRect()
    const fraction = ratioFromPointer(clientX, rect.left, rect.width)
    const time = options.windowStart.value + fraction * options.windowSeconds.value
    const clamped = Math.min(Math.max(0, time), options.duration() || time)
    try {
      el.currentTime = clamped
    } catch {
      /* 元数据还没到 / 浏览器拒绝：显示仍跟着手指走 */
    }
    options.current.value = clamped
    options.ratio.value = options.duration() > 0 ? clamped / options.duration() : 0
  }

  /** 把音频定位到某个绝对时间（整体进度条与边缘滚动共用；不改变播放状态） */
  function seekToTime(time: number): void {
    const el = options.audioRef.value
    const total = options.duration()
    const clamped = Math.min(Math.max(0, time), total > 0 ? total : Math.max(0, time))
    if (el) {
      try {
        el.currentTime = clamped
      } catch {
        /* 元数据还没到：只更新显示 */
      }
    }
    options.current.value = clamped
    options.ratio.value = total > 0 ? clamped / total : 0
  }

  /** 整体进度条：指针位置 → 绝对时间（这条是**整条音频**的尺子，与窗口无关） */
  function onTrackPointerDown(e: PointerEvent): void {
    if (!options.url()) return
    e.stopPropagation()
    e.preventDefault()
    trackSeeking = true
    const el = options.audioRef.value
    wasPlayingBeforeSeek = !!el && !el.paused
    scrubPaused = false
    if (el) {
      // 与把手一致：拖动期间出声、停手即静音，松手原样恢复
      void el.play().catch(() => {})
      options.playing.value = true
      options.startLoop()
    }
    options.trackRef.value?.setPointerCapture?.(e.pointerId)
    seekByTrackPointer(e.clientX)
    armScrubIdleTimer()
  }

  function onTrackPointerMove(e: PointerEvent): void {
    if (!trackSeeking) return
    e.stopPropagation()
    noteScrubActivity()
    seekByTrackPointer(e.clientX)
  }

  function onTrackPointerUp(e: PointerEvent): void {
    if (!trackSeeking) return
    trackSeeking = false
    options.trackRef.value?.releasePointerCapture?.(e.pointerId)
    cancelScrubIdle()
    const el = options.audioRef.value
    if (el) {
      if (wasPlayingBeforeSeek) {
        void el.play().catch(() => {})
        options.playing.value = true
        options.startLoop()
      } else {
        el.pause()
        options.playing.value = false
        options.stopLoop()
      }
    }
    wasPlayingBeforeSeek = false
    void options.refreshWindowPeaks()
  }

  /** 指针横坐标 → 整条音频上的时间 */
  function seekByTrackPointer(clientX: number): void {
    const track = options.trackRef.value
    if (!track) return
    const rect = track.getBoundingClientRect()
    const fraction = ratioFromPointer(clientX, rect.left, rect.width)
    seekToTime(fraction * options.duration())
  }

  /** 开始一次 seek（播放头与历史卡的整条波形共用同一套逻辑） */
  function beginSeek(e: PointerEvent, captureEl: HTMLElement | null): void {
    if (!options.url()) return
    e.stopPropagation()
    e.preventDefault()
    // 冻结窗口：否则"窗口跟着播放走"+"指针映射到时间"会形成反馈环（实测进度会飞）
    options.frozenStart.value = options.windowStart.value
    seeking = true
    const el = options.audioRef.value
    wasPlayingBeforeSeek = !!el && !el.paused
    scrubPaused = false
    if (el) {
      void el.play().catch(() => {})
      options.playing.value = true
      options.startLoop()
    }
    pointerClientX = e.clientX
    captureEl?.setPointerCapture?.(e.pointerId)
    startEdgeScroll()
    armScrubIdleTimer()
  }

  function moveSeek(e: PointerEvent): void {
    if (!seeking) return
    e.stopPropagation()
    pointerClientX = e.clientX
    noteScrubActivity()
    seekTo(e.clientX)
  }

  function finishSeek(e: PointerEvent, captureEl: HTMLElement | null): void {
    if (!seeking) return
    seeking = false
    options.frozenStart.value = null
    stopEdgeScroll()
    cancelScrubIdle()
    const el = options.audioRef.value
    if (el) {
      // 恢复"拖之前"的状态：原本在播就继续播，原本暂停就回到暂停（用户口径）
      if (wasPlayingBeforeSeek) {
        void el.play().catch(() => {})
        options.playing.value = true
        options.startLoop()
      } else {
        el.pause()
        options.playing.value = false
        options.stopLoop()
      }
    }
    wasPlayingBeforeSeek = false
    captureEl?.releasePointerCapture?.(e.pointerId)
    void options.refreshWindowPeaks()
  }

  function onKnobPointerDown(e: PointerEvent): void {
    beginSeek(e, options.knobRef.value)
  }

  function onKnobPointerMove(e: PointerEvent): void {
    moveSeek(e)
  }

  function onKnobPointerUp(e: PointerEvent): void {
    finishSeek(e, options.knobRef.value)
  }

  /**
   * 历史卡（compact）里整条波形都能点/拖：点哪跳哪，按住拖连续 seek。
   * 只在 compact 模式接管 —— 节点里的波形要留给画布拖拽（手势契约，别回退）。
   */
  function onWavePointerDown(e: PointerEvent): void {
    if (!options.compact()) return
    beginSeek(e, options.waveRef.value)
    seekTo(e.clientX)
  }

  function onWavePointerMove(e: PointerEvent): void {
    if (!options.compact()) return
    moveSeek(e)
  }

  function onWavePointerUp(e: PointerEvent): void {
    if (!options.compact()) return
    finishSeek(e, options.waveRef.value)
  }

  /** 拖动时每次指针移动重置定时器；到点自动暂停（声音、播放头、时间轴一起停） */
  function armScrubIdleTimer(): void {
    if (scrubIdleTimer) clearTimeout(scrubIdleTimer)
    scrubIdleTimer = window.setTimeout(pauseScrub, SCRUB_IDLE_MS)
  }

  function cancelScrubIdle(): void {
    if (scrubIdleTimer) clearTimeout(scrubIdleTimer)
    scrubIdleTimer = 0
  }

  /** 指针动了：若停手时被暂停过，先恢复出声，再把"停手暂停"的定时器往后推一格 */
  function noteScrubActivity(): void {
    if (scrubPaused) {
      const el = options.audioRef.value
      if (el) {
        void el.play().catch(() => {})
        options.playing.value = true
        options.startLoop()
      }
      scrubPaused = false
    }
    armScrubIdleTimer()
  }

  /** 停手了：暂停播放，下次移动再恢复 */
  function pauseScrub(): void {
    scrubIdleTimer = 0
    if (!seeking && !trackSeeking) return
    if (scrubPaused) return
    const el = options.audioRef.value
    if (el && !el.paused) {
      el.pause()
      options.current.value = el.currentTime
      options.ratio.value = progressRatio(el.currentTime, options.duration())
    }
    options.playing.value = false
    options.stopLoop()
    scrubPaused = true
  }

  /**
   * 边缘滚动：指针拖到可视区左/右边缘时，让**窗口**持续朝那一侧走 ——
   * 一根把手就能控制整条音频，而不是只有可视窗口那一小段。
   */
  function runEdgeScroll(): void {
    edgeScrollRaf = 0
    if (!seeking) return
    const wave = options.waveRef.value
    const total = options.duration()
    const span = options.windowSeconds.value
    if (!wave || !(total > 0) || !(span > 0) || span >= total) return
    const rect = wave.getBoundingClientRect()
    const left = rect.left + EDGE_ZONE_PX
    const right = rect.right - EDGE_ZONE_PX
    let step = 0
    if (pointerClientX < left) step = -EDGE_SCROLL_SECONDS_PER_FRAME
    else if (pointerClientX > right) step = EDGE_SCROLL_SECONDS_PER_FRAME
    if (step !== 0) {
      const from = options.frozenStart.value ?? options.windowStart.value
      const next = Math.min(Math.max(0, from + step), Math.max(0, total - span))
      if (Math.abs(next - from) > 1e-6) {
        options.frozenStart.value = next
        // 窗口在滚：把播放位置也带到窗口中心附近，松手时落点才跟得上画面
        const target = Math.min(total, Math.max(0, next + span / 2))
        const el = options.audioRef.value
        if (el) {
          try {
            el.currentTime = target
          } catch {
            /* 元数据还没到：只滚窗口 */
          }
        }
        options.current.value = target
        options.ratio.value = total > 0 ? target / total : 0
        options.invalidatePeakRequest()
        void options.refreshWindowPeaks()
      }
    }
    edgeScrollRaf = requestAnimationFrame(runEdgeScroll)
  }

  function startEdgeScroll(): void {
    if (!edgeScrollRaf) edgeScrollRaf = requestAnimationFrame(runEdgeScroll)
  }

  function stopEdgeScroll(): void {
    if (edgeScrollRaf) cancelAnimationFrame(edgeScrollRaf)
    edgeScrollRaf = 0
  }

  function isSeeking(): boolean {
    return seeking
  }

  return {
    onTrackPointerDown,
    onTrackPointerMove,
    onTrackPointerUp,
    onKnobPointerDown,
    onKnobPointerMove,
    onKnobPointerUp,
    onWavePointerDown,
    onWavePointerMove,
    onWavePointerUp,
    cancelScrubIdle,
    stopEdgeScroll,
    isSeeking,
  }
}

