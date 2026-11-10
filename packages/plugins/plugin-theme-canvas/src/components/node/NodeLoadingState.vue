<script setup lang="ts">
/**
 * NodeLoadingState —— 节点卡片的**默认加载态**（默认主题的画布半边提供，节点壳直接使用）。
 *
 * 视觉来源：底部状态栏原本那套「流光扰动」任务加载 UI —— 不透明底色 + 3 个缓慢游走的
 * 模糊光斑 + 中间超大百分比 + 下方一行阶段文案，右上角一个耗时小胶囊。
 * 现在把它收成通用件，任务执行、视频帧图、视频加载、后台裁剪/剪辑都共用这一只。
 *
 * 归属（用户 2026-11-09 明确）：这是**节点壳的一部分**，不是某个业务插件私有的件。
 * NodeCardShell 直接渲染它，所以图片 / 视频 / 文本 / 可视化所有节点类型都自动拥有加载态，
 * 不依赖底部状态栏插件是否装、是否启用。
 * 视频内容里那几处（帧图加载、裁剪中胶囊）也直接 import 本文件复用同一份实现。
 *
 * 两个形态：
 * - `fill`（默认）：盖满最近的定位容器（节点内容区 / 预览舞台），整块任务加载态；
 * - `chip`：一行小胶囊（高 28px），塞进上下状态栏里表示「这一格正在处理」，不挡画面。
 *
 * 配色：默认跟随 `<html class="dark">` 切亮/暗两套；`surface="media"` 用于视频画面内部
 * （恒深色底，与视频的黑边同口径，不随应用主题变白闪一下）。
 *
 * 不挡交互：根 `pointer-events: none`，只有 `#action` 插槽里的按钮自己接收指针 ——
 * 加载期间节点照样能拖、能选中。
 *
 * 分档（用户要求）：加载态长在所有节点上，缩小时不该还画一整片大字。按画布缩放分三档，
 * 阈值来自全局设置 nodeLoadingTier2Zoom / nodeLoadingTier3Zoom（图片 / 视频 / 可视化共用），
 * 规则在 @mini-canvas/theme-contract 的 nodeLoadingTier：
 * - 第 1 档：完整（状态词 + 耗时 + 大百分比 + 文案 + 取消按钮）；
 * - 第 2 档：精简（去耗时、字号小一号，其余保留）；
 * - 第 3 档：极简（只留中心数字 / 光圈，不写状态词与文案）。
 *
 * 档位由画布缩放决定；容器很小时（例如 108px 的小卡片）另有一档「紧凑」只降字号，
 * 两者叠加取更省的那个，保证字号不会把文案挤没。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  NODE_LOADING_TIER_PREFIX,
  nodeLoadingTierKeys,
  readNodeLoadingTiers,
  resolveNodeLoadingTier,
  type NodeLoadingTierConfig,
} from '@mini-canvas/theme-contract'
import { useCanvasRender } from '@mini-canvas/canvas-render'

const props = withDefaults(
  defineProps<{
    /** `fill` 盖满容器（默认）；`chip` 一行小胶囊（状态栏/按钮旁用） */
    variant?: 'fill' | 'chip'
    /** 加载中 / 失败（失败只换文案与配色，不做第二套版式） */
    tone?: 'loading' | 'error'
    /** 卡片主题（跟随亮暗）还是视频画面（恒深色） */
    surface?: 'card' | 'media'
    /** 左上角状态词；缺省按 tone 给「生成中」/「执行失败」 */
    label?: string
    /** 0-100；`null` = 不确定态（显示旋转的 SVG 图标，不编一个假数字） */
    percent?: number | null
    /**
     * 大数字（不设上限）。与 `suffix` 拼起来显示，例如 `20000` + `tokens`。
     * 用户 2026-11-10：进度不一定是百分比 —— token 数会超过 100，不能钳。
     * 传了 `progressText` 时以它为准（见下）。
     */
    value?: number | null
    /** 数字后缀（默认 `%`）；token 这类传 `tokens`。没有 `value` 时不显示 */
    suffix?: string
    /**
     * 整段进度文案（优先于 value + suffix）。
     * 想让加载层显示任意说法时用它 —— 例如「已接收 1.2k tokens」。
     */
    progressText?: string
    /**
     * 正在返回的一小段文本（用户 2026-11-10：「实时流输出的滑动文本效果」）。
     * 只会显示尾部十几二十个字，不是整篇 —— 整篇在节点正文里。
     */
    streamTail?: string
    /** 下方那行阶段文案 */
    message?: string
    /** 只有失败态用：下一行小字（告诉用户接下来能做什么） */
    hint?: string
    /** 计时起点（ms）。给了才在右上角显示已耗时；视频帧图这类瞬时加载不用给 */
    startedAt?: number
    /**
     * 已产出量（文本对话用）：加载中显示「已输出 N 字 · ≈M tokens」。
     * 这只是**过程信息**，不进作品、不进历史 —— 用户 2026-11-10 的口径。
     */
    stats?: { chars?: number; tokens?: number }
  }>(),
  {
    variant: 'fill',
    tone: 'loading',
    surface: 'card',
    label: '',
    percent: null,
    message: '',
    hint: '',
    startedAt: 0,
    suffix: '%',
    progressText: '',
    streamTail: '',
  },
)

