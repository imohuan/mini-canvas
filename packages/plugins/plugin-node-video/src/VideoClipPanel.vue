<script setup lang="ts">
/**
 * VideoClipPanel —— 视频剪辑胶片条（video/clip 功能模式的底栏；单选时显示）。
 *
 * 1:1 复刻 packages/ui/public/video-clip-demo.html 的暗色胶囊剪辑条（用户口径 2026-10-29）：
 *   关闭 | 键盘（配置入口） | 胶片格（蓝胶囊选区 + 播放头 + 时长 pill） | 磁吸 | 循环 | 白色确认圆钮。
 * 点键盘图标向下展开配置区：吸附间隔/范围 + 快捷键表（对应截图右侧面板）。
 *
 * 几何与 demo 同一套（重点抄 demo 文件头「吸附行为」5 条铁律）：
 * - 磁吸作用对象是「选区时长」，不是背景位置；进入吸附点 ± 范围才吸，平时跟手；
 * - 吸附范围 ≤ 间隔/2（超出自动收回）；
 * - 0 和总时长是物理边界，贴边不做吸附取整；
 * - 最短时长优先级最高。
 *
 * 草稿归会话（不写库）：确认时经命令 video:clip-confirm 一次性提交。
 * 面板由 nodeToolbar 的 video/clip 模式挂在底栏（不再是一条底栏动作），
 * 所以顶栏「剪辑时长」点下去就能看到它 —— 不必先去下拉里手动选「剪辑」。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCanvasRender, useSoleNodeSelected, useUiComponent } from '@mini-canvas/canvas-render'
import {
  clampClipEnd,
  clampClipRange,
  clampClipStart,
  MIN_CLIP_DURATION,
  moveClipRange,
  readClipRange,
} from './videoClip'
import { isClipPending, isClipping, overlayDraft, setOverlayDraft } from './videoSession'
import {
  publishDraftRange,
  readClipPrefs,
  readDuration,
  readPlayhead,
} from './videoClipStore'
import { frameCountFor, grabStrip, type FilmstripFrame } from './videoFilmstrip'
import { clipKeyAction, isTypingTarget } from './videoClipKeys'
import { resolveVideoSrc } from './videoRefs'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()
// 设计系统件按名取（与图片裁剪顶栏同一条约定），换主题时这里一行不改
const NodeToolbarButton = useUiComponent('toolbarButton')
const selected = useSoleNodeSelected(props.id)
const visible = computed(() => selected.value && isClipping(props.id))

// 图标（demo 同款线性 SVG；与 ui-style-guide §3.11 一致）
const ICON_CLOSE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
const ICON_MAGNET =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"/><path d="m5 8 4 4"/><path d="m12 15 4 4"/></svg>'
const ICON_LOOP =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>'
const ICON_CONFIRM =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
const ICON_KEYBOARD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>'

const hasVideo = computed(() => {
  const resourceId = typeof props.data?.resourceId === 'string' ? props.data.resourceId : ''
  const legacy = typeof props.data?.videoUrl === 'string' ? props.data.videoUrl : ''
  return resourceId !== '' || legacy !== ''
})

/** 后台切段中：确认按钮禁用（真正的进度显示在新建的占位节点上）。 */
const pending = computed(() => isClipPending(props.id))

/** 视频总时长：等内容区 loadedmetadata 上报；没上报过退回节点里的 videoDuration */
const duration = computed(() => {
  const live = readDuration(props.id)
  if (live > 0) return live
  const fallback = Number(props.data?.videoDuration)
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0
})

const minClip = computed(() => {
  const settings = ctx.tryGet('settings')
  const raw = settings?.get('videoMinClipDuration')
  const n = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : MIN_CLIP_DURATION
  return duration.value > 0 ? Math.min(n, duration.value) : n
})

/** 会话偏好（吸附/循环）。面板上的按钮直接改这份；设置面板改的是它下面的默认值 */
const prefs = readClipPrefs(props.id)

/**
 * 把 settings 里的值同步进会话偏好。
 *
 * ★ 为什么不能只在 onMounted 播一次种子（用户 2026-10-31 报「配置改了不生效」）：
 * 剪辑面板是常驻组件，设置面板改值时不重新挂载 —— 只读一次就永远是打开那一刻的旧值。
 * 这里既能当挂载时的种子，也能当设置变更时的回调。
 */
