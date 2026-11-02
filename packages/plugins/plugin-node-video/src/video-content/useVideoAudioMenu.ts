import { computed, ref, type Ref } from 'vue'

export interface VideoAudioMenuOptions {
  volume: Ref<number>
  muted: Ref<boolean>
  playbackRate: Ref<number>
  videoRef: { value: HTMLVideoElement | null }
  captureMenuOpen: Ref<boolean>
}

/**
 * 音量/倍速/截帧菜单的显隐：两组下拉互斥，鼠标移进面板时取消延迟收起。
 */
export function useVideoAudioMenu(options: VideoAudioMenuOptions) {
  const { volume, muted, playbackRate, videoRef, captureMenuOpen } = options
  const volumeOpen = ref(false)
  const rateMenuOpen = ref(false)
  const RATE_VALUES = [0.5, 1, 1.5, 2, 3] as const

  let volumeCloseTimer: number | null = null
  let captureCloseTimer: number | null = null
  let volumeDragging = false

  const volumeEffectiveMuted = computed(() => muted.value || volume.value <= 0)

  function delayedClose(kind: 'volume' | 'capture'): void {
    if (kind === 'volume') {
      if (volumeCloseTimer !== null) window.clearTimeout(volumeCloseTimer)
      volumeCloseTimer = window.setTimeout(() => { volumeOpen.value = false; volumeCloseTimer = null }, 350)
    } else {
      if (captureCloseTimer !== null) window.clearTimeout(captureCloseTimer)
      captureCloseTimer = window.setTimeout(() => { captureMenuOpen.value = false; captureCloseTimer = null }, 350)
    }
  }

  function cancelDelayedClose(kind: 'volume' | 'capture'): void {
    if (kind === 'volume') {
      if (volumeCloseTimer !== null) { window.clearTimeout(volumeCloseTimer); volumeCloseTimer = null }
    } else {
      if (captureCloseTimer !== null) { window.clearTimeout(captureCloseTimer); captureCloseTimer = null }
    }
  }

  /** 两组下拉互斥：开一组就立刻收另一组 */
  function openExclusive(kind: 'volume' | 'capture'): void {
    if (kind === 'volume') {
      captureMenuOpen.value = false
      volumeOpen.value = true
    } else {
      volumeOpen.value = false
      captureMenuOpen.value = true
    }
  }

  function onRateToggle(): void {
    rateMenuOpen.value = !rateMenuOpen.value
  }

  function onRatePick(value: number): void {
    if (!(RATE_VALUES as readonly number[]).includes(value)) return
    playbackRate.value = value
    rateMenuOpen.value = false
    const v = videoRef.value
    if (v) v.playbackRate = value
  }

  function onMuteToggle(): void {
    muted.value = !muted.value
  }

  function onBarVolume(value: number): void {
    if (!Number.isFinite(value)) return
    volume.value = Math.min(1, Math.max(0, value))
    if (volume.value > 0) muted.value = false
    const v = videoRef.value
    if (v) v.volume = volume.value
  }

  function dispose(): void {
    if (volumeCloseTimer !== null) window.clearTimeout(volumeCloseTimer)
    if (captureCloseTimer !== null) window.clearTimeout(captureCloseTimer)
  }

  return {
    volumeOpen,
    rateMenuOpen,
    RATE_VALUES,
    volumeEffectiveMuted,
    delayedClose,
    cancelDelayedClose,
    openExclusive,
    onRateToggle,
    onRatePick,
    onMuteToggle,
    onBarVolume,
    dispose,
  }
}
