<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { clampClipEnd, clampClipRange, clampClipStart, formatTime, moveClipRange } from './videoNodeUtils'

const props = defineProps<{
  videoUrl: string
  duration: number
  start: number
  end: number
  minDuration?: number
  currentTime?: number
}>()

const emit = defineEmits<{
  (e: 'update:clip', value: { start: number; end: number }): void
  (e: 'cancel'): void
  (e: 'confirm'): void
}>()

const localStart = ref(props.start)
const localEnd = ref(props.end)
const snapToSecond = ref(false)
const trackRef = ref<HTMLElement | null>(null)
const thumbnails = ref<string[]>([])
const dragging = ref<'start' | 'end' | 'move' | null>(null)
const dragOffset = ref(0)

watch(() => [props.start, props.end, props.duration], () => {
  localStart.value = props.start
  localEnd.value = props.end
})
watch(() => props.videoUrl, () => generateThumbnails(), { immediate: true })

const safeDuration = computed(() => Math.max(0.1, Number(props.duration) || 0.1))
const minClipDuration = computed(() => Math.min(safeDuration.value, Math.max(0.1, Number(props.minDuration) || 1)))
const range = computed(() => clampClipRange({ start: localStart.value, end: localEnd.value, duration: safeDuration.value, minDuration: minClipDuration.value }))
const startPct = computed(() => range.value.start / safeDuration.value * 100)
const endPct = computed(() => range.value.end / safeDuration.value * 100)
const widthPct = computed(() => Math.max(0, endPct.value - startPct.value))
const windowThumbStyle = computed(() => {
  const width = Math.max(0.001, widthPct.value)
  return {
    width: `${10000 / width}%`,
    transform: `translateX(-${startPct.value}%)`,
  }
})
const lengthLabel = computed(() => `${formatTime(range.value.end - range.value.start)} s`)
const playheadPct = computed(() => {
  const length = Math.max(0.1, range.value.end - range.value.start)
  const t = Math.min(range.value.end, Math.max(range.value.start, Number(props.currentTime) || range.value.start))
  return (t - range.value.start) / length * 100
})

function normalizeTime(value: number) {
  const next = snapToSecond.value ? Math.round(value) : value
  return Math.min(safeDuration.value, Math.max(0, next))
}

function setRange(start: number, end: number) {
  const next = clampClipRange({ start: normalizeTime(start), end: normalizeTime(end), duration: safeDuration.value, minDuration: minClipDuration.value })
  localStart.value = next.start
  localEnd.value = next.end
  emit('update:clip', next)
}

function setStart(start: number) {
  const next = clampClipStart({ start: normalizeTime(start), end: localEnd.value, duration: safeDuration.value, minDuration: minClipDuration.value })
  localStart.value = next.start
  localEnd.value = next.end
  emit('update:clip', next)
}

function setEnd(end: number) {
  const next = clampClipEnd({ start: localStart.value, end: normalizeTime(end), duration: safeDuration.value, minDuration: minClipDuration.value })
  localStart.value = next.start
  localEnd.value = next.end
  emit('update:clip', next)
}

function moveRange(nextStart: number) {
  const next = moveClipRange({
    start: localStart.value,
    end: localEnd.value,
    nextStart: normalizeTime(nextStart),
    duration: safeDuration.value,
    minDuration: minClipDuration.value,
  })
  localStart.value = next.start
  localEnd.value = next.end
  emit('update:clip', next)
}

function clientToTime(clientX: number) {
  const rect = trackRef.value?.getBoundingClientRect()
  if (!rect) return 0
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  return ratio * safeDuration.value
}

function onHandleDown(which: 'start' | 'end', e: PointerEvent) {
  e.preventDefault()
  e.stopPropagation()
  dragging.value = which
  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* synthetic pointer event */ }
}

function onWindowMove(e: PointerEvent) {
  if (!dragging.value) return
  const t = clientToTime(e.clientX)
  if (dragging.value === 'start') setStart(t)
  else if (dragging.value === 'end') setEnd(t)
  else moveRange(t - dragOffset.value)
}

function onWindowUp() { dragging.value = null }

function onWindowDown(e: PointerEvent) {
  e.preventDefault()
  e.stopPropagation()
  const t = clientToTime(e.clientX)
  dragOffset.value = t - range.value.start
  dragging.value = 'move'
}

async function generateThumbnails() {
  thumbnails.value = []
  if (!props.videoUrl) return
  const video = document.createElement('video')
  video.crossOrigin = 'anonymous'
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = props.videoUrl
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('video thumbnail load failed'))
    })
    const canvas = document.createElement('canvas')
    const ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9
    canvas.width = 96
    canvas.height = Math.round(canvas.width / ratio)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const count = 12
    for (let i = 0; i < count; i++) {
      const time = Math.min(Math.max(video.duration - 0.05, 0), (video.duration || safeDuration.value) * (i / Math.max(1, count - 1)))
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve()
        video.currentTime = time
      })
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      thumbnails.value.push(canvas.toDataURL('image/jpeg', 0.72))
    }
  } catch {
    thumbnails.value = []
  } finally {
    video.src = ''
  }
}

function resetRange() { setRange(0, safeDuration.value) }

onMounted(() => {
  window.addEventListener('pointermove', onWindowMove)
  window.addEventListener('pointerup', onWindowUp)
})
onUnmounted(() => {
  window.removeEventListener('pointermove', onWindowMove)
  window.removeEventListener('pointerup', onWindowUp)
})
</script>

