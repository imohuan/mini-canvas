<script setup lang="ts">
/**
 * MiniMapOverlay —— 小地图浮层（注册进 overlay 槽，宿主 CanvasSurface 已渲染该槽）。
 *
 * 行为对齐老版 canvas-core/src/plugins/mini-map/MiniMap.vue：
 * - 右下角固定显示；内容 = 全部非 group 节点的 flow 包围盒 + 当前视口矩形，等比归一化；
 * - 缩略节点用纯色方块（按节点几何，不渲染节点内容）；
 * - 拖拽视口框/空白 → 平移画布（经 viewport 服务 setViewport，保留 zoom）；点击空白 → setCenter 跳转；
 * - 显隐由 mini-map 服务状态（visible）驱动；Ctrl/Cmd+M 切换（见 miniMapPlugin 命令）。
 *
 * 数据全来自渲染层只读源：renderNodes(节点集，宿主随 store 同步) + viewport(响应式视口) +
 * paneRect(画布 pane 尺寸) + nodeLayout(实测矩形)。本组件只做 UI 与手势，不碰内核 store。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import type { ViewportService } from '@mini-canvas/canvas-render'
import type { ViewportState } from '@mini-canvas/canvas-render'
import type { NodeLayoutService } from '@mini-canvas/canvas-render'
import {
  computeContentBounds,
  unionRect,
  viewportRectInFlow,
  computeMapState,
  rectToMap,
  panViewport,
  mapPointToFlow,
  type MiniMapRect,
  type MiniMapMapState,
} from './miniMapEngine'

const { ctx, viewport, paneRect, renderNodes } = useCanvasRender()

// —— 配置（对齐老版默认；如需面板化可后续接 settings）——
const MAP_WIDTH = 240
const MAP_HEIGHT = 160
const PADDING = 8
const NODE_COLOR = '#cbd5e1'
const VIEWER_BORDER = '#3b82f6'

/** 可见内容节点（缩略方块的数据源：flow 矩形） */
interface ContentItem {
  id: string
  rect: MiniMapRect
}

const content = shallowRef<ContentItem[]>([])
/** 当前地图归一化状态（不随 viewport 实时变——拖动/缩放时冻结防跳变） */
const mapState = ref<MiniMapMapState | null>(null)
/** pane 可视尺寸（px）：优先 host paneRect；退化为自量所在全幅 overlay 层；窗口 resize 刷新 */
const paneSize = shallowRef<{ w: number; h: number }>({ w: 800, h: 600 })
const rootEl = ref<HTMLElement | null>(null)

// —— 显隐状态：mini-map 服务（插件 apply ctx.inject('mini-map', state)，命令切换同一对象）——
interface MiniMapServiceState {
  visible: boolean
}
const service = ctx.get<MiniMapServiceState>('mini-map')
const visible = computed(() => !!service && service.visible)

function measurePane(): void {
  const pr = paneRect.value
  if (pr && pr.width > 0 && pr.height > 0) {
    paneSize.value = { w: pr.width, h: pr.height }
    return
  }
  // host 未量测/过期时兜底：量自身所在的全幅 overlay 层（其尺寸 = pane）
  const layer = rootEl.value?.closest('.csurface-overlay') as HTMLElement | null
  if (layer && layer.clientWidth > 0 && layer.clientHeight > 0) {
    paneSize.value = { w: layer.clientWidth, h: layer.clientHeight }
  }
}

function viewRectNow(): MiniMapRect {
  const { w, h } = paneSize.value
  return viewportRectInFlow(viewport.value, w, h)
}

/** 从渲染层 renderNodes + nodeLayout 收内容节点矩形（过滤 group 容器节点） */
function collectContent(): ContentItem[] {
  const layout = ctx.get<NodeLayoutService>('nodeLayout')
  if (!layout) return []
  const list = renderNodes.value
  const out: ContentItem[] = []
  for (const n of list) {
    if (n.type === 'group') continue // group 容器本身不画（子节点已含绝对坐标）
    const rect = layout.getNodeRect(n.id)
    if (rect && rect.w > 0 && rect.h > 0) out.push({ id: n.id, rect })
  }
  return out
}

function rebuild(): void {
  content.value = collectContent()
  const cb = computeContentBounds(content.value.map((c) => c.rect))
  const union = unionRect(cb, viewRectNow())
  mapState.value = union ? computeMapState(union, MAP_WIDTH, MAP_HEIGHT, PADDING) : null
}

