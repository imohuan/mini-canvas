<script setup lang="ts">
import { Position, useVueFlow } from '@vue-flow/core'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import BaseTitle from '../../components/Decoration/BaseTitle.vue'
import NodeToolbar from '../../components/Decoration/NodeToolbar.vue'
import BaseToolbar from '../../components/Toolbar/BaseToolbar.vue'
import { useCanvasStore } from '../../composables/useCanvasStore'
import { createNodeTitleLayout } from '../../utils/viewportSpace'
import { normalizeGroupTitle, resolveGroupBackgroundColor } from './model'

type GroupNodeData = {
  label?: string
  backgroundColor?: string
  _editingTitle?: boolean
  nodeType?: string
}

const props = defineProps<{
  id: string
  data: GroupNodeData
  selected: boolean
  type?: string
  position?: { x: number; y: number }
  dimensions?: { width: number; height: number }
}>()

const vf = useVueFlow()
const canvas = useCanvasStore()

const MIN_WIDTH = 160
const MIN_HEIGHT = 120
const RESIZE_HANDLE_SIZE = 12
const TITLE_HANDLE_GAP = 6

const isResizing = ref(false)
const draftTitle = ref('')
const skipNextTitleBlur = ref(false)
const titleInputRef = ref<HTMLInputElement | null>(null)

const label = computed(() => normalizeGroupTitle(props.data?.label))
const isEditingTitle = computed(() => props.data?._editingTitle === true)
const titleVisible = computed(() => isEditingTitle.value || label.value.length > 0)
const groupBackground = computed(() => resolveGroupBackgroundColor(props.data?.backgroundColor))
const zoom = computed(() => Math.max(vf.viewport.value.zoom || 1, 0.01))
const titleLayout = computed(() => createNodeTitleLayout(zoom.value, {
  offset: canvas.state.core.nodeTitleOffset,
  minZoom: canvas.state.core.nodeTitleScaleMinZoom,
}))
const titleStyle = computed(() => titleLayout.value.style)
const controlHandleClearance = computed(() => {
  if (!props.selected) return 0
  return (RESIZE_HANDLE_SIZE * zoom.value) / 2 + TITLE_HANDLE_GAP * titleLayout.value.scale
})
const titleOffset = computed(() => titleLayout.value.offset)
const titleAlignOffset = computed(() => controlHandleClearance.value)

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

watch(isEditingTitle, (editing) => {
  if (!editing) return
  draftTitle.value = label.value
  nextTick(() => {
    titleInputRef.value?.focus()
    titleInputRef.value?.select()
  })
}, { immediate: true })

function updateGroupData(data: Partial<GroupNodeData>) {
  vf.updateNode(props.id, {
    data: {
      ...(props.data ?? {}),
      ...data,
      nodeType: 'group',
    },
  })
}

function startTitleEdit() {
  if (!label.value) return
  updateGroupData({ _editingTitle: true })
}

function commitTitleEdit() {
  if (skipNextTitleBlur.value) {
    skipNextTitleBlur.value = false
    return
  }
  updateGroupData({ label: normalizeGroupTitle(draftTitle.value), _editingTitle: false })
}

function cancelTitleEdit() {
  skipNextTitleBlur.value = true
  updateGroupData({ _editingTitle: false })
}

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
    :style="{ '--group-node-color': groupBackground }"
  >
    <BaseToolbar v-if="selected" v-bind="$props" toolbar-position="top" />

    <NodeToolbar
      v-if="titleVisible"
      :node-id="id"
      :is-visible="true"
      :position="Position.Top"
      :offset="titleOffset"
      :align-offset="titleAlignOffset"
      :z-index-offset="-1"
      align="start"
    >
      <BaseTitle
        class="group-node__title"
        :interactive="true"
        :editing="isEditingTitle"
        :title-style="titleStyle"
        :title-icon="false"
        :label="label"
      >
        <template v-if="$slots['title-icon']" #title-icon>
          <slot name="title-icon" />
        </template>
        <template #title-label>
          <input
            v-if="isEditingTitle"
            ref="titleInputRef"
            v-model="draftTitle"
            class="group-node__title-value group-node__title-input"
            type="text"
            @keydown.enter.prevent="commitTitleEdit"
            @keydown.escape.prevent="cancelTitleEdit"
            @blur="commitTitleEdit"
            @pointerdown.stop
            @dblclick.stop
          >
          <button
            v-else
            class="group-node__title-value group-node__title-text"
            type="button"
            @dblclick.stop="startTitleEdit"
          >
            {{ label }}
          </button>
        </template>
      </BaseTitle>
    </NodeToolbar>

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
  border: 1px solid color-mix(in srgb, var(--group-node-color) 56%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--group-node-color) 14%, transparent);
  overflow: visible;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.group-node--selected {
  border-color: color-mix(in srgb, var(--group-node-color) 78%, white 22%);
  background: color-mix(in srgb, var(--group-node-color) 18%, transparent);
}

.group-node--resizing {
  user-select: none;
}

.group-node__title {
  pointer-events: auto;
}

.group-node__title-value {
  appearance: none;
  box-sizing: border-box;
  margin: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}

.group-node__title-text {
  display: block;
  min-width: 28px;
  max-width: 260px;
  padding: 0;
  border: 0;
  cursor: text;
  line-height: inherit;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-node__title-input {
  display: block;
  min-width: 28px;
  width: 180px;
  max-width: 260px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--group-node-color) 74%, white 26%);
  border-radius: 6px;
  line-height: 20px;
  outline: none;
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
