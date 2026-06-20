<script setup lang="ts">
/**
 * SelectionFrame — 多选虚线背景框
 *
 * 数据源：
 * - 节点位置/尺寸 → 优先读取 VueFlow 内部 getNodes（包含 dimensions/selected 的最新状态）
 * - 哪些节点选中 → useCanvasStore.selectionState.selectedNodeIds；如果同步还没来得及更新，则回退读取 node.selected
 * - 节点位置更新 → props.vfInstance.updateNode()（直接操作 VueFlow 内部状态，确保视觉同步）
 *
 * 注意：SelectionFrame 必须跟 VueFlow 的真实节点状态保持一致，否则节点已经蓝了，大框却不显示。
 */
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useCanvasStore } from '../../composables/useCanvasStore'
import type { Node } from '@vue-flow/core'
import BaseToolbar from '../../components/toolbar/BaseToolbar.vue'

const props = defineProps<{
  viewport: { x: number; y: number; zoom: number }
  /** VueFlow getNodes 返回值（包含 dimensions/selected 运行时状态） */
  nodes: Node[]
  /** VueFlow 实例（用于 updateNode 同步拖拽位置） */
  vfInstance: { updateNode(id: string, data: Partial<Omit<Node, 'id'>>): void; getNodes: { value: Node[] } }
}>()

const emit = defineEmits<{
  (e: 'pan', vp: { x: number; y: number; zoom: number }): void
  (e: 'batch-connect-start', payload: { event: MouseEvent; type: 'source' | 'target'; nodeIds: string[] }): void
}>()

const canvas = useCanvasStore()

const selectionFrameRef = ref<HTMLElement | null>(null)
const isFrameHovered = ref(false)

const selectedNodeIds = computed(() => {
  const nodes = getLiveNodes()
  return [...getSelectedIdSet(nodes)]
})

const showFrameDecorations = computed(() => Boolean(canvasBounds.value))

function handleBatchConnectStart(event: MouseEvent) {
  emit('batch-connect-start', {
    event,
    type: 'source',
    nodeIds: selectedNodeIds.value,
  })
}

// ====== 拖拽状态 ======
const isDragging = ref(false)
const dragStartPos = ref({ x: 0, y: 0 })
const nodeStartPositions = ref<Map<string, { x: number; y: number }>>(new Map())

// ====== 中键平移 ======
const isPanning = ref(false)
const panStartPos = ref({ x: 0, y: 0 })
const panStartViewport = ref({ x: 0, y: 0, zoom: 1 })

function getLiveNodes(): any[] {
  return props.vfInstance?.getNodes?.value?.length
    ? props.vfInstance.getNodes.value
    : props.nodes
}

function getSelectedIdSet(nodes: any[]): Set<string> {
  const selIds = canvas.selectionState.selectedNodeIds
  const liveSelectedIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id))

  if (selIds instanceof Set && selIds.size >= liveSelectedIds.size) {
    return selIds
  }

  // 兜底：有些时刻 VueFlow 的 selected 已经更新了，但 Pinia 同步还没跑到。
  return liveSelectedIds
}

// ====== 实时计算选中节点边界框 ======
// selectionVersion 作为依赖，确保 selectedNodeIds Set 替换时触发重算
const rawSelectionBounds = computed(() => {
  // 强制依赖 selectionVersion，确保选中变化时重算
  const _v = canvas.selectionState.selectionVersion
  void _v

  // 额外依赖 VueFlow 节点数组引用，拖拽/选中变更时能触发重算
  const nodes = getLiveNodes()
  const selIds = getSelectedIdSet(nodes)

  if (nodes.length === 0) return null
  if (selIds.size <= 1) return null

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  for (const node of nodes) {
    if (!selIds.has(node.id)) continue
    // 使用绝对坐标：group 子节点的 position 是相对父 group 的
    const x = node.computedPosition?.x ?? node.position.x
    const y = node.computedPosition?.y ?? node.position.y
    const w = node.dimensions?.width || 256
    const h = node.dimensions?.height || 256
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + w)
    maxY = Math.max(maxY, y + h)
  }

  // 如果遍历完没找到匹配节点（selectedNodeIds 和 nodes 不同步），返回 null
  if (!isFinite(minX)) return null

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
})

