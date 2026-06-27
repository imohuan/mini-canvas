<script setup lang="ts">
import { computed, shallowRef } from "vue"

const props = withDefaults(defineProps<{
  nodes: any[]
  viewport: { x: number; y: number; zoom: number }
  dimensions: { width: number; height: number }
  width?: number
  height?: number
  nodeColor?: string
  viewportBorderColor?: string
  padding?: number
  sensitivityX?: number
  sensitivityY?: number
}>(), {
  width: 240,
  height: 160,
  nodeColor: "#cbd5e1",
  viewportBorderColor: "#3b82f6",
  padding: 8,
  sensitivityX: 1,
  sensitivityY: 1,
})

const emit = defineEmits<{
  pan: [payload: { x: number; y: number }]
}>()

let dragging = false
let dragPointerId: number | null = null
let dragCaptureEl: HTMLElement | null = null
let dragStartPoint = { x: 0, y: 0 }
let dragStartViewport = { x: 0, y: 0, zoom: 1 }
let dragStartMapState = { scale: 1, minX: 0, minY: 0, offsetX: 0, offsetY: 0 }

const frozenNodes = shallowRef<any[] | null>(null)
const renderNodes = computed(() => {
  return (frozenNodes.value ?? props.nodes).filter((n: any) => !n.hidden)
})

const contentBB = computed(() => {
  const visible = renderNodes.value
  if (visible.length === 0) return { x: 0, y: 0, w: 1, h: 1 }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of visible) {
    const x = n.computedPosition?.x ?? n.position.x
    const y = n.computedPosition?.y ?? n.position.y
    const w = n.dimensions?.width ?? 200
    const h = n.dimensions?.height ?? 100
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + w)
    maxY = Math.max(maxY, y + h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
})

const viewBB = computed(() => ({
  x: -props.viewport.x / props.viewport.zoom,
  y: -props.viewport.y / props.viewport.zoom,
  w: props.dimensions.width / props.viewport.zoom,
  h: props.dimensions.height / props.viewport.zoom,
}))

const unionBB = computed(() => {
  const cb = contentBB.value
  const vb = viewBB.value
  const minX = Math.min(cb.x, vb.x)
  const minY = Math.min(cb.y, vb.y)
  const maxX = Math.max(cb.x + cb.w, vb.x + vb.w)
  const maxY = Math.max(cb.y + cb.h, vb.y + vb.h)
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
})

const mapState = computed(() => {
  const u = unionBB.value
  if (u.w <= 0 || u.h <= 0) return { scale: 1, minX: 0, minY: 0, offsetX: 0, offsetY: 0 }

  const pad = props.padding
  const availW = props.width - pad * 2
  const availH = props.height - pad * 2

  const scale = Math.min(availW / u.w, availH / u.h)
  const offsetX = pad + (availW - u.w * scale) / 2
  const offsetY = pad + (availH - u.h * scale) / 2

  return { scale, minX: u.x, minY: u.y, offsetX, offsetY }
})

function nodeStyle(node: any) {
  const x = node.computedPosition?.x ?? node.position.x
  const y = node.computedPosition?.y ?? node.position.y
  const w = node.dimensions?.width ?? 200
  const h = node.dimensions?.height ?? 100

  const ms = mapState.value
  return {
    left: `${ms.offsetX + (x - ms.minX) * ms.scale}px`,
    top: `${ms.offsetY + (y - ms.minY) * ms.scale}px`,
    width: `${Math.max(1, w * ms.scale)}px`,
    height: `${Math.max(1, h * ms.scale)}px`,
    background: props.nodeColor,
  }
}

const viewerStyle = computed(() => {
  const vb = viewBB.value
  const ms = mapState.value
  return {
    left: `${ms.offsetX + (vb.x - ms.minX) * ms.scale}px`,
    top: `${ms.offsetY + (vb.y - ms.minY) * ms.scale}px`,
    width: `${Math.max(1, vb.w * ms.scale)}px`,
    height: `${Math.max(1, vb.h * ms.scale)}px`,
    borderColor: props.viewportBorderColor,
  }
})

function applyMovement(clientX: number, clientY: number) {
  const ms = dragStartMapState
  const zoom = dragStartViewport.zoom || 1
  const dx = (clientX - dragStartPoint.x) * props.sensitivityX
  const dy = (clientY - dragStartPoint.y) * props.sensitivityY

  emit("pan", {
    x: dragStartViewport.x - dx / ms.scale * zoom,
    y: dragStartViewport.y - dy / ms.scale * zoom,
  })
}

function onPointerMove(e: PointerEvent) {
  if (!dragging) return
  if (dragPointerId !== null && e.pointerId !== dragPointerId) return
  applyMovement(e.clientX, e.clientY)
}

function startDrag(e: PointerEvent) {
  dragging = true
  dragPointerId = e.pointerId
  dragStartPoint = { x: e.clientX, y: e.clientY }
  dragStartViewport = { ...props.viewport }
  dragStartMapState = { ...mapState.value }
  frozenNodes.value = props.nodes.map((n: any) => ({
    ...n,
    position: { ...n.position },
    computedPosition: n.computedPosition ? { ...n.computedPosition } : undefined,
    dimensions: n.dimensions ? { ...n.dimensions } : undefined,
  }))
  applyMovement(e.clientX, e.clientY)
  e.stopPropagation()
  e.preventDefault()

  const target = e.currentTarget as HTMLElement
  dragCaptureEl = target
  target.setPointerCapture(e.pointerId)
}

function onViewerDown(e: PointerEvent) {
  if (e.button !== 0) return
  startDrag(e)
}

function onPointerUp(e: PointerEvent) {
  if (!dragging) return
  if (dragPointerId !== null && e.pointerId !== dragPointerId) return
  finishDrag(e)
}

function onPointerCancel(e: PointerEvent) {
  if (!dragging) return
  if (dragPointerId !== null && e.pointerId !== dragPointerId) return
  finishDrag(e)
}

function finishDrag(e: PointerEvent) {
  dragging = false
  dragPointerId = null
  frozenNodes.value = null
  if (dragCaptureEl?.hasPointerCapture?.(e.pointerId)) {
    dragCaptureEl.releasePointerCapture(e.pointerId)
  }
  dragCaptureEl = null
}


</script>

<template>
  <div
    class="mini-map"
    :style="{ width: width + 'px', height: height + 'px' }"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
  >
    <div
      v-for="node in renderNodes"
      :key="node.id"
      class="mini-node"
      :style="nodeStyle(node)"
    />
    <div
      class="mini-viewer"
      :style="viewerStyle"
      @pointerdown="onViewerDown"
    />
  </div>
</template>

<style scoped>
.mini-map {
  position: relative;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  cursor: crosshair;
  touch-action: none;
}

.mini-node {
  position: absolute;
  border-radius: 2px;
  pointer-events: none;
}

.mini-viewer {
  position: absolute;
  border: 2px solid #3b82f6;
  background: rgba(59, 130, 246, 0.08);
  border-radius: 4px;
  cursor: move;
  pointer-events: auto;
  z-index: 1;
}
</style>