function syncPrefsFromSettings(): void {
  const settings = ctx.tryGet<{ get(key: string): unknown }>('settings')
  if (!settings) return
  const step = settings.get('videoClipSnapStep')
  if (typeof step === 'number' && Number.isFinite(step) && step > 0) prefs.snapStep = step
  const radius = settings.get('videoClipSnapRadius')
  if (typeof radius === 'number' && Number.isFinite(radius) && radius > 0) prefs.snapRadius = radius
  const loop = settings.get('videoClipLoop')
  if (typeof loop === 'boolean') prefs.loop = loop
}

syncPrefsFromSettings()

/**
 * 订阅设置变更（用户口径：设置页里的吸附间隔/范围/区间循环要**实时**生效）。
 * 只要动的是这三个键就重新同步；别的设置不打扰。
 */
const offPrefs = ctx
  .tryGet<{
    onChange(cb: (key: string, value: unknown) => void, opts?: { scope?: string }): { dispose(): void }
  }>('settings')
  ?.onChange((key) => {
    if (key !== 'videoClipSnapStep' && key !== 'videoClipSnapRadius' && key !== 'videoClipLoop') return
    syncPrefsFromSettings()
  })
onBeforeUnmount(() => offPrefs?.dispose())

/** 吸附范围夹取：不能超过间隔的一半（demo 铁律 3） */
const effectiveRadius = computed(() => Math.min(prefs.snapRadius, prefs.snapStep / 2))

/** 当前显示范围：草稿优先，其次已保存的，最后整段 */
const range = computed(() => {
  const draft = overlayDraft(props.id)._clipRange as { start: number; end: number } | undefined
  if (draft && Number.isFinite(draft.start) && Number.isFinite(draft.end)) {
    return clampClipRange({ start: draft.start, end: draft.end, duration: duration.value, minDuration: minClip.value })
  }
  return readClipRange(props.data, minClip.value)
})

const startPct = computed(() => (duration.value > 0 ? (range.value.start / duration.value) * 100 : 0))
const endPct = computed(() => (duration.value > 0 ? (range.value.end / duration.value) * 100 : 100))
const lengthLabel = computed(() => (range.value.end - range.value.start).toFixed(2) + ' s')

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
const rulerEl = ref<HTMLElement | null>(null)
const labelWidth = ref(0)

function measureLabel(): void {
  const w = rulerEl.value?.offsetWidth ?? 0
  if (w !== labelWidth.value) labelWidth.value = w
  // 胶片左偏移也在这里量一次：两者都在「宽度/文字可能变了」时失效
  const film = filmEl.value
  const dock = film?.parentElement
  if (film && dock) {
    const offset = film.getBoundingClientRect().left - dock.getBoundingClientRect().left
    if (Math.abs(offset - filmOffsetLeft.value) > 0.5) filmOffsetLeft.value = offset
  }
}

/** 选区在屏幕上的像素宽度 */
const selectionPx = computed(() => (filmWidth.value * Math.max(0, endPct.value - startPct.value)) / 100)

/** 选区装不下标签（留 4px 余量）→ 标签改到下方 */
const labelBelow = computed(() => labelWidth.value > 0 && selectionPx.value < labelWidth.value + 4)

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
  const t = readPlayhead(props.id)
  if (t === null || duration.value <= 0) return null
  return Math.min(Math.max(0, (t / duration.value) * 100), 100)
})

/** 胶片格抽帧 */
const frames = ref<Map<number, string>>(new Map())
const filmEl = ref<HTMLElement | null>(null)
const frameCount = ref(8)
const frameIndices = computed(() => Array.from({ length: frameCount.value }, (_, i) => i))

let stripJob = 0
let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  if (typeof ResizeObserver === 'function' && filmEl.value) {
    resizeObserver = new ResizeObserver(() => {
      const width = filmEl.value?.clientWidth ?? 0
      frameCount.value = frameCountFor(width || 560)
      filmWidth.value = width
      nextTick(measureLabel)
    })
    resizeObserver.observe(filmEl.value)
  }
  const width = filmEl.value?.clientWidth ?? 0
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
    const src = await resolveVideoSrc(ctx, props.data)
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

/** 拖拽：吸附作用于「色块时长」（demo 铁律 2），背景位置自由 */
let drag: { kind: 'start' | 'end' | 'move'; startX: number; width: number; from: { start: number; end: number } } | null = null
const isDragging = ref(false)