const rootEl = ref<HTMLElement | null>(null)

/**
 * 全局档位：读阈值 + 跟着设置变化，并跟随画布缩放算出当前档位。
 *
 * 为什么这只件自己读、而不是让宿主传进来：它挂在每个节点的覆盖层里，
 * 让所有调用方都记得接线等于逼大家抄一遍；自己读一处，以后加节点类型也不用改。
 * 单测 / 极简宿主里拿不到渲染上下文时退回默认阈值，不抛错。
 */
let flow: { viewport?: { value?: { zoom?: number } } } | undefined
let settingsSvc:
  | {
      get?(key: string): unknown
      onChange?(cb: (key: string, value: unknown) => void): { dispose(): void }
    }
  | undefined
try {
  const render = useCanvasRender()
  flow = render.flow as unknown as typeof flow
  settingsSvc = render.ctx.tryGet<typeof settingsSvc>('settings')
} catch {
  // 不在画布渲染子树里（单测 / 面板预览）：用默认阈值
}

function readTierCfg(): NodeLoadingTierConfig {
  const settings = settingsSvc
  if (!settings || typeof settings.get !== 'function') {
    return readNodeLoadingTiers(NODE_LOADING_TIER_PREFIX, undefined)
  }
  return readNodeLoadingTiers(NODE_LOADING_TIER_PREFIX, {
    get: (name: string) => (name === 'settings' ? settings : undefined),
  } as never)
}

const tierCfg = ref<NodeLoadingTierConfig>(readTierCfg())
/**
 * 当前画布缩放。
 *
 * flow.viewport 在不同装配下可能是 Ref，也可能是裸值 —— 两种都认，读不到就当 1（不猜）。
 */
const zoom = computed(() => {
  const raw = flow?.viewport as unknown
  const state =
    raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)
      ? (raw as { value?: { zoom?: unknown } }).value
      : (raw as { zoom?: unknown } | undefined)
  const z = state?.zoom
  return typeof z === 'number' && Number.isFinite(z) && z > 0 ? z : 1
})
const canvasMinZoom = computed(() => {
  const v = settingsSvc?.get?.('minZoom')
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined
})
/** 当前档位（1 完整 / 2 精简 / 3 极简） */
const tier = computed(() => resolveNodeLoadingTier(zoom.value, tierCfg.value, canvasMinZoom.value))
const tierSettingOff = settingsSvc?.onChange?.((key) => {
  if (!nodeLoadingTierKeys(NODE_LOADING_TIER_PREFIX).includes(key)) return
  tierCfg.value = readTierCfg()
})

