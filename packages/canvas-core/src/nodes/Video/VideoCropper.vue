<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'
import { getRectOfNodes, useVueFlow } from '@vue-flow/core'
import { useImageDisplay } from '../image/useImageDisplay'

const props = defineProps<{
  nodeId: string
  videoWidth: number
  videoHeight: number
}>()

const emit = defineEmits<{
  (e: 'update:crop', rect: { x: number; y: number; width: number; height: number }): void
}>()

const { viewport, findNode } = useVueFlow()
const MIN_CROP = 20
const node = computed(() => findNode(props.nodeId))
const nodeRect = computed(() => {
  const n = node.value
  return n ? getRectOfNodes([n]) : { x: 0, y: 0, width: 256, height: 256 }
})
const containerW = computed(() => nodeRect.value.width * viewport.value.zoom)
const containerH = computed(() => nodeRect.value.height * viewport.value.zoom)
const zIndex = computed(() => (node.value?.computedPosition?.z || 1) + 100)
const wrapperStyle = computed<CSSProperties>(() => {
  const rect = nodeRect.value
  const z = viewport.value.zoom
  return {
    position: 'fixed',
    left: `${rect.x * z + viewport.value.x}px`,
    top: `${rect.y * z + viewport.value.y}px`,
    width: `${rect.width * z}px`,
    height: `${rect.height * z}px`,
    zIndex: zIndex.value,
    borderRadius: '12px',
    pointerEvents: 'auto',
  }
})

const display = useImageDisplay(containerW, containerH, props.videoWidth, props.videoHeight)
const crop = reactive({ x: 0, y: 0, w: 0, h: 0 })
const overlayRef = ref<HTMLElement | null>(null)

type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e'
type Drag =
  | { kind: 'move'; sx: number; sy: number; scX: number; scY: number }
  | { kind: 'resize'; dir: Handle; sx: number; sy: number; scX: number; scY: number; scW: number; scH: number }
  | null
const drag = ref<Drag>(null)
const handles: Handle[] = ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e']

function initCrop() {
  const w = Math.max(props.videoWidth, MIN_CROP)
  const h = Math.max(props.videoHeight, MIN_CROP)
  crop.w = Math.round(w * 0.8)
  crop.h = Math.round(h * 0.8)
  crop.x = Math.round((w - crop.w) / 2)
  crop.y = Math.round((h - crop.h) / 2)
}

function clamp(nx: number, ny: number, nw: number, nh: number) {
  const maxW = Math.max(props.videoWidth, MIN_CROP)
  const maxH = Math.max(props.videoHeight, MIN_CROP)
  nw = Math.min(Math.max(MIN_CROP, nw), maxW)
  nh = Math.min(Math.max(MIN_CROP, nh), maxH)
  nx = Math.max(0, Math.min(nx, maxW - nw))
  ny = Math.max(0, Math.min(ny, maxH - nh))
  return { x: nx, y: ny, w: nw, h: nh }
}

function getCropRect() {
  return { x: Math.round(crop.x), y: Math.round(crop.y), width: Math.round(crop.w), height: Math.round(crop.h) }
}
function emitCrop() { emit('update:crop', getCropRect()) }
defineExpose({ getCropRect })

function onPointerDown(e: PointerEvent, dir?: Handle) {
  e.preventDefault()
  e.stopPropagation()
  if (dir) {
    drag.value = { kind: 'resize', dir, sx: e.clientX, sy: e.clientY, scX: crop.x, scY: crop.y, scW: crop.w, scH: crop.h }
  } else {
    drag.value = { kind: 'move', sx: e.clientX, sy: e.clientY, scX: crop.x, scY: crop.y }
  }
  overlayRef.value?.setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!drag.value) return
  const d = drag.value
  const dx = (e.clientX - d.sx) / display.value.scale
  const dy = (e.clientY - d.sy) / display.value.scale
  if (d.kind === 'move') {
    const r = clamp(d.scX + dx, d.scY + dy, crop.w, crop.h)
    crop.x = r.x; crop.y = r.y
    return
  }

  const right = d.scX + d.scW
  const bottom = d.scY + d.scH
  let nx = d.scX, ny = d.scY, nw = d.scW, nh = d.scH
  if (d.dir.includes('w')) { nx = Math.max(0, Math.min(d.scX + dx, right - MIN_CROP)); nw = right - nx }
  if (d.dir.includes('e')) { nw = Math.max(MIN_CROP, Math.min(d.scW + dx, props.videoWidth - nx)) }
  if (d.dir.includes('n')) { ny = Math.max(0, Math.min(d.scY + dy, bottom - MIN_CROP)); nh = bottom - ny }
  if (d.dir.includes('s')) { nh = Math.max(MIN_CROP, Math.min(d.scH + dy, props.videoHeight - ny)) }
  const r = clamp(nx, ny, nw, nh)
  crop.x = r.x; crop.y = r.y; crop.w = r.w; crop.h = r.h
}

function onPointerUp(e: PointerEvent) {
  drag.value = null
  try { overlayRef.value?.releasePointerCapture(e.pointerId) } catch { /* noop */ }
  emitCrop()
}

