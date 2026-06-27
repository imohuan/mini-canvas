<script setup lang="ts">
import { useVueFlow } from '@vue-flow/core'
import { onUnmounted, ref } from 'vue'

/**
 * GroupNode — 分组容器节点 (v0.2.0)
 *
 * 尺寸由 VueFlow NodeWrapper 通过 node.style 管理。
 * GroupNode 自身 width: 100%; height: 100% 占满父容器，
 * 不再自己计算 / 覆盖尺寸。
 *
 * 半透明矩形容器，选中时显示独立边框和四角 resize 控制点。
 * body 区域 pointer-events: none，让事件穿透到子节点。
 */
type GroupNodeData = {
  label?: string
}

const props = defineProps<{
  id: string
  data: GroupNodeData
  selected: boolean
  position?: { x: number; y: number }
  dimensions?: { width: number; height: number }
}>()

const vf = useVueFlow()

const MIN_WIDTH = 160
const MIN_HEIGHT = 120

const isResizing = ref(false)

interface ChildResizePosition {
  id: string
  x: number
  y: number
}

interface ResizeState {
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  startScreenX: number
  startScreenY: number
  startWidth: number
  startHeight: number
  startX: number
  startY: number
  childPositions: ChildResizePosition[]
}

const resizeState = ref<ResizeState | null>(null)

function getCurrentDimensions(): { w: number; h: number } {
  const node = vf.getNodes.value.find((item: any) => item.id === props.id) as any
  const dims = node?.dimensions ?? props.dimensions
  return {
    w: Math.max((dims?.width as number) || MIN_WIDTH, MIN_WIDTH),
    h: Math.max((dims?.height as number) || MIN_HEIGHT, MIN_HEIGHT),
  }
}

function getCurrentNodePosition() {
  const node = vf.getNodes.value.find((item: any) => item.id === props.id) as any
  const position = node?.position ?? props.position
  return {
    x: Number.isFinite(position?.x) ? position.x : 0,
    y: Number.isFinite(position?.y) ? position.y : 0,
  }
}

function getChildResizePositions(): ChildResizePosition[] {
  return vf.getNodes.value
    .filter((node: any) => node.parentNode === props.id)
    .map((node: any) => ({
      id: node.id,
      x: Number.isFinite(node.position?.x) ? node.position.x : 0,
      y: Number.isFinite(node.position?.y) ? node.position.y : 0,
    }))
}

function syncChildPositions(state: ResizeState, parentDeltaX: number, parentDeltaY: number) {
  if (parentDeltaX === 0 && parentDeltaY === 0) return

  for (const child of state.childPositions) {
    vf.updateNode(child.id, {
      position: {
        x: child.x - parentDeltaX,
        y: child.y - parentDeltaY,
      },
    })
  }
}

