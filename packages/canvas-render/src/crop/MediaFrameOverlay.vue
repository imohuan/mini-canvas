<script setup lang="ts">
/**
 * MediaFrameOverlay —— 媒体节点（图片 / 视频）通用的「编辑浮层」：在画面上拖出一个矩形（裁剪 / 扩展）。
 *
 * 为什么是通用件（用户要求「这完全可以做成一个通用组件」）：图片与视频的裁剪是**同一件事** ——
 * 在媒体画面坐标系里框一块区域，确认后由各自的插件去执行（图片走 canvas 重绘、视频只记元数据）。
 * 差异只有两点，都做成 props：
 *   mode: 'crop' 框必须在画面内 ／ 'expand' 框必须包住画面（往外扩图）；
 *   手柄：裁剪给 4 个角（边没意义），扩展给 8 个（要能只往一侧扩）。
 * 其余（几何、遮罩、三分线、四角方块控制点、拖拽会话、量测）两个场景完全共用一份，不再各写一遍。
 *
 * 三个关键设计（都来自实测踩坑，别改回去）：
 *
 * 1. **浮层不放在内容区里**。它由 BaseNode 的 overlay 段渲染在**卡片外面**（与上/下控制栏同级），
 *    所以不会被 .v2-content-clip 的 overflow:hidden 裁掉。用户实测报的"裁剪区域被节点切掉"
 *    就是因为它当初挂在内容区内部。
 *
 * 2. **浮层用自己的量测盒子，不依赖卡片**。组件根是一层铺满小盒子的伪元素
 *    （.mfo-hit），它跟着卡片尺寸走；所有几何都以它为准算 object-contain。
 *    于是"画面在框里的位置"与卡片内容是同一套算法，不会错位。
 *
 * 3. **拖拽期间不写库**。草稿经 update:draft 交出去（由会话态持有），拖完才由调用方一次性提交。
 *    每一帧都写库会产生几百条撤销记录，用户按一次撤销只会退回上一帧。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ALL_DIRS,
  CORNER_DIRS,
  clampCropRect,
  clampExpandRect,
  computeMediaFit,
  defaultCropRect,
  defaultExpandRect,
  isUsableRect,
  minFrameEdge,
  moveCropRect,
  moveExpandRect,
  rectToDisplay,
  resizeCropRect,
  resizeExpandRect,
  screenDeltaToMedia,
  resolveScreenPerCss,
  type HandleDir,
  type Rect,
} from './mediaFit'
import { applyRatio, ratioOf, type CropRatioOption } from './cropRatio'

const props = withDefaults(
  defineProps<{
    /** 编辑模式：裁剪（框在画面内）／扩展（框包住画面） */
    mode?: 'crop' | 'expand'
    /** 媒体像素尺寸（图片/视频的真实宽高）。缺失时退回按容器尺寸算，至少能框 */
    mediaWidth?: number
    mediaHeight?: number
    /** 已有的框（二次进入时作起点） */
    initialRect?: Rect
    /** 会话草稿（拖拽中的临时框；有它就以它为准，优先于 initialRect） */
    draftRect?: Rect
    /** 比例选项（裁剪时才给；给了才显示比例下拉） */
    ratioOptions?: CropRatioOption[]
    /** 当前比例键（受控，由调用方持有；缺省视为默认值） */
    ratioValue?: string
    /**
     * 把节点拉进视野的回调（进入编辑态时调一次）。
     *
     * 为什么要这个：扩展/裁剪的框会往外长，节点若贴在视口边缘，长出来的控制点会落到屏幕外
     * —— 用户实测报的"控制点错位、拖不动"其实是它被推到视口外了（elementFromPoint 返回 null）。
     * 由调用方注入(它能拿到宿主/视口)，这里只负责"什么时候该拉"这个判断。
     */
    fitIntoView?: () => void
  }>(),
  {
    mode: 'crop',
    mediaWidth: 0,
    mediaHeight: 0,
    initialRect: undefined,
    draftRect: undefined,
    ratioOptions: undefined,
    ratioValue: undefined,
  },
)

