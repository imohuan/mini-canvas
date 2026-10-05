<script setup lang="ts">
/**
 * AudioContent —— audio 节点的内容段：波形（当进度条用）+ 播放控件。
 *
 * ## 波形的画法（用户口径，别再改回去）
 *
 * **从头到尾只有一条波形**。进度条做的事只有一件：把播放位置**左边**那些竖条染成主题色，
 * 右边保持灰。竖条**只有一层**，每根自己带 is-played（已播）标记 ——
 * 曾经写成"两层波形叠放、上层按进度宽度裁切"，上层容器一变窄，里面按百分比定位的竖条
 * 就被横向压扁，看起来像"又拉出来一条波纹"（用户实测截图报的 bug）。
 *
 * ## 滑动（轮播图模型）
 *
 * 时间轴是一长条，卡片的可视区只是它的一扇窗。播放/拖动时**整条时间轴向左平移**，
 * 于是可视区里的波形内容随之滑动 —— 就是轮播图那种手感：窗口不动，内容在动。
 * 平移量 = 窗口左端对应的像素位置（timelineShiftPx）。
 *
 * 每根竖条的宽度**固定**（barWidth px，从设置读），所以"窗口里有多少根"=
 * 容器宽度 ÷ 条距，窗口数学与缩放无关（这也是按需算峰值的前提）。
 *
 * ## 按需算峰值（长音频才扛得住）
 *
 * 1 小时的音频不可能一上来就整段解码。所以：
 * - 只算**可视窗口那一段**的峰值（audioSource.peaks(startSec, endSec, bars)）；
 * - 播放中窗口平移，新进入可视区的部分才算（算过的由 PeakCache 命中，不重复算）；
 * - 拿不到 source（跨域 / 非浏览器 / 解码失败）时退回节点上已存好的整段概览
 *   （data.audioWaveform，100 个整数，向后兼容旧存档）。
 *
 * ## 手势契约（别回退）
 *
 * 只有「播放按钮 / 刷新按钮 / 播放头竖线」拦画布手势（nodrag nopan nowheel）；
 * 波形本体、时间文字、文件名、控制条本体一律放行 —— 否则用户拖不动节点（实测 bug）。
 *
 * ## 拖动出声（第十一轮口径）
 *
 * 拖播放头/进度条时**只有手在动才出声**：按下开始播，每次指针移动就把一个 60ms 的
 * 定时器重置（`SCRUB_IDLE_MS`），到点还没再动就暂停 —— 声音、播放头、时间轴一起停。
 * 相当于给"出声"做了节流：拖动中一直响，手一停就静音，按住不放也不会自己往前溜。
 * 松手仍按"拖之前是播是停"恢复（用户口径）。
 *
 * 会话态（播放位置 / 是否播放中 / 拖动中冻结的窗口）只存内存，不写库、不进撤销栈。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useCanvasRender } from "@mini-canvas/canvas-render"
import { formatClock, progressRatio, ratioFromPointer } from "./audioPlayback"
import { WAVEFORM_MAX, isValidWaveform } from "./waveform"
import { createAudioOps, defaultTransform, ensureAudioMeta, reanalyzeAudio, uploadAudio } from "./audioOps"
import { openAudioSource, type AudioSource } from "./audioSource"

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()

/** 每根竖条的固定宽度（px）与条距 —— 固定宽度是"轮播窗口"能算准的前提 */
const barWidth = ref(2)
const barGap = 1
const barPitch = computed(() => barWidth.value + barGap)
/** 波形区的实测宽度（px）；窗口里能放多少根由它决定 */
const waveWidth = ref(0)
/** 默认可视窗口秒数：短于它的音频整条铺满，长于它的按这个窗口滑动 */
const WINDOW_SECONDS = 20
/** 波形区最低高度（实际高度由 flex 撑满卡片剩余空间，不留空带） */
const waveMinHeight = ref(28)

const audioRef = ref<HTMLAudioElement | null>(null)
const waveRef = ref<HTMLElement | null>(null)
const knobRef = ref<HTMLElement | null>(null)
const trackRef = ref<HTMLElement | null>(null)
const fileRef = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const refreshing = ref(false)

