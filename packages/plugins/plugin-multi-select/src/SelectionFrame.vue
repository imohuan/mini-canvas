<script setup lang="ts">
/**
 * SelectionFrame —— 多选群组虚线框（对齐老版 multi-select/SelectionFrame.vue）。
 *
 * 当内核选中节点数 > 1 时，在选中集外包一层虚线框 + 内部细线框：
 * - 包围盒 = 选中节点绝对矩形(nodeLayout)并集 + padding（对齐老版 canvasBounds）。
 * - 定位跟随 viewport（wrapper translate+scale），视觉与节点同步缩放。
 * - 框内左键拖动 = 整组移动：逐帧 updateNodeVisual(渲染层单节点视觉写，不触发 store 重灌)，
 *   松手经 history.withRecord + nodeStore.updateNodes 批量落盘。只移动"顶层且祖先未选"节点
 *   （multiSelectEngine.draggableMembers）：父被选则子随父动，避免双重偏移；带父的孤立选中节点本轮跳过。
 * - 中键拖动 = 平移画布（经 viewport 服务 setViewport，保留 zoom）。
 * - 滚轮转发：老版把框上滚轮事件转发给底层 viewport；v2 本组件根 pointer-events 仅在框体 auto，
 *   框内滚轮仍会命中 VueFlow viewport 下层，故无需手动转发。
 *
 * 数据源全来自渲染层只读上下文 + 内核服务；本组件只做 UI 与手势。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import type { NodeLayoutService, ViewportService } from '@mini-canvas/canvas-render'
import type { SelectionService, NodeStoreService, HistoryService } from '@mini-canvas/canvas-core-v2'
import {
  computeUnionBounds,
  paddedBounds,
  draggableMembers,
  DEFAULT_SELECTION_FRAME_PADDING,
  type MultiSelectRect,
} from './multiSelectEngine'

const { viewport, ctx, updateNodeVisual } = useCanvasRender()

// —— 服务（懒取，宿主恒在）——
function sel(): SelectionService {
  return ctx.get<SelectionService>('selection')
}
function layout(): NodeLayoutService | undefined {
  return ctx.get<NodeLayoutService>('nodeLayout')
}
function nodeStore(): NodeStoreService {
  return ctx.get<NodeStoreService>('nodeStore')
}
function history(): HistoryService {
  return ctx.get<HistoryService>('history')
}
function viewportSvc(): ViewportService | undefined {
  return ctx.get<ViewportService>('viewport')
}

// —— 当前选中节点绝对矩形（随选中变化重算；布局服务读 store，选中变化时需主动刷新）——
const bounds = ref<MultiSelectRect | null>(null)

function refreshBounds(): void {
  const l = layout()
  if (!l) return
  const ids = [...sel().ids]
  const rects = ids.map((id) => l.getNodeRect(id)).filter((r): r is MultiSelectRect => r !== null)
  if (rects.length <= 1) {
    bounds.value = null
    return
  }
  const raw = computeUnionBounds(rects)
  bounds.value = raw ? paddedBounds(raw, DEFAULT_SELECTION_FRAME_PADDING) : null
}

// 选中变化触发重算：内核 onChange（选中单源）+ nodeLayout 实测到位后也刷新
watch(
  () => sel().ids,
  () => refreshBounds(),
  { immediate: true },
)

// 订阅内核选中变化（ids Set 替换触发 Vue watch 不一定可靠，onChange 兜底刷新）
let unsubSel: (() => void) | undefined
bindSelChange()
function bindSelChange(): void {
  if (unsubSel) return
  unsubSel = sel().onChange(() => refreshBounds())
}

// 订阅 nodeStore 变化：VueFlow 拖拽落盘/插件增删节点后，包围框跟随新位置刷新
// （宿主 nodeDragStop 批量 updateNodes 不改 selection，靠这里补刷新）
let unsubStore: (() => void) | undefined
function bindStoreChange(): void {
  if (unsubStore) return
  unsubStore = nodeStore().subscribe(() => refreshBounds())
}
bindStoreChange()

// ====== 整组拖动 ======
const isDragging = ref(false)
const dragStartClient = ref({ x: 0, y: 0 })
/** 拖动起始时各可动节点的绝对位置（flow） */
const dragStartPositions = ref<Map<string, { x: number; y: number }>>(new Map())
/** 拖动中最新视觉位置（松手落盘用） */
const livePositions = ref<Map<string, { x: number; y: number }>>(new Map())
/** 拖动起始包围盒（用于框跟随） */
const dragStartBounds = ref<MultiSelectRect | null>(null)
/** 当前框位置 = startBounds + delta（拖动中 store 未变，本地偏移） */
const frameBounds = ref<MultiSelectRect | null>(null)

// ====== 中键平移 ======
const isPanning = ref(false)
const panStartClient = ref({ x: 0, y: 0 })
const panStartViewport = ref({ x: 0, y: 0, zoom: 1 })

function handleMouseDown(e: MouseEvent): void {
  if (e.button === 1) {
    // 中键平移画布（保留 zoom）
    e.stopPropagation()
    e.preventDefault()
    isPanning.value = true
    panStartClient.value = { x: e.clientX, y: e.clientY }
    panStartViewport.value = { ...viewport.value }
    window.addEventListener('mousemove', onPanMove)
    window.addEventListener('mouseup', onPanUp)
    return
  }
  if (e.button !== 0 || !bounds.value) return

  e.stopPropagation()
  e.preventDefault()
  isDragging.value = true
  dragStartClient.value = { x: e.clientX, y: e.clientY }
  dragStartBounds.value = { ...bounds.value }
  frameBounds.value = { ...bounds.value }

  const nodes = nodeStore().getNodes()
  const movable = draggableMembers(sel().ids, nodes)
  const l = layout()
  const startMap = new Map<string, { x: number; y: number }>()
  const liveMap = new Map<string, { x: number; y: number }>()
  for (const id of movable) {
    const rect = l?.getNodeRect(id)
    const pos = rect ? { x: rect.x, y: rect.y } : undefined
    if (pos) {
      startMap.set(id, pos)
      liveMap.set(id, { ...pos })
    }
  }
  dragStartPositions.value = startMap
  livePositions.value = liveMap

  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragUp)
}

