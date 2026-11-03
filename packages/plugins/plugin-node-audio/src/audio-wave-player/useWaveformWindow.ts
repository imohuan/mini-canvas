import { computed, ref, type Ref } from "vue"
import { WAVEFORM_MAX, isValidWaveform } from "../waveform"

export interface WaveformWindowOptions {
  waveform: () => number[] | undefined
  barWidth: () => number
  duration: () => number
  current: () => number
  frozenStart: Ref<number | null>
  windowPeaks: Ref<number[] | null>
  windowPeaksFrom: { value: number }
}

/** 轮播窗口的取景、每根竖条的位置与播放头百分比。 */
export function useWaveformWindow(options: WaveformWindowOptions) {
  const barGap = 1
  const barPitch = computed(() => options.barWidth() + barGap)
  /** 波形区的实测宽度（px）；窗口里能放多少根由它决定 */
  const waveWidth = ref(0)
  /** 默认可视窗口秒数：短于它的音频整条铺满，长于它的按这个窗口滑动 */
  const WINDOW_SECONDS = 20

  /** 可视区能放多少根竖条（固定条宽 → 由实测宽度决定） */
  const barCount = computed(() => Math.max(8, Math.floor(Math.max(1, waveWidth.value) / barPitch.value)))

  /** 每根竖条代表多少秒：短音频整条铺满，长音频按 WINDOW_SECONDS 的窗口 */
  const secondsPerBar = computed(() => {
    const total = options.duration()
    if (!(total > 0)) return 0
    // 格子锚在**绝对时间**上 —— 若让每根条跟着窗口左端漂移，同一格每帧显示的采样点
    // 都在变，看起来就是波形原地抖动（实测的"像水波纹一样来回晃荡"）。
    const visibleSeconds = Math.min(total, WINDOW_SECONDS)
    return visibleSeconds / barCount.value
  })

  const windowSeconds = computed(() => secondsPerBar.value * barCount.value)

  const windowStart = computed(() => {
    if (options.frozenStart.value !== null) return options.frozenStart.value
    const total = options.duration()
    const span = windowSeconds.value
    if (!(total > 0) || span >= total) return 0
    return Math.min(Math.max(0, options.current() - span / 2), total - span)
  })

  /** 时间轴整体平移量（px）：窗口滑到 start 秒，整条就向左移 start 对应的像素 */
  const timelineShiftPx = computed(() =>
    secondsPerBar.value > 0 ? -(windowStart.value / secondsPerBar.value) * barPitch.value : 0,
  )

  /** 当前要画的竖条：**单层**，每根带自己的已播状态与坐标 */
  const bars = computed<Array<{ key: number; played: boolean; style: Record<string, string> }>>(() => {
    const total = options.duration()
    const perBar = secondsPerBar.value
    if (!(total > 0) || perBar <= 0) return []
    const count = barCount.value
    const start = windowStart.value
    const live = options.windowPeaks.value
    const waveform = options.waveform()
    const stored = waveform && isValidWaveform(waveform) ? waveform : null
    const list: Array<{ key: number; played: boolean; style: Record<string, string> }> = []
    const visible = Math.min(count, Math.max(1, Math.ceil(total / perBar - 1e-6)))
    const firstCell = Math.max(0, Math.floor(start / perBar))
    for (let k = 0; k < visible; k++) {
      const cell = firstCell + k
      const timeSec = cell * perBar
      if (timeSec > total + 1e-6) break
      let value = 0
      if (live && cell >= options.windowPeaksFrom.value && cell - options.windowPeaksFrom.value < live.length) {
        value = live[cell - options.windowPeaksFrom.value] ?? 0
      } else if (stored) {
        const si = Math.min(stored.length - 1, Math.max(0, Math.round((timeSec / total) * (stored.length - 1))))
        value = (stored[si] ?? 0) / WAVEFORM_MAX
      }
      const h = Math.max(2, Math.min(100, value * 100))
      list.push({
        key: cell,
        played: timeSec <= options.current(),
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
    const f = (options.current() - windowStart.value) / span
    return (Math.min(1, Math.max(0, f)) * 100).toFixed(4) + "%"
  })

  return {
    barPitch,
    waveWidth,
    barCount,
    secondsPerBar,
    windowSeconds,
    windowStart,
    timelineShiftPx,
    bars,
    headPct,
  }
}