const emit = defineEmits<{
  /** 草稿变化（拖拽中每次移动都发；调用方存进会话态，不写库） */
  (e: 'update:draft', rect: Rect): void
  /** 确认（把当前框交给调用方提交） */
  (e: 'confirm', rect: Rect): void
  /** 取消 / Esc */
  (e: 'cancel'): void
  /** 比例被改（用户选了下拉里的一项）；浮层已按新比例调过框，这里只是把选择同步出去 */
  (e: 'update:ratioValue', value: string): void
}>()

const rootEl = ref<HTMLElement | null>(null)
const boxW = ref(1)
const boxH = ref(1)

/**
 * 屏幕上 1 CSS px = 几个屏幕像素（画布缩放的总效果）。
 *
 * 为什么必须量：浮层与卡片同处 VueFlow 的缩放视口里，所以浮层里的 CSS px 在屏幕上会被
 * zoom 放大或缩小；而拖拽拿到的是**屏幕**像素位移。少了这一步换算，缩放后框就会"不跟手"
 * （zoom=0.5 时框跑两倍远）—— 这正是用户实测报的缺陷。
 * zoom=1 时它是 1，所以只有缩放过才看得出来。
 */
const screenPerCss = ref(1)

/** 画面像素尺寸：props 给了就用，没给就按盒子兜底（至少能框，不会整个浮层失效） */
const mediaW = computed(() => (props.mediaWidth > 0 ? props.mediaWidth : boxW.value))
const mediaH = computed(() => (props.mediaHeight > 0 ? props.mediaHeight : boxH.value))

const fit = computed(() => computeMediaFit(boxW.value, boxH.value, mediaW.value, mediaH.value))
const minEdge = computed(() => minFrameEdge(fit.value.scale))

const isExpand = computed(() => props.mode === 'expand')
const dirs = computed<HandleDir[]>(() => (isExpand.value ? ALL_DIRS : CORNER_DIRS))

/** 当前框（媒体像素坐标） */
const rect = ref<Rect>({ x: 0, y: 0, width: 0, height: 0 })

/** 按当前模式把框收敛进合法范围 */
function constrain(r: Rect): Rect {
  return isExpand.value
    ? clampExpandRect(r, mediaW.value, mediaH.value)
    : clampCropRect(r, mediaW.value, mediaH.value, minEdge.value)
}

function seedRect(): Rect {
  const source = props.draftRect ?? props.initialRect
  if (isUsableRect(source)) return constrain(source)
  return isExpand.value
    ? defaultExpandRect(mediaW.value, mediaH.value)
    : defaultCropRect(mediaW.value, mediaH.value, fit.value.scale)
}

/**
 * 比例变化时把框调成新比例（中心不动）。
 *
 * 比例下拉本身在**上下控制栏**（用户要求，与 liblib 一致：× | 原比例 | 确认），
 * 所以这里只负责"收到新比例后把框改对"，UI 不在这里。用 watch 而不是让父组件调方法：
 * 浮层的 rect 是组件内部状态（拖拽中高频变化），外部不该持有它。
 */
watch(
  () => props.ratioValue,
  (value) => {
    if (props.mode !== 'crop') return
    // 边界就是整幅画面：比例调整只用于裁剪（扩展不锁比例）
    const next = applyRatio(rect.value, ratioOf(value), {
      width: mediaW.value,
      height: mediaH.value,
      minEdge: minEdge.value,
    })
    rect.value = next
    emit('update:draft', next)
  },
)

type Session =
  | { kind: 'move'; startX: number; startY: number; from: Rect }
  | { kind: 'resize'; dir: HandleDir; startX: number; startY: number; from: Rect }
let session: Session | null = null

/**
 * 量测浮层盒子。
 *
 * 这个组件**自己量自己**，不要求调用方传卡片尺寸：段组件只收到 { id, data }，
 * 而壳给浮层的容器本来就与卡片同尺寸 —— 自量既省掉一条 props 通道，也避免"传进来的
 * 尺寸与实际渲染尺寸不一致"这类错位（错位在裁剪里表现为框与画面差几像素，很难查）。
 */