/**
 * 小容器自动收紧版式。
 * 视频帧图这类卡片可能只有 160px 宽，56px 的大数字会把文案挤没；窄/矮时降一档字号。
 */
const compact = ref(false)
let sizeObserver: ResizeObserver | null = null
function measure(): void {
  if (props.variant === 'chip') return
  const el = rootEl.value
  if (!el) return
  const w = el.clientWidth
  const h = el.clientHeight
  compact.value = (w > 0 && w < 240) || (h > 0 && h < 150)
}

/**
 * 跟随卡片圆角。
 *
 * 状态层（`state:overlay`）/ 内容裁剪层的圆角是 0，直接铺一层不透明底色会把卡片的圆角涂平
 * （真实反馈过）。这里读卡片实算值，不写死数字；找不到卡片（正文外的预览舞台）就用 0。
 */
const radius = ref('')
function syncRadius(): void {
  if (props.variant === 'chip') return
  const card = rootEl.value?.closest('.v2-node')?.querySelector('.v2-card') as HTMLElement | null
  const r = card ? getComputedStyle(card).borderRadius : ''
  const next = r && r !== '0px' ? r : ''
  if (next !== radius.value) radius.value = next
}
let radiusTimer: ReturnType<typeof setInterval> | null = null

/** 已耗时（右上角小胶囊） */
const elapsedSec = ref(0)
function tickElapsed(): void {
  elapsedSec.value = props.startedAt > 0 ? Math.max(0, (Date.now() - props.startedAt) / 1000) : 0
}
let tickTimer: ReturnType<typeof setInterval> | null = null

const elapsedText = computed(() => {
  if (props.startedAt <= 0) return ''
  return elapsedSec.value < 60
    ? elapsedSec.value.toFixed(1) + 's'
    : Math.floor(elapsedSec.value / 60) + '分' + Math.round(elapsedSec.value % 60) + '秒'
})

const shownPercent = computed(() => {
  const p = props.percent
  if (typeof p !== 'number' || !Number.isFinite(p)) return null
  return Math.max(0, Math.min(100, Math.round(p)))
})
const shownValue = computed(() => {
  const v = props.value
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    // 没给 value 时沿用老属性 percent（0-100）—— 既有调用方一行都不用改
    return shownPercent.value
  }
  // 不设上限：token 数会超过 100（用户 2026-11-10）。只挡负数。
  return Math.max(0, Math.round(v))
})

/** 整段进度文案：传了 progressText 就用它，否则 value + suffix */
const progressLabel = computed(() => {
  if (props.progressText) return props.progressText
  if (shownValue.value === null) return null
  return String(shownValue.value) + (props.suffix ?? '')
})

/** 数字 + 后缀分开画（样式不同：大号数字 + 小号后缀） */
const splitProgress = computed(
  () => props.progressText === '' && shownValue.value !== null,
)

/** 实时流尾部文本：只留最后 20 个字符 */
const tailText = computed(() => {
  const s = (props.streamTail ?? '').replace(/\s+/g, ' ').trim()
  if (s === '') return ''
  return [...s].slice(-20).join('')
})


/** 输出量文案（文本对话）：只有执行方给了 stats 才有 */
const statsText = computed(() => {
  const s = props.stats
  if (!s) return ''
  const parts: string[] = []
  if (typeof s.chars === 'number' && Number.isFinite(s.chars)) parts.push('已输出 ' + Math.max(0, Math.floor(s.chars)) + ' 字')
  if (typeof s.tokens === 'number' && Number.isFinite(s.tokens)) parts.push('≈' + Math.max(0, Math.floor(s.tokens)) + ' tokens')
  return parts.join(' · ')
})

const ariaLabel = computed(() => props.message || props.label || (props.tone === 'error' ? '执行失败' : '执行中'))

