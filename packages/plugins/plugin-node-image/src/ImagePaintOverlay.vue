<script setup lang="ts">
/**
 * ImagePaintOverlay —— 图片节点绘制模式的画布浮层（over:inset 段）。
 *
 * 与裁剪/扩展浮层同层：BaseNode 把它画在卡片外面，铺满卡片尺寸。
 * 笔迹画在自己的 canvas 上实时可见，坐标用归一化值（0~1）存，
 * 卡片被拖成多大都不影响保存结果（见 imagePaint.ts 的坐标说明）。
 *
 * 数据流：笔迹直接读写会话里的同一份数组（paintSession.strokes），
 * 保存命令从会话里拿 —— 浮层、顶栏面板、命令三方共享，不需要桥。
 *
 * 挂载门控：ImageOverlays 已用 isPainting 门控，这里只在绘制态挂载，
 * 所以 setup 里读会话、挂监听都是安全的。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { fitEditingNodeIntoView, useCanvasRender } from '@mini-canvas/canvas-render'
import { paintState } from './paintSession'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()

const rootEl = ref<HTMLElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
/** 会话（笔刷大小/形状/模式 + 笔迹数组，响应式，状态栏与浮层读同一份） */
const session = paintState(props.id)

/** 本文件里用的轻量笔迹形状（与会话里的 PaintStroke 结构一致） */
interface PaintStrokeLite {
  kind: 'paint' | 'erase'
  radiusRatio: number
  shape: 'round' | 'square'
  points: Array<{ x: number; y: number }>
}

/** 当前正在画的一条 */
let current: PaintStrokeLite | null = null

/** 图片在卡片里的实际显示区（object-contain 后的 dx dy dw dh，CSS px） */
const dispX = ref(0)
const dispY = ref(0)
const dispW = ref(0)
const dispH = ref(0)

/**
 * 量测：卡片尺寸 + 图片实际显示位置。
 * 图片的 <img> 用 object-contain/cover 后，它的实际渲染矩形与卡片不一定重合，
 * 量 DOM 是唯一可靠的来源（与裁剪浮层的量测盒子同一套思路）。
 */
function measure(): void {
  const el = rootEl.value
  const c = canvasEl.value
  if (!el) return
  // canvas 位图必须跟 CSS 尺寸一致，否则笔迹会被拉伸（默认 300x150 的位图被 CSS 拉满）
  const w = el.clientWidth
  const h = el.clientHeight
  if (c && w > 0 && h > 0 && (c.width !== w || c.height !== h)) {
    c.width = w
    c.height = h
  }
  // 读内容组件里的 <img> 实际渲染矩形（真实显示区）
  const host = el.closest(".v2-node") ?? el.parentElement
  const img = host?.querySelector("img") as HTMLImageElement | null
  if (img && img.naturalWidth > 0) {
    const r = img.getBoundingClientRect()
    const p = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) {
      dispX.value = r.left - p.left
      dispY.value = r.top - p.top
      dispW.value = r.width
      dispH.value = r.height
    }
  }
}

/** 指针位置 → 归一化坐标（0~1，相对图片显示区，不是整张卡片） */
function pointOf(ev: PointerEvent): { x: number; y: number } {
  const el = rootEl.value
  if (!el) return { x: 0, y: 0 }
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return { x: 0, y: 0 }
  // 指针相对图片显示区左上角的偏移（CSS px）→ 相对显示区的比例
  const x = (ev.clientX - r.left - dispX.value) / Math.max(dispW.value, 1)
  const y = (ev.clientY - r.top - dispY.value) / Math.max(dispH.value, 1)
  return { x, y }
}

/** 笔刷半径（归一化：会话里的 brushSize 是滑块 4~100，换算成图片显示宽的比例） */
function brushRadiusRatio(): number {
  return Math.min(0.05, Math.max(0.008, session.brushSize / 1000))
}

function onPointerDown(ev: PointerEvent): void {
  if (ev.button !== 0) return
  ev.preventDefault()
  ev.stopPropagation()
  measure()
  current = { kind: session.brushMode, radiusRatio: brushRadiusRatio(), shape: session.brushShape, points: [pointOf(ev)] }
  session.strokes.push(current)
  repaint()
  rootEl.value?.setPointerCapture?.(ev.pointerId)
}

function onPointerMove(ev: PointerEvent): void {
  if (!current) return
  ev.stopPropagation()
  current.points.push(pointOf(ev))
  repaint()
}

function onPointerUp(ev: PointerEvent): void {
  if (!current) return
  ev.stopPropagation()
  current = null
  rootEl.value?.releasePointerCapture?.(ev.pointerId)
  repaint()
}

/** 重画全部笔迹（半透明白预览；擦用 destination-out 挖掉之前的笔迹） */
function repaint(): void {
  const c = canvasEl.value
  if (!c) return
  const c2d = c.getContext("2d")
  if (!c2d) return
  c2d.clearRect(0, 0, c.width, c.height)
  // 笔迹坐标系 = 图片显示区，不是整张卡片。先把画布原点挪到显示区左上角
  c2d.save()
  c2d.translate(dispX.value, dispY.value)
  c2d.beginPath()
  c2d.rect(0, 0, dispW.value, dispH.value)
  c2d.clip()
  for (const s of session.strokes) {
    c2d.save()
    c2d.globalCompositeOperation = s.kind === "erase" ? "destination-out" : "source-over"
    c2d.strokeStyle = "rgba(255,255,255,0.55)"
    c2d.fillStyle = c2d.strokeStyle
    const r = s.radiusRatio * dispW.value
    c2d.lineWidth = r * 2
    c2d.lineJoin = "round"
    c2d.lineCap = s.shape === 'round' ? 'round' : 'butt'
    c2d.beginPath()
    if (s.points.length > 0) {
      c2d.moveTo(s.points[0].x * dispW.value, s.points[0].y * dispH.value)
      for (const p of s.points.slice(1)) c2d.lineTo(p.x * dispW.value, p.y * dispH.value)
      if (s.points.length === 1) c2d.lineTo(s.points[0].x * dispW.value + 0.01, s.points[0].y * dispH.value)
    }
    c2d.stroke()
    if (s.shape === 'square') {
      for (const p of s.points) c2d.fillRect(p.x * dispW.value - r, p.y * dispH.value - r, r * 2, r * 2)
    }
    c2d.restore()
  }
  c2d.restore()
}

/** 会话数组被外部改（撤销/清空命令）→ 重画；本组件自己改也走这里 */
watch(() => session.strokes.length, () => repaint())

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key !== "Escape") return
  ev.stopPropagation()
  ctx.get<{ execute(id: string, payload?: unknown): unknown }>('command').execute('image:paint-cancel', { nodeId: props.id })
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  measure()
  // 进绘制态先确保节点完整可见（与裁剪/扩展同一条体验规矩）
  fitEditingNodeIntoView(ctx, props.id)
  window.addEventListener("keydown", onKeydown)
  const el = rootEl.value
  if (el && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => measure())
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
.ipo-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