function measure(): void {
  const el = rootEl.value
  if (!el) return
  const w = el.clientWidth
  const h = el.clientHeight
  if (w > 0 && h > 0) {
    boxW.value = w
    boxH.value = h
  }
  // 同时量"布局尺寸 vs 屏幕尺寸"的比值 = 缩放系数（含视口与祖先变换）
  const screen = el.getBoundingClientRect()
  screenPerCss.value = resolveScreenPerCss(screen.width, w)
}

let resizeObserver: ResizeObserver | null = null

function onPointerDown(ev: PointerEvent, dir?: HandleDir): void {
  if (ev.button !== 0) return
  ev.preventDefault()
  ev.stopPropagation()
  // 起手先量一次：卡片可能刚被改过尺寸，几何必须是当下的
  measure()
  rect.value = constrain(rect.value)
  session = dir
    ? { kind: 'resize', dir, startX: ev.clientX, startY: ev.clientY, from: { ...rect.value } }
    : { kind: 'move', startX: ev.clientX, startY: ev.clientY, from: { ...rect.value } }
  rootEl.value?.setPointerCapture?.(ev.pointerId)
}

function onPointerMove(ev: PointerEvent): void {
  if (!session) return
  ev.stopPropagation()
  const d = screenDeltaToMedia(
    ev.clientX - session.startX,
    ev.clientY - session.startY,
    fit.value.scale,
    screenPerCss.value,
  )
  const next =
    session.kind === 'move'
      ? isExpand.value
        ? moveExpandRect(session.from, d.dx, d.dy, mediaW.value, mediaH.value)
        : moveCropRect(session.from, d.dx, d.dy, mediaW.value, mediaH.value, minEdge.value)
      : isExpand.value
        ? resizeExpandRect(session.from, session.dir, d.dx, d.dy, mediaW.value, mediaH.value)
        : resizeCropRect(session.from, session.dir, d.dx, d.dy, mediaW.value, mediaH.value, minEdge.value)
  rect.value = next
  emit('update:draft', next)
}

function onPointerUp(ev: PointerEvent): void {
  if (!session) return
  ev.stopPropagation()
  session = null
  rootEl.value?.releasePointerCapture?.(ev.pointerId)
  emit('update:draft', rect.value)
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key !== 'Escape') return
  ev.stopPropagation()
  emit('cancel')
}

/**
 * 把本节点拉进视野（只在"含编辑余量的范围装不下"时才动，见 shouldFitEditingViewport）。
 *
 * 这里只负责"什么时候该拉"：几何交给调用方（它手上有 flow 坐标与视口服务，
 * 不必在本组件里再反推一遍缩放与 pane 偏移 —— 多一处算式就多一处出错）。
 */
function fitNodeIntoView(): void {
  if (!props.fitIntoView) return
  props.fitIntoView()
}

onMounted(() => {
  measure()
  rect.value = seedRect()
  emit('update:draft', rect.value)
  // 进入编辑态先确保节点完整可见：框会往外长，贴在视口边缘时控制点会跑到屏幕外点不到
  // （用户实测报的"控制点错位/拖不动"就是它）。拿不到视口信息时不瞎跳。
  fitNodeIntoView()
  window.addEventListener('keydown', onKeydown)
  // 卡片尺寸会变（换媒体 / 用户拖过尺寸 / 画布缩放引起重排），浮层必须跟着重新量测，
  // 否则框与画面会错位。ResizeObserver 比 watch(cardWidth) 可靠：它量的是真实渲染尺寸。
  const el = rootEl.value
  if (el && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      measure()
      rect.value = constrain(rect.value)
    })
    resizeObserver.observe(el)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  resizeObserver?.disconnect()
  resizeObserver = null
  session = null
})

// ==================== 显示几何 ====================

const frame = computed(() => rectToDisplay(rect.value, fit.value))

const frameStyle = computed<Record<string, string>>(() => ({
  left: px(frame.value.x),
  top: px(frame.value.y),
  width: size(frame.value.width),
  height: size(frame.value.height),
}))

