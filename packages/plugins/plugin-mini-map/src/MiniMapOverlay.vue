<script setup lang="ts">
/**
 * MiniMapOverlay —— 小地图浮层（v2 复刻老版 canvas-core/src/plugins/mini-map/MiniMap.vue）。
 *
 * 实现方式与老版完全一致（不是另起炉灶）：
 * - 数据全走 computed 链：内容节点矩形 → contentBB → unionBB(内容 ∪ 当前视口) → mapState(scale/offset)。
 *   因地图范围**恒包含当前视口矩形**，蓝框数学上永远落在小地图 padding 内 —— 无需任何钳制/修正；
 * - 拖拽换算用"按下瞬间的 mapState + 视口"快照（线性跟手），渲染却随最新 viewport 实时重算；
 * - 按下时冻结内容节点快照（防拖拽中节点包围盒跳动导致地图抖动），松手解冻；
 * - 拖蓝框或空白 → 平移视口（保留 zoom）；点击空白（无拖动）→ 跳转到该 flow 点（老版 v2 扩展）。
 *
 * v2 接入差异（行为不变）：
 * - 老版父组件每事件 emit('pan') → setViewport；v2 经 viewport 服务（后端已即时 setViewport 无动画）
 *   + rAF 合帧（pointer 事件可能快于一帧，只每帧应用一次，避免多余重排）。
 * - 节点几何源 = renderNodes + nodeLayout（实测/绝对坐标），等价老版 position/computedPosition/dimensions。
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
import { miniMapConfigFrom, type MiniMapConfig } from './miniMapConfig'

const { ctx, viewport, paneRect, renderNodes } = useCanvasRender()

// —— 配置（⚙ 设置面板：小地图 mini-map 分组；实时订阅，默认 240x160/灵敏度1，对齐老版）——
const settings = ctx.get<{
  get(key: string): string | number | boolean | undefined
  onChange(cb: (key: string, v: unknown) => void): { dispose(): void }
} | undefined>('settings')
const cfg = ref<MiniMapConfig>(miniMapConfigFrom(ctx))
if (settings) {
  const off = settings.onChange((key) => {
    if (key.startsWith('miniMap')) cfg.value = miniMapConfigFrom(ctx)
  })
  onBeforeUnmount(() => off.dispose())
}

const width = computed(() => cfg.value.miniMapWidth)
const height = computed(() => cfg.value.miniMapHeight)
const sensitivityX = computed(() => cfg.value.miniMapSensitivityX)
const sensitivityY = computed(() => cfg.value.miniMapSensitivityY)

const PADDING = 8
const NODE_COLOR = '#cbd5e1'
const VIEWER_BORDER = '#3b82f6'

// —— 显隐状态：mini-map 服务（命令切换与组件读同一对象）——
interface MiniMapServiceState {
  visible: boolean
}
const service = ctx.get<MiniMapServiceState>('mini-map')
const visible = computed(() => !!service && service.visible)

/** pane 可视尺寸（px）：优先 host paneRect；退化为自量所在全幅 overlay 层；窗口 resize 刷新 */
const paneSize = shallowRef<{ w: number; h: number }>({ w: 800, h: 600 })
const rootEl = ref<HTMLElement | null>(null)

/** 内容节点矩形（flow 绝对坐标）；拖拽中为按下瞬间快照，防止节点包围盒变化导致地图抖动 */
const contentRects = shallowRef<MiniMapRect[]>([])

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

/** 收内容节点矩形（过滤 group 容器节点；等价老版 renderNodes 过滤 hidden/group） */
function collectContentRects(): MiniMapRect[] {
  const layout = ctx.get<NodeLayoutService | undefined>('nodeLayout')
  if (!layout) return []
  const list = renderNodes.value
  const out: MiniMapRect[] = []
  for (const n of list) {
    if (n.type === 'group') continue
    const rect = layout.getNodeRect(n.id)
    if (rect && rect.w > 0 && rect.h > 0) out.push(rect)
  }
  return out
}

// —— computed 链（与老版 MiniMap.vue 逐条对应）——

/** 当前视口在 flow 坐标的可见矩形（实时跟随最新 viewport） */
const viewBB = computed<MiniMapRect>(() => {
  const { w, h } = paneSize.value
  return viewportRectInFlow(viewport.value, w, h)
})

/** 地图范围 = 内容包围盒 ∪ 当前视口矩形（恒含视口 → 蓝框必然在小地图内） */
const unionBB = computed<MiniMapRect>(() => {
  const cb = computeContentBounds(contentRects.value)
  const union = unionRect(cb, viewBB.value)
  return union ?? { x: 0, y: 0, w: 1, h: 1 }
})

/** 归一化到 (width-pad*2 × height-pad*2)：scale + 地图原点 + 已加 padding 的绘制偏移 */
const mapState = computed<MiniMapMapState>(() =>
  computeMapState(unionBB.value, width.value, height.value, PADDING),
)

/** 蓝框样式：随最新 viewport + mapState 现算（拖动时 1:1 跟手） */
const viewerStyle = computed(() => {
  const vb = viewBB.value
  const ms = mapState.value
  const r = rectToMap(vb, ms)
  return {
    left: r.left + 'px',
    top: r.top + 'px',
    width: r.width + 'px',
    height: r.height + 'px',
    borderColor: VIEWER_BORDER,
  }
})

