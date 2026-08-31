<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useVueFlow, getRectOfNodes } from '@vue-flow/core'
import type { CSSProperties } from 'vue'
import { useImageDisplay } from './useImageDisplay'
import ResizeHandle from '../../components/Decoration/ResizeHandle.vue'
import ToolbarButton from '../../components/Decoration/ToolbarButton.vue'

// ==================== Props ====================
const props = defineProps<{
  nodeId: string
  imageUrl: string
  imageWidth: number
  imageHeight: number
}>()

const emit = defineEmits<{
  (e: 'update:crop', rect: { x: number; y: number; width: number; height: number }): void
  (e: 'cancel'): void
  (e: 'confirm'): void
}>()

const { viewport, findNode } = useVueFlow()

// ==================== Constants ====================
const MIN_CROP = 20

// SVG icons for ToolbarButton
const cancelIcon = '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
const confirmIcon = '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'

// ==================== Container tracking ====================
// 独立 computed：直接依赖 nodeRect 和 zoom，和 wrapperStyle 并行计算
// 不通过 side-effect 写入，避免了 zoom 变化时 display.scale 过期导致的拖拽弹回
const containerW = computed(() => nodeRect.value.width * viewport.value.zoom)
const containerH = computed(() => nodeRect.value.height * viewport.value.zoom)

// Position computed via viewport transform (like NodeToolbar)
const node = computed(() => findNode(props.nodeId))
const nodeRect = computed(() => {
  const n = node.value
  return n ? getRectOfNodes([n]) : { x: 0, y: 0, width: 256, height: 256 }
})

const zIndex = computed(() => (node.value?.computedPosition?.z || 1) + 100)

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

  return {
    position: 'fixed',
    left: `${left}px`,
    top: `${top}px`,
    width: `${w}px`,
    height: `${h}px`,
    zIndex: zIndex.value,
    borderRadius: '12px',
    pointerEvents: 'auto',
  }
})

// ==================== Image display geometry (object-contain within overlay) ====================
const display = useImageDisplay(containerW, containerH, props.imageWidth, props.imageHeight)

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

// ==================== Action bar ====================
// 位置跟随裁剪框底边居中（同扩展框的 action bar 风格）
const actionBarStyle = computed<CSSProperties>(() => {
  const d = display.value
  const fb = d.oy + (crop.y + crop.h) * d.scale
  const fcx = d.ox + (crop.x + crop.w / 2) * d.scale
  return {
    position: 'absolute',
    left: `${fcx}px`, top: `${fb + 14}px`,
    transform: 'translateX(-50%)',
    pointerEvents: 'auto',
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
    // 正确的 resize 逻辑：固定对边，移动当前边
    const right = d.scX + d.scW
    const bottom = d.scY + d.scH
    let nx = d.scX, ny = d.scY, nw = d.scW, nh = d.scH

    // X 轴
    if (d.dir.includes('w')) {
      nx = Math.max(0, Math.min(d.scX + dx, right - MIN_CROP))
      nw = right - nx
    } else if (d.dir.includes('e')) {
      nx = d.scX
      nw = Math.max(MIN_CROP, Math.min(d.scW + dx, props.imageWidth - nx))
    }

    // Y 轴
    if (d.dir.includes('n')) {
      ny = Math.max(0, Math.min(d.scY + dy, bottom - MIN_CROP))
      nh = bottom - ny
    } else if (d.dir.includes('s')) {
      ny = d.scY
      nh = Math.max(MIN_CROP, Math.min(d.scH + dy, props.imageHeight - ny))
    }

    crop.x = nx; crop.y = ny; crop.w = nw; crop.h = nh
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
onUnmounted(() => {
  // 释放 pointer capture
  if (overlayRef.value) {
    try { overlayRef.value.releasePointerCapture?.(1) } catch { /* ignore */ }
  }
  // 清理计时器
  if (emitTimer) {
    clearTimeout(emitTimer)
    emitTimer = null
  }
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
        <ResizeHandle dir="nw" class="nw" @pointerdown="onPointerDown($event, 'nw')" />
        <ResizeHandle dir="ne" class="ne" @pointerdown="onPointerDown($event, 'ne')" />
        <ResizeHandle dir="sw" class="sw" @pointerdown="onPointerDown($event, 'sw')" />
        <ResizeHandle dir="se" class="se" @pointerdown="onPointerDown($event, 'se')" />
        <ResizeHandle dir="n" class="n" @pointerdown="onPointerDown($event, 'n')" />
        <ResizeHandle dir="s" class="s" @pointerdown="onPointerDown($event, 's')" />
        <ResizeHandle dir="w" class="w" @pointerdown="onPointerDown($event, 'w')" />
        <ResizeHandle dir="e" class="e" @pointerdown="onPointerDown($event, 'e')" />
      </div>

      <!-- Action toolbar（同扩展框风格） -->
      <div class="crop-action-bar" :style="{ ...actionBarStyle, zIndex: 20 }" @pointerdown.stop>
        <ToolbarButton :icon="cancelIcon" title="取消" danger @action="$emit('cancel')" />
        <ToolbarButton :icon="confirmIcon" title="确认裁剪" variant="primary" @action="$emit('confirm')" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.crop-overlay {
  cursor: crosshair;
  touch-action: none;
  border-radius: 12px;
}

.crop-letterbox {
  position: absolute;
  background: rgba(0, 0, 0, 0.68);
  pointer-events: none;
}

.crop-shade {
  position: absolute;
  background: rgba(0, 0, 0, 0.52);
  pointer-events: none;
}

.crop-frame {
  position: absolute;
  cursor: move;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.95), 0 12px 36px rgba(0, 0, 0, 0.28);
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

/* 控制柄统一由 ResizeHandle 渲染（正方形、白底黑边、2px 圆角）。
   方向定位通过透传 class + :deep 作用到 ResizeHandle 根元素。 */
.crop-frame :deep(.nw) { top: -5px; left: -5px; }
.crop-frame :deep(.ne) { top: -5px; right: -5px; }
.crop-frame :deep(.sw) { bottom: -5px; left: -5px; }
.crop-frame :deep(.se) { bottom: -5px; right: -5px; }
.crop-frame :deep(.n)  { top: -5px; left: 50%; margin-left: -5px; }
.crop-frame :deep(.s)  { bottom: -5px; left: 50%; margin-left: -5px; }
.crop-frame :deep(.w)  { top: 50%; left: -5px; margin-top: -5px; }
.crop-frame :deep(.e)  { top: 50%; right: -5px; margin-top: -5px; }

/* 裁剪框 action bar：样式与扩展框的 .expand-action-bar 保持一致 */
.crop-action-bar {
  display: flex; align-items: center; gap: 2px;
  padding: 4px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(12px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}
</style>
