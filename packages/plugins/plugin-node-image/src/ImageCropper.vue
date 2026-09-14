<script setup lang="ts">
/**
 * ImageCropper —— 图片裁剪覆盖层（画在节点内容区之上，不动内核 data）。
 *
 * 关键取舍：
 * - 位置：相对内容区（卡片内）绝对定位；角柄允许略微出界，但内容区自身 overflow:hidden，
 *   所以一切都会被卡片圆角裁住 —— 不越出节点，也不必自己跟随视口 pan/zoom。
 * - 坐标系：裁剪框的真身存**图片像素**，显示时只做一次 scale 换算（见 cropGeometry）。
 *   确认裁剪时直接把像素矩形交给 canvas，不做二次换算。
 * - 数值：全部来自 docs/design/ui-style-guide.md（灰阶 / 发丝边 / 青只做强调 / 圆角阶梯 /
 *   动效 + prefers-reduced-motion 降级）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  clampRect,
  computeFit,
  defaultCropRect,
  minCropEdge,
  moveRect,
  placeActionBar,
  rectToDisplay,
  resizeRect,
  screenDeltaToImage,
  type CropCorner,
  type Rect,
} from './cropGeometry'

const props = defineProps<{
  nodeId: string
  imageUrl: string
  /** data 里记的图片像素尺寸；缺省时用元素实测兜底 */
  imageWidth?: number
  imageHeight?: number
}>()

const emit = defineEmits<{
  (e: 'confirm', rect: Rect): void
  (e: 'cancel'): void
}>()

/** 覆盖层根：既是量测容器，也是指针捕获目标 */
const rootEl = ref<HTMLElement | null>(null)
/** 操作条：按真实宽度居中定位 */
const barEl = ref<HTMLElement | null>(null)

const boxW = ref(1)
const boxH = ref(1)
/** 操作条实测尺寸（落点计算用；实测前用估算值，挂载后立刻矫正） */
const barW = ref(96)
const barH = ref(32)

/** 图片像素尺寸：优先 data，缺省回退容器尺寸 */
const imgW = computed(() => (props.imageWidth && props.imageWidth > 0 ? props.imageWidth : boxW.value))
const imgH = computed(() => (props.imageHeight && props.imageHeight > 0 ? props.imageHeight : boxH.value))

const fit = computed(() => computeFit(boxW.value, boxH.value, imgW.value, imgH.value))
const minEdge = computed(() => minCropEdge(fit.value.scale))

/** 裁剪框（图片像素坐标） */
const rect = ref<Rect>({ x: 0, y: 0, width: 0, height: 0 })

/** 显示几何：裁剪框 + 四块遮罩 + 操作条 */
const frame = computed(() => rectToDisplay(rect.value, fit.value))

const frameStyle = computed(() => ({
  left: px(frame.value.x),
  top: px(frame.value.y),
  width: px(frame.value.width),
  height: px(frame.value.height),
}))

const shadeStyles = computed(() => {
  const f = frame.value
  return [
    { top: px(0), left: px(0), width: px(boxW.value), height: px(f.y) },
    {
      top: px(f.y + f.height),
      left: px(0),
      width: px(boxW.value),
      height: px(Math.max(boxH.value - f.y - f.height, 0)),
    },
    { top: px(f.y), left: px(0), width: px(f.x), height: px(f.height) },
    {
      top: px(f.y),
      left: px(f.x + f.width),
      width: px(Math.max(boxW.value - f.x - f.width, 0)),
      height: px(f.height),
    },
  ]
})

/** 图像外的信箱条（图上/下/左/右各一条） */
const letterboxStyles = computed(() => {
  const d = fit.value
  return [
    { top: px(0), left: px(0), width: px(boxW.value), height: px(d.oy) },
    {
      top: px(d.oy + d.dh),
      left: px(0),
      width: px(boxW.value),
      height: px(Math.max(boxH.value - d.oy - d.dh, 0)),
    },
    { top: px(d.oy), left: px(0), width: px(d.ox), height: px(d.dh) },
    {
      top: px(d.oy),
      left: px(d.ox + d.dw),
      width: px(Math.max(boxW.value - d.ox - d.dw, 0)),
      height: px(d.dh),
    },
  ]
})