/** 框外遮罩：四条（跟着框实时变）。裁剪时压暗框外，扩展时框外是要新增的区域、同样压暗以突出原图 */
const shadeStyles = computed<Array<Record<string, string>>>(() => {
  const f = frame.value
  return [
    { top: px(0), left: px(0), width: size(boxW.value), height: size(f.y) },
    { top: px(f.y + f.height), left: px(0), width: size(boxW.value), height: size(Math.max(boxH.value - f.y - f.height, 0)) },
    { top: px(f.y), left: px(0), width: size(f.x), height: size(f.height) },
    { top: px(f.y), left: px(f.x + f.width), width: size(Math.max(boxW.value - f.x - f.width, 0)), height: size(f.height) },
  ]
})

/** 画面之外的信箱条（更暗一档：这里根本没有画面） */
const letterboxStyles = computed<Array<Record<string, string>>>(() => {
  const d = fit.value
  return [
    { top: px(0), left: px(0), width: size(boxW.value), height: size(d.oy) },
    { top: px(d.oy + d.dh), left: px(0), width: size(boxW.value), height: size(Math.max(boxH.value - d.oy - d.dh, 0)) },
    { top: px(d.oy), left: px(0), width: size(d.ox), height: size(d.dh) },
    { top: px(d.oy), left: px(d.ox + d.dw), width: size(Math.max(boxW.value - d.ox - d.dw, 0)), height: size(d.dh) },
  ]
})

/**
 * 像素值 → CSS 长度（用于 **位置**：left/top）。
 *
 * 只挡非有限值（NaN / Infinity 会让整条 CSS 声明失效），**负数必须原样保留** ——
 * 扩展（outpaint）的框本来就要往外扩，左边/上边为负正是它的正常形态。
 *
 * 实测踩过的坑（用户报的"扩展全是 BUG"）：早先这里把负数夹成 0，于是往外拖西/北手柄时
 * 框的 left/top 被钉死在 0、只有宽高在长 —— 表现成"边框往右长、左边纹丝不动"，
 * 与"从左边往外扩"的预期正好相反。
 */
function px(n: number): string {
  return String(Number.isFinite(n) ? n : 0) + 'px'
}

/**
 * 像素值 → CSS 长度（用于 **尺寸**：width/height）。
 * 这里必须夹到非负：负宽高会让浏览器忽略整条声明（连位置一起失效），
 * 而尺寸为负只可能是中间态算错，不该渲染出来。
 */
function size(n: number): string {
  return String(Number.isFinite(n) && n > 0 ? n : 0) + 'px'
}

/** 框尺寸文案（媒体像素） */
const sizeLabel = computed(() => `${Math.round(rect.value.width)} × ${Math.round(rect.value.height)}`)

/** 手柄在图层的样式：按方向贴到框的角/边上 */
function handleStyle(dir: HandleDir): Record<string, string> {
  const f = frame.value
  const midX = f.x + f.width / 2
  const midY = f.y + f.height / 2
  switch (dir) {
    case 'nw': return { left: px(f.x), top: px(f.y), cursor: 'nwse-resize' }
    case 'n': return { left: px(midX), top: px(f.y), cursor: 'ns-resize' }
    case 'ne': return { left: px(f.x + f.width), top: px(f.y), cursor: 'nesw-resize' }
    case 'e': return { left: px(f.x + f.width), top: px(midY), cursor: 'ew-resize' }
    case 'se': return { left: px(f.x + f.width), top: px(f.y + f.height), cursor: 'nwse-resize' }
    case 's': return { left: px(midX), top: px(f.y + f.height), cursor: 'ns-resize' }
    case 'sw': return { left: px(f.x), top: px(f.y + f.height), cursor: 'nesw-resize' }
    case 'w': return { left: px(f.x), top: px(midY), cursor: 'ew-resize' }
    default: return {}
  }
}
</script>

