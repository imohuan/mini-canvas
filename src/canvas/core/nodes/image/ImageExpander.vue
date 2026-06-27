<script setup lang="ts">
import { ref, reactive, computed, onMounted, nextTick, watch } from 'vue'
import { useVueFlow, getRectOfNodes } from '@vue-flow/core'
import type { CSSProperties } from 'vue'
import ToolbarButton from '../../components/Decoration/ToolbarButton.vue'
import { useCanvasRuntime } from '../../runtime/useCanvasRuntime'
import type { ToolbarButtonDefinition } from '../../registry/types'

// ==================== Props ====================
const props = defineProps<{
  nodeId: string
  imageUrl: string
  imageWidth: number
  imageHeight: number
}>()

const emit = defineEmits<{
  (e: 'update:expand', rect: { x: number; y: number; width: number; height: number }): void
}>()

const { viewport, findNode, viewportRef } = useVueFlow()
const runtime = useCanvasRuntime()

// ==================== Constants ====================
const MIN_EXPAND = 20
const GRID_COLS = 3
const GRID_ROWS = 3

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

// Container: absolute inside viewportRef, z-index below toolbar (which is node.z+1)
const viewportX = computed(() => viewport.value.x)
const viewportY = computed(() => viewport.value.y)
const zoom = computed(() => viewport.value.zoom)

// Background + frame styles — all absolute in viewport, using viewport-relative coords
const containerStyle = computed<CSSProperties>(() => ({
  position: 'absolute',
  inset: '0',
  pointerEvents: 'none',
}))

// Image display at node's viewport-relative position
function imgScreenX() { return nodeRect.value.x * zoom.value + viewportX.value + display.value.ox }
function imgScreenY() { return nodeRect.value.y * zoom.value + viewportY.value + display.value.oy }

const imageScreenStyle = computed<CSSProperties>(() => ({
  position: 'absolute',
  left: `${nodeRect.value.x * zoom.value + viewportX.value}px`,
  top: `${nodeRect.value.y * zoom.value + viewportY.value}px`,
  width: `${nodeRect.value.width * zoom.value}px`,
  height: `${nodeRect.value.height * zoom.value}px`,
  borderRadius: '12px',
  overflow: 'hidden',
  pointerEvents: 'none',
}))

// Interactive area — larger than node to support outward drag
const interactiveStyle = computed<CSSProperties>(() => {
  const rect = nodeRect.value
  const pad = Math.max(rect.width, rect.height) * zoom.value * 2
  return {
    position: 'absolute',
    left: `${rect.x * zoom.value + viewportX.value - pad}px`,
    top: `${rect.y * zoom.value + viewportY.value - pad}px`,
    width: `${rect.width * zoom.value + pad * 2}px`,
    height: `${rect.height * zoom.value + pad * 2}px`,
    pointerEvents: 'auto',
    cursor: 'crosshair',
  }
})

// ==================== Expand area ====================
const expand = reactive({ x: 0, y: 0, w: 0, h: 0 })
function initExpand() {
  expand.x = 0; expand.y = 0
  expand.w = props.imageWidth; expand.h = props.imageHeight
}

// ==================== Drag ====================
type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e'
type Drag =
  | { kind: 'move'; sx: number; sy: number; scX: number; scY: number }
  | { kind: 'resize'; dir: Handle; sx: number; sy: number; scX: number; scY: number; scW: number; scH: number }
  | null

const drag = ref<Drag>(null)
const overlayRef = ref<HTMLElement | null>(null)

// ==================== Frame ====================
const frameScreenStyle = computed<CSSProperties>(() => {
  const d = display.value
  const ox = imgScreenX(); const oy = imgScreenY()
  return {
    position: 'absolute',
    left: `${ox + expand.x * d.scale}px`,
    top: `${oy + expand.y * d.scale}px`,
    width: `${expand.w * d.scale}px`,
    height: `${expand.h * d.scale}px`,
    pointerEvents: 'none',
  }
})

const gridData = computed(() => {
  const d = display.value
  const ox = imgScreenX(); const oy = imgScreenY()
  const fl = ox + expand.x * d.scale
  const ft = oy + expand.y * d.scale
  const fw = expand.w * d.scale
  const fh = expand.h * d.scale
  const lines: { type: 'h' | 'v'; pos: number }[] = []
  for (let i = 1; i < GRID_COLS; i++) lines.push({ type: 'v', pos: fl + (fw * i) / GRID_COLS })
  for (let i = 1; i < GRID_ROWS; i++) lines.push({ type: 'h', pos: ft + (fh * i) / GRID_ROWS })
  return { fl, ft, fw, fh, lines }
})

const originalBoundaryStyle = computed<CSSProperties>(() => {
  const d = display.value
  return {
    position: 'absolute',
    left: `${imgScreenX()}px`,
    top: `${imgScreenY()}px`,
    width: `${d.dw}px`,
    height: `${d.dh}px`,
    pointerEvents: 'none',
  }
})

