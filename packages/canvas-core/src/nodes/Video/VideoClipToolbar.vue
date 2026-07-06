<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { clampClipRange, formatTime } from './videoNodeUtils'

const props = defineProps<{
  videoUrl: string
  duration: number
  start: number
  end: number
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
const range = computed(() => clampClipRange({ start: localStart.value, end: localEnd.value, duration: safeDuration.value }))
const startPct = computed(() => range.value.start / safeDuration.value * 100)
const endPct = computed(() => range.value.end / safeDuration.value * 100)
const widthPct = computed(() => Math.max(0, endPct.value - startPct.value))
const lengthLabel = computed(() => `${formatTime(range.value.end - range.value.start)} s`)

function normalizeTime(value: number) {
  const next = snapToSecond.value ? Math.round(value) : value
  return Math.min(safeDuration.value, Math.max(0, next))
}

function setRange(start: number, end: number) {
  const next = clampClipRange({ start: normalizeTime(start), end: normalizeTime(end), duration: safeDuration.value })
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
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onWindowMove(e: PointerEvent) {
  if (!dragging.value) return
  const t = clientToTime(e.clientX)
  if (dragging.value === 'start') setRange(t, localEnd.value)
  else if (dragging.value === 'end') setRange(localStart.value, t)
  else setRange(t - dragOffset.value, t - dragOffset.value + (range.value.end - range.value.start))
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
      <div class="clip-thumbs">
        <div v-for="(src, i) in thumbnails" :key="i" class="clip-thumb" :style="{ backgroundImage: `url(${src})` }" />
        <div v-if="thumbnails.length === 0" class="clip-thumb-fallback" />
      </div>
      <div class="clip-window" :style="{ left: startPct + '%', width: widthPct + '%' }" @pointerdown.stop="onWindowDown">
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
.video-clip-toolbar { display: flex; align-items: center; gap: 12px; width: min(900px, 84vw); padding: 10px 12px; border-radius: 18px; background: rgba(34,34,34,.96); color: white; box-shadow: 0 12px 34px rgba(0,0,0,.28); pointer-events: auto; }
.clip-icon-button, .clip-side-button, .clip-confirm-button { width: 38px; height: 38px; border: 0; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; color: white; background: rgba(255,255,255,.08); cursor: pointer; }
.clip-icon-button:hover, .clip-side-button:hover { background: rgba(255,255,255,.16); }
.clip-icon-button.active { color: #111; background: #fff; }
.clip-confirm-button { width: 52px; border-radius: 14px; color: #111; background: #fff; }
.clip-icon-button svg, .clip-side-button svg, .clip-confirm-button svg { width: 20px; height: 20px; }
.clip-divider { width: 1px; height: 30px; background: rgba(255,255,255,.12); }
.clip-track { position: relative; flex: 1; min-width: 320px; height: 54px; border-radius: 14px; overflow: hidden; background: #111; cursor: grab; }
.clip-track:active { cursor: grabbing; }
.clip-thumbs { position: absolute; inset: 0; display: flex; opacity: .82; }
.clip-thumb { flex: 1; background-size: cover; background-position: center; }
.clip-thumb-fallback { position: absolute; inset: 0; background: linear-gradient(90deg, #1f2937, #111827 45%, #374151); }
.clip-track::after { content: ''; position: absolute; inset: 0; background: rgba(0,0,0,.42); pointer-events: none; }
.clip-window { position: absolute; top: 4px; bottom: 4px; z-index: 2; min-width: 72px; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; border-radius: 12px; background: rgba(255,255,255,.14); box-shadow: 0 0 0 999px rgba(0,0,0,.34); }
.clip-window strong { padding: 4px 10px; border-radius: 999px; background: rgba(0,0,0,.72); font-size: 12px; line-height: 1; }
.clip-grip { position: absolute; top: 0; bottom: 0; width: 20px; display: flex; align-items: center; justify-content: center; color: #111; background: #fff; cursor: ew-resize; }
.clip-grip svg { width: 12px; height: 24px; }
.clip-grip-left { left: 0; border-radius: 10px 0 0 10px; }
.clip-grip-right { right: 0; border-radius: 0 10px 10px 0; }
</style>
