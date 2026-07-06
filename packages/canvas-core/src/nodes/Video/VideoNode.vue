<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { Position, useVueFlow } from '@vue-flow/core'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import BaseNode from '../../components/Decoration/BaseNode.vue'
import NodeToolbar from '../../components/Decoration/NodeToolbar.vue'
import BaseToolbar from '../../components/Toolbar/BaseToolbar.vue'
import { useCanvasRuntime } from '../../runtime/useCanvasRuntime'
import { useCanvasStore } from '../../composables/useCanvasStore'
import { formatFileSize } from '../../utils/format'
import VideoCropper from './VideoCropper.vue'
import VideoClipToolbar from './VideoClipToolbar.vue'
import { fitVideoCardSize, formatTime, makeImageNodeFromFrame } from './videoNodeUtils'

interface RectLike { x: number; y: number; width: number; height: number }

defineOptions({ inheritAttrs: false })

const props = defineProps<NodeProps>()
const runtime = useCanvasRuntime()
const canvas = useCanvasStore()
const vf = useVueFlow()
const videoRef = ref<HTMLVideoElement | null>(null)
const fullscreenVideoRef = ref<HTMLVideoElement | null>(null)
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(Number(props.data?.videoDuration) || 0)
const fullscreen = ref(false)
const captureBusy = ref(false)

const videoUrl = computed(() => (props.data?.videoUrl as string) || '')
const isCropping = computed(() => props.data?._overlay?._cropMode === true)
const isClipping = computed(() => props.data?._overlay?._clipMode === true)
const clipRange = computed(() => props.data?._overlay?._clipRange || {
  start: Number(props.data?.clipStart) || 0,
  end: Number(props.data?.clipEnd) || duration.value || Number(props.data?.videoDuration) || 0,
})
const savedClipStart = computed(() => Number(props.data?.clipStart) || 0)
const savedClipEnd = computed(() => Number(props.data?.clipEnd) || duration.value || Number(props.data?.videoDuration) || 0)
const playStart = computed(() => isClipping.value ? clipRange.value.start : savedClipStart.value)
const playEnd = computed(() => isClipping.value ? clipRange.value.end : savedClipEnd.value)
const playableDuration = computed(() => Math.max(0.1, playEnd.value - playStart.value || duration.value || 0.1))
const displayCurrent = computed(() => Math.max(0, currentTime.value - playStart.value))
const displayDuration = computed(() => props.data?.clipStart !== undefined || props.data?.clipEnd !== undefined
  ? Math.max(0.1, savedClipEnd.value - savedClipStart.value)
  : duration.value)
const bottomOffset = computed(() => canvas.state.core.bottomToolbarOffset)
const nodeLabel = computed(() => (props.data?.label as string) || (props.data?.videoName as string) || '视频')
const dims = computed(() => {
  const parts: string[] = []
  const w = Number(props.data?.videoWidth) || 0
  const h = Number(props.data?.videoHeight) || 0
  const size = Number(props.data?.videoSize) || 0
  if (w && h) parts.push(`${w}×${h}`)
  if (displayDuration.value) parts.push(formatTime(displayDuration.value))
  if (size) parts.push(formatFileSize(size))
  return parts.join(' · ')
})

const titleIconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>'

const cropVideoStyle = computed(() => {
  const rect = props.data?.cropRect as RectLike | undefined
  const sourceW = Number(props.data?.cropSourceWidth || props.data?.videoWidth) || rect?.width || 1
  const sourceH = Number(props.data?.cropSourceHeight || props.data?.videoHeight) || rect?.height || 1
  if (!rect) return undefined
  return {
    width: `${sourceW / rect.width * 100}%`,
    height: `${sourceH / rect.height * 100}%`,
    left: `${-rect.x / rect.width * 100}%`,
    top: `${-rect.y / rect.height * 100}%`,
  }
})
const fullscreenStageStyle = computed(() => {
  const rect = props.data?.cropRect as RectLike | undefined
  if (!rect?.width || !rect?.height) return undefined
  return { '--crop-ratio': String(rect.width / rect.height) }
})