const audioUrl = computed(() => (typeof props.data?.audioUrl === "string" ? props.data.audioUrl : ""))
const audioName = computed(() => (typeof props.data?.audioName === "string" ? props.data.audioName : ""))
/** 节点上存下来的整段概览（100 个整数）；没有按需 source 时用它兜底，旧存档也靠它 */
const storedWaveform = computed<number[] | null>(() =>
  isValidWaveform(props.data?.audioWaveform) ? props.data.audioWaveform : null,
)
/** 按需算出来的"当前窗口"峰值（0..1 原始振幅；null = 还没算出来） */
const windowPeaks = ref<number[] | null>(null)
/** 上面那批峰值对应的**起始格号**（与绝对格号对齐，滑动时才不会错位/抖动） */
let windowPeaksFrom = 0

const ratio = ref(0)
const playing = ref(false)
const current = ref(0)
/** 拖动中冻结的窗口左端（秒）；null = 跟随播放位置 */
const frozenStart = ref<number | null>(null)
/** 解码读出来的时长（节点上没记时用它） */
const decodedDuration = ref(0)

/** 当前音频时长（秒）：优先节点上记的，其次解码/元数据读到的 */
const duration = computed(() => {
  const stored = typeof props.data?.audioDuration === "number" ? props.data.audioDuration : 0
  return stored > 0 ? stored : decodedDuration.value
})

// ==================== 轮播窗口 ====================

/** 可视区能放多少根竖条（固定条宽 → 由实测宽度决定） */
const barCount = computed(() => Math.max(8, Math.floor(Math.max(1, waveWidth.value) / barPitch.value)))

/** 每根竖条代表多少秒：短音频整条铺满，长音频按 WINDOW_SECONDS 的窗口 */
const secondsPerBar = computed(() => {
  const total = duration.value
  if (!(total > 0)) return 0
  // 每根条的秒数**固定**（短音频铺满整条，长音频按 20 秒窗口），
  // 且格子锚在**绝对时间**上 —— 若让每根条跟着窗口左端漂移，同一格每帧显示的采样点
  // 都在变，看起来就是波形原地抖动（实测的"像水波纹一样来回晃荡"）。
  const visibleSeconds = Math.min(total, WINDOW_SECONDS)
  return visibleSeconds / barCount.value
})

/** 窗口总宽度（秒） */
const windowSeconds = computed(() => secondsPerBar.value * barCount.value)

/** 窗口左端（秒）：拖动中用冻结的，否则让播放位置居中，并夹在 [0, duration - windowSeconds] */
const windowStart = computed(() => {
  if (frozenStart.value !== null) return frozenStart.value
  const total = duration.value
  const span = windowSeconds.value
  if (!(total > 0) || span >= total) return 0
  return Math.min(Math.max(0, current.value - span / 2), total - span)
})

/**
 * 时间轴整体平移了多少像素（轮播图的核心）。
 *
 * 时间轴上"第 0 秒"原本在最左边；窗口滑到 start 秒后，整条要向左移 start 对应的像素，
 * 于是可视区里露出来的就是 [start, start + windowSeconds] 这一段。
 */
const timelineShiftPx = computed(() =>
  secondsPerBar.value > 0 ? -(windowStart.value / secondsPerBar.value) * barPitch.value : 0,
)

/**
 * 当前要画的竖条：**单层**，每根带自己的已播状态与坐标。
 *
 * 定位一律用"这根条代表哪个时刻"，所以滑动与染色天然一致：
 * 左端 = 该时刻在时间轴上的像素位置（再靠父层整体平移对齐窗口）。
 */