const barStyle = computed(() => {
  const place = placeActionBar(frame.value, boxW.value, boxH.value, barW.value, barH.value)
  return { left: px(place.left), top: px(place.top) }
})

/** 像素值 → CSS 长度（避免模板里写模板字符串，保持模板可读） */
function px(n: number): string {
  return String(n >= 0 && Number.isFinite(n) ? n : 0) + 'px'
}

/** 指针会话：整体移动 or 拖某个角 */
type Session =
  | { kind: 'move'; startX: number; startY: number; rect: Rect }
  | { kind: 'resize'; corner: CropCorner; startX: number; startY: number; rect: Rect }
const session = ref<Session | null>(null)

const CORNERS: CropCorner[] = ['nw', 'ne', 'sw', 'se']

function initRect(): void {
  rect.value = defaultCropRect(imgW.value, imgH.value, fit.value.scale)
}

function onFramePointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  session.value = { kind: 'move', startX: e.clientX, startY: e.clientY, rect: { ...rect.value } }
  rootEl.value?.setPointerCapture(e.pointerId)
}

function onHandlePointerDown(e: PointerEvent, corner: CropCorner): void {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  session.value = { kind: 'resize', corner, startX: e.clientX, startY: e.clientY, rect: { ...rect.value } }
  rootEl.value?.setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent): void {
  const s = session.value
  if (!s) return
  const delta = screenDeltaToImage(e.clientX - s.startX, e.clientY - s.startY, fit.value.scale)
  rect.value =
    s.kind === 'move'
      ? moveRect(s.rect, delta.dx, delta.dy, imgW.value, imgH.value, minEdge.value)
      : resizeRect(s.rect, s.corner, delta.dx, delta.dy, imgW.value, imgH.value, minEdge.value)
}

function onPointerUp(e: PointerEvent): void {
  if (!session.value) return
  session.value = null
  try {
    rootEl.value?.releasePointerCapture(e.pointerId)
  } catch {
    /* 捕获可能已自动释放 */
  }
}

function onConfirm(): void {
  const pixels = clampRect(rect.value, imgW.value, imgH.value, minEdge.value)
  if (pixels.width <= 0 || pixels.height <= 0) return
  emit('confirm', pixels)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  emit('cancel')
}

// —— 量测内容区：尺寸变了要重算显示几何，并把裁剪框收敛回新边界 ——
let observer: ResizeObserver | null = null
let barObserver: ResizeObserver | null = null