onMounted(() => {
  if (props.variant === 'chip') return
  measure()
  syncRadius()
  tickElapsed()
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => measure())
    if (rootEl.value) observer.observe(rootEl.value)
    sizeObserver = observer
  }
  radiusTimer = setInterval(syncRadius, 250)
  tickTimer = setInterval(tickElapsed, 1000)
})

onBeforeUnmount(() => {
  sizeObserver?.disconnect()
  sizeObserver = null
  if (radiusTimer) clearInterval(radiusTimer)
  if (tickTimer) clearInterval(tickTimer)
  tierSettingOff?.dispose()
})
</script>

<template>
  <div
    ref="rootEl"
    class="nls-root"
    :class="[`is-${variant}`, `is-${tone}`, `is-${surface}`, 'is-tier' + tier, { 'is-compact': compact }]"
    :style="radius ? { borderRadius: radius } : undefined"
    role="status"
    aria-live="polite"
    :aria-label="ariaLabel"
  >
    <!-- ① 底色：不透明，把底下的内容完全盖住 -->
    <div class="ld-base" aria-hidden="true" />
    <!-- ② 流光层：3 个模糊光斑缓慢游走（亮/暗两套配色；视频画面恒深色）。
         失败态**不画**：任务已经失败，底下还在游动会让人以为「还在跑」（用户 2026-11-09）。 -->
    <div v-if="tone !== 'error'" class="ld-fluid" aria-hidden="true">
      <span class="ld-blob ld-blob--1" />
      <span class="ld-blob ld-blob--2" />
      <span class="ld-blob ld-blob--3" />
    </div>

    <!-- 紧凑形态：一行小胶囊，塞进状态栏 -->
    <template v-if="variant === 'chip'">
      <i class="ld-dot" aria-hidden="true" />
      <span v-if="label" class="nls-chip-label">{{ label }}</span>
      <span class="nls-chip-msg">{{ message || '处理中…' }}</span>
      <span v-if="tailText" class="nls-chip-tail">…{{ tailText }}</span>
      <span v-if="progressLabel !== null" class="nls-chip-pct">{{ progressLabel }}</span>
      <span v-else-if="statsText" class="nls-chip-stats">{{ statsText }}</span>
    </template>

    <!-- 整块形态 -->
    <template v-else>
      <!-- 状态词 + 耗时：只在第 1 档画。第 2 档起文字会糊成一片，留着反而挡数字 -->
      <div v-if="tier === 1" class="ld-top">
        <span class="ld-state">
          <i class="ld-dot" aria-hidden="true" />{{ label || (tone === 'error' ? '执行失败' : '生成中') }}
        </span>
        <span v-if="tone !== 'error' && elapsedText" class="ld-timer">{{ elapsedText }}</span>
      </div>

      <div class="ld-progress">
        <span v-if="tone === 'error'" class="ld-fail-mark" aria-hidden="true">!</span>
        <!--
          有进度就给数字；没有就用一个旋转的 SVG 图标（不编假百分比，也不放三个点）。
          两段拆开画是为了大小字重不同（大号数字 + 小号后缀）。传了 progressText 时整段一起画。
        -->
        <template v-else-if="splitProgress">
          <span class="ld-num">{{ shownValue }}</span>
          <span class="ld-pct">{{ suffix }}</span>
        </template>
        <span v-else-if="progressLabel !== null" class="ld-progress-text">{{ progressLabel }}</span>
        <svg v-else class="ld-spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle class="ld-spinner-track" cx="12" cy="12" r="9" />
          <circle class="ld-spinner-arc" cx="12" cy="12" r="9" />
        </svg>
      </div>

      <!-- 阶段文案 / 失败原因：第 3 档不写（缩到那份上只剩一句糊字） -->
      <template v-if="tier !== 3">
        <p class="ld-prompt">{{ message || (tone === 'error' ? '执行失败' : '执行中…') }}</p>
        <p v-if="tailText && tone !== 'error'" class="ld-stream-tail">…{{ tailText }}</p>
        <p v-if="tone === 'error' && hint" class="ld-hint">{{ hint }}</p>
      </template>

      <!-- 取消按钮：第 3 档不画（小到点不准，且此时用户本来就不该在这里操作） -->
      <div v-if="tier !== 3" class="nls-action"><slot name="action" /></div>
    </template>
  </div>