function snapLength(length: number): number {
  if (!prefs.snap || prefs.snapStep <= 0) return length
  // 磁性吸附：把时长圆到最近的间隔倍数；范围(radius)始终 ≤ 间隔/2，只起「跟手缓冲」作用，
  // 这里按 demo 的实际行为实现（圆整值与原值差超过范围 = 还没进吸附带 = 返回原值）。
  const snapped = Math.round(length / prefs.snapStep) * prefs.snapStep
  return Math.abs(snapped - length) <= effectiveRadius.value ? snapped : length
}

function commit(next: { start: number; end: number }): void {
  setOverlayDraft(props.id, { ...overlayDraft(props.id), _clipRange: next })
}

/**
 * 把当前区间同步给内容区（它据此判断「播到段尾停 / 区间循环」）。
 *
 * 面板与内容区是兄弟组件，只共享会话态：拖拽改的是草稿，节点 data 还没落，
 * 内容区要是只读 data，就永远按上一次确认的范围播（用户实测报的循环没效果）。
 */
watch(range, (r) => publishDraftRange(props.id, { start: r.start, end: r.end }), { immediate: true })

function onHandleDown(ev: PointerEvent, kind: 'start' | 'end' | 'move'): void {
  if (ev.button !== 0 || duration.value <= 0) return
  ev.preventDefault()
  ev.stopPropagation()
  const box = filmEl.value?.getBoundingClientRect()
  drag = { kind, startX: ev.clientX, width: box && box.width > 0 ? box.width : 1, from: { ...range.value } }
  isDragging.value = true
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragUp)
  window.addEventListener('pointercancel', onDragUp)
}

function onDragMove(ev: PointerEvent): void {
  if (!drag) return
  ev.preventDefault()
  const delta = ((ev.clientX - drag.startX) / drag.width) * duration.value
  const opts = { duration: duration.value, minDuration: minClip.value }
  if (drag.kind === 'start') {
    const rawLength = drag.from.end - (drag.from.start + delta)
    const length = Math.max(minClip.value, snapLength(rawLength))
    commit(clampClipStart({ start: drag.from.end - length, end: drag.from.end, ...opts }))
  } else if (drag.kind === 'end') {
    const rawLength = drag.from.end + delta - drag.from.start
    const length = Math.max(minClip.value, snapLength(rawLength))
    commit(clampClipEnd({ start: drag.from.start, end: drag.from.start + length, ...opts }))
  } else {
    commit(moveClipRange({ ...drag.from, nextStart: drag.from.start + delta, ...opts }))
  }
}

function onDragUp(): void {
  drag = null
  isDragging.value = false
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragUp)
  window.removeEventListener('pointercancel', onDragUp)
}

/** I/O 设出入点：以播放头当前位置为准 */
function setInPoint(): void {
  const t = readPlayhead(props.id)
  if (t === null) return
  commit(clampClipStart({ start: t, end: range.value.end, duration: duration.value, minDuration: minClip.value }))
}

function setOutPoint(): void {
  const t = readPlayhead(props.id)
  if (t === null) return
  commit(clampClipEnd({ start: range.value.start, end: t, duration: duration.value, minDuration: minClip.value }))
}

function onKeyDown(ev: KeyboardEvent): void {
  if (!visible.value || isTypingTarget(ev.target)) return
  const action = clipKeyAction({ key: ev.key, shift: ev.shiftKey, ctrl: ev.ctrlKey, meta: ev.metaKey })
  const step = 'seconds' in action ? action.seconds : 0
  const opts = { duration: duration.value, minDuration: minClip.value }
  switch (action.kind) {
    case 'move':
      commit(moveClipRange({ ...range.value, nextStart: range.value.start + step, ...opts }))
      ev.preventDefault()
      break
    case 'nudge-edge':
      if (action.edge === 'start') {
        const len = Math.max(minClip.value, range.value.end - (range.value.start + step))
        commit(clampClipStart({ start: range.value.end - len, end: range.value.end, ...opts }))
      } else {
        const len = Math.max(minClip.value, range.value.end + step - range.value.start)
        commit(clampClipEnd({ start: range.value.start, end: range.value.start + len, ...opts }))
      }
      ev.preventDefault()
      break
    case 'set-in': setInPoint(); ev.preventDefault(); break
    case 'set-out': setOutPoint(); ev.preventDefault(); break
    case 'toggle-play': togglePlay(); ev.preventDefault(); break
    case 'exit': onCancel(); ev.preventDefault(); break
    case 'confirm': onConfirm(); ev.preventDefault(); break
    default: break
  }
}

