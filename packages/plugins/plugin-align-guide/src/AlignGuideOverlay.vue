<template>
  <div class="align-guide-layer" style="pointer-events: none">
    <div
      v-if="vGuide !== null"
      class="align-guide-line align-guide-vline"
      :style="{ transform: `translateX(${vScreen}px)` }"
    />
    <div
      v-if="hGuide !== null"
      class="align-guide-line align-guide-hline"
      :style="{ transform: `translateY(${hScreen}px)` }"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * AlignGuideOverlay -- reference-line floating layer (host CanvasSurface already renders this slot).
 *
 * Bug fix (lines stuck after several snap parallel moves):
 *   1. dragFrameSeq lock: every NodeDrag increments; NodeDragEnd only clears when its seq matches current.
 *      Stops late frames from re-lighting the line, and avoids cross-frame contamination.
 *   2. window-level pointerup / pointercancel / blur safety net: covers any missed NodeDragEnd,
 *      especially during repeated snap-in/out near threshold edge.
 *   3. inactivity timer (150ms): if no new drag frame within window, force-clear.
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { useCanvasRender, RenderEvents, type NodeLayoutService } from '@mini-canvas/canvas-render'
import { computeAlignGuides } from './alignGuideEngine'

const { ctx, viewport, updateNodeVisual } = useCanvasRender()

const vGuide = ref<number | null>(null)
const hGuide = ref<number | null>(null)

let activeId: string | null = null
let dragFrameSeq = 0
const INACTIVITY_TIMEOUT_MS = 150
let inactivityTimer: ReturnType<typeof setTimeout> | null = null

function clearGuides(): void {
  if (inactivityTimer !== null) {
    clearTimeout(inactivityTimer)
    inactivityTimer = null
  }
  activeId = null
  vGuide.value = null
  hGuide.value = null
}

function armInactivityTimeout(): void {
  if (inactivityTimer !== null) clearTimeout(inactivityTimer)
  inactivityTimer = setTimeout(() => {
    inactivityTimer = null
    if (activeId !== null) clearGuides()
  }, INACTIVITY_TIMEOUT_MS)
}

const vScreen = computed(() => (vGuide.value !== null ? vGuide.value * viewport.value.zoom + viewport.value.x : 0))
const hScreen = computed(() => (hGuide.value !== null ? hGuide.value * viewport.value.zoom + viewport.value.y : 0))

function handleDragFrame(nodeId: string, position: { x: number; y: number }): void {
  dragFrameSeq += 1
  armInactivityTimeout()
  const layout = ctx.get<NodeLayoutService>('nodeLayout')
  if (!layout) return
  const size = layout.nodeSize(nodeId)
  if (size.w <= 0 || size.h <= 0) return
  const dragged = { id: nodeId, x: position.x, y: position.y, w: size.w, h: size.h }
  const others = layout.getAllRects().filter((r) => r.id !== nodeId)
  const { deltaX, deltaY, guides } = computeAlignGuides(dragged, others)
  if (deltaX !== 0 || deltaY !== 0) {
    updateNodeVisual(nodeId, { x: position.x + deltaX, y: position.y + deltaY })
  }
  const v = guides.find((g) => g.type === 'vertical')
  const h = guides.find((g) => g.type === 'horizontal')
  activeId = nodeId
  vGuide.value = v ? v.position : null
  hGuide.value = h ? h.position : null
}

function handleDragEnd(nodeId: string | undefined): void {
  if (inactivityTimer !== null) {
    clearTimeout(inactivityTimer)
    inactivityTimer = null
  }
  if (nodeId === undefined || nodeId === activeId) {
    activeId = null
    vGuide.value = null
    hGuide.value = null
  }
}

function handlePointerSettle(): void {
  clearGuides()
}

const disposers: Array<{ dispose(): void }> = []
disposers.push(
  ctx.on(RenderEvents.NodeDragStart, (_payload: { nodeId: string; position: { x: number; y: number } }) => {
    clearGuides()
    activeId = _payload.nodeId
    dragFrameSeq = 0
    armInactivityTimeout()
  }),
  ctx.on(RenderEvents.NodeDrag, (payload: { nodeId: string; position: { x: number; y: number } }) => {
    handleDragFrame(payload.nodeId, payload.position)
  }),
  ctx.on(RenderEvents.NodeDragEnd, (payload: { nodeId: string; position: { x: number; y: number } }) => {
    handleDragEnd(payload.nodeId)
  })
)

onBeforeUnmount(() => {
  for (const d of disposers) d.dispose()
  if (inactivityTimer !== null) {
    clearTimeout(inactivityTimer)
    inactivityTimer = null
  }
})

if (typeof window !== 'undefined') {
  window.addEventListener('pointerup', handlePointerSettle, true)
  window.addEventListener('pointercancel', handlePointerSettle, true)
  window.addEventListener('blur', handlePointerSettle)
  onBeforeUnmount(() => {
    window.removeEventListener('pointerup', handlePointerSettle, true)
    window.removeEventListener('pointercancel', handlePointerSettle, true)
    window.removeEventListener('blur', handlePointerSettle)
  })
}
</script>

<style scoped>
.align-guide-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}
.align-guide-line {
  position: absolute;
  top: 0;
  left: 0;
  background: rgba(99, 102, 241, 0.6);
  pointer-events: none;
}
.align-guide-vline {
  width: 1px;
  height: 100%;
}
.align-guide-hline {
  width: 100%;
  height: 1px;
}
</style>