</template>

<style scoped>
/* ============================================================
   默认节点加载态（照底部状态栏那只流光版式收成通用件）
   只动 transform / opacity（GPU 层），几十个节点同屏也不掉帧。
   配色用**组件私有变量**：亮/暗两套 + 视频画面一套，改主题时各自取值。
   ============================================================ */
.nls-root {
  /* 亮色（白卡） */
  --nls-base: #ffffff;
  --nls-state: #64748b;
  --nls-dot: #0ea5e9;
  --nls-timer-ink: #475569;
  --nls-timer-bg: rgb(241 245 249 / 0.9);
  --nls-timer-line: rgb(226 232 240 / 0.9);
  --nls-num: #1e293b;
  --nls-num-glow: 0 0 16px rgb(14 165 233 / 0.25);
  --nls-pct: #0284c7;
  --nls-prompt: #475569;
  --nls-hint: #9f8b8b;
  --nls-blob-1: radial-gradient(circle, rgba(56, 189, 248, 0.35) 0%, transparent 70%);
  --nls-blob-2: radial-gradient(circle, rgba(129, 140, 248, 0.3) 0%, transparent 70%);
  --nls-blob-3: radial-gradient(circle, rgba(45, 212, 191, 0.3) 0%, transparent 70%);
  --nls-fluid-opacity: 0.75;
  --nls-radius: 8px;

  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  /* 不接指针：加载期间节点照样能拖、能选 */
  pointer-events: none;
  overflow: hidden;
  border-radius: var(--nls-radius);
  animation: ld-in 0.18s ease-out;
}

/* 暗色（深海青紫） */
html.dark .nls-root {
  --nls-base: #0f172a;
  --nls-state: #94a3b8;
  --nls-dot: #22d3ee;
  --nls-timer-ink: #cbd5e1;
  --nls-timer-bg: rgb(2 6 23 / 0.7);
  --nls-timer-line: rgb(51 65 85 / 0.6);
  --nls-num: #ffffff;
  --nls-num-glow: 0 0 20px rgb(56 189 248 / 0.4);
  --nls-pct: #22d3ee;
  --nls-prompt: #cbd5e1;
  --nls-hint: #a18585;
  --nls-blob-1: radial-gradient(circle, rgba(14, 165, 233, 0.45) 0%, rgba(56, 189, 248, 0) 70%);
  --nls-blob-2: radial-gradient(circle, rgba(99, 102, 241, 0.4) 0%, rgba(139, 92, 246, 0) 70%);
  --nls-blob-3: radial-gradient(circle, rgba(20, 184, 166, 0.35) 0%, transparent 70%);
  --nls-fluid-opacity: 0.85;
}

/* 视频画面里：恒深色底，避免加载时白闪一下 */
.nls-root.is-media {
  --nls-base: #050505;
  --nls-state: #94a3b8;
  --nls-dot: #22d3ee;
  --nls-timer-ink: #cbd5e1;
  --nls-timer-bg: rgb(2 6 23 / 0.7);
  --nls-timer-line: rgb(51 65 85 / 0.6);
  --nls-num: #ffffff;
  --nls-num-glow: 0 0 20px rgb(56 189 248 / 0.4);
  --nls-pct: #22d3ee;
  --nls-prompt: #cbd5e1;
  --nls-hint: #a18585;
  --nls-blob-1: radial-gradient(circle, rgba(14, 165, 233, 0.45) 0%, rgba(56, 189, 248, 0) 70%);
  --nls-blob-2: radial-gradient(circle, rgba(99, 102, 241, 0.4) 0%, rgba(139, 92, 246, 0) 70%);
  --nls-blob-3: radial-gradient(circle, rgba(20, 184, 166, 0.35) 0%, transparent 70%);
  --nls-fluid-opacity: 0.85;
  --nls-radius: 0px;
}

