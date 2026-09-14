<script setup lang="ts">
/**
 * SelectionFrame —— 多选群组框（对齐老版 multi-select/SelectionFrame.vue 的"小框 + 大框"）。
 *
 * 两个框各是什么：
 * - **大框（外框）**：选中节点矩形的并集再按配置 padding 向外扩一圈，专门给节点上方的标题条留位置；
 *   它同时是**整组拖动的把手**（按在它上面拖 = 把这组节点一起移动）。
 * - **小框（内框）**：**紧贴节点并集**的框，尺寸就是节点并集本身，**不含标题**；
 *   它按配置的 padding 落在大框里（左/上各内缩 padding），只有位置受 padding 影响。
 *
 * 关键：内框的尺寸**不再由 padding 反推**。以前外框用"节点并集 + padding"、内框位置用 padding、
 * 内框尺寸却写成了外框尺寸，于是内框被推到右下、比外框还大，两个框交叉错位。
 * 现在两框几何全在 multiSelectEngine.computeSelectionFrameGeometry 里一次算清，组件只贴样式。
 *
 * 外观（颜色/线型/线宽/圆角/填充）与两框间距全来自插件 Config（分组「布局/多选」），
 * 改动经 settings.onChange 实时生效；线宽与圆角按 1/zoom 反向缩放，缩放画布时框线粗细恒定。
 *
 * 拖动：框内左键拖动 = 整组移动（逐帧 updateNodeVisual 视觉写，松手经 graph.updateNodes 批量落盘，
 * 唯一写入口负责历史）；中键 = 平移画布。只移动"顶层且祖先未选"的节点（父被选则子随父动，避免双位移）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import type { NodeLayoutService, ViewportService } from '@mini-canvas/canvas-render'
import type { SelectionService, NodeStoreService, GraphDocumentService } from '@mini-canvas/canvas-data'
import {
  computeSelectionFrameGeometry,
  draggableMembers,
  type MultiSelectRect,
  type SelectionFrameGeometry,
} from './multiSelectEngine'
import {
  applyMultiSelectFrameChange,
  frameStrokeCss,
  resolveMultiSelectFrameConfig,
  type MultiSelectFrameConfig,
} from './multiSelectConfig'

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
function graph(): GraphDocumentService {
  return ctx.get<GraphDocumentService>('graph')
}
function viewportSvc(): ViewportService | undefined {
  return ctx.get<ViewportService>('viewport')
}

// ====== 外观配置（实时跟随设置面板）======
const frameConfig = ref<MultiSelectFrameConfig>(resolveMultiSelectFrameConfig((key) => ctx.get<{ get(k: string): unknown } | undefined>('settings')?.get(key)))
const settingsOff = ctx
  .get<{ onChange(cb: (key: string, value: unknown) => void): { dispose(): void } } | undefined>('settings')
  ?.onChange((key, value) => {
    frameConfig.value = applyMultiSelectFrameChange(frameConfig.value, key, value)
  })
onBeforeUnmount(() => settingsOff?.dispose())

// ====== 当前选中节点的内外两框（随选中 / 布局变化重算）======
const frame = ref<SelectionFrameGeometry | null>(null)

function refreshFrame(): void {
  const l = layout()
  if (!l) return
  const ids = [...sel().ids]
  if (ids.length <= 1) {
    frame.value = null
    return
  }
  const rects = ids.map((id) => l.getNodeRect(id)).filter((r): r is MultiSelectRect => r !== null)
  frame.value = computeSelectionFrameGeometry(rects, frameConfig.value)
}

// 选中变化触发重算（内核 onChange 是选中单源，最可靠）
let unsubSel: (() => void) | undefined
unsubSel = sel().onChange(() => refreshFrame())

// 节点尺寸/位置变化（拖拽落盘、插件增删节点、resize）后包围框要跟上；
// 拖动中的"框跟随"由下面的 frameBounds 本地偏移负责，这里只管最终态。
let unsubStore: (() => void) | undefined
unsubStore = nodeStore().subscribe(() => refreshFrame())

// 配置或选中集变化都要重算（配置改变两框间距/大小）
watch([() => sel().ids, frameConfig], () => refreshFrame(), { immediate: true })

// ====== 整组拖动 ======
const isDragging = ref(false)
const dragStartClient = ref({ x: 0, y: 0 })
/** 拖动起始时各可动节点的绝对位置（flow） */
const dragStartPositions = ref<Map<string, { x: number; y: number }>>(new Map())
/** 拖动中最新视觉位置（松手落盘用） */
const livePositions = ref<Map<string, { x: number; y: number }>>(new Map())
// ====== 中键平移 ======
const isPanning = ref(false)
const panStartClient = ref({ x: 0, y: 0 })
const panStartViewport = ref({ x: 0, y: 0, zoom: 1 })

