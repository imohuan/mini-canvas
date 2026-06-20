<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from "vue"

const props = withDefaults(defineProps<{
  nodes: any[]
  viewport: { x: number; y: number; zoom: number }
  dimensions: { width: number; height: number }
  width?: number
  height?: number
  nodeColor?: string
  nodeStrokeColor?: string
  nodeStrokeWidth?: number
  nodeBorderRadius?: number
  maskColor?: string
  pannable?: boolean
  zoomable?: boolean
  offsetScale?: number
}>(), {
  width: 180,
  height: 120,
  nodeColor: "#e2e2e2",
  nodeStrokeColor: "transparent",
  nodeStrokeWidth: 2,
  nodeBorderRadius: 5,
  maskColor: "rgba(0,0,0,0.08)",
  pannable: true,
  zoomable: true,
  offsetScale: 5,
})

const emit = defineEmits<{
  pan: [payload: { x: number; y: number }]
  zoom: [payload: { zoom: number }]
}>()

const svgRef = ref<SVGSVGElement>()

// ---- 计算所有节点的包围盒 ----
const nodesBB = computed(() => {
  const visibleNodes = props.nodes.filter((n: any) => !n.hidden)
  if (visibleNodes.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const node of visibleNodes) {
    const x = node.computedPosition?.x ?? node.position.x
    const y = node.computedPosition?.y ?? node.position.y
    const w = node.dimensions?.width ?? 200
    const h = node.dimensions?.height ?? 100
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + w)
    maxY = Math.max(maxY, y + h)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
})

// ---- 当前视口在 flow 坐标系中的矩形 ----
const viewBB = computed(() => ({
  x: -props.viewport.x / props.viewport.zoom,
  y: -props.viewport.y / props.viewport.zoom,
  width: props.dimensions.width / props.viewport.zoom,
  height: props.dimensions.height / props.viewport.zoom,
}))

// ---- 合并后的包围盒 ----
const boundingRect = computed(() => {
  const bb = nodesBB.value
  const vb = viewBB.value
  if (bb.width === 0 && bb.height === 0) return vb
  return {
    x: Math.min(bb.x, vb.x),
    y: Math.min(bb.y, vb.y),
    width: Math.max(bb.x + bb.width, vb.x + vb.width) - Math.min(bb.x, vb.x),
    height: Math.max(bb.y + bb.height, vb.y + vb.height) - Math.min(bb.y, vb.y),
  }
})

// ---- 缩放比例 ----
const viewScale = computed(() => {
  const br = boundingRect.value
  if (br.width <= 0 || br.height <= 0) return 1
  const sx = br.width / props.width
  const sy = br.height / props.height
  return Math.max(sx, sy)
})

// ---- viewBox ----
const viewBox = computed(() => {
  const scale = viewScale.value
  const br = boundingRect.value
  const offset = props.offsetScale * scale

  const vw = scale * props.width
  const vh = scale * props.height

  return {
    x: br.x - (vw - br.width) / 2 - offset,
    y: br.y - (vh - br.height) / 2 - offset,
    width: vw + offset * 2,
    height: vh + offset * 2,
  }
})

// ---- 遮罩 path ----
const maskPath = computed(() => {
  const vb = viewBB.value
  const box = viewBox.value
  const offset = props.offsetScale * viewScale.value

  // 外围大矩形
  const outer = [
    `M${box.x - offset},${box.y - offset}`,
    `h${box.width + offset * 2}`,
    `v${box.height + offset * 2}`,
    `h${-(box.width + offset * 2)}z`,
  ].join("")

  // 视口矩形（挖空）
  const inner = [
    `M${vb.x},${vb.y}`,
    `h${vb.width}`,
    `v${vb.height}`,
    `h${-vb.width}z`,
  ].join("")

  return outer + inner
})

// ---- 拖拽平移 ----
let dragging = false
let lastClientX = 0
let lastClientY = 0

function onPointerDown(e: PointerEvent) {
  if (!props.pannable || e.button !== 0) return
  dragging = true
  lastClientX = e.clientX
  lastClientY = e.clientY
  ;(e.target as Element).setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!dragging) return
  const dx = e.clientX - lastClientX
  const dy = e.clientY - lastClientY
  lastClientX = e.clientX
  lastClientY = e.clientY

  const moveScale = viewScale.value * Math.max(1, props.viewport.zoom)
  emit("pan", {
    x: props.viewport.x - dx * moveScale,
    y: props.viewport.y - dy * moveScale,
  })
}

function onPointerUp(e: PointerEvent) {
  if (!dragging) return
  dragging = false
  ;(e.target as Element).releasePointerCapture(e.pointerId)
}

// ---- 滚轮缩放 ----
function onWheel(e: WheelEvent) {
  if (!props.zoomable) return
  e.preventDefault()

  const delta = -e.deltaY * 0.002
  const nextZoom = props.viewport.zoom * (1 + delta)
  emit("zoom", { zoom: Math.max(0.1, Math.min(4, nextZoom)) })
}

onMounted(() => {
  svgRef.value?.addEventListener("wheel", onWheel, { passive: false })
})

onUnmounted(() => {
  svgRef.value?.removeEventListener("wheel", onWheel)
})
</script>

<template>
  <svg
    ref="svgRef"
    :width="width"
    :height="height"
    :viewBox="`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`"
    class="mini-map-svg"
    :class="{ pannable, zoomable }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
  >
    <!-- 节点缩略 -->
    <rect
      v-for="node in nodes.filter((n: any) => !n.hidden)"
      :key="node.id"
      :x="node.computedPosition?.x ?? node.position.x"
      :y="node.computedPosition?.y ?? node.position.y"
      :width="node.dimensions?.width ?? 200"
      :height="node.dimensions?.height ?? 100"
      :rx="nodeBorderRadius"
      :ry="nodeBorderRadius"
      :fill="nodeColor"
      :stroke="nodeStrokeColor"
      :stroke-width="nodeStrokeWidth"
      shape-rendering="crispEdges"
    />

    <!-- 遮罩 -->
    <path
      :d="maskPath"
      :fill="maskColor"
      fill-rule="evenodd"
    />
  </svg>
</template>

<style scoped>
.mini-map-svg {
  background: #fff;
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

.mini-map-svg.pannable {
  cursor: grab;
}

.mini-map-svg.pannable:active {
  cursor: grabbing;
}
</style>