function onResizePointerDown(corner: ResizeState['corner'], event: PointerEvent) {
  if (!props.selected) return

  event.preventDefault()
  event.stopPropagation()

  const position = getCurrentNodePosition()
  const dims = getCurrentDimensions()
  isResizing.value = true
  resizeState.value = {
    corner,
    startScreenX: event.clientX,
    startScreenY: event.clientY,
    startWidth: dims.w,
    startHeight: dims.h,
    startX: position.x,
    startY: position.y,
    childPositions: getChildResizePositions(),
  }

  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onResizePointerMove(event: PointerEvent) {
  if (!isResizing.value || !resizeState.value) return

  event.preventDefault()
  event.stopPropagation()

  const state = resizeState.value
  const zoom = vf.viewport.value.zoom || 1
  const dx = (event.clientX - state.startScreenX) / zoom
  const dy = (event.clientY - state.startScreenY) / zoom
  const resizeFromLeft = state.corner.includes('left')
  const resizeFromTop = state.corner.includes('top')

  const nextWidth = Math.max(MIN_WIDTH, state.startWidth + (resizeFromLeft ? -dx : dx))
  const nextHeight = Math.max(MIN_HEIGHT, state.startHeight + (resizeFromTop ? -dy : dy))
  const nextX = resizeFromLeft ? state.startX + state.startWidth - nextWidth : state.startX
  const nextY = resizeFromTop ? state.startY + state.startHeight - nextHeight : state.startY

  const parentDeltaX = nextX - state.startX
  const parentDeltaY = nextY - state.startY
  syncChildPositions(state, parentDeltaX, parentDeltaY)

  vf.updateNode(props.id, {
    position: { x: nextX, y: nextY },
    style: { width: `${nextWidth}px`, height: `${nextHeight}px` },
  })
}

function onResizePointerUp(event: PointerEvent) {
  if (!isResizing.value) return

  event.preventDefault()
  event.stopPropagation()
  isResizing.value = false
  resizeState.value = null
  ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
}

onUnmounted(() => {
  isResizing.value = false
  resizeState.value = null
})
</script>

<template>
  <div
    class="group-node"
    :class="{ 'group-node--selected': selected, 'group-node--resizing': isResizing }"
  >
    <div class="group-node__body" />

    <div v-if="selected" class="group-node__selection" aria-hidden="true">
      <button
        class="group-node__resize-handle group-node__resize-handle--top-left"
        type="button"
        aria-label="Resize group from top left"
        @pointerdown="onResizePointerDown('top-left', $event)"
        @pointermove="onResizePointerMove"
        @pointerup="onResizePointerUp"
      />
      <button
        class="group-node__resize-handle group-node__resize-handle--top-right"
        type="button"
        aria-label="Resize group from top right"
        @pointerdown="onResizePointerDown('top-right', $event)"
        @pointermove="onResizePointerMove"
        @pointerup="onResizePointerUp"
      />
      <button
        class="group-node__resize-handle group-node__resize-handle--bottom-left"
        type="button"
        aria-label="Resize group from bottom left"
        @pointerdown="onResizePointerDown('bottom-left', $event)"
        @pointermove="onResizePointerMove"
        @pointerup="onResizePointerUp"
      />
      <button
        class="group-node__resize-handle group-node__resize-handle--bottom-right"
        type="button"
        aria-label="Resize group from bottom right"
        @pointerdown="onResizePointerDown('bottom-right', $event)"
        @pointermove="onResizePointerMove"
        @pointerup="onResizePointerUp"
      />
    </div>
  </div>
</template>

<style scoped>
.group-node {
  position: relative;
  width: 100%;
  height: 100%;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 10px;
  background: rgba(148, 163, 184, 0.05);
  overflow: visible;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.group-node--selected {
  border-color: rgba(148, 163, 184, 0.44);
  background: rgba(148, 163, 184, 0.07);
}

.group-node--resizing {
  user-select: none;
}

.group-node__body {
  flex: 1;
  pointer-events: none;
}

.group-node__selection {
  position: absolute;
  inset: -1px;
  z-index: 2;
  border: 1px solid rgba(209, 213, 219, 0.78);
  border-radius: 10px;
  pointer-events: none;
  box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.1);
}

.group-node__resize-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  padding: 0;
  border: 1px solid rgba(107, 114, 128, 0.85);
  border-radius: 3px;
  background: #d1d5db;
  pointer-events: auto;
  touch-action: none;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    transform 120ms ease;
}

.group-node__resize-handle:hover,
.group-node--resizing .group-node__resize-handle {
  background: #f3f4f6;
  border-color: rgba(75, 85, 99, 0.95);
}

.group-node__resize-handle--top-left {
  top: 0;
  left: 0;
  cursor: nwse-resize;
  transform: translate(-50%, -50%);
}

.group-node__resize-handle--top-right {
  top: 0;
  right: 0;
  cursor: nesw-resize;
  transform: translate(50%, -50%);
}

.group-node__resize-handle--bottom-left {
  bottom: 0;
  left: 0;
  cursor: nesw-resize;
  transform: translate(-50%, 50%);
}

.group-node__resize-handle--bottom-right {
  right: 0;
  bottom: 0;
  cursor: nwse-resize;
  transform: translate(50%, 50%);
}

.group-node__resize-handle--top-left:hover,
.group-node--resizing .group-node__resize-handle--top-left {
  transform: translate(-50%, -50%) scale(1.08);
}

.group-node__resize-handle--top-right:hover,
.group-node--resizing .group-node__resize-handle--top-right {
  transform: translate(50%, -50%) scale(1.08);
}

.group-node__resize-handle--bottom-left:hover,
.group-node--resizing .group-node__resize-handle--bottom-left {
  transform: translate(-50%, 50%) scale(1.08);
}

.group-node__resize-handle--bottom-right:hover,
.group-node--resizing .group-node__resize-handle--bottom-right {
  transform: translate(50%, 50%) scale(1.08);
}
</style>
