<script setup lang="ts">
/**
 * AudioWavePlayer —— 音频播放器的可复用核心：波形 + 播放头 + 整体进度条。
 *
 * 从 AudioContent 抽出（交接文档 P0-1）：节点内容段（AudioContent）与预览件
 * （AudioPreview）共用这一套波形实现，别再分叉两份 —— 两份必然漂移。
 *
 * 本组件只管"给一段音频地址，画波形、能播放、能拖进度"：
 * - 不读节点数据、不碰插件服务（settings / doc 一概不知）—— 节点相关留在调用方；
 * - 上传按钮 / 刷新按钮 / 底部信息栏不在这里 —— 调用方各自拼装；
 * - 无 url 时内部 audio 元素不渲染（"无音频"占位符是节点内容段的事）。
 *
 * ## 波形的画法（用户口径，别再改回去）
 *
 * **从头到尾只有一条波形**。进度条做的事只有一件：把播放位置**左边**那些竖条染成主题色，
 * 右边保持灰。竖条**只有一层**，每根自己带 is-played（已播）标记 ——
 * 曾经写成"两层波形叠放、上层按进度宽度裁切"，上层容器一变窄，里面按百分比定位的竖条
 * 就被横向压扁，看起来像"又拉出来一条波纹"（用户实测截图报的 bug）。
 *
 * ## 轮播窗口
 *
 * 时间轴是一长条，可视区只是一扇窗。播放/拖动时**整条时间轴向左平移**（内容在动、窗口不动）。
 * 每根竖条宽度固定（barWidth px），"窗口里有多少根"由实测宽度决定，与缩放无关。
 * 短音频整条铺满，长音频按 WINDOW_SECONDS 的窗口滑动，格子锚在绝对时间上。
 *
 * ## 按需算峰值
 *
 * 只算可视窗口那一段（openAudioSource.peaks，算过的由 PeakCache 命中）；拿不到 source 时
 * 退回调用方传入的整段概览（waveform prop，100 个整数）。
 *
 * ## 手势契约（别回退）
 *
 * 只有播放头竖线 / 整体进度条拦画布手势（nodrag nopan nowheel）；波形本体放行 ——
 * 否则用户拖不动节点（实测 bug）。底栏按钮由调用方自己标注。
 *
 * ## 拖动出声（搓碟）
 *
 * 拖播放头/进度条时只有手在动才出声：每次指针移动重置一个 60ms 定时器（SCRUB_IDLE_MS），
 * 到点还没再动就暂停；松手恢复"拖之前"的播放/暂停状态。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { progressRatio, ratioFromPointer } from "./audioPlayback"
import { WAVEFORM_MAX, isValidWaveform } from "./waveform"
import { openAudioSource, type AudioSource } from "./audioSource"

const props = withDefaults(
  defineProps<{
    /** 音频地址（URL / dataURL / blob:）；空串时什么都不渲染 */
    url?: string
    /** 调用方存好的整段概览（100 个整数）；拿不到按需 source 时兜底 */
    waveform?: number[]
    /** 已知时长（秒）：元数据到达前先用它显示，避免时间闪 0:00 */
    duration?: number
    /** 紧凑模式（历史卡片）：藏整体进度条行，波形本身就是进度条 */
    compact?: boolean
    /** 每根竖条固定宽度（px）；节点设置可覆盖 */
    barWidth?: number
    /** 波形区最低高度（px）；节点设置可覆盖 */
    waveMinHeight?: number
  }>(),
  { url: "", waveform: undefined, duration: 0, compact: false, barWidth: 2, waveMinHeight: 28 },
)

const barGap = 1
const barPitch = computed(() => props.barWidth + barGap)
/** 波形区的实测宽度（px）；窗口里能放多少根由它决定 */
const waveWidth = ref(0)
/** 默认可视窗口秒数：短于它的音频整条铺满，长于它的按这个窗口滑动 */
const WINDOW_SECONDS = 20

const audioRef = ref<HTMLAudioElement | null>(null)
const waveRef = ref<HTMLElement | null>(null)
const knobRef = ref<HTMLElement | null>(null)
const trackRef = ref<HTMLElement | null>(null)

