<script setup lang="ts">
/**
 * AgentOrb —— 底栏那颗 Agent 圆球（表情会跟着鼠标/悬停变）。
 *
 * 来源：用户给的参考文件（一张「包子脸」HTML）—— 瞳孔跟随光标、悬停咧嘴、
 * 离开变惊讶。这里把它**移植成组件**，并做两处用户点名的改造：
 *
 *   ① **亮/暗双主题**：参考文件是写死的一套米黄配色（#fff4e0 / #ffe8c2 / #f6a07a…），
 *      在暗色画布上是一块突兀的亮斑。这里所有颜色一律换成 --ui-* 令牌 ——
 *      令牌本身按 html.dark 切换，所以**不需要一行 JS 判断主题**。
 *   ② **用主题色**：脸红、点缀、点亮态都走强调色（--ui-accent），
 *      于是这颗球跟全站的「青 = 激活」是同一套语言，而不是自带一个棕色系。
 *
 * 根节点是 **span 不是 button**：调用方（底栏）已经有自己的按钮（带 aria-label 与
 * tooltip），按钮里再套按钮是非法 HTML。本组件只负责「长什么样」，
 * 点击/无障碍交给外壳。
 */
import { onBeforeUnmount, onMounted, ref, useId } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 对话面板是否打开：亮一圈强调色描边（照原来按钮的 bg-panel-active 语义） */
    open?: boolean
  }>(),
  { open: false },
)

const rootRef = ref<HTMLElement | null>(null)
/** 同一页可能出现多颗球：渐变 id 必须带实例后缀，否则后一颗会覆盖前一颗的定义 */
const uid = useId()
const skinId = 'ao-skin-' + uid
const blushId = 'ao-blush-' + uid
const topId = 'ao-top-' + uid

/**
 * 四种嘴型（照参考文件）。
 * 用 path 的 d 做过渡 —— Chrome/Edge 支持，别的浏览器退化成瞬间切换（可接受）。
 */
const MOUTH = {
  neutral: 'M 46 71 L 54 71',
  surprised: 'M 47 71 Q 50 75, 53 71 Q 50 68, 47 71',
  smile: 'M 44 70 Q 50 76, 56 70',
  bigSmile: 'M 42 69 Q 50 79, 58 69',
} as const
type Expression = keyof typeof MOUTH

const expression = ref<Expression>('smile')
const hovering = ref(false)
/** 瞳孔偏移（px）：两颗眼珠一起动 */
const pupil = ref({ x: 0, y: 0 })

function setExpression(next: Expression): void {
  expression.value = next
}

/** 瞳孔跟随：离线近时几乎不动、越远越偏，最多 MAX_OFFSET */
const MAX_OFFSET = 4.2
function onMouseMove(e: MouseEvent): void {
  const el = rootRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const dx = e.clientX - (r.left + r.width / 2)
  const dy = e.clientY - (r.top + r.height / 2)
  const dist = Math.hypot(dx, dy)
  if (dist < 0.5) {
    pupil.value = { x: 0, y: 0 }
    return
  }
  // 15px 内基本不动，160px 外偏到头 —— 近处不抖、远处有跟随感
  const factor = Math.min(1, Math.max(0, (dist - 15) / (160 - 15)))
  const scale = (0.15 + 0.85 * factor) * MAX_OFFSET
  pupil.value = { x: (dx / dist) * scale, y: (dy / dist) * scale }
}

function onEnter(): void {
  hovering.value = true
  setExpression('bigSmile')
}
function onLeave(): void {
  hovering.value = false
  setExpression('surprised')
}
/** 鼠标离开整个文档：收成中性脸并把眼珠归位（照参考文件） */
function onDocLeave(): void {
  setExpression('neutral')
  pupil.value = { x: 0, y: 0 }
}
function onDocEnter(): void {
  if (!hovering.value) setExpression('surprised')
}

onMounted(() => {
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseleave', onDocLeave)
  document.addEventListener('mouseenter', onDocEnter)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseleave', onDocLeave)
  document.removeEventListener('mouseenter', onDocEnter)
})
</script>

