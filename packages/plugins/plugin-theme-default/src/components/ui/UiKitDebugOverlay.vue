<script setup lang="ts">
/**
 * UiKitDebugOverlay —— 组件库使用标记的调试层（全局只挂一次）。
 *
 * 只读开发期注入的 data-ui-kit-debug / data-ui-kit-component：
 * - 开关关闭：组件被 v-if 卸载，不监听、不查询、零开销；
 * - 打开：给每个带标记的元素右上角画 7px 圆点；鼠标靠近圆点/组件时浮出定位信息。
 * - 只在开发构建里由 App.vue 挂载；生产构建里这段组件代码不会进主包。
 *
 * 气泡不用伪元素：伪元素会落进业务组件的层叠/overflow，节点被裁时点也跟着消失。
 * 这里用一个 fixed 覆盖层画，位置每帧按元素矩形算，不改变业务 DOM 与布局。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import {
  UI_KIT_DEBUG_ATTR,
  UI_KIT_DEBUG_COMPONENT_ATTR,
  parseDebugLoc,
  type UiKitUsageLoc,
} from '@mini-canvas/ui-kit-shadcn'

/** 圆点直径（px）；命中区略大，方便鼠标找 */
const DOT = 7
const HIT = 12
const GAP = 8
const CLOSE_DELAY = 260

interface Target {
  el: HTMLElement
  loc: UiKitUsageLoc
  rect: { left: number; top: number; right: number; bottom: number }
  /** 圆点中心（视口坐标） */
  cx: number
  cy: number
}

interface Marker {
  el: HTMLElement
  loc: UiKitUsageLoc
  key: number
  left: number
  top: number
  rect: Target['rect']
}

const target = ref<Target | null>(null)
const markers = shallowRef<Marker[]>([])
const panelRef = ref<HTMLElement | null>(null)
const panelW = ref(320)
const panelH = ref(120)
const shown = ref(false)

let closeTimer: ReturnType<typeof setTimeout> | null = null
let moveRaf = 0
let tickRaf = 0
let lastScan = 0
let pointerX = -1
let pointerY = -1
let overPanel = false
/** 圆点列表的稳定 key（同一元素跨次扫描不变） */
const markerIds = new WeakMap<HTMLElement, number>()
let nextMarkerId = 1

/** 定位：气泡优先放圆点上方；越界翻到下方，再收进视口 */
const panelStyle = computed(() => {
  const t = target.value
  if (!t) return {}
  const vw = typeof window === 'undefined' ? 1920 : window.innerWidth
  const vh = typeof window === 'undefined' ? 1080 : window.innerHeight
  const w = panelW.value
  const h = panelH.value
  let left = t.cx - w / 2
  let top = t.cy - h - GAP
  if (top < 8) top = t.cy + GAP
  if (left + w > vw - 8) left = vw - w - 8
  if (left < 8) left = 8
  if (top + h > vh - 8) top = Math.max(8, vh - h - 8)
  if (top < 8) top = 8
  return { left: Math.round(left) + 'px', top: Math.round(top) + 'px' }
})

/** 扫描带标记的元素，算好圆点与命中框（只在调试层挂载后跑） */
function scan(): void {
  // 设置面板打开时整层让位：它自己就是「正在看组件库用在哪」的主要目标，
  // 圆点压在上面反而看不清面板本身。面板关掉后下一帧自动回来。
  if (document.querySelector('[role="dialog"]')) {
    if (markers.value.length) markers.value = []
    if (shown.value) {
      shown.value = false
      target.value = null
    }
    return
  }
  const next: Marker[] = []
  for (const el of document.querySelectorAll<HTMLElement>(`[${UI_KIT_DEBUG_ATTR}]`)) {
    if (!el.isConnected || !el.getClientRects().length) continue
    const r = el.getBoundingClientRect()
    if (!r.width && !r.height) continue
    const loc = parseDebugLoc(
      el.getAttribute(UI_KIT_DEBUG_ATTR) ?? undefined,
      el.getAttribute(UI_KIT_DEBUG_COMPONENT_ATTR) ?? undefined,
    )
    if (!loc) continue
    let id = markerIds.get(el)
    if (!id) {
      id = nextMarkerId++
      markerIds.set(el, id)
    }
    next.push({
      el,
      loc,
      key: id,
      left: r.right - DOT / 2,
      top: r.top - DOT / 2,
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
    })
  }
  // 列表有变化就换引用；数量与位置都没变时保留旧数组，避免每 120ms 触发一次重渲染。
  if (!sameMarkers(markers.value, next)) markers.value = next
}

function sameMarkers(a: Marker[], b: Marker[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]
    const y = b[i]
    if (!x || !y) return false
    if (x.el !== y.el || x.left !== y.left || x.top !== y.top) return false
    if (x.rect.left !== y.rect.left || x.rect.top !== y.rect.top) return false
    if (x.rect.right !== y.rect.right || x.rect.bottom !== y.rect.bottom) return false
  }
  return true
}

