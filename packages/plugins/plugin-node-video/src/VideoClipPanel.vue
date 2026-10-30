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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCanvasRender, useSoleNodeSelected } from '@mini-canvas/canvas-render'
import {
  clampClipEnd,
  clampClipRange,
  clampClipStart,
  MIN_CLIP_DURATION,
  moveClipRange,
  readClipRange,
} from './videoClip'
import { isClipPending, isClipping, overlayDraft, setOverlayDraft } from './videoSession'
import { readClipPrefs, readDuration, readPlayhead } from './videoClipStore'
import { frameCountFor, grabStrip, type FilmstripFrame } from './videoFilmstrip'
import { clipKeyAction, isTypingTarget } from './videoClipKeys'
import { resolveVideoSrc } from './videoRefs'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()
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

/** 会话偏好（吸附/循环）。挂载时从 settings 播一次已保存值当种子 */
const prefs = readClipPrefs(props.id)
onMounted(() => {
  const settings = ctx.tryGet('settings')
  if (!settings) return
  const step = settings.get('videoClipSnapStep')
  if (typeof step === 'number' && Number.isFinite(step) && step > 0) prefs.snapStep = step
  const radius = settings.get('videoClipSnapRadius')
  if (typeof radius === 'number' && Number.isFinite(radius) && radius > 0) prefs.snapRadius = radius
  const loop = settings.get('videoClipLoop')
  if (typeof loop === 'boolean') prefs.loop = loop
})

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
      frameCount.value = frameCountFor(filmEl.value?.clientWidth ?? 560)
    })
    resizeObserver.observe(filmEl.value)
  }
  frameCount.value = frameCountFor(filmEl.value?.clientWidth ?? 560)
})
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
  const v = contentVideo()
  if (v) v.loop = prefs.loop && range.value.end - range.value.start < duration.value
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
  <div v-if="visible" class="vclip nodrag nopan nowheel" @dblclick.stop>
    <div v-if="!hasVideo" class="vclip-empty">这里还没有视频，先上传一段再剪辑</div>

    <template v-else>
      <div class="vclip-dock" @keydown="onKeyDown">
        <button class="vclip-btn" type="button" title="退出剪辑" aria-label="退出剪辑" @click="onCancel">
          <span class="vclip-ico" v-html="ICON_CLOSE" />
        </button>

        <button class="vclip-btn" :class="{ 'is-on': configOpen }" type="button" :title="configOpen ? '收起配置' : '快捷键与吸附设置'" :aria-expanded="configOpen" aria-label="快捷键与吸附设置" @click="configOpen = !configOpen">
          <span class="vclip-ico" v-html="ICON_KEYBOARD" />
        </button>

        <div ref="filmEl" class="vclip-film" role="group" aria-label="视频片段选择">
          <div class="vclip-frames" aria-hidden="true">
            <div v-for="i in frameIndices" :key="i" class="vclip-frame" :style="frames.get(i) ? { backgroundImage: 'url(' + frames.get(i) + ')' } : undefined" />
          </div>
          <div class="vclip-shade is-left" :style="{ width: startPct + '%' }" />
          <div class="vclip-shade is-right" :style="{ left: endPct + '%', width: Math.max(0, 100 - endPct) + '%' }" />
          <div
            class="vclip-selection"
            :class="{ 'is-dragging': isDragging, 'is-at-left': startPct <= 0.5, 'is-at-right': endPct >= 99.5 }"
            :style="{ left: startPct + '%', width: Math.max(0, endPct - startPct) + '%' }"
            @pointerdown="onHandleDown($event, 'move')"
          >
            <div class="vclip-handle is-start" role="slider" aria-label="片段起点" :aria-valuemin="0" :aria-valuemax="duration" :aria-valuenow="range.start" tabindex="0" @pointerdown.stop="onHandleDown($event, 'start')" />
            <div class="vclip-handle is-end" role="slider" aria-label="片段终点" :aria-valuemin="0" :aria-valuemax="duration" :aria-valuenow="range.end" tabindex="0" @pointerdown.stop="onHandleDown($event, 'end')" />
            <span class="vclip-length">{{ lengthLabel }}</span>
          </div>
          <div v-if="playheadPct !== null && !isDragging" class="vclip-playhead" :style="{ left: playheadPct + '%' }" />
        </div>

        <button class="vclip-btn" :class="{ 'is-on': prefs.snap }" type="button" :title="prefs.snap ? '关闭吸附' : '开启吸附'" :aria-pressed="prefs.snap" aria-label="吸附" @click="toggleSnap">
          <span class="vclip-ico" v-html="ICON_MAGNET" />
        </button>

        <button class="vclip-btn" :class="{ 'is-on': prefs.loop }" type="button" :title="prefs.loop ? '关闭区间循环' : '开启区间循环'" :aria-pressed="prefs.loop" aria-label="区间循环" @click="toggleLoop">
          <span class="vclip-ico" v-html="ICON_LOOP" />
        </button>

        <button class="vclip-confirm" type="button" :disabled="pending" :title="pending ? '剪辑中…' : '确认剪辑'" :aria-label="pending ? '剪辑中' : '确认剪辑'" @click="onConfirm">
          <span class="vclip-ico" v-html="ICON_CONFIRM" />
        </button>
      </div>

      <div v-if="configOpen" class="vclip-config">
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
 * 视觉 1:1 抄 demo 的 capsule 样式（56px 高、12px 圆角、黑底）。
 * 蓝色只出现在：左右两只实心把手 + 选区上下 2px 细线 + 按钮激活态（与 demo 同色 #3b82f6）。
 * 这里是**功能模式专属的深色工具条**，与 ui-style-guide 的浅色浮层并存（同图片裁剪浮层的先例）。
 */
