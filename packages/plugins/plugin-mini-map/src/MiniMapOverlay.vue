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
import type { ViewportState } from '@mini-canvas/canvas-base'

// mini-map 槽宿主会下发 class/data-slot-*；根是 v-if 的单元素，正常能继承，
// 但 visible=false 时渲染注释节点 → 条件根继承失效产生 warn，显式关掉最稳。
defineOptions({ inheritAttrs: false })
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

/** 组件自身不定位、不自定颜色：位置交给宿主；配色**只走 CSS**（见下方 <style> 里的 --mm-*），
 *  由宿主的 `<html class="dark">` 自动切换，不提供任何"配色"配置项。 */


const { ctx, flow, renderNodes } = useCanvasRender()
const viewport = flow.viewport
const paneRect = flow.paneRect

// —— 配置（⚙ 设置面板：小地图 mini-map 分组；实时订阅，默认 240x160/灵敏度1，对齐老版）——
const settings = ctx.tryGet('settings')
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

// —— 显隐状态：设置项 miniMapVisible（命令与面板读写同一份；不再占 mini-map 服务名）——
const visibility = ref<boolean>(miniMapConfigFrom(ctx).miniMapVisible)
if (settings) {
  const off = settings.onChange((key, value) => {
    if (key === 'miniMapVisible' && typeof value === 'boolean') visibility.value = value
  })
  onBeforeUnmount(() => off.dispose())
}
const visible = computed(() => visibility.value)

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
  const layout = ctx.tryGet('nodeLayout')
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
  }
})

/**
 * 节点方块改 canvas 绘制（2026-10-15 性能优化 P5）：
 * 旧实现 v-for 渲染 160 个 div（诊断报告：.mini-map 161 个子元素每帧跟随重绘）。
 * canvas 只在内容/视口变化时重画一次 2D 方块，DOM 恒为 1 个元素。
 * 视口蓝框仍是独立 div（动画跟随、便宜）。命中判定改几何（原 class 判断不可用）。
 */
const nodeCanvas = ref<HTMLCanvasElement | null>(null)

function drawNodes(): void {
  const cv = nodeCanvas.value
  const ms = mapState.value
  if (!cv || !ms) return
  const dpr = window.devicePixelRatio || 1
  const w = width.value
  const h = height.value
  // 只在尺寸/内容变化时重设分辨率（重设会清空画布）
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr)
    cv.height = Math.round(h * dpr)
  }
  const g = cv.getContext('2d')
  if (!g) return
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)
  // 节点方块颜色跟主题：读 CSS 变量（亮/暗各一套 --mm-node，scoped 样式里有定义；
  // 不写字面量兜底——主题色卫生测试禁止插件内裸颜色）
  const color = getComputedStyle(cv).getPropertyValue('--mm-node').trim()
  if (!color) return
  g.fillStyle = color
  for (const rect of contentRects.value) {
    const r = rectToMap(rect, ms)
    g.fillRect(r.left, r.top, r.width, r.height)
  }
}

/** canvas 版节点命中：点在任一节点方块的映射矩形内 → true（旧 class 判断的等价替代） */
function hitNode(clientX: number, clientY: number): boolean {
  const cv = nodeCanvas.value
  const ms = mapState.value
  if (!cv || !ms) return false
  const cr = cv.getBoundingClientRect()
  const px = clientX - cr.left
  const py = clientY - cr.top
  for (const rect of contentRects.value) {
    const r = rectToMap(rect, ms)
    if (px >= r.left && px <= r.left + r.width && py >= r.top && py <= r.top + r.height) return true
  }
  return false
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
// 内容/视口/地图状态变化 → 重画 canvas（viewer 是独立 div 不进 canvas，其位置由 computed 驱动）
watch([contentRects, mapState, width, height, visible], () => {
  void Promise.resolve().then(() => drawNodes())
})
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
  const vp = ctx.get('viewport')
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
  const vpService = ctx.get('viewport')
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
  const vp = ctx.get('viewport')
  if (jumped && session && !session.moved && vp) {
    // 点击（无拖动）且不是点在视口框/缩略节点上 → 跳到该 flow 点（保留 zoom）
    const target = e.target as HTMLElement | null
    if (!downOnViewer && !hitNode(e.clientX, e.clientY) && elRect) {
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
      <canvas ref="nodeCanvas" class="mini-node-canvas" :style="{ width: width + 'px', height: height + 'px' }" />
      <div class="mini-viewer" :style="viewerStyle" />
    </div>
  </div>
</template>

<style scoped>
/* 配色**只走 CSS**：默认（亮色）一套 --mm-*，`.dark`（<html class="dark">）下覆盖另一套。
   组件不再有 theme prop / 配置项，宿主换主题时这里零 JS 参与、零重渲染。
   dark 风格：深底 + 边框、浅灰节点方块、视口框浅灰描边。
   圆角与亮色**保持一致**（用户口径 2026-10-28：亮色的圆角很好，暗色切过去也必须有）。 */
.mini-map-overlay {
  --mm-bg: #f8fafc;
  --mm-line: #e2e8f0;
  --mm-node: #cbd5e1;
  --mm-shadow: 0 2px 8px rgb(0 0 0 / 0.08);
  /* 亮色的视口框改用中性灰（不再是蓝色）：取规范灰阶里的中灰 #6b7280，
     落在浅灰节点(#cbd5e1)与暗色之间；填充也去掉淡蓝，改成中性的黑色淡底。 */
  --mm-viewer-bg: rgb(0 0 0 / 0.06);
  --mm-viewer-line: #6b7280;
  --mm-radius: 12px;
  --mm-node-radius: 2px;
  --mm-viewer-radius: 4px;
}
/* 注意用 `html.dark` 而不是 `.dark`：组件自己的 scoped 规则（.mini-map-overlay[data-v-xxx]）
   特异性是 0,2,0，比 `.dark .mini-map-overlay`（0,2,0，同分靠顺序）更危险 ——
   提到 0,2,1 才稳赢，不受样式加载顺序影响。 */
html.dark .mini-map-overlay {
  --mm-bg: #252525;
  --mm-line: #3c3c3c;
  --mm-node: #8a8a8a;
  --mm-shadow: none;
  /* 视口框内部比小地图底色更深：黑色半透明叠在 --mm-bg 上得到凹陷感 */
  --mm-viewer-bg: rgb(0 0 0 / 0.45);
  --mm-viewer-line: #8a8a8a;
  /* 暗色不再归零：与亮色同一套嵌套圆角（面板 12 / 节点 2 / 视口 4） */
  --mm-radius: 12px;
  --mm-node-radius: 2px;
  --mm-viewer-radius: 4px;
}

.mini-map-overlay {
  /* 定位归宿主：本组件只负责画一张地图（宽高由配置决定） */
}
.mini-map {
  position: relative;
  background: var(--mm-bg);
  border: 1px solid var(--mm-line);
  border-radius: var(--mm-radius);
  box-shadow: var(--mm-shadow);
  overflow: hidden;
  cursor: crosshair;
  touch-action: none;
}
.mini-node-canvas {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.mini-node {
  position: absolute;
  background: var(--mm-node);
  border-radius: var(--mm-node-radius);
  pointer-events: none;
}
.mini-viewer {
  position: absolute;
  border: 2px solid var(--mm-viewer-line);
  background: var(--mm-viewer-bg);
  border-radius: var(--mm-viewer-radius);
  cursor: move;
  pointer-events: auto;
  z-index: 1;
}
</style>