function getMainVideo() {
  return fullscreen.value ? fullscreenVideoRef.value || videoRef.value : videoRef.value
}

async function togglePlay() {
  const video = getMainVideo()
  if (!video || !videoUrl.value) return
  if (video.paused) {
    if (video.currentTime < playStart.value || video.currentTime >= playEnd.value) video.currentTime = playStart.value
    await video.play().catch(() => {})
  } else {
    video.pause()
  }
}

function onLoadedMetadata(e: Event) {
  const video = e.target as HTMLVideoElement
  duration.value = video.duration || duration.value
  if (playStart.value > 0 && video.currentTime < playStart.value) video.currentTime = playStart.value
  if (!video.videoWidth || !video.videoHeight) return

  const nextDuration = Math.round(video.duration || 0)
  const crop = props.data?.cropRect as RectLike | undefined
  if (crop) {
    if (!props.data?.cropSourceWidth || !props.data?.cropSourceHeight || !props.data?.videoDuration) {
      vf.updateNode(props.id, {
        data: {
          ...props.data,
          cropSourceWidth: props.data?.cropSourceWidth || video.videoWidth,
          cropSourceHeight: props.data?.cropSourceHeight || video.videoHeight,
          videoDuration: props.data?.videoDuration || nextDuration,
        },
      })
    }
    return
  }

  const nextSize = fitVideoCardSize(video.videoWidth, video.videoHeight)
  const isClipResult = props.data?.clipStart !== undefined || props.data?.clipEnd !== undefined
  const nextData = {
    ...props.data,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    videoDuration: isClipResult ? props.data?.videoDuration : nextDuration,
    cardWidth: nextSize.cardWidth,
    cardHeight: nextSize.cardHeight,
  }
  if (
    props.data?.videoWidth !== nextData.videoWidth ||
    props.data?.videoHeight !== nextData.videoHeight ||
    props.data?.videoDuration !== nextData.videoDuration ||
    props.data?.cardWidth !== nextData.cardWidth ||
    props.data?.cardHeight !== nextData.cardHeight
  ) {
    vf.updateNode(props.id, { data: nextData })
  }
}

function onTimeUpdate(e: Event) {
  const video = e.target as HTMLVideoElement
  currentTime.value = video.currentTime
  isPlaying.value = !video.paused
  if (video.currentTime >= playEnd.value && playEnd.value > playStart.value) {
    video.pause()
    video.currentTime = playEnd.value
  }
}

function seekToDisplayTime(value: number) {
  const video = getMainVideo()
  if (!video) return
  video.currentTime = playStart.value + Number(value)
  currentTime.value = video.currentTime
}

function onCropUpdate(rect: RectLike) {
  vf.updateNode(props.id, { data: { ...props.data, _overlay: { ...props.data._overlay, _cropRect: rect } } })
}

function onClipUpdate(range: { start: number; end: number }) {
  vf.updateNode(props.id, { data: { ...props.data, _overlay: { ...props.data._overlay, _clipRange: range } } })
  seekToDisplayTime(0)
}

function runCommand(id: string) {
  runtime.commandRegistry.execute(id, { runtime, node: props, logger: console } as any)
}

function downloadVideo() {
  if (!videoUrl.value) return
  const a = document.createElement('a')
  a.href = videoUrl.value
  a.download = (props.data?.videoName as string) || 'video.mp4'
  a.click()
}

function waitForSeek(video: HTMLVideoElement, time: number) {
  return new Promise<void>((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.03) { resolve(); return }
    const done = () => { video.removeEventListener('seeked', done); resolve() }
    video.addEventListener('seeked', done, { once: true })
    video.currentTime = time
  })
}