const bars = computed<Array<{ key: number; played: boolean; style: Record<string, string> }>>(() => {
  const total = duration.value
  const perBar = secondsPerBar.value
  if (!(total > 0) || perBar <= 0) return []
  const count = barCount.value
  const start = windowStart.value
  const live = windowPeaks.value
  const stored = storedWaveform.value
  const list: Array<{ key: number; played: boolean; style: Record<string, string> }> = []
  // 可视区最多能放 count 根；整条音频有多少格就是多少格
  const visible = Math.min(count, Math.max(1, Math.ceil(total / perBar - 1e-6)))
  // 窗口覆盖到的**绝对格号**：格子锚在时间轴上，滑动时格子不动、整条平移
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
      // 两种数据源量纲不同：按需结果是 0..1 原始振幅，已存概览是 1..100 百分比 → 统一成 0..1
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

/** 播放头在可视区里的位置（%）：当前播放位置在窗口内的相对位置 */
const headPct = computed(() => {
  const span = windowSeconds.value
  if (!(span > 0)) return "0%"
  const f = (current.value - windowStart.value) / span
  return (Math.min(1, Math.max(0, f)) * 100).toFixed(4) + "%"
})
/** 整体进度（%）：给下方那条普通进度条用 —— 它是**整条音频**的比例，不受窗口影响 */
const progressPct = computed(() => (Math.min(1, Math.max(0, ratio.value)) * 100).toFixed(4) + "%")

// ==================== 按需峰值（只算可视窗口那一段） ====================

let source: AudioSource | null = null
let sourceGeneration = 0
/** 上一次请求的窗口特征，用来避免同一窗口重复发起解码 */
let lastPeakRequest = ""

/**
 * 只算当前可视窗口那一段的峰值。
 *
 * 为什么要去重：播放中每帧都会调到这里，而窗口在一次"每根条"的跨度内是不变的 ——
 * 不去重就会每帧发起一次解码（PeakCache 虽会命中，但请求本身的开销不该有）。
 */
async function refreshWindowPeaks(): Promise<void> {
  const src = source
  // 注意：**拖动中也要继续补算**（边缘滚动会不断把新区域带进可视区），
  // 只是拖动时不重算"已经算过的那一窗"（靠下面的 key 去重）。
  if (!src) return
  const span = windowSeconds.value
  const start = windowStart.value
  if (!(span > 0)) return
  const key = start.toFixed(3) + "|" + span.toFixed(3) + "|" + barCount.value
  if (key === lastPeakRequest) return
  lastPeakRequest = key
  const generation = sourceGeneration
  try {
    // 请求时用"绝对格号"对齐：算出来的第 0 个值对应 firstCell 那一格，
    // 这样格子锚在时间轴上（滑动时格子不动），不会因为窗口左端是小数而整体错位。
    const perBar = secondsPerBar.value
    const firstCell = Math.max(0, Math.floor(start / perBar))
    const askedFrom = firstCell * perBar
    const askedTo = Math.min(duration.value, askedFrom + span)
    const peaks = await src.peaks(askedFrom, askedTo, barCount.value)
    if (generation !== sourceGeneration || seeking) return
    windowPeaksFrom = firstCell
    windowPeaks.value = peaks
  } catch {
    /* 单次取样失败不影响已有画面：留着上一次的窗口峰值 */
  }
}

async function openSource(): Promise<void> {
  const generation = ++sourceGeneration
  source?.dispose()
  source = null
  windowPeaks.value = null
  lastPeakRequest = ""
  if (!audioUrl.value) return
  const next = await openAudioSource(audioUrl.value)
  if (generation !== sourceGeneration) {
    next?.dispose()
    return
  }
  source = next
  if (!next) return
  if (!(duration.value > 0) && next.duration > 0) decodedDuration.value = next.duration
  void refreshWindowPeaks()
}

// ==================== 播放控制 ====================

let rafId = 0
let settingsOff: (() => void) | null = null
/** 波形区的尺寸观察器：元素出现/宽度变化时重新测量 */
let observer: ResizeObserver | null = null

/** 读一次设置（波形最低高度 / 竖条宽度）—— 缺设置服务时保持默认，不抛错 */
function readSettings(): void {
  const settings = ctx.tryGet<{ get(key: string): unknown }>("settings")
  if (!settings || typeof settings.get !== "function") return
  const h = Number(settings.get("audioWaveHeight"))
  if (Number.isFinite(h) && h > 0) waveMinHeight.value = h
  const w = Number(settings.get("audioBarMinWidth"))
  if (Number.isFinite(w) && w > 0) barWidth.value = w
}

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
  if (!el || !audioUrl.value) return
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
  decodedDuration.value = Number.isFinite(el.duration) ? el.duration : 0
  void refreshWindowPeaks()
}

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

// ==================== 拖拽 seek ====================

/**
 * 拖拽 seek：**唯一**入口是播放头那条竖线（按住它左右拖）。
 * 波形本体不接拖拽 —— 那是节点拖动区，接了用户就拖不动节点。
 */
let seeking = false
/** 拖动前是否正在播放：松手后只在这种情况下才恢复播放（暂停状态拖完不该自己响起来） */
let wasPlayingBeforeSeek = false
/** 是否正在拖那条整体进度条 */
let trackSeeking = false
/** 拖动中指针在容器内的横向位置（不夹取）：用来判断是否进入边缘滚动区 */
let pointerClientX = 0
/** 边缘滚动区宽度（px）：指针进到这个范围里，波纹就往那一侧滚 */
const EDGE_ZONE_PX = 28
/** 边缘滚动的每帧推进量（秒/帧）—— 与帧率无关地按 60fps 折算 */
const EDGE_SCROLL_SECONDS_PER_FRAME = 0.12
let edgeScrollRaf = 0

/**
 * 拖动出声的节流窗口（毫秒）：每次指针移动就重置这个定时器，到点还没再动就暂停。
 *
 * 用户口径（第十一轮）："只有拖拽、移动进度的时候才播放，停下立马暂停" ——
 * 连续拖动时移动事件每帧都来，定时器不断被打断，于是一直出声；手一停，约 60ms 后就静音。
 * 60ms 是用户给的数：短到听得出手停了，又长到不会在拖动中误停。
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

/** 把音频定位到某个绝对时间（整体进度条与边缘滚动共用；不改变播放/静音状态） */
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
  if (!audioUrl.value) return
  e.stopPropagation()
  e.preventDefault()
  trackSeeking = true
  const el = audioRef.value
  wasPlayingBeforeSeek = !!el && !el.paused
  scrubPaused = false
  if (el) {
    // 与把手一致：拖动期间出声、停手即静音，松手原样恢复（拖前是播就继续播、是停就回到停）
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

function onKnobPointerDown(e: PointerEvent): void {
  if (!audioUrl.value) return
  e.stopPropagation()
  e.preventDefault()
  // 冻结窗口：否则"窗口跟着播放走"+"指针映射到时间"会形成反馈环（实测进度会飞）
  frozenStart.value = windowStart.value
  seeking = true
  // 拖动**期间**要能听到声音（用户要的"搓碟"手感）：按下先出声。
  // 但**不能靠"一直在播"**（第十一轮口径）：按住不放、指针却停住时若音频还在播，
  // 播放头会自己往前溜、跟手指脱节；所以下面安排"停手判定"，指针一停就暂停。
  // 另外记下"拖之前是播是停"，松手时**原样恢复**（用户明确的口径）。
  const el = audioRef.value
  wasPlayingBeforeSeek = !!el && !el.paused
  scrubPaused = false
  if (el) {
    void el.play().catch(() => {})
    playing.value = true
    startLoop()
  }
  pointerClientX = e.clientX
  knobRef.value?.setPointerCapture?.(e.pointerId)
  startEdgeScroll()
  armScrubIdleTimer()
}

function onKnobPointerMove(e: PointerEvent): void {
  if (!seeking) return
  e.stopPropagation()
  pointerClientX = e.clientX
  // 手指动了 → 恢复出声（若停手时被暂停过）并把停手定时器往后推一格
  noteScrubActivity()
  seekTo(e.clientX)
}

function onKnobPointerUp(e: PointerEvent): void {
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
  knobRef.value?.releasePointerCapture?.(e.pointerId)
  void refreshWindowPeaks()
}

/**
 * 拖动出声的节流：拖动时每次指针移动都重置这个定时器，到点自动暂停。
 *
 * 这是用户的口径：不关心"停了多久"，只关心"还在拖吗" —— 拖的时候一直响（定时器
 * 每帧被打断），手一停约 60ms 就静音。声音、播放头、时间轴同时停住，不会自己往前溜。
 */
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

/** 停手了：暂停播放（声音、播放头、时间轴一起停），下次移动再恢复 */
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
 * 边缘滚动：指针拖到可视区左/右边缘时，让**窗口**持续朝那一侧走，
 * 于是波纹自己滚起来 —— 这样一根把手就能控制整条音频，而不是只有可视窗口那一小段。
 *
 * 用 rAF 逐帧推进（指针停住也继续滚），松手/卸载时立刻取消。
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

// ==================== 上传 / 刷新 ====================

const ops = createAudioOps(ctx)

async function onPickFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files && input.files[0]
  input.value = ""
  if (!file || uploading.value) return
  uploading.value = true
  try {
    await uploadAudio(ops, props.id, file, defaultTransform, async (blob) => {
      // 存进宿主资源库（本地 IndexedDB / 云端画布文件夹，由当前 adapter 决定）
      const resources = ctx.tryGet<{ put(b: Blob, o?: { kind?: string; name?: string }): Promise<string> }>("resources")
      if (!resources) return undefined
      return resources.put(blob, { kind: "audio", ...(blob instanceof File && blob.name ? { name: blob.name } : {}) })
    })
  } finally {
    uploading.value = false
  }
}

function openPicker(): void {
  fileRef.value?.click()
}

/** 刷新：重新分析一次（重算整段概览 + 重建按需 source） */
async function refreshMeta(): Promise<void> {
  if (refreshing.value || !audioUrl.value) return
  refreshing.value = true
  try {
    await reanalyzeAudio(ops, props.id, defaultTransform)
    await openSource()
  } finally {
    refreshing.value = false
  }
}

// ==================== 生命周期 ====================

/** 量一次波形区宽度（固定条宽 → 根数由它算出来） */
function measure(): void {
  const el = waveRef.value
  if (!el) return
  // 用 clientWidth（布局像素）而不是 getBoundingClientRect：后者含画布缩放，
  // 而条宽是布局像素 —— 两者混用会让"能放多少根"算错，波形只铺到卡片一部分就没了。
  const w = el.clientWidth
  if (Number.isFinite(w) && w > 0 && Math.abs(w - waveWidth.value) > 0.5) {
    waveWidth.value = w
    lastPeakRequest = ""
    void refreshWindowPeaks()
  }
}

onMounted(() => {
  readSettings()
  measure()
  // 再量一次：挂载这一帧宽度可能还没定下来（卡片尺寸是异步落位的）
  void nextTick(() => {
    measure()
    requestAnimationFrame(() => measure())
  })
  const settings = ctx.tryGet<{ onChange(cb: () => void): { dispose(): void } }>("settings")
  const off = settings?.onChange?.(() => {
    readSettings()
    lastPeakRequest = ""
    void refreshWindowPeaks()
  })
  settingsOff = () => {
    observer?.disconnect()
    off?.dispose()
  }
  void ensureAudioMeta(ops, props.id, defaultTransform)
  void openSource()
})

onBeforeUnmount(() => {
  stopLoop()
  stopEdgeScroll()
  cancelScrubIdle()
  settingsOff?.()
  observer?.disconnect()
  sourceGeneration++
  source?.dispose()
  source = null
})

watch(
  () => audioUrl.value,
  () => {
    current.value = 0
    ratio.value = 0
    void openSource()
    // ★ 音频地址一变就**强制重算**波形与时长（用户口径："检测到播放地址发生变化就自动刷新"）。
    //   - 节点先建、音频后写入（web2api/后台生成）：挂载时 audioUrl 还是空的，ensureAudioMeta 直接 return，
    //     之后再没人补 → "波形不显示，点刷新才出来"；
    //   - 先上传本地音频、再用 API 生成覆盖：新地址写进来了，但节点上还留着**上一段**的波形，
    //     而 ensureAudioMeta 见"波形+时长都在"会跳过 → 画的是旧音频的波形。
    //   两种都靠"地址变了就重算"根治：reanalyzeAudio 无条件按**当前地址**重新解码并覆盖。
    if (audioUrl.value) void reanalyzeAudio(ops, props.id, defaultTransform)
  },
)

/**
 * 波形元素**出现时**才量得到宽度 —— 这一条是必需的，不是保险。
 *
 * 节点常常是"先建出来、音频随后才写进去"（web2api 生成、后台/MCP 建节点都是这样）：
 * 挂载那一刻 audioUrl 还是空的，整个波形子树根本没渲染，所以挂载时量不到宽度；
 * 等音频到位、元素出现时若不再测一次，宽度就一直是 0 —— 条数退化成保底值，
 * 波形只铺满卡片最左边一小撮（实测就是这个现象）。
 */
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
);