onMounted(() => {
  const el = rootEl.value
  if (el) {
    boxW.value = el.clientWidth || 1
    boxH.value = el.clientHeight || 1
  }
  initRect()
  if (el && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => {
      boxW.value = el.clientWidth || 1
      boxH.value = el.clientHeight || 1
      rect.value = clampRect(rect.value, imgW.value, imgH.value, minEdge.value)
    })
    observer.observe(el)
    // 操作条自身尺寸也量一次：文案/缩放变化时落点要跟着重算
    barObserver = new ResizeObserver(() => {
      const bar = barEl.value
      if (!bar) return
      if (bar.offsetWidth > 0) barW.value = bar.offsetWidth
      if (bar.offsetHeight > 0) barH.value = bar.offsetHeight
    })
    if (barEl.value) barObserver.observe(barEl.value)
  }
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  barObserver?.disconnect()
  barObserver = null
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    ref="rootEl"
    class="ci-cropper nodrag nopan"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <!-- 图像外区域：更深，表明这里没有画面 -->
    <div v-for="(style, i) in letterboxStyles" :key="'lb' + i" class="ci-letterbox" :style="style" />

    <!-- 框外遮罩（四条，跟着裁剪框实时变） -->
    <div v-for="(style, i) in shadeStyles" :key="'sh' + i" class="ci-shade" :style="style" />

    <!-- 裁剪框：拖动即整体平移；三分构图线只作参考 -->
    <div
      class="ci-frame"
      :style="frameStyle"
      title="拖动调整裁剪范围"
      @pointerdown="onFramePointerDown"
    >
      <div class="ci-grid" aria-hidden="true">
        <span class="ci-grid-line ci-grid-line--h" style="top: 33.333%" />
        <span class="ci-grid-line ci-grid-line--h" style="top: 66.666%" />
        <span class="ci-grid-line ci-grid-line--v" style="left: 33.333%" />
        <span class="ci-grid-line ci-grid-line--v" style="left: 66.666%" />
      </div>
      <button
        v-for="corner in CORNERS"
        :key="corner"
        type="button"
        class="ci-handle"
        :class="'ci-handle--' + corner"
        :title="'拖动调整裁剪框（' + corner + ' 角）'"
        :aria-label="'拖动调整裁剪框（' + corner + ' 角）'"
        @pointerdown="onHandlePointerDown($event, corner)"
      />
    </div>

    <!-- 操作条：跟随裁剪框底边居中 -->
    <div
      ref="barEl"
      class="ci-actions"
      :style="barStyle"
      role="group"
      aria-label="裁剪操作"
      @pointerdown.stop
    >
      <button class="ci-btn" type="button" title="取消裁剪" aria-label="取消裁剪" @click="emit('cancel')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
        <span>取消</span>
      </button>
      <button class="ci-btn ci-btn--primary" type="button" title="确认裁剪" aria-label="确认裁剪" @click="onConfirm">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span>确认</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 覆盖层本体：铺满内容区，承载全部裁剪子元素；自身不挡点击（子元素各自接管） */
.ci-cropper {
  position: absolute;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  touch-action: none;
  cursor: crosshair;
}

/* 图像外区域：更深，表明没有画面 */
.ci-letterbox {
  position: absolute;
  background: rgba(0, 0, 0, 0.68);
  pointer-events: none;
}

/* 图像内、框外：浅一档的遮罩 */
.ci-shade {
  position: absolute;
  background: rgba(0, 0, 0, 0.52);
  pointer-events: none;
}

/* 裁剪框：白描边 + 柔和投影（对齐 ui-style-guide 的柔影，不用硬黑边） */
.ci-frame {
  position: absolute;
  box-sizing: border-box;
  pointer-events: auto;
  cursor: move;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.95),
    0 12px 36px rgba(0, 0, 0, 0.28);
}

.ci-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.ci-grid-line {
  position: absolute;
  background: rgba(255, 255, 255, 0.45);
}
.ci-grid-line--h {
  left: 0;
  right: 0;
  height: 1px;
}
.ci-grid-line--v {
  top: 0;
  bottom: 0;
  width: 1px;
}

/* 四角控制柄：10px 方块、白底发丝边；命中区用 ::before 外扩到约 22px */
.ci-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  padding: 0;
  box-sizing: border-box;
  background: #fff;
  border: 1.5px solid rgba(0, 0, 0, 0.5);
  border-radius: 2px;
  pointer-events: auto;
  touch-action: none;
}
.ci-handle::before {
  content: '';
  position: absolute;
  inset: -6px;
}
.ci-handle--nw {
  top: -5px;
  left: -5px;
  cursor: nwse-resize;
}
.ci-handle--ne {
  top: -5px;
  right: -5px;
  cursor: nesw-resize;
}
.ci-handle--sw {
  bottom: -5px;
  left: -5px;
  cursor: nesw-resize;
}
.ci-handle--se {
  bottom: -5px;
  right: -5px;
  cursor: nwse-resize;
}
.ci-handle:focus-visible {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: 1px;
}

/* 操作条：不透明白底 + 发丝边 + e2 柔影；圆角 8（嵌套阶梯 16→12→10→8→6） */
.ci-actions {
  position: absolute;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08);
  pointer-events: auto;
}

.ci-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition:
    background-color 0.18s cubic-bezier(0.34, 1.56, 0.64, 1),
    color 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ci-btn svg {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}

.ci-btn:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #111827;
}

.ci-btn:focus-visible {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: 1px;
}

/* 全界面同一时刻只允许一个实心主按钮 —— 这里就是「确认」 */
.ci-btn--primary {
  padding: 6px 14px;
  border-radius: 8px;
  background: #0891b2;
  color: #fff;
  font-weight: 700;
}

.ci-btn--primary:hover {
  background: #0e7490;
  color: #fff;
}

.ci-btn--primary:active {
  transform: scale(0.97);
}

@media (prefers-reduced-motion: reduce) {
  .ci-btn {
    transition: none !important;
  }
  .ci-btn--primary:active {
    transform: none;
  }
}
</style>
