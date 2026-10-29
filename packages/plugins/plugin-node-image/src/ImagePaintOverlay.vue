<script setup lang="ts">
/**
 * ImagePaintOverlay —— 图片节点绘制模式的画布浮层（over:inset 段）。
 *
 * 与裁剪/扩展浮层同层：BaseNode 把它画在卡片外面，铺满卡片尺寸。
 * 笔迹画在自己的 canvas 上实时可见；坐标归一化（0~1，相对图片显示区）。
 *
 * 三种工具（用户口径 2026-10-30）：画笔 / 矩形填充 / 橡皮擦。
 *
 * 坐标系（用户口径 2026-10-30：绘制必须跟随画布缩放）——
 * 一切几何都换算回**布局尺寸**（除以 zoom）：
 *   - 指针位置：屏幕坐标 → 减去卡片屏幕位置 → 除以 zoom → 布局坐标；
 *   - 显示区（img 的 object-contain 矩形）：屏幕矩形 → 除以 zoom → 布局矩形。
 *
 * 清晰度（用户口径 2026-10-30：不要模糊边缘）——
 * canvas 位图按 **布局尺寸 × 屏幕像素比 × 画布缩放** 分配，绘制时用 setTransform 统一放大，
 * 笔迹就按真实屏幕像素渲染。之前位图只有布局尺寸，放大后是被拉伸的图，边缘自然发虚。
 *
 * 笔刷光标（用户口径 2026-10-30）：鼠标在绘制区时显示一个圆圈 = 当前笔刷大小（brush cursor）。
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

/** 位图缩放倍率（布局 px → 位图 px）：屏幕像素比 × 画布缩放 */
const pixelRatio = ref(1)

/** 笔刷光标位置（布局坐标，相对浮层左上角）；null = 鼠标不在绘制区 */
const cursor = ref<{ x: number; y: number } | null>(null)

/** 调粗细时的中心预览圆位置（绘制区正中心，布局坐标） */
const centerPreview = computed(() => ({
  x: dispX.value + dispW.value / 2,
  y: dispY.value + dispH.value / 2,
}))

/**
 * 粗细变化时在画面中心亮一下预览圆（用户口径 2026-10-30）：
 * 盯 brushSize 本身，拖滑块/点轨道/键盘方向键都能覆盖；停止改动 900ms 后收起。
 */
const sizePreview = ref(false)
let sizePreviewTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => session.brushSize,
  () => {
    sizePreview.value = true
    if (sizePreviewTimer !== null) clearTimeout(sizePreviewTimer)
    sizePreviewTimer = setTimeout(() => {
      sizePreviewTimer = null
      sizePreview.value = false
    }, 900)
  },
)

/** 当前画布缩放 */
const zoom = computed(() => Math.max(flow.viewport.value?.zoom || 1, 0.01))

/** 当前正在画的这一笔（拖拽中） */
type DraftStroke = { tool: "brush" | "rect" | "erase"; color: string; radiusRatio: number; points: Array<{ x: number; y: number }> }
let draft: DraftStroke | null = null

/**
 * 量测：位图尺寸 + 图片显示区（布局坐标）。
 * getBoundingClientRect 给的是屏幕尺寸（已乘 zoom），除回去就是布局尺寸。
 */