const canvasBounds = computed(() => {
  const bounds = rawSelectionBounds.value
  if (!bounds) return null

  const paddingX = canvas.state.core.selectionFramePaddingX
  const paddingTop = canvas.state.core.selectionFramePaddingTop
  const paddingBottom = canvas.state.core.selectionFramePaddingBottom
  return {
    x: bounds.x - paddingX,
    y: bounds.y - paddingTop,
    width: bounds.width + paddingX * 2,
    height: bounds.height + paddingTop + paddingBottom,
  }
})

const innerBoundsStyle = computed(() => {
  const bounds = rawSelectionBounds.value
  if (!bounds) return undefined

  return {
    left: canvas.state.core.selectionFramePaddingX + 'px',
    top: canvas.state.core.selectionFramePaddingTop + 'px',
    width: bounds.width + 'px',
    height: bounds.height + 'px',
  }
})

const inverseViewportScaleStyle = computed(() => ({
  '--selection-frame-ui-scale': `${1 / props.viewport.zoom}`,
}))

// ====== 拖拽处理 ======
function handleMouseDown(event: MouseEvent) {
  if (event.button === 1) {
    event.preventDefault()
    isPanning.value = true
    panStartPos.value = { x: event.clientX, y: event.clientY }
    panStartViewport.value = { ...props.viewport }
    document.addEventListener('mousemove', handlePanMove)
    document.addEventListener('mouseup', handlePanUp)
    return
  }
  if (event.button !== 0) return

  event.stopPropagation()
  event.preventDefault()
  isDragging.value = true
  dragStartPos.value = { x: event.clientX, y: event.clientY }

  nodeStartPositions.value.clear()
  const nodes = getLiveNodes()
  const selIds = getSelectedIdSet(nodes)
  for (const node of nodes) {
    if (selIds.has(node.id)) {
      nodeStartPositions.value.set(node.id, { ...node.position })
    }
  }

  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
}

function handleMouseMove(event: MouseEvent) {
  if (!isDragging.value) return
  const dx = event.clientX - dragStartPos.value.x
  const dy = event.clientY - dragStartPos.value.y
  const canvasDx = dx / props.viewport.zoom
  const canvasDy = dy / props.viewport.zoom

  const nodes = getLiveNodes()
  const selIds = getSelectedIdSet(nodes)
  for (const node of nodes) {
    if (!selIds.has(node.id)) continue
    const startPos = nodeStartPositions.value.get(node.id)
    if (startPos) {
      const newPos = { x: startPos.x + canvasDx, y: startPos.y + canvasDy }
      // 同步 VueFlow 内部状态（驱动节点视觉移动）
      props.vfInstance.updateNode(node.id, { position: newPos })
      // 同步本地 nodes（驱动 SelectionFrame 边界框移动）
      node.position = newPos
    }
  }
}

function handleMouseUp() {
  if (!isDragging.value) return
  isDragging.value = false
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
}

// ====== 中键平移 ======
function handlePanMove(event: MouseEvent) {
  if (!isPanning.value) return
  const dx = event.clientX - panStartPos.value.x
  const dy = event.clientY - panStartPos.value.y
  emit('pan', {
    x: panStartViewport.value.x + dx,
    y: panStartViewport.value.y + dy,
    zoom: panStartViewport.value.zoom,
  })
}
function handlePanUp() {
  isPanning.value = false
  document.removeEventListener('mousemove', handlePanMove)
  document.removeEventListener('mouseup', handlePanUp)
}

// ====== 滚轮转发 ======
const viewportEl = ref<HTMLElement | null>(null)