/* 失败态：同一块整卡覆盖，只换成「没成」的交代 */
.nls-root.is-error {
  --nls-base: #fef2f2;
  --nls-state: #dc2626;
  --nls-dot: #ef4444;
  --nls-prompt: #b91c1c;
}
html.dark .nls-root.is-error {
  --nls-base: #1f0f12;
  --nls-prompt: #fca5a5;
}

/* ① 底色 */
.ld-base {
  position: absolute;
  inset: 0;
  background: var(--nls-base);
}

/* ② 流光层 */
.ld-fluid {
  position: absolute;
  inset: -20px;
  overflow: hidden;
  filter: blur(28px);
  opacity: var(--nls-fluid-opacity);
  pointer-events: none;
}
.ld-blob {
  position: absolute;
  border-radius: 999px;
  will-change: transform, opacity;
}
.ld-blob--1 {
  top: 15%;
  left: 15%;
  width: 70%;
  height: 70%;
  background: var(--nls-blob-1);
  animation: ld-orbit-1 9s ease-in-out infinite;
}
.ld-blob--2 {
  bottom: 15%;
  right: 15%;
  width: 75%;
  height: 75%;
  background: var(--nls-blob-2);
  animation: ld-orbit-2 11s ease-in-out infinite;
}
.ld-blob--3 {
  top: 50%;
  left: 50%;
  width: 60%;
  height: 60%;
  margin: -30% 0 0 -30%;
  background: var(--nls-blob-3);
  animation: ld-pulse 8s ease-in-out infinite;
}

/* 左上状态词 + 右上耗时 */
.ld-top {
  position: absolute;
  top: 10px;
  left: 12px;
  right: 12px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ld-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--nls-state);
}
.ld-dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 999px;
  background: var(--nls-dot);
  animation: ld-blink 1.4s ease-in-out infinite;
}
.ld-timer {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--nls-timer-ink);
  background: var(--nls-timer-bg);
  border: 1px solid var(--nls-timer-line);
}

/* 中间超大百分比 */
.ld-progress {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  margin-bottom: 6px;
}
.ld-num {
  font-size: 56px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--nls-num);
  text-shadow: var(--nls-num-glow);
}
.ld-pct {
  margin-left: 2px;
  font-size: 22px;
  font-weight: 600;
  line-height: 1;
  color: var(--nls-pct);
}

/* 整段进度文案（progressText）：字号介于大数字与后缀之间 */
.ld-progress-text {
  font-size: 22px;
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  color: var(--nls-num);
  text-shadow: var(--nls-num-glow);
}
.nls-root.is-tier2 .ld-progress-text {
  font-size: 17px;
}
.nls-root.is-tier3 .ld-progress-text {
  font-size: 13px;
}

/* 实时流尾部（「正在返回的那一小段」）：比阶段文案更弱，像终端回显 */
.ld-stream-tail {
  position: relative;
  z-index: 2;
  margin: 3px 0 0;
  max-width: calc(100% - 32px);
  text-align: center;
  font-size: 11px;
  line-height: 1.5;
  color: var(--nls-timer-ink);
  opacity: 0.85;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow-wrap: anywhere;
}

/* 不确定态：一个旋转的 SVG 光圈（不编百分比、不放三个点） */
.ld-spinner {
  width: 52px;
  height: 52px;
  transform-origin: 50% 50%;
  animation: ld-spin 0.9s linear infinite;
  filter: drop-shadow(0 0 10px var(--ui-accent-soft, rgb(8 145 178 / 0.12))); /* 主题色白名单: var() 兜底里的具体色值是 accent 缺席时的降级，非独立配色 */
}
.ld-spinner-track {
  stroke: color-mix(in srgb, var(--nls-pct) 22%, transparent);
  stroke-width: 2.5;
}
.ld-spinner-arc {
  stroke: var(--nls-pct);
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-dasharray: 42 15;
}

