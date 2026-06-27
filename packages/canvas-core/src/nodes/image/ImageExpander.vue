<script setup lang="ts">
import { ref, reactive, computed, onMounted, nextTick, watch } from 'vue'
import { useVueFlow, getRectOfNodes } from '@vue-flow/core'
import type { CSSProperties } from 'vue'
import ToolbarButton from '../../components/Decoration/ToolbarButton.vue'

const props = defineProps<{
  nodeId: string
  imageUrl: string
  imageWidth: number
  imageHeight: number
}>()

const emit = defineEmits<{
  (e: 'update:expand', rect: { x: number; y: number; width: number; height: number }): void
  (e: 'cancel'): void
  (e: 'confirm'): void
}>()

const { viewport, findNode } = useVueFlow()

const MIN_EXPAND = 20
const GRID_COLS = 3
const GRID_ROWS = 3

// SVG icons for ToolbarButton
const cancelIcon = '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
const confirmIcon = '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'

// ==================== Node tracking ====================
const node = computed(() => findNode(props.nodeId))
const nodeRect = computed(() => {
  const n = node.value
  return n ? getRectOfNodes([n]) : { x: 0, y: 0, width: 256, height: 256 }
})

const nodeW = computed(() => nodeRect.value.width * viewport.value.zoom)
const nodeH = computed(() => nodeRect.value.height * viewport.value.zoom)

const display = computed(() => {
  const cw = Math.max(nodeW.value, 1)
  const ch = Math.max(nodeH.value, 1)
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

const zoom = computed(() => viewport.value.zoom)
const panX = computed(() => viewport.value.x)
const panY = computed(() => viewport.value.y)

function imgOriginScreen() {
  const d = display.value
  return {
    x: nodeRect.value.x * zoom.value + panX.value + d.ox,
    y: nodeRect.value.y * zoom.value + panY.value + d.oy,
  }
}

// ==================== Expand area ====================
const expand = reactive({ x: 0, y: 0, w: 0, h: 0 })
function initExpand() {
  expand.x = 0; expand.y = 0
  expand.w = props.imageWidth; expand.h = props.imageHeight
}

// ==================== Drag ====================
type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e'
type Drag =
  | { kind: 'move'; sx: number; sy: number; scX: number; scY: number; captureEl: HTMLElement }
  | { kind: 'resize'; dir: Handle; sx: number; sy: number; scX: number; scY: number; scW: number; scH: number; captureEl: HTMLElement }
  | null

const drag = ref<Drag>(null)

// ==================== Frame ====================
const frameStyle = computed<CSSProperties>(() => {
  const d = display.value
  const { x, y } = imgOriginScreen()
  return {
    position: 'fixed' as const,
    left: `${x + expand.x * d.scale}px`,
    top: `${y + expand.y * d.scale}px`,
    width: `${expand.w * d.scale}px`,
    height: `${expand.h * d.scale}px`,
  }
})

const gridLines = computed(() => {
  const d = display.value
  const { x, y } = imgOriginScreen()
  const fl = x + expand.x * d.scale
  const ft = y + expand.y * d.scale
  const fw = expand.w * d.scale
  const fh = expand.h * d.scale
  const lines: { type: 'h' | 'v'; pos: number }[] = []
  for (let i = 1; i < GRID_COLS; i++) lines.push({ type: 'v', pos: fl + (fw * i) / GRID_COLS })
  for (let i = 1; i < GRID_ROWS; i++) lines.push({ type: 'h', pos: ft + (fh * i) / GRID_ROWS })
  return { fl, ft, fw, fh, lines }
})

// ==================== Handles ====================
function handleStyle(dir: Handle): CSSProperties {
  const d = display.value
  const { x, y } = imgOriginScreen()
  const l = x + expand.x * d.scale
  const t = y + expand.y * d.scale
  const w = expand.w * d.scale
  const h = expand.h * d.scale
  switch (dir) {
    case 'nw': return { left: `${l - 5}px`, top: `${t - 5}px`, cursor: 'nw-resize' }
    case 'ne': return { left: `${l + w - 5}px`, top: `${t - 5}px`, cursor: 'ne-resize' }
    case 'sw': return { left: `${l - 5}px`, top: `${t + h - 5}px`, cursor: 'sw-resize' }
    case 'se': return { left: `${l + w - 5}px`, top: `${t + h - 5}px`, cursor: 'se-resize' }
    case 'n':  return { left: `${l + w / 2 - 5}px`, top: `${t - 5}px`, cursor: 'n-resize' }
    case 's':  return { left: `${l + w / 2 - 5}px`, top: `${t + h - 5}px`, cursor: 's-resize' }
    case 'w':  return { left: `${l - 5}px`, top: `${t + h / 2 - 5}px`, cursor: 'w-resize' }
    case 'e':  return { left: `${l + w - 5}px`, top: `${t + h / 2 - 5}px`, cursor: 'e-resize' }
  }
  return {}
}

// ==================== Pointer events ====================
function onMoveStart(e: PointerEvent) {
  e.preventDefault(); e.stopPropagation()
  const el = e.currentTarget as HTMLElement
  cleanupDrag() // 清理可能残留的旧 listener
  drag.value = { kind: 'move', sx: e.clientX, sy: e.clientY, scX: expand.x, scY: expand.y, captureEl: el }
  el.setPointerCapture(e.pointerId)
  window.addEventListener('pointermove', onPointerMove, { passive: false })
  window.addEventListener('pointerup', onPointerUpCb)
}

function onResizeStart(e: PointerEvent, dir: Handle) {
  e.preventDefault(); e.stopPropagation()
  const el = e.currentTarget as HTMLElement
  cleanupDrag()
  drag.value = { kind: 'resize', dir, sx: e.clientX, sy: e.clientY, scX: expand.x, scY: expand.y, scW: expand.w, scH: expand.h, captureEl: el }
  el.setPointerCapture(e.pointerId)
  window.addEventListener('pointermove', onPointerMove, { passive: false })
  window.addEventListener('pointerup', onPointerUpCb)
}

function cleanupDrag() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUpCb)
}

