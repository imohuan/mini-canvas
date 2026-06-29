<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick, type CSSProperties } from 'vue'
import { useVueFlow, getRectOfNodes } from '@vue-flow/core'
import type { MaskConfig } from '../../types/CanvasNodeData'

// ==================== Props ====================
const props = defineProps<{
  nodeId: string
  imageUrl: string
  imageWidth: number
  imageHeight: number
  maskConfig: MaskConfig
  maskDataUrl?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:maskData', blobUrl: string | null): void
}>()

const { viewport, findNode } = useVueFlow()

// ==================== Viewport transform (same as ImageCropper) ====================
const node = computed(() => findNode(props.nodeId))
const nodeRect = computed(() => {
  const n = node.value
  return n ? getRectOfNodes([n]) : { x: 0, y: 0, width: 256, height: 256 }
})

const zIndex = computed(() => (node.value?.computedPosition?.z || 1) + 100)

const containerW = computed(() => nodeRect.value.width * viewport.value.zoom)
const containerH = computed(() => nodeRect.value.height * viewport.value.zoom)

const wrapperStyle = computed<CSSProperties>(() => {
  const rect = nodeRect.value
  const z = viewport.value.zoom
  const tx = viewport.value.x
  const ty = viewport.value.y
  return {
    position: 'fixed',
    left: `${rect.x * z + tx}px`,
    top: `${rect.y * z + ty}px`,
    width: `${rect.width * z}px`,
    height: `${rect.height * z}px`,
    zIndex: zIndex.value,
    borderRadius: '12px',
    pointerEvents: 'auto',
  }
})

// ==================== Image display geometry (object-contain) ====================
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

// ==================== Canvas refs ====================
const bgCanvasRef = ref<HTMLCanvasElement | null>(null)
const drawCanvasRef = ref<HTMLCanvasElement | null>(null)
const overlayRef = ref<HTMLElement | null>(null)

// ==================== Drawing state ====================
const isDrawing = ref(false)
const hasMaskContent = ref(false)

// ==================== Canvas context ====================
let drawCtx: CanvasRenderingContext2D | null = null

function getDrawCtx(): CanvasRenderingContext2D | null {
  if (!drawCtx && drawCanvasRef.value) {
    drawCtx = drawCanvasRef.value.getContext('2d')
  }
  return drawCtx
}

// ==================== Setup canvases ====================
// Returns the saved draw canvas snapshot for restore, or null
function snapshotDrawCanvas(): string | null {
  const fg = drawCanvasRef.value
  if (!fg || !hasMaskContent.value || fg.width === 0 || fg.height === 0) return null
  return fg.toDataURL('image/png')
}

function restoreDrawCanvas(dataUrl: string | null) {
  if (!dataUrl) return
  const fg = drawCanvasRef.value
  if (!fg) return
  const img = new Image()
  img.onload = () => {
    const ctx = fg.getContext('2d')
    if (ctx) ctx.drawImage(img, 0, 0, fg.width, fg.height)
  }
  img.src = dataUrl
}

function setupCanvases(saveSnapshot = false) {
  const d = display.value
  const bg = bgCanvasRef.value
  const fg = drawCanvasRef.value
  if (!bg || !fg) return

  const w = Math.round(d.dw)
  const h = Math.round(d.dh)

  // Save drawing content before resize (zoom changes clear the canvas)
  const snapshot = saveSnapshot ? snapshotDrawCanvas() : null

  // Size both canvases to match image display area
  bg.width = w
  bg.height = h
  fg.width = w
  fg.height = h

  // Restore drawing content after resize
  restoreDrawCanvas(snapshot)

  // Load background image
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    const ctx = bg.getContext('2d')
    if (ctx) ctx.drawImage(img, 0, 0, w, h)
  }
  img.src = props.imageUrl

  // Reset drawing context cache
  drawCtx = null
}

// ==================== Brush rendering ====================
function getBrushStyle(): { color: string; size: number; composite: GlobalCompositeOperation } {
  const cfg = props.maskConfig
  if (cfg.isErasing) {
    return {
      color: 'rgba(0,0,0,1)',
      size: cfg.brushSize,
      composite: 'destination-out',
    }
  }
  const { r, g, b } = parseColor(cfg.brushColor)
  return {
    color: `rgba(${r},${g},${b},${cfg.brushOpacity})`,
    size: cfg.brushSize,
    composite: 'source-over',
  }
}

function parseColor(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (m) return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
  return { r: 255, g: 0, b: 0 }
}

// ==================== Coordinate transform ====================
function clientToCanvas(clientX: number, clientY: number): { x: number; y: number } {
  const d = display.value
  const rect = overlayRef.value?.getBoundingClientRect()
  if (!rect) return { x: 0, y: 0 }
  return {
    x: clientX - rect.left - d.ox,
    y: clientY - rect.top - d.oy,
  }
}