/** 跟随播放位置时，窗口一变就补算新进入可视区的峰值（拖动中窗口冻结，不重算） */
watch([windowStart, barCount], () => {
  if (!seeking) void refreshWindowPeaks()
})
</script>

<template>
  <div class="audio-node" :class="{ 'is-playing': playing }">
    <input ref="fileRef" class="aw-file" type="file" accept="audio/*" @change="onPickFile" />
    <audio
      v-if="audioUrl"
      ref="audioRef"
      class="aw-audio"
      :src="audioUrl"
      preload="metadata"
      @loadedmetadata="onLoadedMetadata"
      @timeupdate="onTimeUpdate"
      @ended="onEnded"
      @pause="playing = false"
    />

    <div v-if="audioUrl" class="aw-root">
      <!-- 波形：**只有一条**。整条时间轴按轮播方式向左平移，可视区只是一扇窗。
           每根竖条自己带 is-played —— 播放头左边的染主题色，右边保持灰。 -->
      <div
        ref="waveRef"
        class="aw-wave"
        :class="{ 'is-empty': !bars.length }"
        :style="{ minHeight: waveMinHeight + 'px', '--aw-bar-width': barWidth + 'px' }"
      >
        <!-- 时间轴：一条长条，靠 transform 平移（轮播图那种"内容在动、窗口不动"） -->
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

      <!-- 整体进度条：普通进度条的样子，控制**整条音频**的进度（波纹只看得见一小段窗口）。
           它和播放头是两条不同的尺子：这条是全局比例，波纹上那条是窗口内位置。 -->
      <div
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

      <!-- 播放控件：**只有按钮**才拦画布手势（nodrag/nopan/nowheel）——
           整条都拦的话，时间/文件名这些"死"元素也拖不动节点了（用户实测反馈）。 -->
      <div class="aw-bar">
        <button
          class="aw-btn nodrag nopan nowheel"
          type="button"
          :title="playing ? '暂停' : '播放'"
          :aria-label="playing ? '暂停' : '播放'"
          @click.stop="togglePlay"
        >
          <svg v-if="!playing" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <polygon points="7,4 19,12 7,20" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        </button>
        <span class="aw-time">{{ formatClock(current) }} / {{ formatClock(duration) }}</span>
        <span v-if="audioName" class="aw-name" :title="audioName">{{ audioName }}</span>
        <button
          class="aw-btn aw-btn-ghost nodrag nopan nowheel"
          type="button"
          title="刷新波形与时长"
          aria-label="刷新"
          :disabled="refreshing"
          @click.stop="refreshMeta"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <polyline points="3 4 3 10 9 10" />
          </svg>
        </button>
      </div>
    </div>

    <div v-else class="audio-empty">
      <svg
        class="audio-empty-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M3 10v4" />
        <path d="M7 6v12" />
        <path d="M11 3v18" />
        <path d="M15 7v10" />
        <path d="M19 10v4" />
      </svg>
      <span class="audio-empty-text">（无音频）</span>
      <button
        class="aw-btn aw-btn-upload"
        type="button"
        title="上传音频"
        aria-label="上传音频"
        :disabled="uploading"
        @click.stop="openPicker"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span class="aw-btn-text">上传音频</span>
      </button>
    </div>
  </div>
