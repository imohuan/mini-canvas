<script setup lang="ts">
/**
 * SettingsShell —— 设置面板的**外壳**（渲染层提供，所有设置"皮"共用）。
 *
 * 为什么外壳归宿主（而不是让每个皮各画一遍）：
 *   settingsPanel 是可替换槽（theme 单赢家）。若连遮罩、居中、✕、Esc、浮动窗口都由皮自己实现，
 *   "关闭"这件事就有 N 份实现：宿主想统一（a11y、关闭动画、窗口位置记忆）做不到，皮与皮之间也会漂移
 *   （历史上两个皮就因为 closeOnMask 默认值不同，一个能点遮罩关、一个不能）。
 *
 * 职责切分（方案二）：
 *   - 本外壳 = **最外层 Dialog**：遮罩 / 居中 / 盒子尺寸 / 标题栏 / ✕ / Esc / 点遮罩关闭 / 转浮动窗口 /
 *     拖拽 / 右下角 resize / 最小化成悬浮球。**不提供任何中间容器**。
 *   - 槽里的皮 = **中间层**：左导航 + 右侧设置项都归它（声明 props.settings 即可），不碰窗口级行为。
 *
 * 关闭通道：外壳 emit('close') → SettingsHost → ctx.emit('settings:ui-close') → 宿主收起面板。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 标题栏主标题 */
    title?: string
    /** 标题栏上方的小字 */
    eyebrow?: string
    /** 是否允许点遮罩 / 按 Esc 关闭（默认 true） */
    closeOnMask?: boolean
  }>(),
  { title: '设置', eyebrow: '偏好', closeOnMask: true },
)

const emit = defineEmits<{ (e: 'close'): void }>()

function close(): void {
  emit('close')
}
function onMaskClick(): void {
  if (props.closeOnMask) close()
}
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.closeOnMask) close()
}

// —— 浮动窗口模式：脱离遮罩，居中→绝对坐标，顶部可拖，右下可 resize，限制不出屏与最小尺寸 ——
const floating = ref(false)

// —— 最小化成悬浮球：只做"视觉缩小"动画，逻辑宽高始终钉在最小尺寸，故内容永不重排/变形 ——
/** 压缩动画时长（与 .psd-dialog-ball 的 transition 一致） */
const BALL_ANIM_MS = 240
/** 悬浮球直径 */
const BALL_SIZE = 40
/** 吸附后贴边的"长方形"尺寸 */
const BALL_SNAP_W = 7
const BALL_SNAP_H = 34
/** 悬浮球拖拽/吸附边缘的触发距离 */
const BALL_DRAG_THRESHOLD = 4
const BALL_SNAP_MARGIN = 18

const minimized = ref(false)
/** 压缩动画进行中（用于禁用过渡、避免动画期间被再次操作打断） */
const ballAnimating = ref(false)
/** 悬浮球当前是"吸附贴边"态（长方形）还是"自由浮动"态（圆形） */
const ballDocked = ref(false)
/** 吸附到哪一侧：-1 左 / 1 右 / 0 未吸附 */
const ballSide = ref<-1 | 0 | 1>(0)
const ballGeom = ref({ left: 0, top: 0 })

/** 复原动画的起点（球的位置）：窗口从球的位置/大小展开回自己 */
const animFromGeom = ref<{ left: number; top: number } | null>(null)
/**
 * 压缩动画期间，窗口这层"皮"停靠的矩形 = 最小化前那一刻的窗口矩形。
 * 动画只走 transform，皮的布局尺寸全程不变，所以从"用户看到的窗口"一帧不跳地缩成球。
 */
const ballFromBox = ref<WinGeom | null>(null)
let ballAnimTimer: ReturnType<typeof setTimeout> | null = null

const MIN_W = 520
const MIN_H = 360
const DEFAULT_W = typeof window !== 'undefined' ? Math.min(920, window.innerWidth - 64) : 920
const DEFAULT_H = typeof window !== 'undefined' ? Math.min(Math.floor(0.68 * window.innerHeight), 780) : 780