function onDragMove(e: MouseEvent): void {
  if (!isDragging.value) return
  const dx = e.clientX - dragStartClient.value.x
  const dy = e.clientY - dragStartClient.value.y
  const zoom = viewport.value.zoom || 1
  const canvasDx = dx / zoom
  const canvasDy = dy / zoom

  // 框跟随（startBounds + delta）
  const sb = dragStartBounds.value
  if (sb) {
    frameBounds.value = {
      id: sb.id,
      x: sb.x + canvasDx,
      y: sb.y + canvasDy,
      w: sb.w,
      h: sb.h,
    }
  }

  // 整组节点视觉移动（渲染层单节点视觉写，不触发 store 重灌）
  const nextLive = new Map<string, { x: number; y: number }>()
  for (const [id, start] of dragStartPositions.value) {
    const p = { x: start.x + canvasDx, y: start.y + canvasDy }
    nextLive.set(id, p)
    updateNodeVisual(id, p)
  }
  livePositions.value = nextLive
}

function onDragUp(): void {
  if (!isDragging.value) return
  isDragging.value = false
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragUp)

  // 有实际位移 → 批量落盘（原子 + 历史）
  const entries = [...livePositions.value].map(([id, p]) => ({
    id,
    patch: { position: { x: p.x, y: p.y } },
  }))
  if (entries.length > 0) {
    history().withRecord(() => nodeStore().updateNodes(entries))
  }
  dragStartPositions.value.clear()
  livePositions.value.clear()
  frameBounds.value = null
  refreshBounds()
}

function onPanMove(e: MouseEvent): void {
  if (!isPanning.value) return
  const vp = viewportSvc()
  if (!vp) return
  const dx = e.clientX - panStartClient.value.x
  const dy = e.clientY - panStartClient.value.y
  vp.setViewport({
    x: panStartViewport.value.x + dx,
    y: panStartViewport.value.y + dy,
    zoom: panStartViewport.value.zoom,
  })
}
function onPanUp(): void {
  if (!isPanning.value) return
  isPanning.value = false
  window.removeEventListener('mousemove', onPanMove)
  window.removeEventListener('mouseup', onPanUp)
}

// 视口变化 → 框跟随 transform 由模板绑定处理；无额外逻辑

// —— 模板样式计算 ——
const wrapperStyle = computed(() => {
  const vp = viewport.value
  return {
    transform: 'translate(' + vp.x + 'px, ' + vp.y + 'px) scale(' + vp.zoom + ')',
    transformOrigin: '0 0',
  }
})

const frameStyle = computed(() => {
  const b = frameBounds.value ?? bounds.value
  if (!b) return null
  const vp = viewport.value
  const zoom = vp.zoom || 1
  return {
    left: b.x + 'px',
    top: b.y + 'px',
    width: b.w + 'px',
    height: b.h + 'px',
    // 边框宽度 / 内部反缩放（老版用 --selection-frame-ui-scale）
    borderWidth: 1 / zoom + 'px',
  }
})

/** 内框（紧贴实际节点并集的细线框）样式 */
const innerStyle = computed(() => {
  const b = bounds.value
  const f = frameBounds.value ?? b
  if (!b || !f) return null
  const vp = viewport.value
  const zoom = vp.zoom || 1
  const padX = DEFAULT_SELECTION_FRAME_PADDING.paddingX
  const padTop = DEFAULT_SELECTION_FRAME_PADDING.paddingTop
  return {
    left: padX + 'px',
    top: padTop + 'px',
    width: b.w + 'px',
    height: b.h + 'px',
    borderRadius: 12 / zoom + 'px',
  }
})

const isVisible = computed(() => bounds.value !== null)

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragUp)
  window.removeEventListener('mousemove', onPanMove)
  window.removeEventListener('mouseup', onPanUp)
  if (unsubSel) unsubSel()
  if (unsubStore) unsubStore()
})
</script>

<template>
  <div v-if="isVisible" class="selection-frame-wrapper" :style="wrapperStyle">
    <div
      class="selection-frame"
      :class="{ 'is-dragging': isDragging }"
      :style="frameStyle"
      @mousedown="handleMouseDown"
    >
      <div v-if="bounds" class="selection-frame-inner" :style="innerStyle" />
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
  position: absolute;
  border: 1px dashed rgba(148, 163, 184, 0.72);
  background: transparent;
  border-radius: 6px;
  cursor: grab;
  pointer-events: auto;
  overflow: visible;
}

.selection-frame-inner {
  position: absolute;
  border: 1px solid rgba(96, 165, 250, 0.42);
  background: rgba(96, 165, 250, 0.045);
  pointer-events: none;
}

.selection-frame.is-dragging {
  cursor: grabbing;
  border-color: rgba(148, 163, 184, 0.95);
  background: rgba(148, 163, 184, 0.1);
}

.selection-frame.is-dragging .selection-frame-inner {
  border-color: rgba(96, 165, 250, 0.6);
  background: rgba(96, 165, 250, 0.07);
}
</style>