async function captureFrameAt(kind: 'start' | 'end') {
  const video = getMainVideo()
  if (!video || !video.videoWidth || !video.videoHeight || captureBusy.value) return
  captureBusy.value = true
  const wasPaused = video.paused
  const oldTime = video.currentTime
  const targetTime = kind === 'start' ? playStart.value : Math.max(playStart.value, playEnd.value - 0.05)
  try {
    video.pause()
    await waitForSeek(video, targetTime)
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return
    const url = URL.createObjectURL(blob)
    let assetId: string | undefined
    const assetManager = (runtime as any).getPluginAPI?.('storage')?.assets
    const suffix = kind === 'start' ? 'first' : 'last'
    if (assetManager) {
      const fileName = `${String(props.data?.videoName || 'video').replace(/\.[^.]+$/, '')}_${suffix}_frame.png`
      try { assetId = await assetManager.saveAsset(new File([blob], fileName, { type: 'image/png' }), fileName, 'image/png') }
      catch (err) { console.error('保存视频截图失败:', err) }
    }
    const sourceNode = vf.getNodes.value.find((n) => n.id === props.id)
    if (!sourceNode) return
    vf.addNodes([makeImageNodeFromFrame(sourceNode, { url, width: canvas.width, height: canvas.height, assetId, at: targetTime })])
  } finally {
    await waitForSeek(video, oldTime).catch(() => {})
    if (!wasPaused) video.play().catch(() => {})
    captureBusy.value = false
  }
}

function openFullscreen() {
  fullscreen.value = true
  nextTick(() => {
    const src = videoRef.value
    const target = fullscreenVideoRef.value
    if (src && target) {
      target.currentTime = src.currentTime
      if (!src.paused) target.play().catch(() => {})
    }
  })
}

function closeFullscreen() {
  const src = fullscreenVideoRef.value
  const target = videoRef.value
  if (src && target) target.currentTime = src.currentTime
  fullscreen.value = false
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && fullscreen.value) closeFullscreen()
}

function onFullscreenEvent(e: Event) {
  const detail = (e as CustomEvent).detail
  if (detail?.nodeId === props.id) openFullscreen()
}
function onCaptureEvent(e: Event) {
  const detail = (e as CustomEvent).detail
  if (detail?.nodeId === props.id) captureFrameAt('start')
}

watch(videoUrl, () => {
  currentTime.value = playStart.value
  isPlaying.value = false
})

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('video:fullscreen', onFullscreenEvent)
  window.addEventListener('video:capture-frame', onCaptureEvent)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('video:fullscreen', onFullscreenEvent)
  window.removeEventListener('video:capture-frame', onCaptureEvent)
})
</script>