interface WinGeom { left: number; top: number; width: number; height: number }
/** 进入浮动模式时一次性拍下当前居中几何（用 dialog 当时的实际渲染尺寸） */
const winGeom = ref<WinGeom>({ left: 0, top: 0, width: DEFAULT_W, height: DEFAULT_H })
/**
 * 最小化前用户自己定下的窗口宽高（拖右下角改过的）。
 * 最小化期间窗口逻辑尺寸必须钉死在 MIN_W×MIN_H（缩放动画靠它算比例），
 * 所以"用户尺寸"只能单独存一份，点球展开时用它还原——而不是永远回到 MIN。
 */
let restoreSize: { width: number; height: number } | null = null
const dialogEl = ref<HTMLElement | null>(null)

/** 浮动窗口与屏幕四边保留的呼吸空隙 */
const VIEWPORT_PADDING = 10

function clampGeom(g: WinGeom): WinGeom {
  const vw = window.innerWidth
  const vh = window.innerHeight
  // 可用区域 = 视口去掉四周 padding；窗口不超出这块区域，四边就总留 10px
  const availW = Math.max(MIN_W, vw - VIEWPORT_PADDING * 2)
  const availH = Math.max(MIN_H, vh - VIEWPORT_PADDING * 2)
  const w = Math.max(MIN_W, Math.min(g.width, availW))
  const h = Math.max(MIN_H, Math.min(g.height, availH))
  const maxL = vw - w - VIEWPORT_PADDING
  const maxT = vh - h - VIEWPORT_PADDING
  return {
    // 下界同样收紧到 padding，窗口贴边时也是留 10px 而不是贴着 0
    left: Math.min(Math.max(VIEWPORT_PADDING, g.left), Math.max(VIEWPORT_PADDING, maxL)),
    top: Math.min(Math.max(VIEWPORT_PADDING, g.top), Math.max(VIEWPORT_PADDING, maxT)),
    width: w,
    height: h,
  }
}