// ==================== Pointer events ====================
function onPointerDown(e: PointerEvent) {
  e.preventDefault()
  e.stopPropagation()
  const pt = clientToCanvas(e.clientX, e.clientY)
  lastPoint.x = pt.x
  lastPoint.y = pt.y
  isDrawing.value = true

  // Draw initial dot as a filled circle
  const ctx = getDrawCtx()
  if (ctx) {
    const { color, size, composite } = getBrushStyle()
    ctx.globalCompositeOperation = composite
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(pt.x, pt.y, size / 2, 0, Math.PI * 2)
    ctx.fill()
    hasMaskContent.value = true
  }
  overlayRef.value?.setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!isDrawing.value) return
  e.preventDefault()

  const pt = clientToCanvas(e.clientX, e.clientY)
  const ctx = getDrawCtx()
  if (!ctx) return
  const { color, size, composite } = getBrushStyle()

  ctx.globalCompositeOperation = composite
  ctx.fillStyle = color

  // Draw dense overlapping circles along the segment for smooth continuous brush
  const dx = pt.x - lastPoint.x
  const dy = pt.y - lastPoint.y
  const dist = Math.sqrt(dx * dx + dy * dy)
  const step = Math.max(0.5, size * 0.25) // inter-circle spacing
  const steps = Math.max(1, Math.ceil(dist / step))
  const radius = size / 2

  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const cx = lastPoint.x + dx * t
    const cy = lastPoint.y + dy * t
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fill()
  }

  lastPoint.x = pt.x
  lastPoint.y = pt.y
  hasMaskContent.value = true
}

function onPointerUp(e: PointerEvent) {
  if (!isDrawing.value) return
  isDrawing.value = false
  overlayRef.value?.releasePointerCapture(e.pointerId)
  emitMaskData()
}

// Last known pointer position for line segment tracking
const lastPoint = { x: 0, y: 0 }

// ==================== Mask data export ====================
function getMaskBlob(): Promise<Blob | null> {
  return new Promise((resolve) => {
    const canvas = drawCanvasRef.value
    if (!canvas || !hasMaskContent.value) { resolve(null); return }
    canvas.toBlob((b) => resolve(b), 'image/png')
  })
}

function emitMaskData() {
  const canvas = drawCanvasRef.value
  if (!canvas) return

  if (!hasMaskContent.value) {
    emit('update:maskData', null as any)
    return
  }
  canvas.toBlob((b) => {
    const url = b ? URL.createObjectURL(b) : null
    emit('update:maskData', url as any)
  })
}

function clearMask() {
  const ctx = getDrawCtx()
  const canvas = drawCanvasRef.value
  if (!ctx || !canvas) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  hasMaskContent.value = false
  emit('update:maskData', null as any)
}

defineExpose({ getMaskBlob, clearMask })

// ==================== Lifecycle ====================
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  nextTick(() => {
    setupCanvases()
    if (overlayRef.value) {
      resizeObserver = new ResizeObserver(() => {
        setupCanvases(true) // save/restore draw canvas content
      })
      resizeObserver.observe(overlayRef.value)
    }
  })
})

// Re-setup when image changes
watch(() => props.imageUrl, () => {
  nextTick(() => setupCanvases())
})

// Clear canvas when mask data is cleared externally (via "清除" button)
watch(() => props.maskDataUrl, (val) => {
  if (val === null || val === undefined) {
    clearMask()
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="node"
      ref="overlayRef"
      class="mask-overlay"
      :style="wrapperStyle"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
    >
      <!-- Image display area background canvas -->
      <canvas
        ref="bgCanvasRef"
        class="mask-bg-canvas"
        :style="{
          left: display.ox + 'px',
          top: display.oy + 'px',
          width: display.dw + 'px',
          height: display.dh + 'px',
        }"
      />
      <!-- Drawing canvas (on top of background) -->
      <canvas
        ref="drawCanvasRef"
        class="mask-draw-canvas"
        :style="{
          left: display.ox + 'px',
          top: display.oy + 'px',
          width: display.dw + 'px',
          height: display.dh + 'px',
        }"
      />
      <!-- Letterbox areas (darken non-image areas) -->
      <div class="mask-letterbox" :style="{ top: '0', left: '0', width: containerW + 'px', height: display.oy + 'px' }" />
      <div class="mask-letterbox" :style="{ top: (display.oy + display.dh) + 'px', left: '0', width: containerW + 'px', height: (containerH - display.oy - display.dh) + 'px' }" />
      <div class="mask-letterbox" :style="{ top: display.oy + 'px', left: '0', width: display.ox + 'px', height: display.dh + 'px' }" />
      <div class="mask-letterbox" :style="{ top: display.oy + 'px', left: (display.ox + display.dw) + 'px', width: (containerW - display.ox - display.dw) + 'px', height: display.dh + 'px' }" />
    </div>
  </Teleport>
</template>

<style scoped>
.mask-overlay {
  cursor: crosshair;
  touch-action: none;
  border-radius: 12px;
  overflow: hidden;
}

.mask-bg-canvas {
  position: absolute;
  pointer-events: none;
  opacity: 0.5;
}

.mask-draw-canvas {
  position: absolute;
  pointer-events: none;
}

.mask-letterbox {
  position: absolute;
  background: rgba(0, 0, 0, 0.55);
  pointer-events: none;
}
</style>
