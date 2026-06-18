<script setup lang="ts">
import { ref, reactive, computed, onMounted, nextTick, watch } from 'vue'
import { useVueFlow, getRectOfNodes } from '@vue-flow/core'
import type { CSSProperties } from 'vue'

// ==================== Props ====================
const props = defineProps<{
  nodeId: string
  imageUrl: string
  imageWidth: number
  imageHeight: number
}>()

const emit = defineEmits<{
  (e: 'update:crop', rect: { x: number; y: number; width: number; height: number }): void
}>()

const { viewport, findNode } = useVueFlow()

// ==================== Constants ====================
const MIN_CROP = 20

// ==================== Container tracking ====================
const containerW = ref(256)
const containerH = ref(256)

// Position computed via viewport transform (like NodeToolbar)
const node = computed(() => findNode(props.nodeId))
const nodeRect = computed(() => {
  const n = node.value
  return n ? getRectOfNodes([n]) : { x: 0, y: 0, width: 256, height: 256 }
})

const zIndex = computed(() => (node.value?.computedPosition?.z || 1) + 10)

// Real-time position via viewport transform (follows pan/zoom)
const wrapperStyle = computed<CSSProperties>(() => {
  const rect = nodeRect.value
  const z = viewport.value.zoom
  const tx = viewport.value.x
  const ty = viewport.value.y

  const left = rect.x * z + tx
  const top = rect.y * z + ty
  const w = rect.width * z
  const h = rect.height * z

  containerW.value = w
  containerH.value = h

  return {
    position: 'fixed',
    left: `${left}px`,
    top: `${top}px`,
    width: `${w}px`,
    height: `${h}px`,
    zIndex: zIndex.value,
    borderRadius: '12px',
    overflow: 'hidden',
    pointerEvents: 'auto',
  }
})

// ==================== Image display geometry (object-contain within overlay) ====================
const display = computed(() => {
  const cw = Math.max(containerW.value, 1)
  const ch = Math.max(containerH.value, 1)
  const iw = props.imageWidth || 1
  const ih = props.imageHeight || 1
  const ca = cw / ch
  const ia = iw / ih

  let dw: number, dh: number, ox: number, oy: number
  if (ia > ca) {
    dw = cw; dh = cw / ia; ox = 0; oy = (ch - dh) / 2
  } else {
    dh = ch; dw = ch * ia; ox = (cw - dw) / 2; oy = 0
  }

  return { dw, dh, ox, oy, scale: dw / iw }
})

// ==================== Crop area (image pixel coords) ====================
const crop = reactive({ x: 0, y: 0, w: 0, h: 0 })

function initCrop() {
  const size = Math.min(props.imageWidth, props.imageHeight) * 0.8
  crop.x = Math.round((props.imageWidth - size) / 2)
  crop.y = Math.round((props.imageHeight - size) / 2)
  crop.w = Math.round(size)
  crop.h = Math.round(size)
}

// ==================== Drag state ====================
type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e'
type Drag =
  | { kind: 'move'; sx: number; sy: number; scX: number; scY: number }
  | { kind: 'resize'; dir: Handle; sx: number; sy: number; scX: number; scY: number; scW: number; scH: number }
  | null

const drag = ref<Drag>(null)
const overlayRef = ref<HTMLElement | null>(null)

// ==================== Crop frame display style ====================
const frameStyle = computed(() => {
  const d = display.value
  return {
    left: `${d.ox + crop.x * d.scale}px`,
    top: `${d.oy + crop.y * d.scale}px`,
    width: `${crop.w * d.scale}px`,
    height: `${crop.h * d.scale}px`,
  }
})