function captureCurrentGeom(): WinGeom {
  const el = dialogEl.value
  if (!el) return winGeom.value
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

function enterFloating(): void {
  winGeom.value = clampGeom(captureCurrentGeom())
  floating.value = true
}
function exitFloating(): void {
  floating.value = false
}
function toggleFloating(): void {
  if (floating.value) exitFloating()
  else enterFloating()
}

// —— 最小化 / 复原：压缩成悬浮球 ——
/** 球心落在窗口左上角：锚点固定为左上角，不动球时反复最小化/展开，窗口位置才保持一致 */
function ballAtCorner(g: WinGeom): { left: number; top: number } {
  return { left: g.left - BALL_SIZE / 2, top: g.top - BALL_SIZE / 2 }
}

function minimizeToBall(): void {
  if (minimized.value || ballAnimating.value) return
  if (!floating.value) enterFloating() // 弹窗态点最小化：先转浮动窗口再压缩
  // 拍下"用户此刻的窗口宽高"：全部收起前它是 winGeom 里的真实值（窗口模式所见即所得）
  restoreSize = { width: winGeom.value.width, height: winGeom.value.height }
  ballFromBox.value = { ...winGeom.value }
  ballGeom.value = ballAtCorner(winGeom.value)
  ballDocked.value = false
  ballSide.value = 0
  // 最小化态：窗口立刻切到"最小尺寸 + 球位置"，由 dialogStyle 持续施加缩放；
  // transition 会把这次的 scale 从 1 补间到球的大小，动画期间布局尺寸始终不变。
  minimized.value = true
  ballAnimating.value = true
  winGeom.value = {
    // 与 restoreFromBall 用同一套锚点，保证"最小化 → 原位展开"严格可逆
    left: ballGeom.value.left + ballAnchorOf().x,
    top: ballGeom.value.top + ballAnchorOf().y,
    width: MIN_W,
    height: MIN_H,
  }
  if (ballAnimTimer !== null) clearTimeout(ballAnimTimer)
  ballAnimTimer = setTimeout(() => {
    ballAnimTimer = null
    ballAnimating.value = false
    ballFromBox.value = null
    // 落在边缘附近则直接吸附贴边
    maybeDock()
  }, BALL_ANIM_MS)
}

function restoreFromBall(): void {
  if (!minimized.value || ballAnimating.value) return
  ballFromBox.value = null
  // 尺寸还原：用最小化前拍下的用户宽高（拖过右下角就是拖完的值），
  // 而不是永远弹回 MIN——最小化期间 winGeom 被钉在 MIN 只是缩放动画需要。
  const size = restoreSize
  winGeom.value = clampGeom({
    // 锚点反推：最小化时窗口左上角被钉在"球左上角 + 锚点偏移"处，
    // 展开就按同一套偏移把左上角取回来，球没被拖过 ⇒ 窗口原地不动。
    left: ballGeom.value.left + ballAnchorOf().x,
    top: ballGeom.value.top + ballAnchorOf().y,
    width: size ? size.width : winGeom.value.width,
    height: size ? size.height : winGeom.value.height,
  })
  // 复原：窗口从球的位置/大小起步展开（补间由 .psd-dialog 的 transition 完成）。
  // 起点位置拍下来存进 animFromGeom，动画结束后再清掉、并把窗口摆回自己的正常几何。
  animFromGeom.value = { left: winGeom.value.left, top: winGeom.value.top }
  ballAnimating.value = true
  minimized.value = false
  if (ballAnimTimer !== null) clearTimeout(ballAnimTimer)
  ballAnimTimer = setTimeout(() => {
    ballAnimTimer = null
    ballAnimating.value = false
    animFromGeom.value = null
    ballDocked.value = false
    ballSide.value = 0
  }, BALL_ANIM_MS)
}

/** 松手后判断是否贴边：靠近左右边缘则吸附成竖长条 */
function maybeDock(): void {
  if (!minimized.value) return
  const vw = window.innerWidth
  const cx = ballGeom.value.left + BALL_SIZE / 2
  if (cx <= BALL_SNAP_MARGIN) {
    ballSide.value = -1
    ballDocked.value = true
  } else if (cx >= vw - BALL_SNAP_MARGIN) {
    ballSide.value = 1
    ballDocked.value = true
  } else {
    ballSide.value = 0
    ballDocked.value = false
  }
  applyBallGeom()
}

/**
 * 锚点 = 球的视觉矩形中心相对其左上角的偏移（圆球是 20/20，贴边条是 3.5/17）。
 * 最小化与展开都取同一个锚点当作"窗口左上角所在处"，两边才严格可逆。
 */
function ballAnchorOf(): { x: number; y: number } {
  const w = ballDocked.value ? BALL_SNAP_W : BALL_SIZE
  const h = ballDocked.value ? BALL_SNAP_H : BALL_SIZE
  return { x: w / 2, y: h / 2 }
}

/**
 * 压缩/展开缩放的不动点（相对窗口盒子左上角），a = 球矩形中心偏移，s = "球大小那一端"的缩放比。
 * 窗口盒子停在球的锚点上，而球矩形是在锚点左上方伸出去的，故不动点要落到盒子外。
 * 推导：视觉矩形左边缘 = 盒子左边缘 + o·(1-s)，令它在 s 处正好等于球左边缘 → o = -a/(1-s)。
 */
function ballScaleOrigin(a: { x: number; y: number }, sx: number, sy: number): string {
  const ox = sx >= 0.999 ? 0 : -a.x / (1 - sx)
  const oy = sy >= 0.999 ? 0 : -a.y / (1 - sy)
  return ox + 'px ' + oy + 'px'
}

/** 把 ballGeom 同步到窗口几何（吸附态用长方形尺寸，自由态用方形） */
function applyBallGeom(): void {
  const w = ballDocked.value ? BALL_SNAP_W : BALL_SIZE
  const h = ballDocked.value ? BALL_SNAP_H : BALL_SIZE
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = ballGeom.value.left
  if (ballSide.value === -1) left = 0
  else if (ballSide.value === 1) left = vw - w
  // 竖直方向夹在视口内（拖动越界时按中心偏移收回）
  const top = Math.min(Math.max(0, ballGeom.value.top), Math.max(0, vh - h))
  ballGeom.value = { left, top }
  // 吸附把球水平钳到边缘后，锚点变成"贴边后的那条分界线"，
  // 所以这里要按同一套偏移重钉窗口左上角，否则展开时窗口会偏回吸附前的位置。
  // 窗口逻辑尺寸恒为最小尺寸，视觉尺寸由 .psd-dialog 的缩放决定。
  winGeom.value = {
    left: left + ballAnchorOf().x,
    top: top + ballAnchorOf().y,
    width: MIN_W,
    height: MIN_H,
  }
}

// 悬浮球拖拽：按下 → 超过阈值才进入拖拽（否则算点击=复原）→ 松手只做吸附，不展开
// 监听挂在 window 上（球很小，鼠标很容易跑出球外），并在 onMounted 一次性注册，
// 不能挂在 mousedown 里——真实点击（CDP/自动化）不一定补发 mouseup 给新注册的监听。
let ballDragging = false
let ballDragMoved = false
/**
 * 刚拖完这一次的标记：鼠标在球上按下、拖动、松手，浏览器会在 mouseup 之后再补一个 click。
 * 那个 click 是"拖拽的收尾"，不是用户想展开；靠它把随后的 click 吞掉一次，
 * 否则拖完球会自己弹开。
 */
let ballDragJustEnded = false
let ballDragOffX = 0
let ballDragOffY = 0
let ballPressX = 0
let ballPressY = 0
function onBallMouseDown(e: MouseEvent): void {
  if (!minimized.value || ballAnimating.value) return
  ballDragging = true
  ballDragMoved = false
  ballPressX = e.clientX
  ballPressY = e.clientY
  ballDragOffX = e.clientX - ballGeom.value.left
  ballDragOffY = e.clientY - ballGeom.value.top
  e.preventDefault()
}
function onBallMouseMove(e: MouseEvent): void {
  if (!ballDragging) return
  if (!ballDragMoved) {
    // 阈值相对"按下那一点"算，不能用每帧都在变的 ballGeom
    const moved = Math.abs(e.clientX - ballPressX) + Math.abs(e.clientY - ballPressY)
    if (moved < BALL_DRAG_THRESHOLD) return
    ballDragMoved = true
    // 开始拖动即脱离吸附态（恢复成圆球跟随鼠标）
    ballDocked.value = false
    ballSide.value = 0
  }
  ballGeom.value = { left: e.clientX - ballDragOffX, top: e.clientY - ballDragOffY }
  applyBallGeom()
}
function onBallMouseUp(): void {
  if (!ballDragging) return
  ballDragging = false
  if (!ballDragMoved) {
    restoreFromBall() // 没移动 = 点击 → 复原窗口
    return
  }
  // 拖动结束：只落位/吸附，绝不展开；并吞掉紧随其后的那次 click
  ballDragJustEnded = true
  setTimeout(() => { ballDragJustEnded = false }, 0)
  maybeDock()
}
/**
 * 唯一的"点击展开"入口。mouseup 已经处理过普通点击（那次不会再走到这里的前提不成立，
 * 所以两处都要防重），这里主要兜住"真实点击没有 mouseup"的情况。
 */
function onBallClick(): void {
  if (ballDragging) return
  if (ballDragJustEnded) return // 这次 click 是拖拽收尾，不展开
  restoreFromBall()
}

// 拖拽：仅头部，按下鼠标 → 记偏移 → mousemove 更新 left/top，mouseup 解绑
let dragging = false
let dragOffX = 0
let dragOffY = 0
function onHeadMouseDown(e: MouseEvent): void {
  if (!floating.value) return
  // 拖手柄只允许"非按钮"区域触发：点到头部内的 button / interactive 不开始拖
  const t = e.target as HTMLElement | null
  if (t && t.closest('button, a, input, textarea, select, [role="button"]')) return
  dragging = true
  dragOffX = e.clientX - winGeom.value.left
  dragOffY = e.clientY - winGeom.value.top
  e.preventDefault()
}
function onDocMouseMove(e: MouseEvent): void {
  if (!dragging) return
  winGeom.value = clampGeom({
    ...winGeom.value,
    left: e.clientX - dragOffX,
    top: e.clientY - dragOffY,
  })
}
function onDocMouseUp(): void {
  dragging = false
}

// resize：右下角手柄，按下 → 记初始几何 → mousemove 改 width/height，mouseup 解绑
let resizing = false
let resizeStartX = 0
let resizeStartY = 0
let resizeStartGeom: WinGeom = { left: 0, top: 0, width: MIN_W, height: MIN_H }
function onResizeMouseDown(e: MouseEvent): void {
  if (!floating.value) return
  resizing = true
  resizeStartX = e.clientX
  resizeStartY = e.clientY
  resizeStartGeom = { ...winGeom.value }
  e.preventDefault()
  e.stopPropagation()
}
function onResizeMouseMove(e: MouseEvent): void {
  if (!resizing) return
  const dx = e.clientX - resizeStartX
  const dy = e.clientY - resizeStartY
  winGeom.value = clampGeom({
    ...resizeStartGeom,
    width: resizeStartGeom.width + dx,
    height: resizeStartGeom.height + dy,
  })
}
function onResizeMouseUp(): void {
  resizing = false
}

// 浏览器窗口尺寸变化时把浮动窗拽回可视区
function onWindowResize(): void {
  if (floating.value) winGeom.value = clampGeom(winGeom.value)
}

const dialogStyle = computed<Record<string, string>>(() => {
  if (!floating.value) return {}
  const g = winGeom.value
  // 窗口本体的两份职责：
  //  1) 最小化态 = "压缩动画的一层皮"：缩放成球的大小做补间，动画播完整块隐去
  //     （真正代表球的是独立的 .psd-ball，形状和图标都更准）。
  //  2) 复原态   = 从球的位置/尺寸起步，由 transition 补间回正常运行尺寸。
  const start = animFromGeom.value
  const style: Record<string, string> = {
    position: 'fixed',
    left: (start ? start.left : g.left) + 'px',
    top: (start ? start.top : g.top) + 'px',
    width: (minimized.value ? MIN_W : g.width) + 'px',
    height: (minimized.value ? MIN_H : g.height) + 'px',
    animation: 'none',
  }
  if (minimized.value) {
    const w = ballDocked.value ? BALL_SNAP_W : BALL_SIZE
    const h = ballDocked.value ? BALL_SNAP_H : BALL_SIZE
    // 压缩动画期间，这层皮就是"最小化前那一刻的窗口矩形"，动画结束（已隐去）再切回最小尺寸。
    const src = ballAnimating.value && ballFromBox.value ? ballFromBox.value : { left: g.left, top: g.top, width: MIN_W, height: MIN_H }
    style.left = src.left + 'px'
    style.top = src.top + 'px'
    style.width = src.width + 'px'
    style.height = src.height + 'px'
    const sx = w / src.width
    const sy = h / src.height
    style.transformOrigin = ballScaleOrigin(ballAnchorOf(), sx, sy)
    style.transform = 'scale(' + sx + ', ' + sy + ')'
    style.borderRadius = ballDocked.value ? '4px' : '999px'
    // 压缩动画结束后窗口本体彻底隐去，露出下面的圆球
    if (!ballAnimating.value) style.opacity = '0'
  } else if (start) {
    // 复原第一帧：窗口已切到还原后的宽高，但视觉上仍停在球的大小；
    // 下一帧 transition 把它补间回 1:1（此时球被盖在下面，观感就是从球里长出来）
    const w = ballDocked.value ? BALL_SNAP_W : BALL_SIZE
    const h = ballDocked.value ? BALL_SNAP_H : BALL_SIZE
    const sx = w / g.width
    const sy = h / g.height
    // left/top 已经是"展开后的最终位置"，首帧视觉矩形正好压在球上，
    // 随后一路长成完整窗口，全程无位移。
    style.transformOrigin = ballScaleOrigin(ballAnchorOf(), sx, sy)
    style.transform = 'scale(' + sx + ', ' + sy + ')'
    style.opacity = '0'
  }
  return style
})

/** 悬浮球定位：直接以视觉尺寸（圆球/贴边条）摆放，不再依赖窗口缩放 */
const ballStyle = computed<Record<string, string>>(() => {
  const w = ballDocked.value ? BALL_SNAP_W : BALL_SIZE
  const h = ballDocked.value ? BALL_SNAP_H : BALL_SIZE
  return {
    left: ballGeom.value.left + 'px',
    top: ballGeom.value.top + 'px',
    width: w + 'px',
    height: h + 'px',
  }
})

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('mousemove', onDocMouseMove)
  window.addEventListener('mouseup', onDocMouseUp)
  window.addEventListener('mousemove', onResizeMouseMove)
  window.addEventListener('mouseup', onResizeMouseUp)
  window.addEventListener('mousemove', onBallMouseMove)
  window.addEventListener('mouseup', onBallMouseUp)
  window.addEventListener('resize', onWindowResize)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('mousemove', onDocMouseMove)
  window.removeEventListener('mouseup', onDocMouseUp)
  window.removeEventListener('mousemove', onResizeMouseMove)
  window.removeEventListener('mouseup', onResizeMouseUp)
  window.removeEventListener('mousemove', onBallMouseMove)
  window.removeEventListener('mouseup', onBallMouseUp)
  window.removeEventListener('resize', onWindowResize)
  if (ballAnimTimer !== null) clearTimeout(ballAnimTimer)
})
</script>

