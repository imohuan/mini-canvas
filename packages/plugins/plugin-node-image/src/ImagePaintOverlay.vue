<script setup lang="ts">
/**
 * ImagePaintOverlay —— 图片节点绘制模式的画布浮层（over:inset 段）。
 *
 * 与裁剪/扩展浮层同层：BaseNode 把它画在卡片外面，铺满卡片尺寸。
 * 笔迹画在自己的 canvas 上实时可见；坐标归一化（0~1，相对图片显示区）。
 *
 * 三种工具（用户口径 2026-10-30）：画笔（拖出自由笔迹）/ 矩形填充（拖出实心矩形）/ 橡皮擦（挖掉）。
 * 绘制颜色来自会话（顶栏颜色下拉）；橡皮擦忽略颜色。
 *
 * 坐标系（用户口径 2026-10-30：绘制必须跟随画布缩放）——
 * 一切几何都换算回**布局尺寸**（除以 zoom）：
 *   - canvas 位图 = 卡片布局尺寸（zoom 变化时重建，笔迹按归一化坐标重画）；
 *   - 指针位置：屏幕坐标 → 减去卡片屏幕位置 → 除以 zoom → 布局坐标；
 *   - 显示区（img 的 object-contain 矩形）：屏幕矩形 → 除以 zoom → 布局矩形。
 * 这样画布缩放/平移时笔迹永远钉在图片上。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { fitEditingNodeIntoView, useCanvasRender } from '@mini-canvas/canvas-render'
import { paintState, pushStroke } from './paintSession'
import { paintStrokes } from './imagePaint'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx, flow } = useCanvasRender()

const rootEl = ref<HTMLElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
/** 会话（工具/颜色/笔刷大小 + 笔迹，响应式，状态栏与浮层读同一份） */
const session = paintState(props.id)

/** 图片显示区（**布局坐标**，相对卡片左上角） */
const dispX = ref(0)
const dispY = ref(0)
const dispW = ref(0)
const dispH = ref(0)

/** 当前画布缩放 */
const zoom = computed(() => Math.max(flow.viewport.value?.zoom || 1, 0.01))

/** 当前正在画的这一笔（拖拽中） */
let draft: { tool: "brush" | "rect" | "erase"; color: string; radiusRatio: number; points: Array<{ x: number; y: number }> } | null = null

/**
 * 量测：卡片布局尺寸（= canvas 位图尺寸）+ 图片显示区（布局坐标）。
 * getBoundingClientRect 给的是屏幕尺寸（已乘 zoom），除回去就是布局尺寸。
 */
function measure(): void {
  const el = rootEl.value
  const c = canvasEl.value
  if (!el) return
  const z = zoom.value
  const w = el.clientWidth
  const h = el.clientHeight
  if (w > 0 && h > 0) {
    if (c && (c.width !== w || c.height !== h)) {
      c.width = w
      c.height = h
    }
  }
  const host = el.closest(".v2-node") ?? el.parentElement
  const img = host?.querySelector("img") as HTMLImageElement | null
  if (img && img.naturalWidth > 0) {
    const r = img.getBoundingClientRect()
    const p = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) {
      dispX.value = (r.left - p.left) / z
      dispY.value = (r.top - p.top) / z
      dispW.value = r.width / z
      dispH.value = r.height / z
    }
  }
}

/** 指针位置 → 归一化坐标（0~1，相对图片显示区；布局坐标系） */
function pointOf(ev: PointerEvent): { x: number; y: number } {
  const el = rootEl.value
  if (!el) return { x: 0, y: 0 }
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return { x: 0, y: 0 }
  const z = zoom.value
  const lx = (ev.clientX - r.left) / z
  const ly = (ev.clientY - r.top) / z
  return {
    x: (lx - dispX.value) / Math.max(dispW.value, 1),
    y: (ly - dispY.value) / Math.max(dispH.value, 1),
  }
}

/** 笔刷半径（归一化：滑块 4~100 → 显示区宽的比例） */
function brushRadiusRatio(): number {
  return Math.min(0.08, Math.max(0.008, session.brushSize / 1000))
}

function onPointerDown(ev: PointerEvent): void {
  if (ev.button !== 0) return
  ev.preventDefault()
  ev.stopPropagation()
  measure()
  draft = { tool: session.tool, color: session.color, radiusRatio: brushRadiusRatio(), points: [pointOf(ev)] }
  repaint()
  rootEl.value?.setPointerCapture?.(ev.pointerId)
}

function onPointerMove(ev: PointerEvent): void {
  if (!draft) return
  ev.stopPropagation()
  const p = pointOf(ev)
  if (draft.tool === 'rect') {
    // 矩形只保留起点 + 当前点（每次都替换终点，不累积）
    draft.points = [draft.points[0], p]
  } else {
    draft.points.push(p)
  }
  repaint()
}

function onPointerUp(ev: PointerEvent): void {
  if (!draft) return
  ev.stopPropagation()
  // 矩形面积太小（点了一下）不记；画笔至少保留一个点（能点出圆点）
  const d = draft
  draft = null
  if (d.tool === 'rect') {
    const a = d.points[0]
    const b = d.points[d.points.length - 1]
    if (Math.abs(b.x - a.x) * dispW.value < 2 || Math.abs(b.y - a.y) * dispH.value < 2) {
      repaint()
      return
    }
  }
  pushStroke(props.id, d)
  rootEl.value?.releasePointerCapture?.(ev.pointerId)
  repaint()
}

/** 重画：已提交的笔迹 + 正在拖的这一笔（实时预览） */
function repaint(): void {
  const c = canvasEl.value
  if (!c) return
  const c2d = c.getContext("2d")
  if (!c2d) return
  c2d.clearRect(0, 0, c.width, c.height)
  c2d.save()
  c2d.translate(dispX.value, dispY.value)
  c2d.beginPath()
  c2d.rect(0, 0, dispW.value, dispH.value)
  c2d.clip()
  paintStrokes(c2d, session.strokes, dispW.value, dispH.value, 'preview')
  if (draft) paintStrokes(c2d, [draft], dispW.value, dispH.value, 'preview')
  c2d.restore()
}

watch(() => session.strokes.length, () => repaint())
watch(() => session.redo.length, () => repaint())

/** 画布缩放变化：重量测 + 重画（笔迹跟随缩放） */
watch(zoom, () => { measure(); repaint() })

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key !== "Escape") return
  ev.stopPropagation()
  ctx.get<{ execute(id: string, payload?: unknown): unknown }>('command').execute('image:paint-cancel', { nodeId: props.id })
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  measure()
  fitEditingNodeIntoView(ctx, props.id)
  window.addEventListener("keydown", onKeydown)
  const el = rootEl.value
  if (el && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => { measure(); repaint() })
    resizeObserver.observe(el)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown)
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<template>
  <div
    ref="rootEl"
    class="ipo nodrag nopan nowheel"
    :class="'is-tool-' + session.tool"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <canvas ref="canvasEl" class="ipo-canvas" />
  </div>
</template>

<style scoped>
.ipo {
  position: absolute;
  inset: 0;
  cursor: crosshair;
  pointer-events: auto;
  touch-action: none;
  overflow: visible;
}
.ipo.is-tool-rect {
  cursor: cell;
}
.ipo-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