/** 播放/暂停：直接操作内容区的 video（剪辑会话中它永不卸载）。
 *  剪辑确认后按 loop 偏好控制内容区的循环行为 —— 内容区 watch 这个值。 */
function contentVideo(): HTMLVideoElement | null {
  const node = (document.querySelector('[data-id="' + props.id + '"]')
    ?? document.querySelector('.vue-flow__node-' + props.id)) as HTMLElement | null
  return node?.querySelector('video') ?? null
}

function togglePlay(): void {
  const v = contentVideo()
  if (!v) return
  const { start, end } = range.value
  if (v.paused) {
    if (v.currentTime < start || (end > start && v.currentTime >= end)) v.currentTime = start
    void v.play().catch(() => {})
  } else {
    v.pause()
  }
}

function toggleSnap(): void {
  prefs.snap = !prefs.snap
  if (prefs.snap && duration.value > 0) {
    const len = snapLength(range.value.end - range.value.start)
    const safe = Math.max(minClip.value, Math.min(len, duration.value))
    const anchor = Math.max(0, Math.min(range.value.start, duration.value - safe))
    commit(clampClipRange({ start: anchor, end: anchor + safe, duration: duration.value, minDuration: minClip.value }))
  }
}

function toggleLoop(): void {
  prefs.loop = !prefs.loop
  // 循环是内容区的行为：关掉时立刻清 loop（开着不影响确认后的回放起始）
  // ★ 不再动 video 元素的 loop：它只能循环整段视频，管不到剪辑段尾。
  //   真正的区间循环由内容区的 timeupdate 按会话偏好处理（见 VideoContent.onTimeUpdate）。
}

/** 配置展开区 */
const configOpen = ref(false)

function onConfirm(): void {
  // 后台转码中再点一次会重复提交（后台对同节点返回 busy），本地先拦住
  if (pending.value) return
  ctx.get('command').execute('video:clip-confirm', { nodeId: props.id, start: range.value.start, end: range.value.end })
}

function onCancel(): void {
  ctx.get('command').execute('video:clip-cancel', { nodeId: props.id })
}

onBeforeUnmount(onDragUp)
</script>