<template>
  <div class="video-clip-toolbar nodrag nopan" @pointerdown.stop @dblclick.stop>
    <button class="clip-icon-button" title="取消" @click="emit('cancel')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
    <div class="clip-divider" />
    <button class="clip-side-button" title="快捷键">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h.01M11 9h.01M15 9h.01M8 13h8"/></svg>
    </button>
    <div ref="trackRef" class="clip-track" @pointerdown="onWindowDown">
      <div class="clip-rail">
        <div class="clip-thumbs">
          <div v-for="(src, i) in thumbnails" :key="i" class="clip-thumb" :style="{ backgroundImage: `url(${src})` }" />
          <div v-if="thumbnails.length === 0" class="clip-thumb-fallback" />
        </div>
      </div>
      <div class="clip-window" :style="{ left: startPct + '%', width: widthPct + '%' }" @pointerdown.stop="onWindowDown">
        <div class="clip-window-body">
          <div class="clip-window-thumbs" :style="windowThumbStyle">
            <div v-for="(src, i) in thumbnails" :key="i" class="clip-thumb" :style="{ backgroundImage: `url(${src})` }" />
            <div v-if="thumbnails.length === 0" class="clip-thumb-fallback" />
          </div>
          <span class="clip-playhead" :style="{ left: playheadPct + '%' }" />
        </div>
        <span class="clip-grip clip-grip-left" @pointerdown.stop="onHandleDown('start', $event)">
          <svg viewBox="0 0 12 24" fill="none"><path d="M8 6L4 12l4 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <strong>{{ lengthLabel }}</strong>
        <span class="clip-grip clip-grip-right" @pointerdown.stop="onHandleDown('end', $event)">
          <svg viewBox="0 0 12 24" fill="none"><path d="M4 6l4 6-4 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </div>
    </div>
    <button class="clip-icon-button" :class="{ active: snapToSecond }" title="开启整秒吸附" @click="snapToSecond = !snapToSecond">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg>
    </button>
    <button class="clip-icon-button" title="重置" @click="resetRange">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.5 15a9 9 0 102.1-9.4L1 10"/></svg>
    </button>
    <button class="clip-confirm-button" title="确认剪辑" @click="emit('confirm')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
    </button>
  </div>
</template>

<style scoped>
.video-clip-toolbar { display: flex; align-items: center; gap: 12px; width: min(900px, 84vw); padding: 10px 12px; border-radius: 18px; background: var(--canvas-node-panel-surface, #fff); color: var(--canvas-node-text, #111827); box-shadow: 0 14px 36px var(--canvas-node-shadow-panel, rgba(15,23,42,.12)); border: 1px solid var(--canvas-node-border, #e5e7eb); pointer-events: auto; }
.clip-icon-button, .clip-side-button, .clip-confirm-button { width: 38px; height: 38px; border: 0; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; color: #4b5563; background: var(--canvas-node-panel-surface-hover, #f3f4f6); cursor: pointer; }
.clip-icon-button:hover, .clip-side-button:hover { background: var(--canvas-node-panel-surface-active, #e5e7eb); color: #111827; }
.clip-icon-button.active { color: #111827; background: #e5e7eb; box-shadow: inset 0 0 0 1px rgba(17,24,39,.12); }
.clip-confirm-button { width: 52px; border-radius: 14px; color: #fff; background: #111827; }
.clip-icon-button svg, .clip-side-button svg, .clip-confirm-button svg { width: 20px; height: 20px; }
.clip-divider { width: 1px; height: 30px; background: #e5e7eb; }
.clip-track { position: relative; flex: 1; min-width: 320px; height: 54px; overflow: visible; cursor: grab; }
.clip-track:active { cursor: grabbing; }
.clip-rail { position: absolute; inset: 0; border-radius: 14px; overflow: hidden; background: #111827; box-shadow: none; }
.clip-thumbs { position: absolute; inset: 0; display: flex; opacity: 1; filter: none; }
.clip-thumb { flex: 1; background-size: cover; background-position: center; opacity: 1; filter: none; }
.clip-thumb-fallback { position: absolute; inset: 0; background: #111827; }
.clip-rail::after { content: ''; position: absolute; inset: 0; background: rgba(255,255,255,.52); pointer-events: none; }
.clip-window { position: absolute; top: 0; bottom: 0; z-index: 2; display: flex; align-items: center; justify-content: center; border-radius: 14px; }
.clip-window-body { position: absolute; inset: 0; box-sizing: border-box; border: 2px solid #fff; border-radius: 14px; background: transparent; box-shadow: 0 4px 14px rgba(15,23,42,.18); overflow: hidden; }
.clip-window-thumbs { position: absolute; top: 0; bottom: 0; left: 0; display: flex; transform-origin: left center; }
.clip-playhead { position: absolute; top: 0; bottom: 0; width: 2px; transform: translateX(-1px); background: rgba(255,255,255,.95); box-shadow: 0 0 0 1px rgba(17,24,39,.2); pointer-events: none; }
.clip-window strong { position: relative; z-index: 3; padding: 4px 10px; border-radius: 999px; background: rgba(17,24,39,.82); color: #fff; font-size: 12px; line-height: 1; white-space: nowrap; pointer-events: none; }
.clip-grip { position: absolute; top: 0; bottom: 0; z-index: 4; width: 22px; display: flex; align-items: center; justify-content: center; color: #111827; background: #fff; cursor: ew-resize; box-shadow: 0 4px 12px rgba(15,23,42,.18); }
.clip-grip svg { width: 12px; height: 24px; }
.clip-grip-left { left: -12px; border-radius: 10px 0 0 10px; }
.clip-grip-right { right: -12px; border-radius: 0 10px 10px 0; }
</style>
