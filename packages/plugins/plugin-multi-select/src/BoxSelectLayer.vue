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
 * - **松手后要吞掉紧随其后的那一次 pane click**（boxSelectGuard）：框选把选中写进内核后，浏览器还会
 *   补一个 click 事件，宿主的 onPaneClick 会把它当成"点空白"清空选中 —— 结果框选白做
 *   （只有 Ctrl 逐个加选看起来有效）。判定与老版 MultiSelectPlugin 同源：落点在画布空白才算误点击。
 *
 * 只读渲染上下文（useCanvasRender）拿 pane/screenToFlow；数据写走内核 ctx.get('selection')。
 * 纯碰撞逻辑在 multiSelectEngine（hitTestRects），本组件只做 DOM 手势与换算。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCanvasRender, beginSelecting, endSelecting } from '@mini-canvas/canvas-render'
import type { SelectionService } from '@mini-canvas/canvas-data'
import type { NodeLayoutService } from '@mini-canvas/canvas-render'
import { hitTestRects } from './multiSelectEngine'
import { BoxSelectClickGuard } from './boxSelectGuard'
import {
  MULTI_SELECT_FRAME_KEYS,
  MULTI_SELECT_COLOR_KEYS,
  resolveMultiSelectFrameConfig,
  applyMultiSelectFrameChange,
} from './multiSelectConfig'
import { currentThemeMode, watchThemeMode } from '@mini-canvas/canvas-render'

const { flow, ctx, interaction } = useCanvasRender()
const pane = flow.pane

// 绘制框的外观（线型/线宽/填充）：颜色走主题 token（--ui-select-box），其余来自配置。
// 订阅 settings.onChange 实时生效（与 SelectionFrame 同源那一套）。
const settings = (): { get(k: string): unknown; onChange(cb: (k: string, v: unknown) => void): { dispose(): void } } | undefined =>
  ctx.tryGet('settings')
const themeMode = ref<'light' | 'dark'>(currentThemeMode())
const themeOff = watchThemeMode((m) => { themeMode.value = m })
const boxCfg = ref(resolveMultiSelectFrameConfig((k) => settings()?.get(k), themeMode.value).boxSelect)
const offSettings = settings()?.onChange(() => {
  // 颜色格（亮/暗）也走全量重算：改动可能来自任一主题格
  boxCfg.value = resolveMultiSelectFrameConfig((k) => settings()?.get(k), themeMode.value).boxSelect
})
onBeforeUnmount(() => themeOff())

const DRAG_THRESHOLD = 4

let boxEl: HTMLDivElement | null = null
let isBoxSelecting = false
let startX = 0
let startY = 0
let dragDistance = 0

/** 框选结束后的误点击守卫（纯逻辑，见 boxSelectGuard.ts） */
const clickGuard = new BoxSelectClickGuard()

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
  // 广播"正在框选"：节点壳(BaseNode)据此把上下控制栏收起来 —— 框选时那一排操作条/状态栏
  // 既挡视线又会跟着框一起被框进去，用户明确要求框选期间不出现。
  beginSelecting(interaction)
}