<template>
  <div v-if="visible" ref="rootEl" class="vclip nodrag nopan nowheel" @dblclick.stop>
    <div v-if="!hasVideo" class="ntp-root vclip-empty">这里还没有视频，先上传一段再剪辑</div>

    <template v-else>
      <!-- 外壳 = 主题胶囊 .ntp-root（与图片裁剪/绘制状态栏同一套 token）：
           底色、边框、圆角、阴影都跟着亮/暗主题走；按钮一律用主题的 toolbarButton。 -->
      <div class="ntp-root vclip-dock" @keydown="onKeyDown">
        <NodeToolbarButton title="退出剪辑" aria-label="退出剪辑" variant="danger" :icon="ICON_CLOSE" @click="onCancel" />

        <NodeToolbarButton
          :title="configOpen ? '收起配置' : '快捷键与吸附设置'"
          aria-label="快捷键与吸附设置"
          :icon="ICON_KEYBOARD"
          :active="configOpen"
          @click="configOpen = !configOpen"
        />

        <div ref="filmEl" class="vclip-film" role="group" aria-label="视频片段选择">
          <!-- 帧图底板：贴边时这一侧的圆角要取消，否则会露出黑色方角（demo 几何约定第 7 条） -->
          <div class="vclip-frames" :class="{ 'is-at-left': atLeft, 'is-at-right': atRight }" aria-hidden="true">
            <div v-for="i in frameIndices" :key="i" class="vclip-frame" :style="frames.get(i) ? { backgroundImage: 'url(' + frames.get(i) + ')' } : undefined" />
          </div>
          <div class="vclip-shade is-left" :style="{ width: startPct + '%' }" />
          <div class="vclip-shade is-right" :style="{ left: endPct + '%', width: Math.max(0, 100 - endPct) + '%' }" />
          <div
            class="vclip-selection"
            :class="{ 'is-dragging': isDragging, 'is-at-left': atLeft, 'is-at-right': atRight }"
            :style="{ left: startPct + '%', width: Math.max(0, endPct - startPct) + '%' }"
            @pointerdown="onHandleDown($event, 'move')"
          >
            <div class="vclip-handle is-start" role="slider" aria-label="片段起点" :aria-valuemin="0" :aria-valuemax="duration" :aria-valuenow="range.start" tabindex="0" @pointerdown.stop="onHandleDown($event, 'start')" />
            <div class="vclip-handle is-end" role="slider" aria-label="片段终点" :aria-valuemin="0" :aria-valuemax="duration" :aria-valuenow="range.end" tabindex="0" @pointerdown.stop="onHandleDown($event, 'end')" />
            <!-- 装得下就居中显示；装不下改到下方那一条（见 labelBelow） -->
            <span v-if="!labelBelow" class="vclip-length">{{ lengthLabel }}</span>
          </div>
          <div v-if="playheadPct !== null && !isDragging" class="vclip-playhead" :style="{ left: playheadPct + '%' }" />
          <!-- 隐藏量尺：只用来量同一串文字的像素宽度，不参与视觉（visibility 保留布局，能读出 offsetWidth） -->
          <span ref="rulerEl" class="vclip-ruler" aria-hidden="true">{{ lengthLabel }}</span>
        </div>

        <NodeToolbarButton
          :title="prefs.snap ? '关闭吸附' : '开启吸附'"
          aria-label="吸附"
          :icon="ICON_MAGNET"
          :active="prefs.snap"
          @click="toggleSnap"
        />

        <NodeToolbarButton
          :title="prefs.loop ? '关闭区间循环' : '开启区间循环'"
          aria-label="区间循环"
          :icon="ICON_LOOP"
          :active="prefs.loop"
          @click="toggleLoop"
        />

        <NodeToolbarButton
          :title="pending ? '剪辑中…' : '确认剪辑'"
          :aria-label="pending ? '剪辑中' : '确认剪辑'"
          variant="primary"
          :icon="ICON_CONFIRM"
          :disabled="pending"
          @click="onConfirm"
        >
          {{ pending ? '剪辑中…' : '确认' }}
        </NodeToolbarButton>
      </div>

      <!-- 时长文字的下方常驻位（用户口径 2026-10-31）：选区窄到装不下时显示在这里。
           不套 Tooltip 组件、不靠 hover —— 一直看得见，横向锚点跟着选区中心走。
           始终占一行（v-show 而非 v-if）：拖到能被装下/装不下的临界点时，下面的配置区不会跳。 -->
      <div class="vclip-caption" role="status" aria-live="off">
        <span v-show="labelBelow" class="vclip-caption-text" :style="{ left: captionLeftPx + 'px' }">{{ lengthLabel }}</span>
      </div>

      <div v-if="configOpen" class="ntp-root vclip-config">
        <div class="vclip-config-row">
          <span class="vclip-config-label">吸附间隔</span>
          <input v-model.number="prefs.snapStep" class="vclip-config-input" type="number" min="0.01" max="10" step="0.01" aria-label="吸附间隔（秒）" />
          <span class="vclip-config-unit">秒</span>
          <span class="vclip-config-label">吸附范围</span>
          <input v-model.number="prefs.snapRadius" class="vclip-config-input" type="number" min="0.01" max="5" step="0.01" aria-label="吸附范围（秒）" />
          <span class="vclip-config-unit">秒</span>
        </div>
        <div class="vclip-config-row">
          <span class="vclip-config-kbd">← →</span><span class="vclip-config-desc">移动选区</span>
          <span class="vclip-config-kbd">↑ ↓</span><span class="vclip-config-desc">扩展/收缩选区</span>
          <span class="vclip-config-kbd">I</span><span class="vclip-config-desc">设入点</span>
          <span class="vclip-config-kbd">O</span><span class="vclip-config-desc">设出点</span>
        </div>
        <div class="vclip-config-row">
          <span class="vclip-config-kbd">Shift</span><span class="vclip-config-desc">精确模式 0.1s</span>
          <span class="vclip-config-kbd">Ctrl</span><span class="vclip-config-desc">快速调整 1s</span>
          <span class="vclip-config-kbd">Space</span><span class="vclip-config-desc">播放/暂停</span>
          <span class="vclip-config-kbd">Esc</span><span class="vclip-config-desc">退出</span>
          <span class="vclip-config-kbd">Enter</span><span class="vclip-config-desc">确认</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/**
 * 视觉与图片裁剪的状态栏同源（用户口径 2026-10-31）：
 * - 外壳 = 主题的 `.ntp-root` 胶囊（白底/深底、发丝边、10px 圆角、阴影都随亮暗主题变）；
 * - 按钮 = 主题登记件 toolbarButton（尺寸/圆角/hover/激活态由主题决定）；
 * - 只有胶片条本身保持深色 —— 它压的是视频画面，浅色底会把抽出来的帧吃掉。
 * 强调色一律取 --ui-accent，用户换主题色时选区和按钮一起变。
 */