/** 节点方块样式（用当前 mapState 现算） */
function nodeStyle(rect: MiniMapRect): Record<string, string> | null {
  const ms = mapState.value
  if (!ms) return null
  const r = rectToMap(rect, ms)
  return {
    left: r.left + 'px',
    top: r.top + 'px',
    width: r.width + 'px',
    height: r.height + 'px',
    background: NODE_COLOR,
  }
}

// renderNodes / paneRect 变化 → 重收内容（非拖拽中）；视口变化由 computed 自动传导，无需手动 watch
function syncContent(): void {
  contentRects.value = collectContentRects()
}
// renderNodes 是 shallowRef，整体替换才触发 → 用 watch 比较引用
watch(
  () => renderNodes.value,
  () => {
    if (!dragging) syncContent()
  },
)
watch(paneRect, measurePane)

function onWindowResize(): void {
  measurePane()
  if (!dragging) syncContent()
}
onMounted(() => {
  measurePane()
  window.addEventListener('resize', onWindowResize)
  syncContent()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  if (panRaf) cancelAnimationFrame(panRaf)
  panRaf = 0
  session = null
})

// —— 拖拽平移（老版语义：按下瞬间快照做换算；rAF 合帧仅节流写入）——
const DRAG_THRESHOLD = 0
interface DragSession {
  startClient: { x: number; y: number }
  startViewport: ViewportState
  startMapState: MiniMapMapState
  moved: boolean
}
let dragging = false
let session: DragSession | null = null
let elRect: DOMRect | null = null
let downOnViewer = false
let panRaf = 0
let pendingViewport: ViewportState | null = null

function flushPan(): void {
  panRaf = 0
  if (!pendingViewport) return
  const vp = ctx.get<ViewportService>('viewport')
  const next = pendingViewport
  pendingViewport = null
  if (vp) vp.setViewport(next)
}

/** 老版 applyMovement：小地图内位移 ÷ 起始 scale → flow 位移，× zoom → 视口移动量（拖右 → 视口向左） */
function nextViewport(clientX: number, clientY: number): ViewportState {
  const s = session!
  const dx = (clientX - s.startClient.x) * sensitivityX.value
  const dy = (clientY - s.startClient.y) * sensitivityY.value
  const zoom = s.startViewport.zoom || 1
  const scale = s.startMapState.scale || 1
  return {
    x: s.startViewport.x - (dx / scale) * zoom,
    y: s.startViewport.y - (dy / scale) * zoom,
    zoom: s.startViewport.zoom,
  }
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  const vpService = ctx.get<ViewportService>('viewport')
  if (!vpService || !mapState.value) return
  const target = e.target as HTMLElement | null
  downOnViewer = !!target?.classList.contains('mini-viewer')
  const el = e.currentTarget as HTMLElement
  elRect = el.getBoundingClientRect()
  // 老版 startDrag：记起点/起始视口/起始 mapState + 冻结内容节点
  session = {
    startClient: { x: e.clientX, y: e.clientY },
    startViewport: { ...viewport.value },
    startMapState: { ...mapState.value },
    moved: false,
  }
  dragging = true
  contentRects.value = collectContentRects() // 冻结快照
  el.setPointerCapture(e.pointerId)
  e.preventDefault()
  e.stopPropagation()
}

function onPointerMove(e: PointerEvent): void {
  if (!dragging || !session) return
  const dx = e.clientX - session.startClient.x
  const dy = e.clientY - session.startClient.y
  if (!session.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
  session.moved = true
  const next = nextViewport(e.clientX, e.clientY)
  pendingViewport = next
  if (!panRaf) panRaf = requestAnimationFrame(flushPan)
}

function endPointer(e: PointerEvent, jumped: boolean): void {
  if (panRaf) {
    cancelAnimationFrame(panRaf)
    panRaf = 0
  }
  pendingViewport = null
  const vp = ctx.get<ViewportService>('viewport')
  if (jumped && session && !session.moved && vp) {
    // 点击（无拖动）且不是点在视口框/缩略节点上 → 跳到该 flow 点（保留 zoom）
    const target = e.target as HTMLElement | null
    if (!downOnViewer && !target?.classList.contains('mini-node') && elRect) {
      const px = e.clientX - elRect.left
      const py = e.clientY - elRect.top
      const pt = mapPointToFlow(px, py, mapState.value)
      vp.setCenter(pt.x, pt.y, session.startViewport.zoom)
    }
  }
  session = null
  dragging = false
  elRect = null
  downOnViewer = false
  const el = e.currentTarget as HTMLElement
  if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
  syncContent() // 松手解冻：重收内容
}

function onPointerUp(e: PointerEvent): void {
  if (!dragging) return
  endPointer(e, true)
}

function onPointerCancel(e: PointerEvent): void {
  if (!dragging) return
  endPointer(e, false)
}
</script>

<template>
  <div v-if="visible" ref="rootEl" class="mini-map-overlay">
    <div
      class="mini-map"
      :style="{ width: width + 'px', height: height + 'px' }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
    >
      <div
        v-for="(rect, i) in contentRects"
        :key="i"
        class="mini-node"
        :style="nodeStyle(rect)"
      />
      <div class="mini-viewer" :style="viewerStyle" />
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