/* 下方一行阶段文案（可换行，最多 3 行） */
.ld-prompt {
  position: relative;
  z-index: 2;
  margin: 0;
  max-width: calc(100% - 32px);
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;
  overflow-wrap: anywhere;
  color: var(--nls-prompt);
}

/* 已产出量（文本对话的过程信息，不进作品） */
.ld-stats {
  position: relative;
  z-index: 2;
  margin: 2px 0 0;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--nls-timer-ink);
}

/* 失败：中间一个感叹号，下面写原因 + 一句下一步 */
.ld-fail-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 999px;
  background: #ef4444; /* 主题色白名单: 失败标记底色（红），加载装饰的一部分 */
  color: #ffffff; /* 主题色白名单: 失败标记字色（恒白，压在红底上） */
  font-size: 26px;
  font-weight: 900;
  line-height: 1;
  box-shadow: 0 0 22px rgb(239 68 68 / 0.35); /* 主题色白名单: 失败标记外发光（加载装饰） */
}
.ld-hint {
  position: relative;
  z-index: 2;
  margin: 4px 0 0;
  max-width: calc(100% - 32px);
  text-align: center;
  font-size: 11px;
  line-height: 1.5;
  color: var(--nls-hint);
}

/* `#action` 插槽里的按钮自己定位（取消按钮贴右下角），这里不造盒子 */
.nls-action {
  display: contents;
}

/*
 * 失败态：**不要流光背景**。
 *
 * 用户口径 2026-11-09：任务已经失败了，底下却还在缓慢游动那团光，看着像「还在跑」。
 * 流光是「正在处理」的装饰，失败态只需要一块安静的浅红底 + 原因 + 下一步，
 * 所以这一层直接不画（不是调暗——调暗之后它还在动）。
 */
.nls-root.is-error .ld-fluid {
  display: none;
}
/* 同上：失败态左上角的点不再闪。它一闪一闪就是在说「还在跑」，与失败自相矛盾。 */
.nls-root.is-error .ld-dot {
  animation: none;
}

/* 小容器：降一档字号，保住文案 */
.nls-root.is-tier2 .ld-num {
  font-size: 40px;
}
.nls-root.is-tier2 .ld-pct {
  font-size: 18px;
}
.nls-root.is-tier2 .ld-spinner {
  width: 40px;
  height: 40px;
}
.nls-root.is-tier2 .ld-fail-mark {
  width: 38px;
  height: 38px;
  font-size: 22px;
}
.nls-root.is-tier2 .ld-prompt {
  font-size: 11px;
}

/* 第 3 档：只留中心数字 / 光圈，字号收小，其余元素模板里已经不渲染 */
.nls-root.is-tier3 .ld-num {
  font-size: 30px;
}
.nls-root.is-tier3 .ld-pct {
  font-size: 14px;
}
.nls-root.is-tier3 .ld-spinner {
  width: 28px;
  height: 28px;
}
.nls-root.is-tier3 .ld-fail-mark {
  width: 30px;
  height: 30px;
  font-size: 18px;
}

.nls-root.is-compact .ld-num {
  font-size: 28px;
}
.nls-root.is-compact .ld-pct {
  font-size: 14px;
}
.nls-root.is-compact .ld-fail-mark {
  width: 30px;
  height: 30px;
  font-size: 17px;
}
.nls-root.is-compact .ld-top {
  top: 6px;
  left: 8px;
  right: 8px;
}
.nls-root.is-compact .ld-state,
.nls-root.is-compact .ld-timer {
  font-size: 10px;
}
.nls-root.is-compact .ld-timer {
  padding: 1px 7px;
}
.nls-root.is-compact .ld-prompt {
  font-size: 11px;
  max-width: calc(100% - 16px);
}