/** 鼠标是否落在右上角圆点或组件自身内 */
function pick(x: number, y: number): Target | null {
  // 小元素优先：嵌套的 SelectValue 比 SelectTrigger 更具体
  let best: Target | null = null
  let bestArea = Infinity
  for (const marker of markers.value) {
    const r = marker.rect
    const onDot = Math.abs(x - r.right) <= HIT && Math.abs(y - r.top) <= HIT
    const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    if (!onDot && !inside) continue
    const area = (r.right - r.left) * (r.bottom - r.top)
    if (area >= bestArea) continue
    bestArea = area
    best = { el: marker.el, loc: marker.loc, rect: r, cx: r.right, cy: r.top }
  }
  return best
}

function cancelClose(): void {
  if (!closeTimer) return
  clearTimeout(closeTimer)
  closeTimer = null
}

function scheduleClose(): void {
  cancelClose()
  closeTimer = setTimeout(() => {
    closeTimer = null
    if (overPanel) return
    shown.value = false
    target.value = null
  }, CLOSE_DELAY)
}

function measure(): void {
  const el = panelRef.value
  if (!el) return
  panelW.value = el.offsetWidth || panelW.value
  panelH.value = el.offsetHeight || panelH.value
}

/** 只有打开开关后才注册 pointermove；raf 合帧避免大量组件时卡顿 */
function onMove(e: PointerEvent): void {
  pointerX = e.clientX
  pointerY = e.clientY
  if (moveRaf) return
  moveRaf = requestAnimationFrame(() => {
    moveRaf = 0
    const next = pick(pointerX, pointerY)
    if (!next) {
      if (shown.value) scheduleClose()
      return
    }
    cancelClose()
    const same = target.value?.el === next.el
    target.value = next
    if (!same) {
      shown.value = true
      requestAnimationFrame(measure)
    }
  })
}

/** 圆点跟着元素走：调试层挂载期间跑，约 8 帧/秒 */
function tick(now: number): void {
  if (now - lastScan > 120) {
    lastScan = now
    scan()
  }
  tickRaf = requestAnimationFrame(tick)
}

function onDocOver(e: PointerEvent): void {
  const el = e.target as HTMLElement | null
  const was = overPanel
  overPanel = !!el?.closest?.('.ukdo-body')
  if (overPanel && !was) cancelClose()
  if (!overPanel && was) scheduleClose()
}

onMounted(() => {
  scan()
  tickRaf = requestAnimationFrame(tick)
  window.addEventListener('pointermove', onMove, { passive: true })
  document.addEventListener('pointerover', onDocOver, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onMove)
  document.removeEventListener('pointerover', onDocOver, true)
  cancelClose()
  if (moveRaf) cancelAnimationFrame(moveRaf)
  if (tickRaf) cancelAnimationFrame(tickRaf)
})
</script>

<template>
  <!-- 覆盖层不接事件：命中由 window pointermove 判断，绝不挡业务点击 -->
  <div class="ukdo-layer" aria-hidden="true">
    <span
      v-for="marker in markers"
      :key="marker.key"
      class="ukdo-dot"
      :style="{ left: marker.left + 'px', top: marker.top + 'px' }"
    />
    <div v-if="shown && target" ref="panelRef" class="ukdo-body" :style="panelStyle" role="tooltip">
      <div class="ukdo-head">{{ target.loc.component }}</div>
      <div class="ukdo-path">{{ target.loc.file }}:{{ target.loc.line }}:{{ target.loc.column }}</div>
      <div class="ukdo-hint">使用点 · 来源 @mini-canvas/ui-kit-shadcn</div>
    </div>
  </div>
</template>

<style>
/* 非 scoped：覆盖层固定在视口，气泡要压过任意业务浮层 */
.ukdo-layer {
  position: fixed;
  inset: 0;
  z-index: 200000;
  pointer-events: none;
}
.ukdo-dot {
  position: fixed;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  border: 1px solid var(--ui-overlay-solid, #fff);
  background: var(--ui-accent, #0891b2);
  box-shadow: 0 0 0 1px var(--ui-scrim, rgb(15 23 42 / 0.55));
  pointer-events: none;
}
.ukdo-body {
  position: fixed;
  box-sizing: border-box;
  width: max-content;
  min-width: 280px;
  max-width: min(460px, calc(100vw - 16px));
  padding: 8px 10px;
  border: 1px solid var(--ui-line, rgb(0 0 0 / 0.12));
  border-radius: 10px;
  background: var(--ui-overlay-solid, #fff);
  color: var(--ui-ink, #18202b);
  box-shadow: var(--ui-shadow-md, 0 18px 44px rgb(15 23 42 / 0.16));
  text-align: left;
  font: 500 11px/1.6 ui-monospace, Menlo, Consolas, monospace;
  /*
   * 气泡**绝不接收指针事件**。
   * 它只是「看一眼代码位置」的说明层，但会浮在组件上方；一旦能接事件，
   * 就会挡住下面的真按钮（实测：右上「设置」被气泡整个盖住，点不动）。
   * 需要复制路径时用截图/手工选中，不为它牺牲业务可点性。
   */
  pointer-events: none;
  user-select: text;
}
.ukdo-head {
  font-size: 12px;
  font-weight: 700;
  color: var(--ui-ink, #18202b);
}
.ukdo-path {
  margin-top: 2px;
  color: var(--ui-accent, #0891b2);
  word-break: break-all;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}
.ukdo-hint {
  margin-top: 3px;
  color: var(--ui-ink-mute, #9ca3af);
  font-size: 10px;
}
</style>