<template>
  <span
    ref="rootRef"
    class="ao"
    :class="{ 'is-open': props.open, 'is-happy': expression === 'bigSmile' }"
    aria-hidden="true"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  >
    <!-- viewBox 从 y=10 起：球身圆心在用户坐标 cy=60（不是 50），照抄参考文件的
         "0 0 100 100" 会让包子在按钮里往下坠（下方留白明显少于上方）。
         把视口上边界下移 10，球身圆心正好落在 50% —— 真正居中。 -->
    <svg class="ao-svg" viewBox="0 10 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <!-- 球身：面板色 → 面板激活色 → 分隔线色。亮暗两套由令牌自己切，无需 JS。 -->
        <radialGradient :id="skinId" cx="50%" cy="30%" r="75%">
          <stop offset="0%" class="ao-skin-0" />
          <stop offset="55%" class="ao-skin-55" />
          <stop offset="100%" class="ao-skin-100" />
        </radialGradient>
        <!-- 顶部高光：用前景色做一点，暗色下才看得出球面弧光 -->
        <radialGradient :id="topId" cx="50%" cy="50%" r="50%">
          <stop offset="0%" class="ao-hl-0" />
          <stop offset="100%" class="ao-hl-100" />
        </radialGradient>
        <!-- 脸红：走**主题强调色**（不再是参考文件里的橘粉） -->
        <radialGradient :id="blushId" cx="50%" cy="50%" r="50%">
          <stop offset="0%" class="ao-blush-0" />
          <stop offset="100%" class="ao-blush-100" />
        </radialGradient>
      </defs>

      <!-- 球身 -->
      <ellipse class="ao-body" cx="50" cy="60" rx="34" ry="28" :fill="'url(#' + skinId + ')'" />
      <!-- 顶上那道褶（包子皮的感觉；用面板色压一层） -->
      <path class="ao-fold" d="M 20 52 Q 50 24, 80 52 Q 50 40, 20 52 Z" />
      <ellipse cx="50" cy="36" rx="11" ry="5.5" :fill="'url(#' + topId + ')'" />
      <circle class="ao-crumb" cx="50" cy="32" r="3.2" />
      <!-- 底部阴影 -->
      <ellipse class="ao-shadow" cx="50" cy="82" rx="26" ry="5" />

      <!-- 腮红：开心时更明显（CSS 管透明度） -->
      <ellipse class="ao-blush" cx="26" cy="64" rx="9.5" ry="6" :fill="'url(#' + blushId + ')'" />
      <ellipse class="ao-blush" cx="74" cy="64" rx="9.5" ry="6" :fill="'url(#' + blushId + ')'" />

      <!-- 眼睛整体（开心时眯一下） -->
      <g class="ao-eye-group">
        <circle class="ao-eye" cx="36" cy="54" r="9.5" />
        <circle class="ao-eye" cx="64" cy="54" r="9.5" />
        <circle class="ao-pupil" cx="36" cy="54" r="5.2" :transform="'translate(' + pupil.x + ',' + pupil.y + ')'" />
        <circle class="ao-pupil" cx="64" cy="54" r="5.2" :transform="'translate(' + pupil.x + ',' + pupil.y + ')'" />
        <!-- 高光：不跟着瞳孔走（贴在眼白上），像"反光"而不是"黑眼珠上的点" -->
        <circle class="ao-glint" cx="37.6" cy="52" r="1.9" />
        <circle class="ao-glint" cx="65.6" cy="52" r="1.9" />
        <circle class="ao-glint is-small" cx="34.6" cy="56" r="0.9" />
        <circle class="ao-glint is-small" cx="62.6" cy="56" r="0.9" />
      </g>

      <ellipse class="ao-nose" cx="50" cy="64" rx="2.4" ry="1.8" />
      <path class="ao-mouth" :d="MOUTH[expression]" />
      <!-- 舌头：只在咧嘴时出现 -->
      <path class="ao-tongue" d="M 46 72 Q 50 79, 54 72" />
    </svg>
  </span>