<template>
  <div
    ref="rootEl"
    class="mfo nodrag nopan nowheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <!-- 画面之外：更深一档，表明这里没有画面 -->
    <div v-for="(style, i) in letterboxStyles" :key="'lb' + i" class="mfo-letterbox" :style="style" />

    <!-- 框外遮罩 -->
    <div v-for="(style, i) in shadeStyles" :key="'sh' + i" class="mfo-shade" :style="style" />

    <!-- 框本体：拖动即整体平移；三分构图线只作参考 -->
    <div class="mfo-frame" :style="frameStyle" @pointerdown="onPointerDown">
      <span class="mfo-size">{{ sizeLabel }}</span>
      <div class="mfo-grid" aria-hidden="true">
        <span class="mfo-grid-line mfo-grid-line--h" style="top: 33.333%" />
        <span class="mfo-grid-line mfo-grid-line--h" style="top: 66.666%" />
        <span class="mfo-grid-line mfo-grid-line--v" style="left: 33.333%" />
        <span class="mfo-grid-line mfo-grid-line--v" style="left: 66.666%" />
      </div>
    </div>

    <!-- 方形控制点（4 角；扩展另有 4 边）——纯图标按钮，title/aria-label 齐备 -->
    <button
      v-for="dir in dirs"
      :key="dir"
      type="button"
      class="mfo-handle"
      :style="handleStyle(dir)"
      :title="'拖动调整（' + dir + '）'"
      :aria-label="'拖动调整（' + dir + '）'"
      @pointerdown="onPointerDown($event, dir)"
    />
  </div>
</template>

<style scoped>
/* 数值照 docs/design/ui-style-guide.md：灰阶承载层级、青色只做强调、圆角阶梯、
   交互目标 ≥32px（控制点用命中区外扩达到）、动效 150-240ms + prefers-reduced-motion 降级。
   本组件只画媒体之上的编辑层；**操作按钮（确认/取消）不在这里** —— 按用户要求放在上下控制栏。 */
.mfo {
  position: absolute;
  /* 铺满壳给的浮层容器（那层与卡片同尺寸）——本组件的几何基准就是它自己的盒子，
     与卡片内容用的是同一套 object-contain 算法，所以框与画面严格对齐。 */
  inset: 0;
  pointer-events: none;
  touch-action: none;
  overflow: visible;
}

/* 画面之外的留白：最暗（这里压根没有画面） */
.mfo-letterbox {
  position: absolute;
  background: rgba(0, 0, 0, 0.72);
  pointer-events: none;
}

/* 画面内、框外：稍浅（用户仍看得见自己排除了什么） */
.mfo-shade {
  position: absolute;
  background: rgba(0, 0, 0, 0.52);
  pointer-events: none;
}

/* 框：白描边 + 柔影（对齐规范的柔影，不用硬黑边） */
.mfo-frame {
  position: absolute;
  box-sizing: border-box;
  pointer-events: auto;
  cursor: move;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.95),
    0 12px 36px rgba(0, 0, 0, 0.28);
}

/* 尺寸小标：贴在框左上角外侧一点，不挡画面 */
.mfo-size {
  position: absolute;
  left: 0;
  top: -24px;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(17, 24, 39, 0.82);
  color: #fff;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}

.mfo-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.mfo-grid-line {
  position: absolute;
  background: rgba(255, 255, 255, 0.45);
}
.mfo-grid-line--h {
  left: 0;
  right: 0;
  height: 1px;
}
.mfo-grid-line--v {
  top: 0;
  bottom: 0;
  width: 1px;
}

/* 控制点：**方形**（用户要求：控制端口是方形而不是圆形）、白底发丝边，10px 视觉 + ::before 外扩命中区 */
.mfo-handle {
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
  transform: translate(-50%, -50%);
}
/* 命中区外扩：视觉 10px，实际约 24px（触屏/缩放后也好按） */
.mfo-handle::before {
  content: '';
  position: absolute;
  inset: -7px;
}
.mfo-handle:hover {
  border-color: #0891b2;
}
.mfo-handle:focus-visible {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: 1px;
}

@media (prefers-reduced-motion: reduce) {
  .mfo-handle {
    transition: none !important;
  }
}
</style>