function handleWheel(event: WheelEvent) {
  if (viewportEl.value) {
    viewportEl.value.dispatchEvent(new WheelEvent('wheel', {
      deltaX: event.deltaX, deltaY: event.deltaY, deltaZ: event.deltaZ,
      deltaMode: event.deltaMode, clientX: event.clientX, clientY: event.clientY,
      bubbles: true, cancelable: true,
    }))
  }
}

onMounted(() => {
  viewportEl.value = document.querySelector('.vue-flow__viewport') as HTMLElement
  selectionFrameRef.value?.addEventListener('wheel', handleWheel, { passive: false })
})

onUnmounted(() => {
  selectionFrameRef.value?.removeEventListener('wheel', handleWheel)
  selectionFrameRef.value?.removeEventListener('wheel', handleWheel)
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
  document.removeEventListener('mousemove', handlePanMove)
  document.removeEventListener('mouseup', handlePanUp)
})
</script>

<template>
  <div class="selection-frame-wrapper" :style="{
    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
    transformOrigin: '0 0',
  }">
    <div v-if="canvasBounds" ref="selectionFrameRef" class="selection-frame" :class="{ 'is-dragging': isDragging }"
      :style="canvasBounds ? {
        position: 'absolute',
        left: canvasBounds.x + 'px',
        top: canvasBounds.y + 'px',
        width: canvasBounds.width + 'px',
        height: canvasBounds.height + 'px',
        ...inverseViewportScaleStyle,
      } : undefined" @mouseenter="isFrameHovered = true" @mouseleave="isFrameHovered = false"
      @mousedown="handleMouseDown">
      <div v-if="innerBoundsStyle" class="selection-frame-inner-bounds" :style="innerBoundsStyle" />

      <BaseToolbar :node-ids="selectedNodeIds" toolbar-position="top" :extra-offset="canvas.state.core.selectionFramePaddingTop" />

      <button v-show="showFrameDecorations" class="selection-frame-connect-handle" type="button"
        @mousedown.stop.prevent="handleBatchConnectStart">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
          <path d="M12 5v14M5 12h14" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.selection-frame-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  pointer-events: none;
  z-index: 5;
  overflow: visible;
}

.selection-frame {
  border: 1px dashed rgba(148, 163, 184, 0.72);
  background: transparent;
  border-radius: 6px;
  cursor: grab;
  pointer-events: auto;
  overflow: visible;
}

.selection-frame-inner-bounds {
  position: absolute;
  border-radius: 12px;
  border: 1px solid rgba(96, 165, 250, 0.42);
  background: rgba(96, 165, 250, 0.045);
  pointer-events: none;
}


.selection-frame-connect-handle {
  position: absolute;
  top: 50%;
  right: calc(-16px * var(--selection-frame-ui-scale) - 22px);
  width: 32px;
  height: 32px;
  border: 1px solid #e5e7eb;
  border-radius: 9999px;
  background: #fff;
  color: #64748b;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.06), 0 8px 18px rgb(0 0 0 / 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: grab;
  pointer-events: auto;
  z-index: 2;
  transform: translateY(-50%) scale(var(--selection-frame-ui-scale));
  transform-origin: center;
  transition:
    transform 200ms cubic-bezier(0.175, 0.885, 0.32, 1.275),
    opacity 160ms ease,
    color 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.selection-frame-connect-handle:hover {
  color: #334155;
  border-color: #d1d5db;
  transform: translateY(-50%) scale(calc(var(--selection-frame-ui-scale) * 1.06));
}

.selection-frame-connect-handle:active {
  cursor: grabbing;
}

.selection-frame-connect-handle svg {
  width: 16px;
  height: 16px;
  pointer-events: none;
}

.selection-frame.is-dragging {
  cursor: grabbing;
  border-color: rgba(148, 163, 184, 0.95);
  background: rgba(148, 163, 184, 0.1);
}

.selection-frame.is-dragging .selection-frame-inner-bounds {
  border-color: rgba(96, 165, 250, 0.6);
  background: rgba(96, 165, 250, 0.07);
}
</style>