// ==================== Handle style ====================
function handleStyle(dir: Handle): CSSProperties {
  const d = display.value
  const rect = nodeRect.value
  const pad = Math.max(rect.width, rect.height) * zoom.value * 2
  const iox = rect.x * zoom.value + viewportX.value - pad
  const ioy = rect.y * zoom.value + viewportY.value - pad

  const ox = imgScreenX(); const oy = imgScreenY()
  const fl = ox + expand.x * d.scale - iox
  const ft = oy + expand.y * d.scale - ioy
  const fw = expand.w * d.scale
  const fh = expand.h * d.scale

  switch (dir) {
    case 'nw': return { position: 'absolute', left: `${fl - 5}px`, top: `${ft - 5}px`, cursor: 'nw-resize' }
    case 'ne': return { position: 'absolute', left: `${fl + fw - 5}px`, top: `${ft - 5}px`, cursor: 'ne-resize' }
    case 'sw': return { position: 'absolute', left: `${fl - 5}px`, top: `${ft + fh - 5}px`, cursor: 'sw-resize' }
    case 'se': return { position: 'absolute', left: `${fl + fw - 5}px`, top: `${ft + fh - 5}px`, cursor: 'se-resize' }
    case 'n':  return { position: 'absolute', left: `${fl + fw / 2 - 5}px`, top: `${ft - 5}px`, cursor: 'n-resize' }
    case 's':  return { position: 'absolute', left: `${fl + fw / 2 - 5}px`, top: `${ft + fh - 5}px`, cursor: 's-resize' }
    case 'w':  return { position: 'absolute', left: `${fl - 5}px`, top: `${ft + fh / 2 - 5}px`, cursor: 'w-resize' }
    case 'e':  return { position: 'absolute', left: `${fl + fw - 5}px`, top: `${ft + fh / 2 - 5}px`, cursor: 'e-resize' }
  }
  return { position: 'absolute' }
}

// ==================== Pointer events ====================
function onPointerDown(e: PointerEvent, dir?: Handle) {
  e.preventDefault(); e.stopPropagation()
  if (!overlayRef.value) return
  if (dir) {
    drag.value = { kind: 'resize', dir, sx: e.clientX, sy: e.clientY, scX: expand.x, scY: expand.y, scW: expand.w, scH: expand.h }
  } else {
    drag.value = { kind: 'move', sx: e.clientX, sy: e.clientY, scX: expand.x, scY: expand.y }
  }
  overlayRef.value.setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!drag.value) return
  const d = drag.value
  const scale = display.value.scale
  const dx = (e.clientX - d.sx) / scale
  const dy = (e.clientY - d.sy) / scale
  if (d.kind === 'move') {
    expand.x = d.scX + dx; expand.y = d.scY + dy
  } else {
    const right = d.scX + d.scW; const bottom = d.scY + d.scH
    let nx = d.scX, ny = d.scY, nw = d.scW, nh = d.scH
    if (d.dir.includes('w')) { nx = d.scX + dx; nw = right - nx }
    else if (d.dir.includes('e')) { nw = d.scW + dx }
    if (d.dir.includes('n')) { ny = d.scY + dy; nh = bottom - ny }
    else if (d.dir.includes('s')) { nh = d.scH + dy }
    nw = Math.max(MIN_EXPAND, nw); nh = Math.max(MIN_EXPAND, nh)
    expand.x = nx; expand.y = ny; expand.w = nw; expand.h = nh
  }
}

function onPointerUp(e: PointerEvent) {
  drag.value = null
  overlayRef.value?.releasePointerCapture(e.pointerId)
  emitExpand()
}

// ==================== Emit ====================
function getExpandRect() { return { x: Math.round(expand.x), y: Math.round(expand.y), width: Math.round(expand.w), height: Math.round(expand.h) } }
defineExpose({ getExpandRect })
function emitExpand() { emit('update:expand', getExpandRect()) }
let emitTimer: ReturnType<typeof setTimeout> | null = null
watch(expand, () => { if (emitTimer) clearTimeout(emitTimer); emitTimer = setTimeout(emitExpand, 16) }, { deep: true })

// ==================== Registry toolbar buttons (group:'expand') ====================
const overlayButtons = computed<ToolbarButtonDefinition[]>(() => {
  const nodeType = props.data?.nodeType as string | undefined
  const all = [...runtime.toolbarRegistry.getByPosition('top'), ...runtime.toolbarRegistry.getByPosition('bottom')]
  return all.filter((btn) => {
    if (btn.nodeTypes && btn.nodeTypes.length > 0 && nodeType) { if (!btn.nodeTypes.includes(nodeType)) return false }
    return btn.group === 'expand'
  })
})

function buildContext(): any {
  return { runtime, actions: null, selection: null, viewport: null, store: null, logger: console, node: props as any, nodeType: props.data?.nodeType as string | undefined }
}
function btnVisible(btn: ToolbarButtonDefinition): boolean {
  if (btn.visible === undefined) return true
  if (typeof btn.visible === 'boolean') return btn.visible
  try { return btn.visible(buildContext()) } catch { return true }
  return true
}
function btnDisabled(btn: ToolbarButtonDefinition): boolean {
  if (btn.disabled === undefined) return false
  if (typeof btn.disabled === 'boolean') return btn.disabled
  try { return btn.disabled(buildContext()) } catch { return true }
  return false
}
function onBtnAction(btn: ToolbarButtonDefinition) {
  if (btnDisabled(btn)) return
  runtime.commandRegistry.execute(btn.commandId, buildContext())
}

