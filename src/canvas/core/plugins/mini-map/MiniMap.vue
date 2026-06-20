<script setup lang="ts">
import { computed, ref, shallowRef } from "vue"

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
  jump: [payload: { x: number; y: number }]
}>()

const containerRef = ref<HTMLDivElement>()

let dragging = false
let lastClientX = 0
let lastClientY = 0

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

function onViewerDown(e: PointerEvent) {
  if (e.button !== 0) return
  dragging = true
  frozenNodes.value = props.nodes.map((n: any) => ({
    ...n,
    position: { ...n.position },
    computedPosition: n.computedPosition ? { ...n.computedPosition } : undefined,
    dimensions: n.dimensions ? { ...n.dimensions } : undefined,
  }))
  lastClientX = e.clientX
  lastClientY = e.clientY
  e.stopPropagation()
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!dragging) return
  const dx = e.clientX - lastClientX
  const dy = e.clientY - lastClientY
  lastClientX = e.clientX
  lastClientY = e.clientY

  const ms = mapState.value
  // 灵敏度作用在屏幕像素差上，直接缩放 dx/dy
  const scaledDx = dx * props.sensitivityX
  const scaledDy = dy * props.sensitivityY

  emit("pan", {
    x: props.viewport.x - scaledDx / ms.scale * props.viewport.zoom,
    y: props.viewport.y - scaledDy / ms.scale * props.viewport.zoom,
  })
}

function onPointerUp(e: PointerEvent) {
  if (!dragging) return
  dragging = false
  frozenNodes.value = null
  ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
}

function onMinimapClick(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains("mini-viewer")) return

  const rect = containerRef.value?.getBoundingClientRect()
  if (!rect) return

  const ms = mapState.value
  const clickX = e.clientX - rect.left - ms.offsetX
  const clickY = e.clientY - rect.top - ms.offsetY

  const targetX = ms.minX + clickX / ms.scale
  const targetY = ms.minY + clickY / ms.scale

  emit("jump", { x: targetX, y: targetY })
}
</script>

<template>
  <div
    ref="containerRef"
    class="mini-map"
    :style="{ width: width + 'px', height: height + 'px' }"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @mousedown="onMinimapClick"
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