function onPointerMove(e: PointerEvent) {
  if (!drag.value) return
  const d = drag.value
  const scale = display.value.scale
  const dx = (e.clientX - d.sx) / scale
  const dy = (e.clientY - d.sy) / scale
  const iw = props.imageWidth
  const ih = props.imageHeight

  if (d.kind === 'move') {
    let nx = d.scX + dx
    let ny = d.scY + dy
    if (nx > 0) nx = 0
    if (ny > 0) ny = 0
    if (nx + expand.w < iw) nx = iw - expand.w
    if (ny + expand.h < ih) ny = ih - expand.h
    expand.x = nx; expand.y = ny
  } else {
    const right = d.scX + d.scW; const bottom = d.scY + d.scH
    let nx = d.scX, ny = d.scY, nw = d.scW, nh = d.scH
    if (d.dir.includes('w')) { nx = Math.min(0, d.scX + dx); nw = right - nx }
    else if (d.dir.includes('e')) { nw = d.scW + dx }
    if (d.dir.includes('n')) { ny = Math.min(0, d.scY + dy); nh = bottom - ny }
    else if (d.dir.includes('s')) { nh = d.scH + dy }
    if (nx + nw < iw) nw = iw - nx
    if (ny + nh < ih) nh = ih - ny
    nw = Math.max(MIN_EXPAND, Math.max(iw, nw))
    nh = Math.max(MIN_EXPAND, Math.max(ih, nh))
    expand.x = nx; expand.y = ny; expand.w = nw; expand.h = nh
  }
}

function onPointerUpCb(e: PointerEvent) {
  if (!drag.value) return
  drag.value.captureEl.releasePointerCapture(e.pointerId)
  drag.value = null
  cleanupDrag()
  emitExpand()
}

// ==================== Emit ====================
function getExpandRect() { return { x: Math.round(expand.x), y: Math.round(expand.y), width: Math.round(expand.w), height: Math.round(expand.h) } }
defineExpose({ getExpandRect })
function emitExpand() { emit('update:expand', getExpandRect()) }
let emitTimer: ReturnType<typeof setTimeout> | null = null
watch(expand, () => { if (emitTimer) clearTimeout(emitTimer); emitTimer = setTimeout(emitExpand, 16) }, { deep: true })

// ==================== Action bar ====================
const actionBarStyle = computed<CSSProperties>(() => {
  const d = display.value
  const { x, y } = imgOriginScreen()
  const fb = y + expand.y * d.scale + expand.h * d.scale
  const fcx = x + expand.x * d.scale + (expand.w * d.scale) / 2
  return {
    position: 'fixed',
    left: `${fcx}px`, top: `${fb + 14}px`,
    transform: 'translateX(-50%)',
    pointerEvents: 'auto',
  }
})