<template>
  <Teleport to="body">
    <div
      class="psd-mask"
      :class="{ 'psd-mask-hidden': floating }"
      @click="onMaskClick"
    >
      <div
        ref="dialogEl"
        class="psd-dialog"
        :class="{
          'psd-dialog-floating': floating,
          'psd-dialog-resizing': resizing,
          'psd-dialog-ball': minimized,
        }"
        role="dialog"
        aria-modal="true"
        :style="dialogStyle"
        @click.stop
      >
        <!-- 弹窗头：浮动模式下整条可拖（点到按钮除外） -->
        <div class="psd-head" :class="{ 'psd-head-draggable': floating }" @mousedown="onHeadMouseDown">
          <div class="psd-title-block">
            <span class="psd-eyebrow">{{ eyebrow }}</span>
            <h2 class="psd-title">{{ title }}</h2>
          </div>
          <div class="psd-head-actions">
            <button
              class="psd-icon-btn"
              aria-label="最小化为悬浮球"
              title="最小化为悬浮球"
              @click="minimizeToBall"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 12h12"/>
              </svg>
            </button>
            <button
              class="psd-icon-btn"
              :aria-label="floating ? '回到弹窗' : '转为悬浮窗口'"
              :title="floating ? '回到弹窗' : '转为悬浮窗口'"
              @click="toggleFloating"
            >
              <!-- 浮动模式：显示"两个对向箭头 / 收回"图标；弹窗模式：显示"外向箭头"图标 -->
              <svg v-if="floating" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 3v6H3"/><path d="M3 9l6-6"/>
                <path d="M15 21v-6h6"/><path d="M21 15l-6 6"/>
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 3h6v6"/><path d="M9 21H3v-6"/>
                <path d="M21 3l-7 7"/><path d="M3 21l7-7"/>
              </svg>
            </button>
            <button class="psd-close" aria-label="关闭" title="关闭" @click="close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 6l12 12"/><path d="M18 6L6 18"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- 中间层（左导航 + 右侧内容）完全由槽里的皮自己渲染：外壳**不提供任何中间容器**。
             于是「左侧边栏属于设置界面」在结构上就成立 —— 它不在外壳的 DOM 里，只是视觉上落在框内。
             皮自己的根元素直接作为 .psd-dialog 的弹性子项占满剩余高度（flex:1 + min-height:0）。 -->
        <slot />

        <!-- 右下角 resize 把手：仅浮动模式显示，命中区域扩大到一个 16x16 隐形方块 -->
        <div
          v-if="floating"
          class="psd-resize-handle"
          aria-hidden="true"
          @mousedown="onResizeMouseDown"
        >
          <svg viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <path d="M3 13l10-10"/><path d="M7 13l6-6"/><path d="M11 13l2-2"/>
          </svg>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 悬浮球：独立挂在 body 上（不在 dialog 内），才能是一颗尺寸准确的圆球 + 图标；
       承担点击展开、拖拽移动、靠边吸附 -->
  <Teleport to="body">
    <div
      v-if="minimized || (ballAnimating && animFromGeom)"
      class="psd-ball"
      :class="{ 'is-docked': ballDocked, 'is-leaving': !minimized }"
      role="button"
      tabindex="0"
      aria-label="展开设置窗口"
      :title="ballDocked ? '展开设置窗口' : '点击展开设置窗口，拖动可移动'"
      :style="ballStyle"
      @mousedown="onBallMouseDown"
      @click="onBallClick"
      @keydown.enter.prevent="restoreFromBall"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3.2"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    </div>
  </Teleport>