const ratio = ref(0)
const playing = ref(false)
const current = ref(0)
/** 拖动中冻结的窗口左端（秒）；null = 跟随播放位置 */
const frozenStart = ref<number | null>(null)
/** 解码读出来的时长 */
const decodedDuration = ref(0)
/** 按需算出来的"当前窗口"峰值（0..1 原始振幅；null = 还没算出来） */
const windowPeaks = ref<number[] | null>(null)
/** 上面那批峰值对应的起始格号（与绝对格号对齐，滑动时才不会错位/抖动） */
let windowPeaksFrom = 0

/** 当前音频时长（秒）：优先解码结果，元数据没到之前用调用方给的已知值 */
const duration = computed(() =>
  decodedDuration.value > 0 ? decodedDuration.value : props.duration > 0 ? props.duration : 0,
)

// ==================== 轮播窗口 ====================

/** 可视区能放多少根竖条（固定条宽 → 由实测宽度决定） */
const barCount = computed(() => Math.max(8, Math.floor(Math.max(1, waveWidth.value) / barPitch.value)))

/** 每根竖条代表多少秒：短音频整条铺满，长音频按 WINDOW_SECONDS 的窗口 */
const secondsPerBar = computed(() => {
  const total = duration.value
  if (!(total > 0)) return 0
  // 格子锚在**绝对时间**上 —— 若让每根条跟着窗口左端漂移，同一格每帧显示的采样点
  // 都在变，看起来就是波形原地抖动（实测的"像水波纹一样来回晃荡"）。
  const visibleSeconds = Math.min(total, WINDOW_SECONDS)
  return visibleSeconds / barCount.value
})

const windowSeconds = computed(() => secondsPerBar.value * barCount.value)

const windowStart = computed(() => {
  if (frozenStart.value !== null) return frozenStart.value
  const total = duration.value
  const span = windowSeconds.value
  if (!(total > 0) || span >= total) return 0
  return Math.min(Math.max(0, current.value - span / 2), total - span)
})

/** 时间轴整体平移量（px）：窗口滑到 start 秒，整条就向左移 start 对应的像素 */
const timelineShiftPx = computed(() =>
  secondsPerBar.value > 0 ? -(windowStart.value / secondsPerBar.value) * barPitch.value : 0,
)

/** 当前要画的竖条：**单层**，每根带自己的已播状态与坐标 */
const bars = computed<Array<{ key: number; played: boolean; style: Record<string, string> }>>(() => {
  const total = duration.value
  const perBar = secondsPerBar.value
  if (!(total > 0) || perBar <= 0) return []
  const count = barCount.value
  const start = windowStart.value
  const live = windowPeaks.value
  const stored = props.waveform && isValidWaveform(props.waveform) ? props.waveform : null
  const list: Array<{ key: number; played: boolean; style: Record<string, string> }> = []
  const visible = Math.min(count, Math.max(1, Math.ceil(total / perBar - 1e-6)))
  const firstCell = Math.max(0, Math.floor(start / perBar))
  for (let k = 0; k < visible; k++) {
    const cell = firstCell + k
    const timeSec = cell * perBar
    if (timeSec > total + 1e-6) break
    let value = 0
    if (live && cell >= windowPeaksFrom && cell - windowPeaksFrom < live.length) {
      value = live[cell - windowPeaksFrom] ?? 0
    } else if (stored) {
      const si = Math.min(stored.length - 1, Math.max(0, Math.round((timeSec / total) * (stored.length - 1))))
      value = (stored[si] ?? 0) / WAVEFORM_MAX
    }
    const h = Math.max(2, Math.min(100, value * 100))
    list.push({
      key: cell,
      played: timeSec <= current.value,
      style: {
        left: (cell * barPitch.value).toFixed(2) + "px",
        top: (50 - h / 2).toFixed(2) + "%",
        height: h.toFixed(2) + "%",
      },
    })
  }
  return list
})

const headPct = computed(() => {
  const span = windowSeconds.value
  if (!(span > 0)) return "0%"
  const f = (current.value - windowStart.value) / span
  return (Math.min(1, Math.max(0, f)) * 100).toFixed(4) + "%"
})
const progressPct = computed(() => (Math.min(1, Math.max(0, ratio.value)) * 100).toFixed(4) + "%")

// ==================== 按需峰值 ====================

let source: AudioSource | null = null
let sourceGeneration = 0
let lastPeakRequest = ""

