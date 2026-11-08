import { computed, nextTick, ref, watch, type Ref } from 'vue'
import { clipBoundaryAction } from '../videoClip'
import { publishDuration, publishPlayhead, readClipPrefs } from '../videoClipStore'
import { isClipping } from '../videoSession'

export interface VideoPlaybackOptions {
  nodeId: string
  data: () => Record<string, unknown>
  active: () => boolean
  cropping: () => boolean
  broken: Ref<boolean>
  videoUrl: () => string
  clipRange: () => { start: number; end: number }
  videoRef: { value: HTMLVideoElement | null }
  hovering?: Ref<boolean>
  /**
   * 卡片上是否盖着加载 / 失败态（runState 在跑或失败）。
   * 为 true 时所有播放入口都拦掉：悬停不自动播、点播放按钮不挂 video、双击不进全屏。
   */
  blocked?: () => boolean
  /** 元数据读到手后的额外处理（卡片尺寸兜底等） */
  onMeta?: (v: HTMLVideoElement) => void
}

/**
 * 视频播放状态：播放/暂停、时间、剪辑段边界、帧图遮挡计时。
 */
export function useVideoPlayback(options: VideoPlaybackOptions) {
  const { nodeId, active, cropping, broken, videoUrl, clipRange, videoRef } = options
  /** 加载态盖着时就算忙：各条播放入口统一问它，避免各判一次判歪 */
  const blocked = (): boolean => options.blocked?.() === true
  const playing = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  /** 播完一轮的闩锁：一轮里"到段尾暂停"只执行一次，防 seek/暂停残余的 timeupdate 重复触发 */
  const endedLatch = ref(false)

  /** 用户要求播放（点播放按钮 / 悬停自动播 / 进全屏） */
  const videoRequested = ref(false)
  /** 离开时的播放位置：下次再点播放从这里接着放 */
  const resumeTime = ref(0)

  const posterHideTimer: { value: number | null } = { value: null }
  /** true = 帧图还盖着；video 首次 play 后 500ms 翻 false */
  const posterCovering = ref(true)
  const videoHasFrame = ref(false)

  function schedulePosterHide(): void {
    if (posterHideTimer.value !== null) window.clearTimeout(posterHideTimer.value)
    posterHideTimer.value = window.setTimeout(() => {
      posterHideTimer.value = null
      posterCovering.value = false
    }, 500)
  }
  const keepPosterOverVideo = computed(() => posterCovering.value || !videoHasFrame.value)
  const showPoster = computed(() => !videoRequested.value || (!active() && !isClipping(nodeId)))

  function activeVideo(): HTMLVideoElement | null {
    return videoRef.value
  }

  /** 播放：起点不在剪辑段内时先跳到段首 */
  async function togglePlay(): Promise<void> {
    // 加载态盖着时不碰视频：既不挂新解码，也不在这里暂停/起播
    if (blocked()) return
    const v = activeVideo()
    if (!v || !videoUrl()) return
    if (v.paused) {
      const { start, end } = clipRange()
      if (v.currentTime < start || (end > start && v.currentTime >= end)) {
        v.currentTime = start
      } else if (resumeTime.value > 0 && v.currentTime <= 0.01) {
        v.currentTime = Math.min(resumeTime.value, end > start ? end : Number.POSITIVE_INFINITY)
      }
      endedLatch.value = false
      await v.play().catch(() => {
        v.muted = true
        return v.play().catch(() => { })
      })
    } else {
      v.pause()
    }
  }

  /** 播放按钮：帧图态下先挂上 video，等它挂好再播 */
  async function onPlayButton(restart = false): Promise<void> {
    // 加载态盖着时按钮不给播（覆盖层本来就挡着，这是第二道闸）
    if (blocked()) return
    if (!videoRequested.value) {
      videoRequested.value = true
      currentTime.value = clipRange().start
      if (restart) resumeTime.value = 0
      await nextTick()
    }
    await togglePlay()
  }

  async function enterActive(): Promise<void> {
    if (posterHideTimer.value !== null) { window.clearTimeout(posterHideTimer.value); posterHideTimer.value = null }
    posterCovering.value = true
    if (cropping() || broken.value || !videoUrl()) return
    // 加载 / 失败覆盖层盖在卡片上：悬停照常记录，但不起播（用户 2026-11-08 要求拦截）
    if (blocked()) return
    if (videoRequested.value && playing.value) { schedulePosterHide(); return }
    resumeTime.value = 0
    await onPlayButton(true)
  }

  function stopPlayback(): void {
    if (!videoRequested.value) return
    if (isClipping(nodeId)) {
      const v = videoRef.value
      if (v && Number.isFinite(v.currentTime)) resumeTime.value = v.currentTime
      return
    }
    const v = videoRef.value
    if (v && !v.paused) v.pause()
    if (v && Number.isFinite(v.currentTime)) resumeTime.value = v.currentTime
    videoRequested.value = false
    endedLatch.value = false
    videoHasFrame.value = false
  }

  function leaveActive(): void {
    if (posterHideTimer.value !== null) { window.clearTimeout(posterHideTimer.value); posterHideTimer.value = null }
    posterCovering.value = true
    stopPlayback()
  }

  /**
   * 同步「激活态 → 播放/停播」。
   * 激活态有两个来源（鼠标悬停、单选选中），都走同一条路。
   */
  watch(active, (on) => {
    if (on) void enterActive()
    else leaveActive()
  })

  /**
   * 加载态盖上来时把正在播的停掉。
   *
   * 场景：视频正在悬停播放，后台任务把 runState 写成 running，覆盖层一开始不立刻暂停的话，
   * 底下仍有一个 video 在解码 —— 用户看到的是「加载中，但声音还在响」。
   */
  watch(
    () => options.blocked?.() === true,
    (isBlocked) => {
      if (isBlocked) leaveActive()
    },
  )

  /** 悬停进入：只翻标志位，真正的播放交给激活态 watch */
  function onCardEnter(): void {
    if (options.hovering) options.hovering.value = true
  }

  /** 悬停离开：同上，停播交给激活态 watch */
  function onCardLeave(): void {
    if (options.hovering) options.hovering.value = false
  }

  const playableLength = computed(() => {
    if (duration.value > 0) return duration.value
    const fallback = Number(options.data().videoDuration)
    return Number.isFinite(fallback) && fallback > 0 ? fallback : 0
  })
  const playedInClip = computed(() => Math.max(0, Math.min(currentTime.value, playableLength.value)))

  watch(
    () => clipRange().end,
    () => {
      endedLatch.value = false
    },
  )

  function onLoadedMetadata(e: Event): void {
    const v = e.target as HTMLVideoElement
    duration.value = Number.isFinite(v.duration) ? v.duration : duration.value
    broken.value = false
    options.onMeta?.(v)
    const { start } = clipRange()
    if (start > 0 && v.currentTime < start) v.currentTime = start
    publishDuration(nodeId, duration.value)
    if (resumeTime.value > 0 && v.currentTime <= 0.01) {
      const { end } = clipRange()
      const max = end > start ? end : v.duration
      v.currentTime = Number.isFinite(max) ? Math.min(resumeTime.value, max) : resumeTime.value
    }
  }

  function onTimeUpdate(e: Event): void {
    const v = e.target as HTMLVideoElement
    if (v !== activeVideo()) return
    currentTime.value = v.currentTime
    publishPlayhead(nodeId, v.currentTime)
    playing.value = !v.paused
    const { start, end } = clipRange()
    if (endedLatch.value && v.currentTime < end - 0.001) endedLatch.value = false
    const action = clipBoundaryAction({
      current: v.currentTime,
      start,
      end,
      loop: readClipPrefs(nodeId).loop,
    })
    if (action === 'continue') {
      if (endedLatch.value && v.currentTime < end - 0.001) endedLatch.value = false
      return
    }
    if (action === 'clamp-start') {
      if (v.paused) return
      v.currentTime = start
      currentTime.value = start
      return
    }
    endedLatch.value = true
    if (action === 'rewind') {
      endedLatch.value = false
      v.currentTime = start
      currentTime.value = start
      void v.play().catch(() => {})
    } else {
      v.pause()
      v.currentTime = end
      currentTime.value = end
      resumeTime.value = start
    }
  }

  function onBarSeek(seconds: number): void {
    const v = activeVideo()
    if (!v || !Number.isFinite(seconds)) return
    v.currentTime = Math.min(Math.max(seconds, 0), duration.value || seconds)
    currentTime.value = v.currentTime
  }

  function onVideoError(): void {
    const code = videoRef.value?.error?.code ?? 0
    if (code === 4) {
      broken.value = true
      playing.value = false
      return
    }
    const v = videoRef.value
    if (v && videoUrl()) {
      window.setTimeout(() => { try { v.load() } catch { /* 元素已卸载则忽略 */ } }, 400)
    }
    playing.value = false
  }

  function onVideoPlay(): void {
    playing.value = true
    schedulePosterHide()
  }

  function setPlaying(value: boolean): void {
    playing.value = value
  }

  function onVideoReady(): void {
    const v = videoRef.value
    if (v && v.readyState >= 2) videoHasFrame.value = true
  }

  function dispose(): void {
    if (posterHideTimer.value !== null) window.clearTimeout(posterHideTimer.value)
  }

  return {
    playing,
    currentTime,
    duration,
    endedLatch,
    videoRequested,
    resumeTime,
    posterCovering,
    videoHasFrame,
    posterHideTimer,
    schedulePosterHide,
    keepPosterOverVideo,
    showPoster,
    activeVideo,
    togglePlay,
    onPlayButton,
    enterActive,
    leaveActive,
    onCardEnter,
    onCardLeave,
    stopPlayback,
    playableLength,
    playedInClip,
    onLoadedMetadata,
    onTimeUpdate,
    onBarSeek,
    onVideoError,
    onVideoPlay,
    setPlaying,
    onVideoReady,
    dispose,
  }
}