function handleMouseDown(e: MouseEvent): void {
  if (e.button === 1) {
    // 中键在框上 = 平移画布（保留 zoom）
    e.stopPropagation()
    e.preventDefault()
    isPanning.value = true
    panStartClient.value = { x: e.clientX, y: e.clientY }
    panStartViewport.value = { ...viewport.value }
    window.addEventListener('mousemove', onPanMove)
    window.addEventListener('mouseup', onPanUp)
    return
  }
  if (e.button !== 0 || !frame.value) return

  e.stopPropagation()
  e.preventDefault()
  isDragging.value = true
  dragStartClient.value = { x: e.clientX, y: e.clientY }

  const nodes = nodeStore().getNodes()
  const movable = draggableMembers(sel().ids, nodes)
  const l = layout()
  const startMap = new Map<string, { x: number; y: number }>()
  const liveMap = new Map<string, { x: number; y: number }>()
  for (const id of movable) {
    const rect = l?.getNodeRect(id)
    if (rect) {
      startMap.set(id, { x: rect.x, y: rect.y })
      liveMap.set(id, { x: rect.x, y: rect.y })
    }
  }
  dragStartPositions.value = startMap
  livePositions.value = liveMap

  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragUp)
}

function onDragMove(e: MouseEvent): void {
  if (!isDragging.value) return
  const zoom = viewport.value.zoom || 1
  const canvasDx = (e.clientX - dragStartClient.value.x) / zoom
  const canvasDy = (e.clientY - dragStartClient.value.y) / zoom

  // 整组节点视觉移动（渲染层单节点视觉写，不触发 store 重灌）
  const nextLive = new Map<string, { x: number; y: number }>()
  for (const [id, start] of dragStartPositions.value) {
    const p = { x: start.x + canvasDx, y: start.y + canvasDy }
    nextLive.set(id, p)
    updateNodeVisual(id, p)
  }
  livePositions.value = nextLive

  // 两框一起跟着位移（store 还没更新，本地算；松手落盘后 refreshFrame 接管）
  const g = frame.value
  if (g) {
    frame.value = {
      outer: { ...g.outer, x: g.outer.x + canvasDx, y: g.outer.y + canvasDy },
      inner: { ...g.inner, x: g.inner.x + canvasDx, y: g.inner.y + canvasDy },
    }
  }
}

function onDragUp(): void {
  if (!isDragging.value) return
  isDragging.value = false
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragUp)

  // 有实际位移 → 批量落盘（原子 + 一条历史记录）
  const entries = [...livePositions.value].map(([id, p]) => ({
    id,
    patch: { position: { x: p.x, y: p.y } },
  }))
  if (entries.length > 0) graph().updateNodes(entries)

  dragStartPositions.value.clear()
  livePositions.value.clear()
  refreshFrame()
}

function onPanMove(e: MouseEvent): void {
  if (!isPanning.value) return
  const vp = viewportSvc()
  if (!vp) return
  vp.setViewport({
    x: panStartViewport.value.x + (e.clientX - panStartClient.value.x),
    y: panStartViewport.value.y + (e.clientY - panStartClient.value.y),
    zoom: panStartViewport.value.zoom,
  })
}
function onPanUp(): void {
  if (!isPanning.value) return
  isPanning.value = false
  window.removeEventListener('mousemove', onPanMove)
  window.removeEventListener('mouseup', onPanUp)
}