async function refreshWindowPeaks(): Promise<void> {
  const src = source
  if (!src) return
  const span = windowSeconds.value
  const start = windowStart.value
  if (!(span > 0)) return
  const key = start.toFixed(3) + "|" + span.toFixed(3) + "|" + barCount.value
  if (key === lastPeakRequest) return
  lastPeakRequest = key
  const generation = sourceGeneration
  try {
    const perBar = secondsPerBar.value
    const firstCell = Math.max(0, Math.floor(start / perBar))
    const askedFrom = firstCell * perBar
    const askedTo = Math.min(duration.value, askedFrom + span)
    const peaks = await src.peaks(askedFrom, askedTo, barCount.value)
    if (generation !== sourceGeneration) return
    windowPeaksFrom = firstCell
    windowPeaks.value = peaks
  } catch {
    /* 单次取样失败不影响已有画面 */
  }
}

/** 打开（或重开）按需解码源；url 变化与"刷新"都走这里 */
async function openSource(): Promise<void> {
  const generation = ++sourceGeneration
  source?.dispose()
  source = null
  windowPeaks.value = null
  lastPeakRequest = ""
  if (!props.url) return
  const next = await openAudioSource(props.url)
  if (generation !== sourceGeneration) {
    next?.dispose()
    return
  }
  source = next
  if (!next) return
  if (next.duration > 0) decodedDuration.value = next.duration
  void refreshWindowPeaks()
}

// ==================== 播放控制 ====================

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
  void refreshWindowPeaks()
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
  if (!el || !props.url) return
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
  void refreshWindowPeaks()
}

/** 暂停中的位置变化（如进度条 seek 后）也要反映到画面 */
function onTimeUpdate(): void {
  const el = audioRef.value
  if (!el || playing.value) return
  current.value = el.currentTime
  ratio.value = progressRatio(el.currentTime, duration.value)
  void refreshWindowPeaks()
}

function onEnded(): void {
  playing.value = false
  stopLoop()
  current.value = duration.value
  ratio.value = duration.value > 0 ? 1 : 0
}

// ==================== 播放头拖动（轮播窗口 + seek + 搓碟） ====================

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
  const el = audioRef.value
  const wave = waveRef.value
  if (!el || !wave) return
  const rect = wave.getBoundingClientRect()
  const fraction = ratioFromPointer(clientX, rect.left, rect.width)
  const time = windowStart.value + fraction * windowSeconds.value
  const clamped = Math.min(Math.max(0, time), duration.value || time)
  try {
    el.currentTime = clamped
  } catch {
    /* 元数据还没到 / 浏览器拒绝：显示仍跟着手指走 */
  }
  current.value = clamped
  ratio.value = duration.value > 0 ? clamped / duration.value : 0
}

/** 把音频定位到某个绝对时间（整体进度条与边缘滚动共用；不改变播放状态） */
function seekToTime(time: number): void {
  const el = audioRef.value
  const total = duration.value
  const clamped = Math.min(Math.max(0, time), total > 0 ? total : Math.max(0, time))
  if (el) {
    try {
      el.currentTime = clamped
    } catch {
      /* 元数据还没到：只更新显示 */
    }
  }
  current.value = clamped
  ratio.value = total > 0 ? clamped / total : 0
}

/** 整体进度条：指针位置 → 绝对时间（这条是**整条音频**的尺子，与窗口无关） */
function onTrackPointerDown(e: PointerEvent): void {
  if (!props.url) return
  e.stopPropagation()
  e.preventDefault()
  trackSeeking = true
  const el = audioRef.value
  wasPlayingBeforeSeek = !!el && !el.paused
  scrubPaused = false
  if (el) {
    // 与把手一致：拖动期间出声、停手即静音，松手原样恢复
    void el.play().catch(() => {})
    playing.value = true
    startLoop()
  }
  trackRef.value?.setPointerCapture?.(e.pointerId)
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
  trackRef.value?.releasePointerCapture?.(e.pointerId)
  cancelScrubIdle()
  const el = audioRef.value
  if (el) {
    if (wasPlayingBeforeSeek) {
      void el.play().catch(() => {})
      playing.value = true
      startLoop()
    } else {
      el.pause()
      playing.value = false
      stopLoop()
    }
  }
  wasPlayingBeforeSeek = false
  void refreshWindowPeaks()
}

/** 指针横坐标 → 整条音频上的时间 */
function seekByTrackPointer(clientX: number): void {
  const track = trackRef.value
  if (!track) return
  const rect = track.getBoundingClientRect()
  const fraction = ratioFromPointer(clientX, rect.left, rect.width)
  seekToTime(fraction * duration.value)
}