</template>

<style scoped>
.psd-mask {
  position: fixed;
  inset: 0;
  /* z-index 走画布层叠带变量（--layer-modal，唯一事实源见 canvas-render/contracts/layers.ts） */
  z-index: var(--layer-modal, 100000);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: var(--ui-scrim-soft, linear-gradient(180deg, rgba(15, 23, 42, 0.06), rgba(15, 23, 42, 0.18)));
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  font-family: system-ui, 'Microsoft YaHei', sans-serif;
}

/* 浮动模式下：蒙版透明、不可点击、不拦截事件，dialog 自己 fixed 定位 */
.psd-mask-hidden {
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  pointer-events: none;
}
.psd-mask-hidden > * {
  pointer-events: auto;
}

.psd-dialog {
  width: min(920px, 100%);
  height: min(68vh, 780px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  border-radius: 16px;
  background: var(--ui-panel, #fff);
  box-shadow: var(--ui-shadow-md, 0 20px 40px rgba(0, 0, 0, 0.08));
  color: var(--ui-ink, #374151);
  font-size: 13px;
  animation: psd-pop-in 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
  /* 给右下角 resize 把手提供定位上下文；浮动模式由内联 style 覆盖为 fixed */
  position: relative;
  /* 压缩/复原动画：只让 transform 走过渡（width/height 在同一帧瞬时切换，不参与动画）——
     这样动画过程中不存在"中间宽度"，文字绝不会因为过窄而换行，UI 不会变形 */
  transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1), border-radius 0.24s ease;
}

/* 浮动模式：dialog 由内联 style 给 left/top/width/height，自身不再走 flex 居中 */
.psd-dialog-floating {
  animation: none;
  border-radius: 12px;
  box-shadow: var(--ui-shadow-lg, 0 24px 60px rgba(0, 0, 0, 0.18));
}

/* 悬浮球：一颗真圆球（独立元素，尺寸即视觉尺寸，不靠缩放），带齿轮图标 */
.psd-ball {
  position: fixed;
  /* 必须高于 .psd-mask(--layer-modal)，否则被最小化时残留的 dialog 层盖住点不到 */
  z-index: var(--layer-modal-top, 100001);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  /* 悬浮球：渐变从强调色两档取（用户改强调色后整个球跟着变），不写死青绿 */
  background: linear-gradient(145deg, var(--ui-accent-hover, #0e7490), var(--ui-accent, #0891b2));
  /* inset 高光是镜面高光，恒白半透明（不属主题语义色） */
  /* 主题色白名单: 镜面高光恒白半透明 */
  box-shadow: var(--ui-shadow-md, 0 10px 26px rgba(8, 145, 178, 0.4)), inset 0 1px 0 rgb(255 255 255 / 0.25);
  color: var(--ui-primary-ink, #fff);
  cursor: grab;
  user-select: none;
  /* 出现/消失的淡入淡出（尺寸由 transform 之外的 width/height 决定，不参与动画） */
  animation: psd-ball-in 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.psd-ball:active {
  cursor: grabbing;
}

.psd-ball svg {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  /* 图标不参与命中测试：否则鼠标压在齿轮上时 target 是 svg，
     父级的 mousedown 虽然还能冒泡，但光标/拖拽手感会不统一 */
  pointer-events: none;
  transition: width 0.2s ease, height 0.2s ease, opacity 0.2s ease;
}

/* 吸附成贴边竖长条：椭圆的球变窄，图标转 90° 并缩小，居中贴合长条 */
.psd-ball.is-docked {
  border-radius: 4px;
  box-shadow: var(--ui-shadow-md, 0 4px 14px rgba(8, 145, 178, 0.35));
  animation: none;
}

.psd-ball.is-docked svg {
  width: 5px;
  height: 5px;
  opacity: 0;
  transform: rotate(90deg);
}

/* 复原时球要"溶解"进正在展开的窗口：淡出 + 放大，盖住交接的瞬间 */
.psd-ball.is-leaving {
  opacity: 0;
  transform: scale(1.6);
  pointer-events: none;
  transition: opacity 0.24s ease, transform 0.24s ease;
}

.psd-ball:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 2px;
}

@keyframes psd-ball-in {
  from {
    transform: scale(0.6);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

/* resize 进行中禁用文本选中，鼠标全局呈现 nwse-resize */
.psd-dialog-resizing,
.psd-dialog-resizing * {
  cursor: nwse-resize !important;
  user-select: none;
}

/* 最小化（悬浮球）态：窗口本体只是压缩动画的一层皮 —— 动画播完由内联 opacity:0 隐去，
   真正露出的球是独立的 .psd-ball。这里必须关掉指针事件：
   否则这块"隐形的 520×360 大块"会盖在球上面，把所有点击/拖拽全吃掉。 */
.psd-dialog-ball {
  background: linear-gradient(145deg, var(--ui-accent-hover, #0e7490), var(--ui-accent, #0891b2));
  border-color: color-mix(in srgb, var(--ui-accent, #0891b2) 50%, transparent);
  box-shadow: var(--ui-shadow-md, 0 10px 26px rgba(8, 145, 178, 0.4));
  overflow: hidden;
  pointer-events: none;
}

/* 最小化时窗口本体整块隐去（含标题栏与皮渲染的中间层） */
.psd-dialog-ball > * {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease;
}

.psd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 6px 12px;
  /* 标题栏与中间层之间留 8px：原先由中间容器自己的 padding-top 提供 */
  margin-bottom: 8px;
  border-bottom: 1px solid var(--ui-line-soft, rgba(0, 0, 0, 0.05));
  flex-shrink: 0;
}

/* 浮动模式：整条头部都是拖手柄；点按钮时由 @mousedown 内做目标检测放过点击 */
.psd-head-draggable {
  cursor: move;
  user-select: none;
}

.psd-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.psd-title-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 4px;
}

.psd-eyebrow {
  color: var(--ui-ink-mute, #9ca3af);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.psd-title {
  margin: 0;
  color: var(--ui-ink, #111827);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.2;
}

.psd-close {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: var(--ui-veil, rgba(0, 0, 0, 0.04));
  color: var(--ui-ink-dim, #6b7280);
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}

.psd-close svg {
  width: 16px;
  height: 16px;
}

.psd-close:hover {
  background: var(--ui-chip, rgba(0, 0, 0, 0.08));
  color: var(--ui-danger, #ef4444);
}

/* 头部"转浮动/回弹窗"图标按钮：与关闭按钮同尺寸、同底色，仅 hover 色不同 */
.psd-icon-btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: var(--ui-veil, rgba(0, 0, 0, 0.04));
  color: var(--ui-ink-dim, #6b7280);
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}

.psd-icon-btn svg {
  width: 16px;
  height: 16px;
}

.psd-icon-btn:hover {
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.12));
  color: var(--ui-accent, #0891b2);
}

/* 右下角 resize 把手：贴角放一个 16x16 图标 + 隐形放大命中区 */
.psd-resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  padding: 0;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  color: var(--ui-ink-mute, #9ca3af);
  cursor: nwse-resize;
  /* 命中区向右下扩展到 18px，方便抓 */
  box-sizing: content-box;
  margin: 0;
  z-index: 2;
}

.psd-resize-handle:hover {
  color: var(--ui-accent, #0891b2);
}


/* ============ 动画 ============ */
@keyframes psd-pop-in {
  from {
    opacity: 0;
    transform: scale(0.94) translateY(-4px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .psd-dialog {
    animation: none !important;
    transition: none !important;
  }
}
</style>