// ====== 模板样式 ======
/** 外框容器跟随视口（translate + scale），框内坐标即 flow 坐标 */
const wrapperStyle = computed(() => ({
  transform: `translate(${viewport.value.x}px, ${viewport.value.y}px) scale(${viewport.value.zoom})`,
  transformOrigin: '0 0',
}))

/** 外框（大框）：几何 + 描边样式；线宽/圆角反向缩放，视觉粗细恒定 */
const outerStyle = computed(() => {
  const g = frame.value
  if (!g) return null
  const zoom = viewport.value.zoom || 1
  const stroke = frameStrokeCss(frameConfig.value.outer, 1 / zoom)
  return {
    left: `${g.outer.x}px`,
    top: `${g.outer.y}px`,
    width: `${g.outer.w}px`,
    height: `${g.outer.h}px`,
    ...stroke,
  }
})

/**
 * 内框（小框）：紧贴节点并集，位置 = 外框左上角 + padding。
 *
 * 注意与旧实现的差别：内框是外框的**兄弟**而不是子元素。
 * 嵌在外框里时，一旦外框线宽配成 0（或将来被条件隐藏），内框会跟着一起消失 ——
 * 两个框各有各的样式，就不该有这种连坐关系。
 */
const innerStyle = computed(() => {
  const g = frame.value
  if (!g) return null
  const zoom = viewport.value.zoom || 1
  return {
    left: `${g.inner.x}px`,
    top: `${g.inner.y}px`,
    width: `${g.inner.w}px`,
    height: `${g.inner.h}px`,
    // 与上面那条一样按 1/zoom 反缩放（见 frameStrokeCss 的 lineScale 说明）：
    // 两框都对 zoom 免疫，所以"线宽"这个配置项的含义恒为"你屏幕上看到的粗细"。
    ...frameStrokeCss(frameConfig.value.inner, 1 / zoom),
  }
})

/** 是否画内框：线宽 0、或并集退化成一个点，都没意义 */
const showInner = computed(() => {
  const g = frame.value
  if (!g) return false
  return frameConfig.value.inner.lineWidth > 0 && g.inner.w > 0 && g.inner.h > 0
})

/** 有选中（>1）就显示整个浮层 */
const isVisible = computed(() => frame.value !== null)

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragUp)
  window.removeEventListener('mousemove', onPanMove)
  window.removeEventListener('mouseup', onPanUp)
  unsubSel?.()
  unsubStore?.()
})
</script>

<template>
  <div v-if="isVisible" class="selection-frame-wrapper" :style="wrapperStyle">
    <!-- 大框：永远渲染 —— 它不只是"看得见的框"，更是整组拖动的把手。
         线宽配成 0 / 填充配成透明时它就"看不见"，但仍按在上面拖动整组节点。 -->
    <div
      class="selection-frame-outer"
      :class="{ 'is-dragging': isDragging }"
      :style="outerStyle"
      role="presentation"
      @mousedown="handleMouseDown"
    />
    <!-- 小框：紧贴选中节点并集（不含标题），纯装饰不接事件 -->
    <div v-if="showInner" class="selection-frame-inner" :style="innerStyle" />
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

/* 大框：整组拖动把手（颜色/线型/线宽/圆角/填充全由配置注入 inline style） */
.selection-frame-outer {
  position: absolute;
  box-sizing: border-box;
  cursor: grab;
  pointer-events: auto;
  overflow: visible;
  transition: background 180ms ease, border-color 180ms ease;
}

.selection-frame-outer.is-dragging {
  cursor: grabbing;
}

/* 小框：紧贴节点并集，纯装饰不接事件 */
.selection-frame-inner {
  position: absolute;
  box-sizing: border-box;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .selection-frame-outer {
    transition: none;
  }
}
</style>