.vclip {
  /* 只保留胶片条这一块的私有色：它必须压黑，才看得清帧和蓝色选区 */
  --vclip-film: #000;
  /* 胶片条恒定黑底，所以抽帧前的占位也固定用深灰：跟主题走会在暗色下闪出一排浅灰块 */
  --vclip-frame-bg: #181b20;
  --vclip-frame: #1d2128;
  --vclip-divider: rgb(255 255 255 / 0.12);
  --vclip-shade: rgb(0 0 0 / 0.5);
  --vclip-ink-strong: #fff;
  --vclip-handle-line: rgb(255 255 255 / 0.9);
  --vclip-playhead-glow: rgb(255 255 255 / 0.45);
  --vclip-length-bg: rgb(23 24 27 / 0.94);
  --vclip-accent: var(--ui-accent, #0891b2);
  --vclip-accent-ring: var(--ui-accent, #0891b2);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 560px;
  max-width: calc(100vw - 48px);
}

.vclip-empty {
  padding: 14px 16px;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 12px;
}

/* 外框/底色/边框/圆角/阴影全部来自 .ntp-root；这里只排一行、定高、收紧内边距 */
.vclip-dock {
  /* 66px = 胶片条 56px + 上下各 4px 内边距 + 1px 边框（用户 2026-10-31：帧图要看清，允许整条撑高） */
  height: 66px;
  width: 100%;
  box-sizing: border-box;
  padding: 4px;
}

/* 胶片条：黑底 12px 圆角；内部 flex 铺满 */
.vclip-film {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  /* 帧图高度下限（用户 2026-10-31）：外框再被压扁也不低于 55px */
  min-height: 55px;
  overflow: visible;
  border-radius: 12px;
  background: var(--vclip-film);
  /* 两侧留白（用户 2026-10-31 定的 16px）：选区把手要伸到胶片外面，留白是它们的落点 */
  margin: 0 16px;
  touch-action: none;
  user-select: none;
}
.vclip-frames {
  position: absolute;
  inset: 0;
  display: flex;
  overflow: hidden;
  border-radius: 12px;
  background: var(--vclip-frame-bg);
}
/* 选区贴到某一侧（≤12px）：那一侧帧图变直角，把胶片的圆角盖住 ——
   否则圆角下方会露出黑色方角，看起来像选区被削掉一块（demo 几何约定第 7 条）。 */
.vclip-frames.is-at-left { border-top-left-radius: 0; border-bottom-left-radius: 0; }
.vclip-frames.is-at-right { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.vclip-frame {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  background-color: var(--vclip-frame);
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
}
.vclip-frame + .vclip-frame { border-left: 1px solid var(--vclip-divider); }

/* 选区外遮罩（demo 同款半透明黑） */
.vclip-shade {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 2;
  background: var(--vclip-shade);
  pointer-events: none;
}
.vclip-shade.is-left { left: 0; }
.vclip-shade.is-right { right: 0; }

/* 胶囊选区：矩形透明块 + 上下 2px 蓝线（::after）；贴边时外角变直角 */
.vclip-selection {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 4;
  min-width: 2px;
  cursor: grab;
  touch-action: none;
  box-sizing: border-box;
}
.vclip-selection.is-dragging { cursor: grabbing; }
.vclip-selection::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 10;
  border-top: 2px solid var(--vclip-accent);
  border-bottom: 2px solid var(--vclip-accent);
  pointer-events: none;
}
/* 选区本身是直角矩形（圆角只在帧图底板上），所以贴边只需要处理 .vclip-frames */

/* 两只蓝色耳朵：绝对定位、不占布局宽度、可以越过胶片边界（demo capsule 同款） */
.vclip-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 9;
  width: 16px;
  border: 0;
  background: var(--vclip-accent);
  box-shadow: none;
  cursor: ew-resize;
  touch-action: none;
}
.vclip-handle.is-start { left: -16px; border-radius: 12px 0 0 12px; }
.vclip-handle.is-end { right: -16px; border-radius: 0 12px 12px 0; }
.vclip-handle::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 1px;
  height: 13px;
  margin-top: -6.5px;
  margin-left: -0.5px;
  border-radius: 999px;
  background: var(--vclip-handle-line);
  opacity: 0.85;
  transition: opacity 0.14s ease;
}
.vclip-selection:hover .vclip-handle::after,
.vclip-selection.is-dragging .vclip-handle::after { opacity: 1; }
.vclip-handle:focus-visible { outline: 2px solid var(--vclip-accent-ring); outline-offset: 2px; }

