import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { CanvasRenderContext } from '@plume-canvas/canvas-render'
import { readPlayhead } from '../videoClipStore'
import { frameCountFor, grabStrip, type FilmstripFrame } from '../videoFilmstrip'
import { resolveVideoSrc } from '../videoRefs'

export interface ClipTimelineOptions {
  ctx: CanvasRenderContext['ctx']
  nodeId: string
  data: () => Record<string, unknown>
  rootEl: Ref<HTMLElement | null>
  duration: Ref<number>
  range: Ref<{ start: number; end: number }>
  startPct: Ref<number>
  endPct: Ref<number>
  lengthLabel: Ref<string>
}

/**
 * 胶片时间轴几何：贴边圆角、下方时长标签、播放头与抽帧。
 */
export function useClipTimeline(options: ClipTimelineOptions) {
  const { ctx, nodeId, data, duration, range, startPct, endPct, lengthLabel, rootEl } = options

  /** 胶片/量尺在胶片子组件里，按入口根节点查找（不依赖跨组件 ref 的挂载时序） */
  const filmOf = (): HTMLElement | null =>
    (rootEl.value?.querySelector('.vclip-film') as HTMLElement | null) ?? null
  const rulerOf = (): HTMLElement | null =>
    (rootEl.value?.querySelector('.vclip-ruler') as HTMLElement | null) ?? null

  /**
   * 选区贴边：离胶片左右边缘 ≤ 12px 时就取消那一侧的圆角（demo 几何约定第 7 条）。
   *
   * 为什么用像素而不是百分比：圆角是固定的 12px，胶片变宽后 1% 会变成十几像素 ——
   * 按百分比判断要么提前取消、要么永远取消不了。阈值必须和 CSS 的圆角半径同一个数。
   */
  const FILM_RADIUS = 12
  /** 胶片实际宽度（ResizeObserver 上报；0 = 还没量到，只按物理边界判断） */
  const filmWidth = ref(0)

  const atLeft = computed(() => {
    if (duration.value <= 0) return false
    if (range.value.start <= 0.001) return true
    return filmWidth.value > 0 && (range.value.start / duration.value) * filmWidth.value <= FILM_RADIUS
  })

  const atRight = computed(() => {
    if (duration.value <= 0) return false
    const left = duration.value - range.value.end
    if (left <= 0.001) return true
    return filmWidth.value > 0 && (left / duration.value) * filmWidth.value <= FILM_RADIUS
  })

  /* ── 时长文字：选区太窄时改在胶片条下方常驻显示（用户口径 2026-10-31）──
   *
   * 为什么不能继续放在选区里：选区只有几像素宽时，pill 会被 max-width + ellipsis 吃掉，
   * 用户只能看到 "1…"。demo 的做法是窄了就把标签挪到选区上方；这里按用户要求挪到**下方**，
   * 并且始终显示，不依赖 hover 也不套 Tooltip 组件。
   *
   * 判断必须用「真实像素」：选区宽度 = 百分比 × 胶片宽度，标签宽度用一只隐藏的量尺量，
   * 两者比较才可靠（按字数估宽在字体/缩放变化时会漂）。
   */
  const labelWidth = ref(0)

  function measureLabel(): void {
    const w = rulerOf()?.offsetWidth ?? 0
    if (w !== labelWidth.value) labelWidth.value = w
    // 胶片左偏移也在这里量一次：两者都在「宽度/文字可能变了」时失效
    const film = filmOf()
    const dock = film?.parentElement
    if (film && dock) {
      const offset = film.getBoundingClientRect().left - dock.getBoundingClientRect().left
      if (Math.abs(offset - filmOffsetLeft.value) > 0.5) filmOffsetLeft.value = offset
    }
  }

  /** 选区在屏幕上的像素宽度 */
  const selectionPx = computed(() => (filmWidth.value * Math.max(0, endPct.value - startPct.value)) / 100)

  /**
   * 选区装不下标签 → 标签改到下方。
   *
   * 余量要留够（用户口径 2026-10-31：判定不够，得加大宽度）：
   * pill 是居中悬浮的，两侧各留一点空气才不显得"贴着耳朵"；只留 4px 时，
   * 视觉上已经挤在一起，却还判定为"装得下"。这里给 28px（实测 1.00s 的选区已在下沿更耐看）。
   */
  const LABEL_GUTTER = 28
  const labelBelow = computed(() => labelWidth.value > 0 && selectionPx.value < labelWidth.value + LABEL_GUTTER)

  /** 胶片左缘相对底栏左缘的像素偏移（胶片有 16px 外边距，不能按 0 算） */
  const filmOffsetLeft = ref(0)

  /**
   * 标签在下方时的横向锚点（px，相对底栏左缘）= 胶片左偏移 + 选区中心。
   * 用像素而不是百分比：下方那条铺满整个底栏，而选区只在胶片范围内，两者宽度不同。
   */
  const captionLeftPx = computed(
    () => filmOffsetLeft.value + (filmWidth.value * (startPct.value + endPct.value)) / 200,
  )

  /** 播放头：跟随内容区 <video> 的 currentTime */
  const playheadPct = computed(() => {
    const t = readPlayhead(nodeId)
    if (t === null || duration.value <= 0) return null
    return Math.min(Math.max(0, (t / duration.value) * 100), 100)
  })

  /** 胶片格抽帧 */
  const frames = ref<Map<number, string>>(new Map())
  const frameCount = ref(8)
  const frameIndices = computed(() => Array.from({ length: frameCount.value }, (_, i) => i))

  let stripJob = 0
  let resizeObserver: ResizeObserver | null = null
  onMounted(() => {
    if (typeof ResizeObserver === 'function' && filmOf()) {
      resizeObserver = new ResizeObserver(() => {
        const width = filmOf()?.clientWidth ?? 0
        frameCount.value = frameCountFor(width || 560)
        filmWidth.value = width
        nextTick(measureLabel)
      })
      resizeObserver.observe(filmOf()!)
    }
    const width = filmOf()?.clientWidth ?? 0
    frameCount.value = frameCountFor(width || 560)
    filmWidth.value = width
    nextTick(measureLabel)
  })

  // 时长文字变化（或胶片宽度变化）后重新量一次：标签宽度跟着数字位数变
  watch([lengthLabel, filmWidth, () => frameCount.value], () => nextTick(measureLabel))
  onBeforeUnmount(() => {
    resizeObserver?.disconnect()
    resizeObserver = null
    stripJob += 1
  })

  watch(
    [duration, frameCount],
    async ([dur, count]) => {
      if (dur <= 0 || count <= 0) return
      const job = ++stripJob
      frames.value = new Map()
      const src = await resolveVideoSrc(ctx, data())
      if (!src || job !== stripJob) return
      await grabStrip(src, dur, count, (f: FilmstripFrame, i: number) => {
        if (job !== stripJob) return
        const next = new Map(frames.value)
        next.set(i, f.dataUrl)
        frames.value = next
      }, () => job !== stripJob)
    },
    { immediate: true },
  )

  return {
    atLeft,
    atRight,
    labelBelow,
    captionLeftPx,
    playheadPct,
    frames,
    frameCount,
    frameIndices,
  }
}