// Action bar positioned below expand frame
const actionBarStyle = computed<CSSProperties>(() => {
  const d = display.value
  const ox = imgScreenX(); const oy = imgScreenY()
  const fb = oy + expand.y * d.scale + expand.h * d.scale
  const fcx = ox + expand.x * d.scale + (expand.w * d.scale) / 2
  return {
    position: 'absolute',
    left: `${fcx}px`, top: `${fb + 14}px`,
    transform: 'translateX(-50%)',
    pointerEvents: 'auto',
  }
})

onMounted(() => { initExpand(); nextTick(() => emitExpand()) })
</script>

<template>
  <Teleport :to="viewportRef" :disabled="!viewportRef">
    <div v-if="node" class="expand-container" :style="containerStyle">
      <!-- Backdrop -->
      <div class="expand-backdrop" />

      <!-- Image -->
      <div class="expand-image-host" :style="imageScreenStyle">
        <img :src="imageUrl" class="expand-image" draggable="false" />
      </div>

      <!-- Original boundary dashed -->
      <div class="expand-original-boundary" :style="originalBoundaryStyle" />

      <!-- Expand frame -->
      <div class="expand-frame" :style="frameScreenStyle">
        <svg class="expand-grid-svg" :width="gridData.fw" :height="gridData.fh">
          <template v-for="(line, i) in gridData.lines" :key="i">
            <line v-if="line.type === 'v'" :x1="line.pos - gridData.fl" y1="0" :x2="line.pos - gridData.fl" :y2="gridData.fh" class="grid-line" />
            <line v-else x1="0" :y1="line.pos - gridData.ft" :x2="gridData.fw" :y2="line.pos - gridData.ft" class="grid-line" />
          </template>
        </svg>
      </div>

      <!-- Interactive overlay -->
      <div ref="overlayRef" class="expand-interactive" :style="interactiveStyle"
        @pointerdown="onPointerDown($event)" @pointermove="onPointerMove" @pointerup="onPointerUp">
        <div class="expand-handle" :style="handleStyle('nw')" @pointerdown.stop="onPointerDown($event, 'nw')" />
        <div class="expand-handle" :style="handleStyle('ne')" @pointerdown.stop="onPointerDown($event, 'ne')" />
        <div class="expand-handle" :style="handleStyle('sw')" @pointerdown.stop="onPointerDown($event, 'sw')" />
        <div class="expand-handle" :style="handleStyle('se')" @pointerdown.stop="onPointerDown($event, 'se')" />
        <div class="expand-handle" :style="handleStyle('n')"  @pointerdown.stop="onPointerDown($event, 'n')" />
        <div class="expand-handle" :style="handleStyle('s')"  @pointerdown.stop="onPointerDown($event, 's')" />
        <div class="expand-handle" :style="handleStyle('w')"  @pointerdown.stop="onPointerDown($event, 'w')" />
        <div class="expand-handle" :style="handleStyle('e')"  @pointerdown.stop="onPointerDown($event, 'e')" />
      </div>

      <!-- Action toolbar (registry) -->
      <div v-if="overlayButtons.length > 0" class="expand-action-bar" :style="actionBarStyle">
        <ToolbarButton
          v-for="btn in overlayButtons" :key="btn.id" v-show="btnVisible(btn)"
          :icon="btn.icon" :title="btn.title" :tooltip="btn.tooltip"
          :disabled="btnDisabled(btn)" :dropdown="btn.dropdown" :custom-render="btn.customRender"
          @action="onBtnAction(btn)" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.expand-container { touch-action: none; }

.expand-backdrop {
  position: absolute; inset: 0;
  background: rgba(0, 0, 0, 0.45);
  pointer-events: none;
}

.expand-image-host { box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2); }
.expand-image { width: 100%; height: 100%; object-fit: contain; display: block; pointer-events: none; user-select: none; -webkit-user-drag: none; }

.expand-original-boundary { border: 2px dashed rgba(255, 255, 255, 0.5); border-radius: 4px; box-sizing: border-box; }

.expand-frame {
  position: absolute;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.9);
  border-radius: 2px;
}
.expand-grid-svg { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
.grid-line { stroke: rgba(255, 255, 255, 0.4); stroke-width: 1; }

.expand-interactive { touch-action: none; }
.expand-handle {
  width: 10px; height: 10px;
  background: #fff; border: 1.5px solid rgba(0, 0, 0, 0.5);
  border-radius: 2px; z-index: 5; flex-shrink: 0;
}

.expand-action-bar {
  display: flex; align-items: center; gap: 2px;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  background: rgba(30, 30, 30, 0.92);
  backdrop-filter: blur(12px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}
.expand-action-bar :deep(.toolbar-button) { color: #e5e7eb !important; }
.expand-action-bar :deep(.toolbar-button:hover) { background: rgba(255, 255, 255, 0.12) !important; }
</style>