/* 时长 pill（3.36 s）：居中悬浮 */
.vclip-length {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 10;
  transform: translate(-50%, -50%);
  max-width: calc(100% - 16px);
  overflow: hidden;
  padding: 8px 12px;
  border-radius: 10px;
  color: var(--vclip-ink-strong);
  background: var(--vclip-length-bg);
  box-shadow: 0 4px 14px var(--vclip-divider);
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-overflow: ellipsis;
  pointer-events: none;
}

/* 播放头：白色 2px 竖线；拖拽时隐藏（模板 v-if） */
.vclip-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 7;
  width: 2px;
  background: var(--vclip-ink-strong);
  box-shadow: 0 0 0 1px var(--vclip-divider), 0 0 10px var(--vclip-playhead-glow);
  pointer-events: none;
  transform: translate3d(-1px, 0, 0);
}

/**
 * 时长文字的「下方常驻位」（用户口径 2026-10-31）。
 *
 * 选区窄到装不下时（labelBelow），pill 不再挤在选区里被省略，而是挂到胶片条下沿：
 * 常驻可见、不靠 hover、不套 Tooltip 组件。挂在 .vclip-film 里是为了让 left% 直接以
 * 胶片宽度为基准，位置正好对齐选区中心。
 */
.vclip-caption {
  /* 常驻一行（不浮层）：一直占位，拖拽时不会因为显隐把下面的配置区顶来顶去 */
  position: relative;
  width: 100%;
  height: 20px;
  margin-top: -4px;
  z-index: 11;
  pointer-events: none;
}
.vclip-caption-text {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  padding: 4px 8px;
  border-radius: 6px;
  color: var(--vclip-ink-strong);
  background: var(--vclip-length-bg);
  box-shadow: 0 4px 14px var(--vclip-divider);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* 隐藏量尺：与 pill 同一套字体/内边距，量出来的宽度才和真实标签一致。
   visibility:hidden 而不是 display:none —— 后者量不到 offsetWidth。 */
.vclip-ruler {
  position: absolute;
  top: 0;
  left: 0;
  z-index: -1;
  visibility: hidden;
  padding: 8px 12px;
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}

/* 向下展开的配置区（吸附参数 + 快捷键表）：同一只主题胶囊，不再自带深色皮肤 */
.vclip-config {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
  padding: 12px;
  white-space: normal;
}
.vclip-config-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.vclip-config-label {
  color: var(--ui-ink-dim, #6b7280);
  font-size: 11px;
}
.vclip-config-input {
  width: 64px;
  padding: 4px 7px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 7px;
  color: var(--ui-ink, #18202b);
  background: var(--ui-overlay-solid, #fff);
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  outline: none;
}
.vclip-config-input:focus { border-color: var(--ui-accent, #0891b2); }
.vclip-config-unit {
  margin-right: 8px;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 11px;
}
.vclip-config-kbd {
  min-width: 22px;
  padding: 2px 6px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-bottom-width: 2px;
  border-radius: 6px;
  color: var(--ui-ink, #18202b);
  background: var(--ui-overlay-solid, #fff);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  font-weight: 700;
  text-align: center;
}
.vclip-config-desc {
  margin-right: 10px;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 11px;
}

@media (prefers-reduced-motion: reduce) {
  .vclip-handle::after {
    transition: none !important;
  }
}
</style>