</template>

<style scoped>
/* 尺寸由外壳给（底栏那颗按钮是 48×48）；这里只负责铺满与"球感"。 */
.ao { position: relative; display: block; width: 100%; height: 100%; border-radius: 999px; overflow: hidden; }
.ao-svg { display: block; width: 100%; height: 100%; }

/* —— 球身颜色（令牌）：亮暗自动切换 —— */
/* 渐变 stop 用 CSS 属性而不是 SVG 属性：presentation attribute 里写 var() 不生效。 */
.ao-skin-0 { stop-color: var(--ui-chip, rgb(0 0 0 / 0.07)); }
.ao-skin-55 { stop-color: var(--ui-hover-soft, rgb(0 0 0 / 0.035)); }
.ao-skin-100 { stop-color: var(--ui-panel-active, #e8eaf0); }
/* 顶部那道柔光：用**面板色**打亮一小片 —— 亮色下是白高光、暗色下是比球身更浅的一层，
   两边都读成"球面被照亮"，不会变成一块脏斑。 */
.ao-hl-0 { stop-color: var(--ui-panel, #fff); stop-opacity: 0.55; }
.ao-hl-100 { stop-color: var(--ui-panel, #fff); stop-opacity: 0; }
.ao-blush-0 { stop-color: var(--ui-accent, #0891b2); stop-opacity: 0.55; }
.ao-blush-100 { stop-color: var(--ui-accent, #0891b2); stop-opacity: 0; }

.ao-fold { fill: var(--ui-panel, #fff); opacity: 0.45; }
.ao-crumb { fill: var(--ui-panel, #fff); opacity: 0.7; }
.ao-shadow { fill: var(--ui-line, #e2e5ea); opacity: 0.3; }
.ao-blush { transition: opacity 0.35s ease; opacity: 0.5; }
.ao.is-happy .ao-blush { opacity: 0.9; }

/* 眼白/瞳孔：亮色下"白底深珠"，暗色下自动变成"深底亮珠" —— 都靠令牌取反，天然有对比 */
.ao-eye { fill: var(--ui-panel, #fff); stroke: var(--ui-line, #e2e5ea); stroke-width: 1; }
.ao-pupil { fill: var(--ui-ink, #18202b); transition: transform 0.12s cubic-bezier(0.34, 1.56, 0.64, 1); }
.ao-glint { fill: var(--ui-panel, #fff); opacity: 0.95; }
.ao-glint.is-small { opacity: 0.8; }
.ao-nose { fill: var(--ui-accent, #0891b2); opacity: 0.55; }
.ao-mouth { fill: none; stroke: var(--ui-ink, #18202b); stroke-width: 2.6; stroke-linecap: round; transition: d 0.35s cubic-bezier(0.34, 1.2, 0.64, 1); }
.ao-tongue { fill: var(--ui-danger, #ef4444); opacity: 0; transform-origin: 50px 73px; transform: scaleY(0.6); transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.34, 1.2, 0.64, 1); }
.ao.is-happy .ao-tongue { opacity: 0.85; transform: scaleY(1); }
.ao-eye-group { transition: transform 0.3s cubic-bezier(0.34, 1.2, 0.64, 1); transform-origin: 50px 54px; }
.ao.is-happy .ao-eye-group { transform: scaleY(0.88); }

/* 打开态：强调色描边 —— 原来按钮是 bg-panel-active（只是变个底色），
   这里用一圈 accent 更明确，和全站「青 = 激活」一致。 */
.ao::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 999px;
  pointer-events: none;
  border: 2px solid transparent;
  transition: border-color 0.18s ease;
}
.ao.is-open::after { border-color: var(--ui-accent, #0891b2); }

/* 动效可关闭（UI 规范硬性要求） */
@media (prefers-reduced-motion: reduce) {
  .ao-pupil, .ao-blush, .ao-tongue, .ao-mouth, .ao-eye-group, .ao::after { transition: none; }
}
</style>