function onPointerMove(e: PointerEvent): void {
  if (!isBoxSelecting) return
  dragDistance = Math.hypot(e.clientX - startX, e.clientY - startY)
  if (dragDistance <= DRAG_THRESHOLD) return

  if (!boxEl) {
    boxEl = document.createElement('div')
    // 绘制框（Shift 拖拽时画出来的那个框）：
    //  - 颜色走**主题 token** --ui-select-box（用户在「常规/主题配色」里改，用户口径"删掉自定义色就用主题色"）；
    //  - 线型 / 线宽 / 填充来自「布局/多选」的绘制框三项配置。
    // 位置/尺寸随拖拽逐帧改（updateBoxVisual），样式只在首次建元素时定一次。
    const c = boxCfg.value
    // 颜色：自定义色优先（用户在主题配色格填了 hex），空 = 主题 token（--ui-select-box → --ui-accent 兜底）
    const color = c.color ?? 'var(--ui-select-box, var(--ui-accent, #0891b2))'
    boxEl.style.cssText =
      'position:fixed;' +
      'border:' + c.lineWidth + 'px ' + c.lineStyle + ' ' + color + ';' +
      'background:' + (c.fillOpacity > 0 ? 'color-mix(in srgb, ' + color + ' ' + c.fillOpacity * 100 + '%, transparent)' : 'transparent') + ';' +
      'pointer-events:none;z-index:9999;border-radius:2px;'
    // 框选框的 z-index 走画布层叠带变量（--layer-gesture，唯一事实源见 canvas-render/contracts/layers.ts）。
    // 配色与线型仍按本插件的配置（见上）。
    boxEl.style.cssText =
      'position:fixed;' +
      'border:' + c.lineWidth + 'px ' + c.lineStyle + ' ' + color + ';' +
      'background:' + (c.fillOpacity > 0 ? 'color-mix(in srgb, ' + color + ' ' + c.fillOpacity * 100 + '%, transparent)' : 'transparent') + ';' +
      'pointer-events:none;z-index:var(--layer-gesture, 900);border-radius:2px;'
    document.body.appendChild(boxEl)
  }
  updateBoxVisual(startX, startY, e.clientX, e.clientY)

  const tl = flow.screenToFlow(Math.min(startX, e.clientX), Math.min(startY, e.clientY))
  const br = flow.screenToFlow(Math.max(startX, e.clientX), Math.max(startY, e.clientY))
  const box = { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }

  const layout = ctx.get('view')
  const rects = layout ? layout.getAllRects() : []
  const hitIds = hitTestRects(rects, box)

  const sel = ctx.get('selection')
  if (sel) sel.set(hitIds)
}

function onPointerUp(): void {
  if (!isBoxSelecting) return
  const dragged = dragDistance > DRAG_THRESHOLD
  isBoxSelecting = false
  clearBox()
  endSelecting(interaction)
  clickGuard.markGestureDone(dragged)
}

/** 新的指针按下：作废上一次没被消费的待命标记（防误吞下一次真实点击） */
function onDocumentPointerDown(): void {
  clickGuard.reset()
}

/** 框选结束后的那次 pane click：在捕获阶段吞掉，免得宿主 clickPane 清掉刚选中的结果 */
function onPaneClickCapture(e: MouseEvent): void {
  if (!clickGuard.shouldSwallow(isPaneBlank(e.target))) return
  e.stopPropagation()
  e.stopImmediatePropagation()
  e.preventDefault()
}

let paneEl: HTMLElement | null = null

function attach(): void {
  const el = pane.value
  if (!el || paneEl === el) return
  paneEl = el
  paneEl.addEventListener('pointerdown', onPanePointerDown, { capture: true })
  paneEl.addEventListener('click', onPaneClickCapture, { capture: true })
  // 兜底清标记挂 document：任何一个指针按下都意味着"上一轮手势已过去"
  document.addEventListener('pointerdown', onDocumentPointerDown, { capture: true })
  document.addEventListener('pointermove', onPointerMove, { capture: true })
  document.addEventListener('pointerup', onPointerUp, { capture: true })
}

function detach(): void {
  if (paneEl) {
    paneEl.removeEventListener('pointerdown', onPanePointerDown, { capture: true })
    paneEl.removeEventListener('click', onPaneClickCapture, { capture: true })
    paneEl = null
  }
  document.removeEventListener('pointerdown', onDocumentPointerDown, { capture: true })
  document.removeEventListener('pointermove', onPointerMove, { capture: true })
  document.removeEventListener('pointerup', onPointerUp, { capture: true })
  clickGuard.reset()
  endSelecting(interaction) // 拖动中途被卸载（热卸/重挂）：别把"框选中"这个位留在 true
  clearBox()
}

watch(pane, (el) => {
  if (el) attach()
})
onMounted(() => attach())
onBeforeUnmount(() => {
  detach()
  offSettings?.dispose()
})
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
