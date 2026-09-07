<script setup lang="ts">
/**
 * BoxSelectLayer —— 自绘 Shift+拖拽框选（对齐老版 MultiSelectPlugin 的接管策略）。
 *
 * 宿主 CanvasSurface 已把 VueFlow 原生框选键(selectionKeyCode/multiSelectionKeyCode)设为 null，
 * 框选完全由本插件接管：
 * - Shift + 左键 在画布空白按下（capture 拦截，阻止 VueFlow zoom/pan/click）→ 进入框选；
 * - document pointermove 逐帧：屏幕坐标 → screenToFlow → flow 矩形 → nodeLayout 绝对矩形碰撞
 *   （局部相交，含 group 子节点绝对坐标）→ 实时写内核 selection.set(命中 ids) 单源；
 * - 蓝色虚线视觉框以 position:fixed 直接定位屏幕坐标，不受视口缩放影响（老版同款策略）；
 * - 拖动超过 DRAG_THRESHOLD(4px) 才算框选；pointerup 结束移除框。
 *
 * 只读渲染上下文（useCanvasRender）拿 pane/screenToFlow；数据写走内核 ctx.get('selection')。
 * 纯碰撞逻辑在 multiSelectEngine（hitTestRects），本组件只做 DOM 手势与换算。
 */
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import type { SelectionService } from '@mini-canvas/canvas-core-v2'
import type { NodeLayoutService } from '@mini-canvas/canvas-render'
import { hitTestRects } from './multiSelectEngine'

const { pane, screenToFlow, ctx } = useCanvasRender()

const DRAG_THRESHOLD = 4

let boxEl: HTMLDivElement | null = null
let isBoxSelecting = false
let startX = 0
let startY = 0
let dragDistance = 0

function clearBox(): void {
  if (boxEl && boxEl.parentNode) boxEl.parentNode.removeChild(boxEl)
  boxEl = null
}

function updateBoxVisual(x1: number, y1: number, x2: number, y2: number): void {
  if (!boxEl) return
  const left = Math.min(x1, x2)
  const top = Math.min(y1, y2)
  const width = Math.abs(x2 - x1)
  const height = Math.abs(y2 - y1)
  boxEl.style.left = left + 'px'
  boxEl.style.top = top + 'px'
  boxEl.style.width = width + 'px'
  boxEl.style.height = height + 'px'
}

/** pointerdown 落在画布空白（非节点/边/端口/控件浮层）才算框选起点 */
function isPaneBlank(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (
    target.closest('.vue-flow__node') ||
    target.closest('.vue-flow__edge') ||
    target.closest('.vue-flow__handle') ||
    target.closest('.vue-flow__controls') ||
    target.closest('.vue-flow__minimap') ||
    target.closest('.vue-flow__panel') ||
    target.closest('.csurface-overlay-item')
  ) {
    return false
  }
  return true
}

function onPanePointerDown(e: PointerEvent): void {
  if (e.button !== 0 || !e.shiftKey) return
  if (!isPaneBlank(e.target)) return

  e.stopPropagation()
  e.stopImmediatePropagation()
  e.preventDefault()

  startX = e.clientX
  startY = e.clientY
  dragDistance = 0
  isBoxSelecting = true
}

function onPointerMove(e: PointerEvent): void {
  if (!isBoxSelecting) return
  dragDistance = Math.hypot(e.clientX - startX, e.clientY - startY)
  if (dragDistance <= DRAG_THRESHOLD) return

  if (!boxEl) {
    boxEl = document.createElement('div')
    boxEl.style.cssText =
      'position:fixed;border:1.5px dashed #3b82f6;background:rgba(59,130,246,0.06);' +
      'pointer-events:none;z-index:9999;border-radius:2px;'
    document.body.appendChild(boxEl)
  }
  updateBoxVisual(startX, startY, e.clientX, e.clientY)

  const tl = screenToFlow(Math.min(startX, e.clientX), Math.min(startY, e.clientY))
  const br = screenToFlow(Math.max(startX, e.clientX), Math.max(startY, e.clientY))
  const box = { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }

  const layout = ctx.get<NodeLayoutService>('nodeLayout')
  const rects = layout ? layout.getAllRects() : []
  const hitIds = hitTestRects(rects, box)

  const sel = ctx.get<SelectionService>('selection')
  if (sel) sel.set(hitIds)
}

function onPointerUp(): void {
  if (!isBoxSelecting) return
  isBoxSelecting = false
  clearBox()
}

let paneEl: HTMLElement | null = null

function attach(): void {
  const el = pane.value
  if (!el || paneEl === el) return
  paneEl = el
  paneEl.addEventListener('pointerdown', onPanePointerDown, { capture: true })
  document.addEventListener('pointermove', onPointerMove, { capture: true })
  document.addEventListener('pointerup', onPointerUp, { capture: true })
}

function detach(): void {
  if (paneEl) {
    paneEl.removeEventListener('pointerdown', onPanePointerDown, { capture: true })
    paneEl = null
  }
  document.removeEventListener('pointermove', onPointerMove, { capture: true })
  document.removeEventListener('pointerup', onPointerUp, { capture: true })
  clearBox()
}

watch(pane, (el) => {
  if (el) attach()
})
onMounted(() => attach())
onBeforeUnmount(() => detach())
</script>

<template>
  <div class="multi-select-box-layer" aria-hidden="true" />
</template>

<style scoped>
.multi-select-box-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
</style>