// renderNodes（宿主随 store 同步替换）/ paneRect 变化 → 重算内容与归一化
watch(
  () => renderNodes.value,
  () => {
    if (!panning.value) rebuild()
  },
)
watch(paneRect, measurePane)
// 视口 pan/zoom：非拖拽中跟随重算（保证视口框始终纳入地图范围）
watch(
  () => viewport.value,
  () => {
    if (!panning.value) rebuild()
  },
)

function onWindowResize(): void {
  measurePane()
  if (!panning.value) rebuild()
}
onMounted(() => {
  measurePane()
  window.addEventListener('resize', onWindowResize)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  session = null
})
measurePane()
rebuild()

// —— 视口框样式（每次 viewport 变都从最新 mapState + viewport 现算）——
const viewerStyle = computed(() => {
  const ms = mapState.value
  if (!ms) return null
  return { ...rectToMap(viewRectNow(), ms), borderColor: VIEWER_BORDER }
})

function itemStyle(item: ContentItem): Record<string, string | number> | null {
  const ms = mapState.value
  if (!ms) return null
  const r = rectToMap(item.rect, ms)
  return { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', background: NODE_COLOR }
}

// —— 拖拽平移 / 点击跳转 ——
const DRAG_THRESHOLD = 4
interface PanSession {
  startClient: { x: number; y: number }
  startViewport: ViewportState
  mapState: MiniMapMapState
  moved: boolean
}
const panning = ref(false)
let session: PanSession | null = null
let elRect: DOMRect | null = null
let downOnViewer = false

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  const vpService = ctx.get<ViewportService>('viewport')
  if (!vpService || !mapState.value) return
  const target = e.target as HTMLElement | null
  downOnViewer = !!target?.classList.contains('mini-viewer')
  const el = e.currentTarget as HTMLElement
  elRect = el.getBoundingClientRect()
  session = {
    startClient: { x: e.clientX, y: e.clientY },
    startViewport: { ...viewport.value },
    mapState: { ...mapState.value },
    moved: false,
  }
  panning.value = true
  el.setPointerCapture(e.pointerId)
  e.preventDefault()
  e.stopPropagation()
}

function onPointerMove(e: PointerEvent): void {
  if (!panning.value || !session) return
  const dx = e.clientX - session.startClient.x
  const dy = e.clientY - session.startClient.y
  if (!session.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
  session.moved = true
  const vp = ctx.get<ViewportService>('viewport')
  if (!vp) return
  const next = panViewport(session.startViewport, session.startClient, { x: e.clientX, y: e.clientY }, session.mapState.scale)
  vp.setViewport({ x: next.x, y: next.y, zoom: session.startViewport.zoom })
}

function endPointer(e: PointerEvent, jumped: boolean): void {
  const vp = ctx.get<ViewportService>('viewport')
  if (jumped && session && !session.moved && vp) {
    // 点击（无拖动）且不是点在视口框/缩略节点上 → 跳转到该 flow 点（保留 zoom）
    const target = e.target as HTMLElement | null
    if (!downOnViewer && !target?.classList.contains('mini-node') && elRect) {
      const px = e.clientX - elRect.left
      const py = e.clientY - elRect.top
      const pt = mapPointToFlow(px, py, session.mapState)
      vp.setCenter(pt.x, pt.y, session.startViewport.zoom)
    }
  }
  session = null
  panning.value = false
  elRect = null
  downOnViewer = false
  const el = e.currentTarget as HTMLElement
  if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
  rebuild()
}

function onPointerUp(e: PointerEvent): void {
  if (!panning.value) return
  endPointer(e, true)
}

function onPointerCancel(e: PointerEvent): void {
  if (!panning.value) return
  endPointer(e, false)
}
</script>

<template>
  <div v-if="visible" ref="rootEl" class="mini-map-overlay">
    <div
      class="mini-map"
      :style="{ width: MAP_WIDTH + 'px', height: MAP_HEIGHT + 'px' }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
    >
      <div v-for="item in content" :key="item.id" class="mini-node" :style="itemStyle(item)" />
      <div v-if="viewerStyle" class="mini-viewer" :style="viewerStyle" />
    </div>
  </div>
</template>

<style scoped>
.mini-map-overlay {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 5;
}
.mini-map {
  position: relative;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  cursor: crosshair;
  touch-action: none;
}
.mini-node {
  position: absolute;
  border-radius: 2px;
  pointer-events: none;
}
.mini-viewer {
  position: absolute;
  border: 2px solid #3b82f6;
  background: rgba(59, 130, 246, 0.08);
  border-radius: 4px;
  cursor: move;
  pointer-events: auto;
  z-index: 1;
}
</style>