let emitTimer: ReturnType<typeof setTimeout> | null = null
watch(crop, () => {
  if (emitTimer) clearTimeout(emitTimer)
  emitTimer = setTimeout(emitCrop, 16)
}, { deep: true })

onMounted(() => { initCrop(); nextTick(emitCrop) })
onUnmounted(() => { if (emitTimer) clearTimeout(emitTimer) })

const frameStyle = computed(() => {
  const d = display.value
  return {
    left: `${d.ox + crop.x * d.scale}px`,
    top: `${d.oy + crop.y * d.scale}px`,
    width: `${crop.w * d.scale}px`,
    height: `${crop.h * d.scale}px`,
  }
})
const shadeTop = computed(() => ({ top: '0', left: '0', width: `${containerW.value}px`, height: `${display.value.oy + crop.y * display.value.scale}px` }))
const shadeBottom = computed(() => {
  const bottom = display.value.oy + (crop.y + crop.h) * display.value.scale
  return { top: `${bottom}px`, left: '0', width: `${containerW.value}px`, height: `${containerH.value - bottom}px` }
})
const shadeLeft = computed(() => {
  const d = display.value
  return { top: `${d.oy + crop.y * d.scale}px`, left: '0', width: `${d.ox + crop.x * d.scale}px`, height: `${crop.h * d.scale}px` }
})
const shadeRight = computed(() => {
  const d = display.value
  const right = d.ox + (crop.x + crop.w) * d.scale
  return { top: `${d.oy + crop.y * d.scale}px`, left: `${right}px`, width: `${containerW.value - right}px`, height: `${crop.h * d.scale}px` }
})
</script>

<template>
  <Teleport to="body">
    <div v-if="node" ref="overlayRef" class="video-crop-overlay" :style="wrapperStyle" @pointerdown="onPointerDown($event)" @pointermove="onPointerMove" @pointerup="onPointerUp">
      <div class="video-crop-letterbox" :style="{ top: '0', left: '0', width: containerW + 'px', height: display.oy + 'px' }" />
      <div class="video-crop-letterbox" :style="{ top: (display.oy + display.dh) + 'px', left: '0', width: containerW + 'px', height: (containerH - display.oy - display.dh) + 'px' }" />
      <div class="video-crop-letterbox" :style="{ top: display.oy + 'px', left: '0', width: display.ox + 'px', height: display.dh + 'px' }" />
      <div class="video-crop-letterbox" :style="{ top: display.oy + 'px', left: (display.ox + display.dw) + 'px', width: (containerW - display.ox - display.dw) + 'px', height: display.dh + 'px' }" />
      <div class="video-crop-shade" :style="shadeTop" />
      <div class="video-crop-shade" :style="shadeBottom" />
      <div class="video-crop-shade" :style="shadeLeft" />
      <div class="video-crop-shade" :style="shadeRight" />
      <div class="video-crop-frame" :style="frameStyle" @pointerdown.stop="onPointerDown($event)">
        <div class="video-crop-grid">
          <div class="grid-line grid-h" style="top:33.333%" />
          <div class="grid-line grid-h" style="top:66.666%" />
          <div class="grid-line grid-v" style="left:33.333%" />
          <div class="grid-line grid-v" style="left:66.666%" />
        </div>
        <div class="crop-size-label">{{ crop.w.toFixed(0) }} × {{ crop.h.toFixed(0) }}</div>
        <div v-for="h in handles" :key="h" class="video-crop-handle" :class="h" @pointerdown.stop="onPointerDown($event, h)" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.video-crop-overlay { cursor: crosshair; touch-action: none; border-radius: 12px; }
.video-crop-letterbox { position: absolute; background: rgba(0, 0, 0, 0.56); pointer-events: none; }
.video-crop-shade { position: absolute; background: rgba(0, 0, 0, 0.42); pointer-events: none; }
.video-crop-frame { position: absolute; cursor: move; box-shadow: 0 0 0 1px rgba(255,255,255,.9); }
.video-crop-grid { position: absolute; inset: 0; pointer-events: none; }
.grid-line { position: absolute; background: rgba(255,255,255,.45); }
.grid-h { left: 0; right: 0; height: 1px; }
.grid-v { top: 0; bottom: 0; width: 1px; }
.crop-size-label { position: absolute; left: 12px; top: 10px; padding: 4px 8px; border-radius: 5px; background: rgba(0,0,0,.72); color: white; font-size: 12px; pointer-events: none; }
.video-crop-handle { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; background: #fff; border: 1px solid rgba(0,0,0,.45); border-radius: 999px; z-index: 5; }
.nw { top: 0; left: 0; cursor: nw-resize; } .ne { top: 0; left: 100%; cursor: ne-resize; }
.sw { top: 100%; left: 0; cursor: sw-resize; } .se { top: 100%; left: 100%; cursor: se-resize; }
.n { top: 0; left: 50%; cursor: n-resize; } .s { top: 100%; left: 50%; cursor: s-resize; }
.w { top: 50%; left: 0; cursor: w-resize; } .e { top: 50%; left: 100%; cursor: e-resize; }
</style>