/* ============================================================
   紧凑形态：一行小胶囊（状态栏里用）。
   同一套流光藏在字后面，不铺不透明整块 —— 底下的画面/面板仍然看得见。
   ============================================================ */
.nls-root.is-chip {
  position: relative;
  inset: auto;
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  width: auto;
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  overflow: hidden;
  /* 小胶囊自己要有底：它盖在状态栏面板上，纯光斑看不出边界 */
  background: var(--ui-overlay-solid, #fff);
  border: 1px solid var(--ui-line, rgb(0 0 0 / 0.08));
  animation: ld-in 0.18s ease-out;
  color: var(--nls-state);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
html.dark .nls-root.is-chip {
  /* 暗色下用面板底色，避免亮白胶囊压在深色状态栏上 */
  background: var(--ui-panel, #1b1b1b);
  border-color: var(--ui-line, rgb(255 255 255 / 0.1));
}
.nls-root.is-chip .ld-base {
  display: none;
}
.nls-root.is-chip .ld-fluid {
  inset: -10px;
  filter: blur(12px);
  opacity: 0.7;
}
.nls-root.is-chip .ld-blob--1,
.nls-root.is-chip .ld-blob--2,
.nls-root.is-chip .ld-blob--3 {
  width: 55%;
  height: 220%;
  margin: 0;
}
.nls-root.is-chip .ld-blob--1 {
  top: -60%;
  left: -10%;
}
.nls-root.is-chip .ld-blob--2 {
  bottom: -60%;
  right: -10%;
}
.nls-root.is-chip .ld-blob--3 {
  top: 50%;
  left: 50%;
}
.nls-chip-label,
.nls-chip-msg,
.nls-chip-pct {
  position: relative;
  z-index: 2;
}
.nls-chip-label {
  color: var(--nls-num);
}
.nls-chip-msg {
  color: var(--nls-prompt);
}
.nls-chip-pct {
  color: var(--nls-pct);
  font-variant-numeric: tabular-nums;
}
.nls-chip-stats {
  position: relative;
  z-index: 2;
  color: var(--nls-timer-ink);
  font-variant-numeric: tabular-nums;
}
.nls-chip-tail {
  position: relative;
  z-index: 2;
  max-width: 12em;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--nls-timer-ink);
  opacity: 0.85;
}
.nls-root.is-chip.is-error .ld-dot {
  animation: none;
}

@keyframes ld-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes ld-orbit-1 {
  0% {
    transform: translate3d(-30%, -25%, 0) scale(1) rotate(0deg);
  }
  33% {
    transform: translate3d(30%, 15%, 0) scale(1.3) rotate(120deg);
  }
  66% {
    transform: translate3d(-10%, 35%, 0) scale(0.9) rotate(240deg);
  }
  100% {
    transform: translate3d(-30%, -25%, 0) scale(1) rotate(360deg);
  }
}
@keyframes ld-orbit-2 {
  0% {
    transform: translate3d(35%, 30%, 0) scale(1.2) rotate(360deg);
  }
  33% {
    transform: translate3d(-25%, -20%, 0) scale(0.85) rotate(240deg);
  }
  66% {
    transform: translate3d(20%, -35%, 0) scale(1.25) rotate(120deg);
  }
  100% {
    transform: translate3d(35%, 30%, 0) scale(1.2) rotate(0deg);
  }
}
@keyframes ld-pulse {
  0%,
  100% {
    transform: scale(0.8);
    opacity: 0.4;
  }
  50% {
    transform: scale(1.25);
    opacity: 0.85;
  }
}
@keyframes ld-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
@keyframes ld-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 不确定态的图标跟着容器大小走：小卡片里也不会把文案挤没 */
.nls-root.is-compact .ld-spinner {
  width: 30px;
  height: 30px;
}

@media (prefers-reduced-motion: reduce) {
  .nls-root,
  .ld-blob,
  .ld-dot,
  .ld-spinner {
    animation: none !important;
  }
}
</style>