<template>
  <BaseNode v-bind="$props">
    <template #title-icon><span class="w-3.5 h-3.5 shrink-0 inline-flex items-center" v-html="titleIconSvg" /></template>
    <template #title-label><span class="truncate">{{ nodeLabel }}</span></template>
    <template #title-extra><span v-if="dims" class="text-gray-400 shrink-0 ml-auto">{{ dims }}</span></template>
    <template #top-toolbar><BaseToolbar v-bind="$props" toolbar-position="top" /></template>

    <template #content>
      <div class="video-node" :class="{ 'is-editing': isCropping || isClipping }">
        <template v-if="videoUrl">
          <div class="video-stage" :class="{ 'has-crop': data?.cropRect }">
            <video
              ref="videoRef"
              class="video-media"
              :class="{ 'video-media--cropped': data?.cropRect }"
              :style="cropVideoStyle"
              :src="videoUrl"
              playsinline
              preload="metadata"
              @loadedmetadata="onLoadedMetadata"
              @timeupdate="onTimeUpdate"
              @play="isPlaying = true"
              @pause="isPlaying = false"
            />
          </div>

          <button class="video-corner-button video-download" title="下载" @click.stop="downloadVideo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>

          <div class="video-controls nodrag nopan" @dblclick.stop>
            <button class="video-play-button" title="播放/暂停" @click.stop="togglePlay">
              <svg v-if="!isPlaying" viewBox="0 0 24 24" fill="currentColor"><polygon points="7,4 19,12 7,20" /></svg>
              <svg v-else viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
            </button>
            <span class="video-time">{{ formatTime(displayCurrent) }}</span>
            <label class="video-progress" title="拖动调整进度">
              <input :value="displayCurrent" type="range" :min="0" :max="playableDuration" step="0.01" @input="seekToDisplayTime(Number(($event.target as HTMLInputElement).value))" />
              <span class="video-progress-fill" :style="{ width: (displayCurrent / playableDuration * 100) + '%' }" />
            </label>
            <span class="video-time">{{ formatTime(playableDuration) }}</span>
            <div class="video-camera-menu" :class="{ 'is-busy': captureBusy }">
              <button class="video-camera-button" :disabled="captureBusy" title="截图" type="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
              </button>
              <div class="video-camera-popover">
                <button @click.stop="captureFrameAt('start')">截首帧图</button>
                <button @click.stop="captureFrameAt('end')">截尾帧图</button>
              </div>
            </div>
          </div>

          <div v-if="!isPlaying" class="video-center-play" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19" /></svg>
          </div>

          <VideoCropper v-if="isCropping" :node-id="id" :video-width="(data?.videoWidth as number) || 1" :video-height="(data?.videoHeight as number) || 1" @update:crop="onCropUpdate" />
        </template>
        <div v-else class="video-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          <span>{{ nodeLabel }}</span>
        </div>
      </div>
    </template>

    <template #bottom-toolbar>
      <NodeToolbar v-if="isClipping" :node-id="id" :position="Position.Bottom" :offset="bottomOffset">
        <VideoClipToolbar
          :video-url="videoUrl"
          :duration="duration || (data?.videoDuration as number) || 0.1"
          :start="clipRange.start"
          :end="clipRange.end"
          @update:clip="onClipUpdate"
          @cancel="runCommand('video.clipCancel')"
          @confirm="runCommand('video.clipConfirm')"
        />
      </NodeToolbar>
    </template>
  </BaseNode>

  <Teleport to="body">
    <div v-if="fullscreen" class="video-fullscreen" @click.self="closeFullscreen">
      <div class="video-fullscreen-stage" :class="{ 'has-crop': data?.cropRect }" :style="fullscreenStageStyle">
        <video
          ref="fullscreenVideoRef"
          class="video-fullscreen-media"
          :class="{ 'video-fullscreen-media--cropped': data?.cropRect }"
          :style="data?.cropRect ? cropVideoStyle : undefined"
          :src="videoUrl"
          autoplay
          playsinline
          @loadedmetadata="onLoadedMetadata"
          @timeupdate="onTimeUpdate"
          @play="isPlaying = true"
          @pause="isPlaying = false"
        />
      </div>
      <button class="video-fullscreen-close" title="退出全屏 (Esc)" @click="closeFullscreen">×</button>
      <div class="video-fullscreen-controls nodrag nopan">
        <button class="video-play-button" title="播放/暂停" @click.stop="togglePlay">
          <svg v-if="!isPlaying" viewBox="0 0 24 24" fill="currentColor"><polygon points="7,4 19,12 7,20" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
        </button>
        <span class="video-time">{{ formatTime(displayCurrent) }}</span>
        <label class="video-progress"><input :value="displayCurrent" type="range" :min="0" :max="playableDuration" step="0.01" @input="seekToDisplayTime(Number(($event.target as HTMLInputElement).value))" /><span class="video-progress-fill" :style="{ width: (displayCurrent / playableDuration * 100) + '%' }" /></label>
        <span class="video-time">{{ formatTime(playableDuration) }}</span>
        <button class="video-camera-button" title="截首帧图" @click.stop="captureFrameAt('start')">首帧</button>
        <button class="video-camera-button" title="截尾帧图" @click.stop="captureFrameAt('end')">尾帧</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.video-node { position: relative; width: 100%; height: 100%; background: #050505; color: white; overflow: hidden; }
.video-node.is-editing { background: radial-gradient(circle at center, #1f2937 0%, #050505 72%); }
.video-node.is-editing .video-media { opacity: .38; filter: saturate(.8) contrast(.92); }
.video-stage { position: absolute; inset: 0; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.video-media { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #050505; }
.video-media--cropped { inset: auto; object-fit: fill; max-width: none; max-height: none; }
.video-corner-button { position: absolute; z-index: 8; width: 34px; height: 34px; border: 0; color: rgba(255,255,255,.82); background: transparent; cursor: pointer; }
.video-corner-button:hover { color: #fff; }
.video-corner-button svg { width: 22px; height: 22px; }
.video-download { top: 14px; right: 16px; }
.video-controls { position: absolute; left: 18px; right: 18px; bottom: 14px; z-index: 9; display: flex; align-items: center; gap: 10px; }
.video-play-button, .video-camera-button { width: 30px; height: 30px; padding: 0; border: 0; color: #fff; background: transparent; cursor: pointer; }
.video-play-button svg, .video-camera-button svg { width: 24px; height: 24px; }
.video-time { min-width: 36px; font-size: 13px; line-height: 1; text-shadow: 0 1px 3px rgba(0,0,0,.8); }
.video-progress { position: relative; flex: 1; height: 12px; display: flex; align-items: center; cursor: pointer; }
.video-progress::before { content: ''; position: absolute; left: 0; right: 0; top: 4px; height: 4px; border-radius: 99px; background: rgba(255,255,255,.38); }
.video-progress-fill { position: absolute; left: 0; top: 4px; height: 4px; border-radius: 99px; background: #fff; pointer-events: none; }
.video-progress input { position: absolute; inset: 0; width: 100%; opacity: 0; cursor: pointer; }
.video-center-play { position: absolute; z-index: 7; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 56px; height: 56px; color: rgba(255,255,255,.95); pointer-events: none; }
.video-center-play svg { width: 46px; height: 46px; filter: drop-shadow(0 2px 8px rgba(0,0,0,.35)); }
.video-camera-menu { position: relative; display: inline-flex; }
.video-camera-popover { position: absolute; right: 0; bottom: 34px; display: none; min-width: 92px; padding: 5px; border-radius: 10px; background: rgba(20,20,20,.94); box-shadow: 0 10px 24px rgba(0,0,0,.28); }
.video-camera-menu:hover .video-camera-popover { display: grid; gap: 3px; }
.video-camera-popover button { border: 0; border-radius: 7px; padding: 7px 8px; background: transparent; color: #fff; font-size: 12px; white-space: nowrap; cursor: pointer; text-align: left; }
.video-camera-popover button:hover { background: rgba(255,255,255,.12); }
.video-empty { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; background: #111827; color: rgba(255,255,255,.55); font-size: 13px; }
.video-empty svg { width: 48px; height: 48px; color: rgba(255,255,255,.28); }
.video-fullscreen { position: fixed; inset: 0; z-index: 99999; background: #000; display: flex; align-items: center; justify-content: center; }
.video-fullscreen-stage { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
.video-fullscreen-stage.has-crop { width: min(100vw, calc(100vh * var(--crop-ratio))); height: min(100vh, calc(100vw / var(--crop-ratio))); }
.video-fullscreen-media { width: 100%; height: 100%; object-fit: contain; }
.video-fullscreen-media--cropped { position: absolute; object-fit: fill; max-width: none; max-height: none; }
.video-fullscreen-close { position: absolute; top: 18px; right: 18px; width: 42px; height: 42px; border: 0; border-radius: 14px; background: rgba(255,255,255,.12); color: #fff; font-size: 28px; cursor: pointer; }
.video-fullscreen-controls { position: absolute; left: 50%; bottom: 28px; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; width: min(760px, calc(100vw - 80px)); padding: 10px 14px; border-radius: 16px; background: rgba(20,20,20,.72); backdrop-filter: blur(10px); }
.video-fullscreen-controls .video-camera-button { width: auto; padding: 0 10px; border-radius: 8px; background: rgba(255,255,255,.12); font-size: 12px; }
</style>