function measure(): void {
  const el = rootEl.value
  const c = canvasEl.value
  if (!el) return
  const z = zoom.value
  const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1
  // 位图 = 布局尺寸 × dpr × zoom：屏幕上 1 个物理像素对应位图 1 个像素，不放大就不糊
  const ratio = Math.max(0.5, Math.min(8, dpr * z))
  pixelRatio.value = ratio
  const w = el.clientWidth
  const h = el.clientHeight
  if (c && w > 0 && h > 0) {
    const bw = Math.max(1, Math.round(w * ratio))
    const bh = Math.max(1, Math.round(h * ratio))
    if (c.width !== bw || c.height !== bh) {
      c.width = bw
      c.height = bh
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

/** 指针位置 → 布局坐标（相对浮层左上角） */
function layoutPointOf(ev: PointerEvent): { x: number; y: number } {
  const el = rootEl.value
  if (!el) return { x: 0, y: 0 }
  const r = el.getBoundingClientRect()
  const z = zoom.value
  return { x: (ev.clientX - r.left) / z, y: (ev.clientY - r.top) / z }
}

/** 指针位置 → 归一化坐标（0~1，相对图片显示区） */
function pointOf(ev: PointerEvent): { x: number; y: number } {
  const p = layoutPointOf(ev)
  return {
    x: (p.x - dispX.value) / Math.max(dispW.value, 1),
    y: (p.y - dispY.value) / Math.max(dispH.value, 1),
  }
}

/** 笔刷半径（归一化：滑块 1~100 → 显示区宽的比例；最小档约 1px，用户要求更细） */
function brushRadiusRatio(): number {
  return Math.min(0.08, Math.max(0.0012, session.brushSize / 1000))
}

/** 笔刷直径（布局 px，= 光标圆的 CSS 尺寸） */
const brushDiameter = computed(() => Math.max(2, brushRadiusRatio() * dispW.value * 2))

/** 光标圆样式：圆心对准指针 */
const cursorStyle = computed(() => {
  if (!cursor.value) return {}
  const d = brushDiameter.value
  return {
    left: cursor.value.x - d / 2 + "px",
    top: cursor.value.y - d / 2 + "px",
    width: d + "px",
    height: d + "px",
  }
})

/** 光标只在画笔/橡皮擦下出现（矩形填充用十字光标） */
const showCursor = computed(() => session.tool !== "rect")

/** 中心预览圆的样式：与笔刷等大，圆心落在绘制区中心 */
const centerPreviewStyle = computed(() => {
  const d = brushDiameter.value
  return {
    left: centerPreview.value.x - d / 2 + 'px',
    top: centerPreview.value.y - d / 2 + 'px',
    width: d + 'px',
    height: d + 'px',
  }
})

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
  const lp = layoutPointOf(ev)
  cursor.value = lp
  if (!draft) return
  ev.stopPropagation()
  const p = pointOf(ev)
  if (draft.tool === 'rect') {
    draft.points = [draft.points[0], p]
  } else {
    draft.points.push(p)
  }
  repaint()
}

function onPointerUp(ev: PointerEvent): void {
  if (!draft) return
  ev.stopPropagation()
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

function onPointerLeave(): void {
  cursor.value = null
}

/** 重画：已提交的笔迹 + 正在拖的这一笔（实时预览） */
function repaint(): void {
  const c = canvasEl.value
  if (!c) return
  const c2d = c.getContext("2d")
  if (!c2d) return
  const r = pixelRatio.value
  c2d.setTransform(1, 0, 0, 1, 0, 0)
  c2d.clearRect(0, 0, c.width, c.height)
  // 之后全部按**布局坐标**绘制，setTransform 一次性放大到位图分辨率
  c2d.setTransform(r, 0, 0, r, 0, 0)
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

/** 画布缩放变化：重量测（位图与显示区都跟着变）+ 重画 */
watch(zoom, () => { measure(); repaint() })

/** 细笔刷在放大时不发虚：位图分辨率变了要立刻重画 */
watch(pixelRatio, () => repaint())

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
if (sizePreviewTimer !== null) clearTimeout(sizePreviewTimer)
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
    @pointerleave="onPointerLeave"
  >
    <canvas ref="canvasEl" class="ipo-canvas" />
    <!-- 笔刷光标（brush cursor）：圆圈 = 当前笔刷大小，跟随鼠标 -->
    <div v-if="showCursor && cursor" class="ipo-cursor" :style="cursorStyle" aria-hidden="true" />
    <!-- 调粗细时的中心预览：同一个圆，钉在绘制区中心，方便直观比较大小 -->
    <div
      v-if="sizePreview"
      class="ipo-cursor ipo-cursor--preview"
      :style="centerPreviewStyle"
      aria-hidden="true"
    />
  </div>
</template>

<style scoped>
.ipo {
  position: absolute;
  inset: 0;
  /* 自绘笔刷圈，隐藏系统光标 */
  cursor: none;
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
  /* 像素对齐：放大时不要浏览器再插值一次 */
  image-rendering: auto;
}
/* 笔刷圈：白描边 + 深色外描边，任何底色上都看得清；不拦事件 */
.ipo-cursor {
  position: absolute;
  border-radius: 50%;
  border: 1px solid rgb(255 255 255 / 0.9);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.55);
  pointer-events: none;
  box-sizing: border-box;
}
/* 中心预览：同款圆圈，加一点填充让它在任何画面上都醒目，并带一圈强调描边 */
.ipo-cursor--preview {
  border-width: 1.5px;
  background: rgb(255 255 255 / 0.22);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.5), 0 2px 10px rgb(0 0 0 / 0.25);
  transition: width 0.06s linear, height 0.06s linear, left 0.06s linear, top 0.06s linear;
}
@media (prefers-reduced-motion: reduce) {
  .ipo-cursor--preview {
    transition: none;
  }
}
</style>