onMounted(() => { initExpand(); nextTick(() => emitExpand()) })
</script>

<template>
  <Teleport to="body">
    <div v-if="node" class="expander-root">
      <!-- Backdrop: passes events through to canvas -->
      <div class="expand-backdrop" />

      <!-- Original image -->
      <div class="expand-image-host" :style="{
        position: 'fixed',
        left: `${nodeRect.x * zoom + panX}px`,
        top: `${nodeRect.y * zoom + panY}px`,
        width: `${nodeRect.width * zoom}px`,
        height: `${nodeRect.height * zoom}px`,
        borderRadius: '12px', overflow: 'hidden', pointerEvents: 'none',
      }">
        <img :src="imageUrl" class="expand-image" draggable="false" />
      </div>

      <!-- Dashed original boundary -->
      <div class="expand-boundary" :style="{
        position: 'fixed',
        left: `${imgOriginScreen().x}px`,
        top: `${imgOriginScreen().y}px`,
        width: `${display.dw}px`,
        height: `${display.dh}px`,
        pointerEvents: 'none',
      }" />

      <!-- Expand frame -->
      <div class="expand-frame" :style="frameStyle">
        <svg :width="gridLines.fw" :height="gridLines.fh">
          <template v-for="(line, i) in gridLines.lines" :key="i">
            <line v-if="line.type === 'v'" :x1="line.pos - gridLines.fl" y1="0" :x2="line.pos - gridLines.fl" :y2="gridLines.fh" class="grid-line" />
            <line v-else x1="0" :y1="line.pos - gridLines.ft" :x2="gridLines.fw" :y2="line.pos - gridLines.ft" class="grid-line" />
          </template>
        </svg>
        <!-- Frame interior: capture events, drag to move. Outside: pass through to canvas. -->
        <div class="frame-move-area" @pointerdown="onMoveStart" />
      </div>

      <!-- Resize handles (positioned at frame edges) -->
      <div class="expand-handle" :style="handleStyle('nw')" @pointerdown="onResizeStart($event, 'nw')" />
      <div class="expand-handle" :style="handleStyle('ne')" @pointerdown="onResizeStart($event, 'ne')" />
      <div class="expand-handle" :style="handleStyle('sw')" @pointerdown="onResizeStart($event, 'sw')" />
      <div class="expand-handle" :style="handleStyle('se')" @pointerdown="onResizeStart($event, 'se')" />
      <div class="expand-handle" :style="handleStyle('n')"  @pointerdown="onResizeStart($event, 'n')" />
      <div class="expand-handle" :style="handleStyle('s')"  @pointerdown="onResizeStart($event, 's')" />
      <div class="expand-handle" :style="handleStyle('w')"  @pointerdown="onResizeStart($event, 'w')" />
      <div class="expand-handle" :style="handleStyle('e')"  @pointerdown="onResizeStart($event, 'e')" />

      <!-- Action toolbar -->
      <div class="expand-action-bar" :style="{ ...actionBarStyle, zIndex: 20 }">
        <ToolbarButton :icon="cancelIcon" title="取消" danger @action="$emit('cancel')" />
        <ToolbarButton :icon="confirmIcon" title="确认扩展" variant="primary" @action="$emit('confirm')" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.expander-root { pointer-events: none; }

.expand-backdrop {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.45);
  pointer-events: none;
  z-index: 0;
}

.expand-image-host { box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2); z-index: 1; }
.expand-image { width: 100%; height: 100%; object-fit: contain; display: block; user-select: none; -webkit-user-drag: none; }

.expand-boundary { border: 2px dashed rgba(255, 255, 255, 0.5); border-radius: 4px; box-sizing: border-box; z-index: 1; }

.expand-frame {
  position: fixed;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.9);
  border-radius: 2px;
  z-index: 2;
  overflow: visible;
}
.grid-line { stroke: rgba(255, 255, 255, 0.4); stroke-width: 1; }

/* Frame interior captures events for move; exterior passes through */
.frame-move-area {
  position: absolute; inset: 0;
  cursor: move; touch-action: none;
  pointer-events: auto;
}

.expand-handle {
  position: fixed;
  width: 10px; height: 10px;
  background: #fff; border: 1.5px solid rgba(0, 0, 0, 0.5);
  border-radius: 2px;
  z-index: 15;
  pointer-events: auto;
}

.expand-action-bar {
  display: flex; align-items: center; gap: 2px;
  padding: 4px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(12px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}
</style>