</template>
<style scoped>
.audio-node {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 10px 12px;
  gap: 6px;
  overflow: hidden;
  color: var(--canvas-node-text-body, #374151);
}

/* audio 元素只用于解码播放，本身不显示（画面全由波形与控件构成） */
.aw-audio {
  display: none;
}
/* 文件选择器同样不显示：点按钮时由脚本 click 它 */
.aw-file {
  display: none;
}

.aw-root {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  height: 100%;
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

/* 时间轴：一条比窗口长的时间线，靠 transform 平移实现"滑动" */
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
/* 已播：播放头**左边**的那些条 —— 进度条唯一做的事就是给它们换颜色 */
.aw-wave-bar.is-played {
  background: var(--ui-accent, #0891b2);
  opacity: 1;
}

/*
 * hover 到波形上：**只提亮波形本身，不铺灰底**（用户明确不喜欢那块灰背景）。
 * 未播的灰往亮走一档，已播的主题色再亮一点点。
 */
.aw-wave:hover .aw-wave-bar {
  background: var(--canvas-node-text, #6b7280);
  opacity: 0.95;
}
.aw-wave:hover .aw-wave-bar.is-played {
  /* 与主题色混白提亮：白用 token 给（--ui-panel 在两个主题下都是白），不写裸色值 */
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
   *
   * **不要用 border 做高亮**：全局是 box-sizing:border-box，1px 边框会从这 3px 线宽里扣掉，
   * 一到 hover 线反而变细（实测用户反馈"选中它宽度反而变小"）。
   * 所以高亮一律走 outline —— 它画在盒子**外面**，线宽永远不变。
   */
  outline: 1px solid transparent;
  outline-offset: 0;
  transition: background 0.18s ease, outline-color 0.18s ease;
}
.aw-knob:hover::after,
.aw-knob:active::after {
  /* hover / 拖动高亮：线体换主题色 + 外面套一圈描边（线宽保持 3px 不变） */
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

/*
 * 整体进度条（波纹下面那条）：普通进度条的样子 —— 一条细轨 + 已播填充 + 圆点把手。
 * 它显示的是**整条音频**的比例；波纹上那条只会显示窗口内那一段。
 */
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
/* 轨道：始终可见的细线（半透明前景色，深浅主题都看得见） */
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
/* 已播：主题色（用户改品牌色时跟着变） */
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
/* 圆点把手：小圆点，拖到哪指到哪 */
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

/* —— 控件条 —— */
.aw-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: none;
}
.aw-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
  color: var(--canvas-node-text-body, #374151);
  cursor: pointer;
  transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.18s ease;
}
.aw-btn:hover {
  background: var(--ui-hover, rgb(0 0 0 / 0.06));
}
.aw-btn:active {
  transform: scale(0.97);
}
.aw-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 1px;
}
.aw-btn svg {
  width: 14px;
  height: 14px;
}
/* 刷新：贴着时间行右侧，弱化处理（次要动作，不抢播放按钮） */
.aw-btn-ghost {
  margin-left: auto;
  background: transparent;
  color: var(--canvas-node-text-muted, #8c95a3);
}
.aw-btn-ghost:hover {
  background: var(--ui-hover, rgb(0 0 0 / 0.06));
  color: var(--canvas-node-text-body, #374151);
}
/* 空态的上传按钮：带文字，是这条空态的唯一出路 */
.aw-btn-upload {
  width: auto;
  gap: 6px;
  padding: 0 10px;
  height: 28px;
}
.aw-btn-text {
  font-size: 12px;
}

.aw-time {
  flex: none;
  color: var(--canvas-node-text-muted, #8c95a3);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.aw-name {
  overflow: hidden;
  color: var(--canvas-node-text-muted, #8c95a3);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* —— 空态 —— */
.audio-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--canvas-node-text-muted, #9ca3af);
  font-size: 12px;
  text-align: center;
}
.audio-empty-icon {
  width: 22px;
  height: 22px;
}

@media (prefers-reduced-motion: reduce) {
  .is-playing .aw-wave-bar.is-played {
    animation: none;
  }
  .aw-btn,
  .aw-bar,
  .aw-knob::after {
    transition: none;
  }
  .aw-btn:active {
    transform: none;
  }
}
</style>