const shadeTop = computed(() => {
  const d = display.value
  return { top: '0', left: '0', width: `${containerW.value}px`, height: `${d.oy + crop.y * d.scale}px` }
})
const shadeBottom = computed(() => {
  const d = display.value
  const bottom = d.oy + (crop.y + crop.h) * d.scale
  return { top: `${bottom}px`, left: '0', width: `${containerW.value}px`, height: `${containerH.value - bottom}px` }
})
const shadeLeft = computed(() => {
  const d = display.value
  const top = d.oy + crop.y * d.scale
  const h = crop.h * d.scale
  return { top: `${top}px`, left: '0', width: `${d.ox + crop.x * d.scale}px`, height: `${h}px` }
})
const shadeRight = computed(() => {
  const d = display.value
  const top = d.oy + crop.y * d.scale
  const h = crop.h * d.scale
  const right = d.ox + (crop.x + crop.w) * d.scale
  return { top: `${top}px`, left: `${right}px`, width: `${containerW.value - right}px`, height: `${h}px` }
})

// ==================== Helpers ====================
function clamp(nx: number, ny: number, nw: number, nh: number) {
  const maxW = props.imageWidth
  const maxH = props.imageHeight
  nx = Math.max(0, nx)
  ny = Math.max(0, ny)
  nw = Math.max(MIN_CROP, nw)
  nh = Math.max(MIN_CROP, nh)
  if (nx + nw > maxW) nx = maxW - nw
  if (ny + nh > maxH) ny = maxH - nh
  return { x: nx, y: ny, w: nw, h: nh }
}

// ==================== Pointer events ====================
function onPointerDown(e: PointerEvent, dir?: Handle) {
  e.preventDefault()
  e.stopPropagation()
  if (!overlayRef.value) return

  if (dir) {
    drag.value = {
      kind: 'resize', dir,
      sx: e.clientX, sy: e.clientY,
      scX: crop.x, scY: crop.y, scW: crop.w, scH: crop.h,
    }
  } else {
    drag.value = { kind: 'move', sx: e.clientX, sy: e.clientY, scX: crop.x, scY: crop.y }
  }

  overlayRef.value.setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!drag.value) return
  const d = drag.value
  const dx = (e.clientX - d.sx) / display.value.scale
  const dy = (e.clientY - d.sy) / display.value.scale

  if (d.kind === 'move') {
    const r = clamp(d.scX + dx, d.scY + dy, crop.w, crop.h)
    crop.x = r.x; crop.y = r.y
  } else {
    const ax = d.dir.includes('w') ? d.scX + d.scW : d.scX
    const ay = d.dir.includes('n') ? d.scY + d.scH : d.scY

    let nx = d.dir.includes('w') ? Math.min(ax, d.scX + dx) : d.scX
    let ny = d.dir.includes('n') ? Math.min(ay, d.scY + dy) : d.scY
    let nw = d.dir.includes('w') || d.dir.includes('e') ? Math.abs(d.dir.includes('e') ? (d.scX + dx) - ax : ax - (d.scX + dx)) : d.scW
    let nh = d.dir.includes('n') || d.dir.includes('s') ? Math.abs(d.dir.includes('s') ? (d.scY + dy) - ay : ay - (d.scY + dy)) : d.scH

    const r = clamp(nx, ny, nw, nh)
    crop.x = r.x; crop.y = r.y; crop.w = r.w; crop.h = r.h
  }
}

function onPointerUp(e: PointerEvent) {
  drag.value = null
  overlayRef.value?.releasePointerCapture(e.pointerId)
  emitCrop()
}

// ==================== Expose + Emit ====================
function getCropRect() {
  return { x: Math.round(crop.x), y: Math.round(crop.y), width: Math.round(crop.w), height: Math.round(crop.h) }
}

defineExpose({ getCropRect })

function emitCrop() {
  emit('update:crop', getCropRect())
}

let emitTimer: ReturnType<typeof setTimeout> | null = null
watch(crop, () => {
  if (emitTimer) clearTimeout(emitTimer)
  emitTimer = setTimeout(emitCrop, 16)
}, { deep: true })