/** 开始一次 seek（播放头与历史卡的整条波形共用同一套逻辑） */
function beginSeek(e: PointerEvent, captureEl: HTMLElement | null): void {
  if (!props.url) return
  e.stopPropagation()
  e.preventDefault()
  // 冻结窗口：否则"窗口跟着播放走"+"指针映射到时间"会形成反馈环（实测进度会飞）
  frozenStart.value = windowStart.value
  seeking = true
  const el = audioRef.value
  wasPlayingBeforeSeek = !!el && !el.paused
  scrubPaused = false
  if (el) {
    void el.play().catch(() => {})
    playing.value = true
    startLoop()
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
  frozenStart.value = null
  stopEdgeScroll()
  cancelScrubIdle()
  const el = audioRef.value
  if (el) {
    // 恢复"拖之前"的状态：原本在播就继续播，原本暂停就回到暂停（用户口径）
    if (wasPlayingBeforeSeek) {
      void el.play().catch(() => {})
      playing.value = true
      startLoop()
    } else {
      el.pause()
      playing.value = false
      stopLoop()
    }
  }
  wasPlayingBeforeSeek = false
  captureEl?.releasePointerCapture?.(e.pointerId)
  void refreshWindowPeaks()
}

function onKnobPointerDown(e: PointerEvent): void {
  beginSeek(e, knobRef.value)
}

function onKnobPointerMove(e: PointerEvent): void {
  moveSeek(e)
}

function onKnobPointerUp(e: PointerEvent): void {
  finishSeek(e, knobRef.value)
}

/**
 * 历史卡（compact）里整条波形都能点/拖：点哪跳哪，按住拖连续 seek。
 * 只在 compact 模式接管 —— 节点里的波形要留给画布拖拽（手势契约，别回退）。
 */
function onWavePointerDown(e: PointerEvent): void {
  if (!props.compact) return
  beginSeek(e, waveRef.value)
  seekTo(e.clientX)
}

function onWavePointerMove(e: PointerEvent): void {
  if (!props.compact) return
  moveSeek(e)
}

function onWavePointerUp(e: PointerEvent): void {
  if (!props.compact) return
  finishSeek(e, waveRef.value)
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
    const el = audioRef.value
    if (el) {
      void el.play().catch(() => {})
      playing.value = true
      startLoop()
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
  const el = audioRef.value
  if (el && !el.paused) {
    el.pause()
    current.value = el.currentTime
    ratio.value = progressRatio(el.currentTime, duration.value)
  }
  playing.value = false
  stopLoop()
  scrubPaused = true
}

/**
 * 边缘滚动：指针拖到可视区左/右边缘时，让**窗口**持续朝那一侧走 ——
 * 一根把手就能控制整条音频，而不是只有可视窗口那一小段。
 */
function runEdgeScroll(): void {
  edgeScrollRaf = 0
  if (!seeking) return
  const wave = waveRef.value
  const total = duration.value
  const span = windowSeconds.value
  if (!wave || !(total > 0) || !(span > 0) || span >= total) return
  const rect = wave.getBoundingClientRect()
  const left = rect.left + EDGE_ZONE_PX
  const right = rect.right - EDGE_ZONE_PX
  let step = 0
  if (pointerClientX < left) step = -EDGE_SCROLL_SECONDS_PER_FRAME
  else if (pointerClientX > right) step = EDGE_SCROLL_SECONDS_PER_FRAME
  if (step !== 0) {
    const from = frozenStart.value ?? windowStart.value
    const next = Math.min(Math.max(0, from + step), Math.max(0, total - span))
    if (Math.abs(next - from) > 1e-6) {
      frozenStart.value = next
      // 窗口在滚：把播放位置也带到窗口中心附近，松手时落点才跟得上画面
      const target = Math.min(total, Math.max(0, next + span / 2))
      const el = audioRef.value
      if (el) {
        try {
          el.currentTime = target
        } catch {
          /* 元数据还没到：只滚窗口 */
        }
      }
      current.value = target
      ratio.value = total > 0 ? target / total : 0
      lastPeakRequest = ""
      void refreshWindowPeaks()
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

// ==================== 生命周期 ====================

let observer: ResizeObserver | null = null

/** 量一次波形区宽度（固定条宽 → 根数由它算出来） */
function measure(): void {
  const el = waveRef.value
  if (!el) return
  // 用 clientWidth（布局像素）而不是 getBoundingClientRect：后者含画布缩放，
  // 而条宽是布局像素 —— 两者混用会让"能放多少根"算错（实测波形只铺到一部分）。
  const w = el.clientWidth
  if (Number.isFinite(w) && w > 0 && Math.abs(w - waveWidth.value) > 0.5) {
    waveWidth.value = w
    lastPeakRequest = ""
    void refreshWindowPeaks()
  }
}

onMounted(() => {
  measure()
  // 再量一次：挂载这一帧宽度可能还没定下来（卡片尺寸是异步落位的）
  void nextTick(() => {
    measure()
    requestAnimationFrame(() => measure())
  })
  void openSource()
})

watch(
  () => props.url,
  () => {
    current.value = 0
    ratio.value = 0
    playing.value = false
    decodedDuration.value = 0
    stopLoop()
    void openSource()
  },
)

/** 波形元素出现时才量得到宽度（先建卡片、音频后写进来的场景靠它） */
watch(
  waveRef,
  (el) => {
    observer?.disconnect()
    observer = null
    if (!el) return
    measure()
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => measure())
      observer.observe(el)
    }
  },
  { flush: "post" },
)

/** 跟随播放位置时，窗口一变就补算新进入可视区的峰值（拖动中窗口冻结，不重算） */
watch([windowStart, barCount], () => {
  if (!seeking) void refreshWindowPeaks()
})

onBeforeUnmount(() => {
  stopLoop()
  stopEdgeScroll()
  cancelScrubIdle()
  observer?.disconnect()
  sourceGeneration++
  source?.dispose()
  source = null
})

/** 对调用方公开：播放态（defineExpose 会自动解包 ref）+ 播放/暂停 + 重开解码源 */
defineExpose({
  playing,
  current,
  duration,
  togglePlay,
  reload: openSource,
})
</script>

<template>
  <div class="awp-root" :class="{ 'is-playing': playing }">
    <audio
      v-if="url"
      ref="audioRef"
      class="awp-audio"
      :src="url"
      preload="metadata"
      @loadedmetadata="onLoadedMetadata"
      @timeupdate="onTimeUpdate"
      @ended="onEnded"
      @pause="playing = false"
    />

    <!-- 波形：**只有一条**。整条时间轴按轮播方式向左平移，可视区只是一扇窗。
         每根竖条自己带 is-played —— 播放头左边的染主题色，右边保持灰。 -->
    <div
      ref="waveRef"
      class="aw-wave"
      :class="{ 'is-empty': !bars.length, 'is-compact': compact }"
      :style="{ minHeight: waveMinHeight + 'px', '--aw-bar-width': barWidth + 'px' }"
      @pointerdown="onWavePointerDown"
      @pointermove="onWavePointerMove"
      @pointerup="onWavePointerUp"
      @pointercancel="onWavePointerUp"
    >
      <div
        v-if="bars.length"
        class="aw-timeline"
        :style="{ transform: 'translateX(' + timelineShiftPx + 'px)' }"
      >
        <span
          v-for="b in bars"
          :key="b.key"
          class="aw-wave-bar"
          :class="{ 'is-played': b.played }"
          :style="b.style"
        />
      </div>
      <span v-else class="aw-hint">波形分析中…</span>

      <!-- 播放头：一条贯穿整个波形高度的竖线。它同时是**唯一**的拖拽 seek 入口 -->
      <span
        v-if="bars.length"
        ref="knobRef"
        class="aw-knob nodrag nopan nowheel"
        :style="{ left: headPct }"
        title="拖动调整播放进度"
        @pointerdown="onKnobPointerDown"
        @pointermove="onKnobPointerMove"
        @pointerup="onKnobPointerUp"
        @pointercancel="onKnobPointerUp"
      />
    </div>

    <!-- 整体进度条：控制**整条音频**的进度（波纹只看得见一小段窗口）。
         它和播放头是两条不同的尺子：这条是全局比例，波纹上那条是窗口内位置。 -->
    <div
      v-if="!compact"
      ref="trackRef"
      class="aw-progress nodrag nopan nowheel"
      role="slider"
      tabindex="0"
      aria-label="整体播放进度"
      :aria-valuemin="0"
      :aria-valuemax="Math.round(duration)"
      :aria-valuenow="Math.round(current)"
      title="拖动调整整体进度"
      @pointerdown="onTrackPointerDown"
      @pointermove="onTrackPointerMove"
      @pointerup="onTrackPointerUp"
      @pointercancel="onTrackPointerUp"
    >
      <span class="aw-progress-rail" />
      <span class="aw-progress-fill" :style="{ width: progressPct }" />
      <span class="aw-progress-thumb" :style="{ left: progressPct }" />
    </div>
  </div>
</template>

<style scoped>
.awp-root {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  width: 100%;
}

/* audio 元素只用于解码播放，本身不显示（画面全由波形构成） */
.awp-audio {
  display: none;
}

/* 波形区 = 可视窗口。窗口本身不动，动的是里面那条时间轴（轮播图模型） */
.aw-wave {
  position: relative;
  flex: 1 1 auto;
  width: 100%;
  min-height: 24px;
  overflow: hidden;
  touch-action: none;
}

/* 紧凑模式（历史卡）：整条波形是 seek 区，给个手型提示 */
.aw-wave.is-compact {
  cursor: pointer;
}

.aw-timeline {
  position: absolute;
  inset: 0;
  will-change: transform;
}

/* 每根竖条：宽度固定（--aw-bar-width），定位在时间轴坐标上 */
.aw-wave-bar {
  position: absolute;
  top: 0;
  bottom: 0;
  width: var(--aw-bar-width, 2px);
  border-radius: 1px;
  background: var(--canvas-node-text-muted, #9ca3af);
  opacity: 0.7;
  transition: background 0.18s ease, opacity 0.18s ease;
}
.aw-wave-bar.is-played {
  background: var(--ui-accent, #0891b2);
  opacity: 1;
}

/* hover 到波形上：**只提亮波形本身，不铺灰底**（用户明确不喜欢那块灰背景） */
.aw-wave:hover .aw-wave-bar {
  background: var(--canvas-node-text, #6b7280);
  opacity: 0.95;
}
.aw-wave:hover .aw-wave-bar.is-played {
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 78%, var(--ui-panel, #ffffff));
}

/* 播放头：贯穿整个波形高度的竖线，也是唯一能拖的"滑块" */
.aw-knob {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 14px;
  margin-left: -7px;
  cursor: grab;
  touch-action: none;
}
.aw-knob::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 3px;
  margin-left: -1.5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--canvas-node-text-strong, #111827) 28%, transparent);
  /*
   * 平时：就是一条半透明的线，不画边框、不用阴影。
   * 不要用 border 做高亮：全局 border-box 会把边框从线宽里扣掉，hover 反而变细；
   * 高亮一律走 outline —— 它画在盒子外面，线宽永远不变。
   */
  outline: 1px solid transparent;
  outline-offset: 0;
  transition: background 0.18s ease, outline-color 0.18s ease;
}
.aw-knob:hover::after,
.aw-knob:active::after {
  background: var(--ui-accent, #0891b2);
  outline-color: var(--ui-panel, #ffffff);
}
.aw-knob:active {
  cursor: grabbing;
}

/* 播放中：已播部分轻微呼吸（唯一允许的循环动画；只动 opacity，不动几何） */
.is-playing .aw-wave-bar.is-played {
  animation: aw-breathe 1.6s ease-in-out infinite;
}
@keyframes aw-breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.72;
  }
}

.aw-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--canvas-node-text-muted, #9ca3af);
  font-size: 12px;
}

/* 整体进度条：一条细轨 + 已播填充 + 圆点把手（整条音频的全局比例） */
.aw-progress {
  position: relative;
  flex: none;
  width: 100%;
  height: 14px;
  cursor: pointer;
  touch-action: none;
}
.aw-progress:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 2px;
  border-radius: 999px;
}
.aw-progress-rail {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 3px;
  margin-top: -1.5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--canvas-node-text-muted, #9ca3af) 45%, transparent);
}
.aw-progress-fill {
  position: absolute;
  left: 0;
  top: 50%;
  height: 3px;
  margin-top: -1.5px;
  border-radius: 999px;
  background: var(--ui-accent, #0891b2);
  pointer-events: none;
}
.aw-progress-thumb {
  position: absolute;
  top: 50%;
  width: 9px;
  height: 9px;
  margin: -4.5px 0 0 -4.5px;
  border-radius: 999px;
  background: var(--ui-panel, #ffffff);
  border: 2px solid var(--ui-accent, #0891b2);
  pointer-events: none;
  transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.aw-progress:hover .aw-progress-thumb {
  transform: scale(1.15);
}

@media (prefers-reduced-motion: reduce) {
  .is-playing .aw-wave-bar.is-played {
    animation: none;
  }
  .aw-knob::after {
    transition: none;
  }
}
</style>