.vclip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 560px;
  max-width: calc(100vw - 48px);
}

.vclip-empty {
  padding: 14px 16px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 12px;
  background: #0e1014;
  color: #9b9fa8;
  font-size: 12px;
}

.vclip-dock {
  display: flex;
  align-items: stretch;
  gap: 8px;
  height: 66px;
  width: 100%;
  padding: 7px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 12px;
  background: #0e1014;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.4);
}

.vclip-btn {
  flex: none;
  align-self: center;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 10px;
  color: #c8ccd4;
  background: transparent;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}
.vclip-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.065); }
.vclip-btn:active { transform: scale(0.96); }
.vclip-btn.is-on {
  color: #fff;
  background: #3b82f6;
  border-color: rgba(147, 197, 253, 0.45);
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.15), 0 8px 20px rgba(37, 99, 235, 0.28);
}
.vclip-btn:focus-visible { outline: 2px solid rgba(96, 165, 250, 0.95); outline-offset: 2px; }

.vclip-ico { display: block; width: 18px; height: 18px; }
.vclip-ico :deep(svg) { width: 18px; height: 18px; display: block; }

/* 胶片条：黑底 12px 圆角；内部 flex 铺满 */
.vclip-film {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  overflow: visible;
  border-radius: 12px;
  background: #000;
  touch-action: none;
  user-select: none;
}
.vclip-frames {
  position: absolute;
  inset: 0;
  display: flex;
  overflow: hidden;
  border-radius: 12px;
  background: #181b20;
}
.vclip-frame {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  background-color: #1d2128;
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
}
.vclip-frame + .vclip-frame { border-left: 1px solid rgba(0, 0, 0, 0.3); }

/* 选区外遮罩（demo 同款半透明黑） */
.vclip-shade {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 2;
  background: rgba(0, 0, 0, 0.5);
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
  border-top: 2px solid #3b82f6;
  border-bottom: 2px solid #3b82f6;
  pointer-events: none;
}
.vclip-selection.is-at-left { border-top-left-radius: 0; border-bottom-left-radius: 0; }
.vclip-selection.is-at-right { border-top-right-radius: 0; border-bottom-right-radius: 0; }

/* 两只蓝色耳朵：绝对定位、不占布局宽度、可以越过胶片边界（demo capsule 同款） */
.vclip-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 9;
  width: 16px;
  border: 0;
  background: #3b82f6;
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
  background: rgba(255, 255, 255, 0.9);
  opacity: 0.85;
  transition: opacity 0.14s ease;
}
.vclip-selection:hover .vclip-handle::after,
.vclip-selection.is-dragging .vclip-handle::after { opacity: 1; }
.vclip-handle:focus-visible { outline: 2px solid rgba(96, 165, 250, 0.95); outline-offset: 2px; }

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
  color: #fff;
  background: rgba(23, 24, 27, 0.94);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
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
  background: #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.28), 0 0 10px rgba(255, 255, 255, 0.45);
  pointer-events: none;
  transform: translate3d(-1px, 0, 0);
}

/* 白色确认圆钮 */
.vclip-confirm {
  flex: none;
  align-self: center;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: #101216;
  background: #f5f6f8;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.15s ease;
}
.vclip-confirm:hover { background: #fff; }
.vclip-confirm:active { transform: scale(0.96); }
.vclip-confirm:disabled { cursor: progress; opacity: 0.55; }
.vclip-confirm:disabled:hover { background: #f5f6f8; }
.vclip-confirm:focus-visible { outline: 2px solid rgba(96, 165, 250, 0.95); outline-offset: 2px; }
.vclip-confirm .vclip-ico { color: #101216; }

/* 向下展开的配置区（吸附参数 + 快捷键表） */
.vclip-config {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 12px;
  background: #0e1014;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.35);
}
.vclip-config-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.vclip-config-label {
  color: #9b9fa8;
  font-size: 11px;
}
.vclip-config-input {
  width: 64px;
  padding: 4px 7px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 7px;
  color: #f4f5f7;
  background: rgba(255, 255, 255, 0.04);
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  outline: none;
}
.vclip-config-input:focus { border-color: rgba(96, 165, 250, 0.5); }
.vclip-config-unit {
  margin-right: 8px;
  color: #6d727c;
  font-size: 11px;
}
.vclip-config-kbd {
  min-width: 22px;
  padding: 2px 6px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-bottom-width: 2px;
  border-radius: 6px;
  color: #e8ebf0;
  background: rgba(255, 255, 255, 0.07);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  font-weight: 700;
  text-align: center;
}
.vclip-config-desc {
  margin-right: 10px;
  color: #9b9fa8;
  font-size: 11px;
}

@media (prefers-reduced-motion: reduce) {
  .vclip-btn,
  .vclip-confirm,
  .vclip-handle::after {
    transition: none !important;
  }
}
</style>