// ==================== Lifecycle ====================
onMounted(() => {
  initCrop()
  nextTick(() => emitCrop())
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="node"
      ref="overlayRef"
      class="crop-overlay"
      :style="wrapperStyle"
      @pointerdown="onPointerDown($event)"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
    >
      <!-- Letterbox areas -->
      <div class="crop-letterbox" :style="{ top: '0', left: '0', width: containerW + 'px', height: display.oy + 'px' }" />
      <div class="crop-letterbox" :style="{ top: (display.oy + display.dh) + 'px', left: '0', width: containerW + 'px', height: (containerH - display.oy - display.dh) + 'px' }" />
      <div class="crop-letterbox" :style="{ top: display.oy + 'px', left: '0', width: display.ox + 'px', height: display.dh + 'px' }" />
      <div class="crop-letterbox" :style="{ top: display.oy + 'px', left: (display.ox + display.dw) + 'px', width: (containerW - display.ox - display.dw) + 'px', height: display.dh + 'px' }" />

      <!-- Shade areas -->
      <div class="crop-shade" :style="shadeTop" />
      <div class="crop-shade" :style="shadeBottom" />
      <div class="crop-shade" :style="shadeLeft" />
      <div class="crop-shade" :style="shadeRight" />

      <!-- Crop frame -->
      <div class="crop-frame" :style="frameStyle" @pointerdown.stop="onPointerDown($event)">
        <div class="crop-grid">
          <div class="grid-line grid-h" style="top:33.333%" />
          <div class="grid-line grid-h" style="top:66.666%" />
          <div class="grid-line grid-v" style="left:33.333%" />
          <div class="grid-line grid-v" style="left:66.666%" />
        </div>
        <div class="crop-handle nw" @pointerdown.stop="onPointerDown($event, 'nw')" />
        <div class="crop-handle ne" @pointerdown.stop="onPointerDown($event, 'ne')" />
        <div class="crop-handle sw" @pointerdown.stop="onPointerDown($event, 'sw')" />
        <div class="crop-handle se" @pointerdown.stop="onPointerDown($event, 'se')" />
        <div class="crop-handle n" @pointerdown.stop="onPointerDown($event, 'n')" />
        <div class="crop-handle s" @pointerdown.stop="onPointerDown($event, 's')" />
        <div class="crop-handle w" @pointerdown.stop="onPointerDown($event, 'w')" />
        <div class="crop-handle e" @pointerdown.stop="onPointerDown($event, 'e')" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.crop-overlay {
  cursor: crosshair;
  touch-action: none;
  border-radius: 12px;
  overflow: hidden;
}

.crop-letterbox {
  position: absolute;
  background: rgba(0, 0, 0, 0.55);
  pointer-events: none;
}

.crop-shade {
  position: absolute;
  background: rgba(0, 0, 0, 0.4);
  pointer-events: none;
}

.crop-frame {
  position: absolute;
  cursor: move;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.9);
}

.crop-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.grid-line {
  position: absolute;
  background: rgba(255, 255, 255, 0.45);
}
.grid-h { left: 0; right: 0; height: 1px; }
.grid-v { top: 0; bottom: 0; width: 1px; }

.crop-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  background: #fff;
  border: 1.5px solid rgba(0, 0, 0, 0.5);
  border-radius: 2px;
  z-index: 5;
}
.nw { top: -5px; left: -5px; cursor: nw-resize; }
.ne { top: -5px; right: -5px; cursor: ne-resize; }
.sw { bottom: -5px; left: -5px; cursor: sw-resize; }
.se { bottom: -5px; right: -5px; cursor: se-resize; }
.n  { top: -5px; left: 50%; margin-left: -5px; cursor: n-resize; }
.s  { bottom: -5px; left: 50%; margin-left: -5px; cursor: s-resize; }
.w  { top: 50%; left: -5px; margin-top: -5px; cursor: w-resize; }
.e  { top: 50%; right: -5px; margin-top: -5px; cursor: e-resize; }
</style>
