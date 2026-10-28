<script setup lang="ts">
/**
 * VideoPreview —— 视频**预览/播放**组件（注册件，目录名 videoPreview）。
 *
 * 从 VideoContent（video 节点内容段）抽出的纯展示件：video 元素 + 播放/暂停 + 进度 + 时间
 * + 音量 + 倍速 + 循环。不读写节点 data —— 只吃 props.url 播放。
 * 注册进 ui 目录后，任何宿主（卡片 / 生成历史 / 全屏预览 / 其它插件）都能按名取用。
 *
 * ## 控件设计（2026-10-07 定稿，方案 A）
 *
 * **居中悬浮胶囊**贴画面下缘（不再是铺满屏幕宽的横条 —— 那样在小窗口里会被裁切）。
 * 鼠标移入画面才显形，移开自动收起。
 *
 * 音量是一个**向上弹出的竖直滑杆**（点按钮或悬停展开）：竖滑杆不占控件条的横向空间，
 * 也不会像横滑杆那样把别的按钮顶跑 —— 这是这一版重做的重点（用户实测报过）。
 *
 * 倍速与循环：
 * - **倍速**：点按钮弹出一个小菜单（0.5 / 1 / 1.5 / 2 / 3），当前档位高亮；
 * - **循环**：按钮式开关（亮起 = 开）。两个都是"开了以后一直生效"，不随换视频重置。
 *
 * `tall`：宿主把它放在**大舞台**（全屏预览）里时传 true —— 控件条略大、进屏自动播放。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import VideoPlayerBar from "./VideoPlayerBar.vue"

const props = withDefaults(
  defineProps<{
    /** 视频地址 */
    url?: string
    /** 文件名（空则不显示） */
    name?: string
    /** 大舞台模式（全屏预览）：控件条略大、自动播放 */
    tall?: boolean
    /**
     * 小屏态是否在右下角给一个「进入预览」按钮。
     * 宿主能接 expand 事件（去开全屏预览）时传 true；没人接就不给死按钮。
     */
    expandable?: boolean
  }>(),
  { url: "", name: "", tall: false, expandable: false },
)

/** 点「进入预览」：组件自己不开窗，交给宿主（它才知道全屏预览挂在哪） */
const emit = defineEmits<{ (e: "expand"): void }>()

/**
 * 按**实测宽度**在两种 UI 之间切换（用户口径 2026-10-11）。
 *
 * 为什么必须按宽度分：同一个组件既长在生成历史的小卡片里（实测 237px 宽），又长在
 * 全屏预览的大舞台里。而控件条内容实测要 263px 才排得下 —— 237px 的卡片里进度条被裁得
 * 只剩几十像素、基本看不见（用户报的"进度条被遮挡"就是这个）。窄的时候只留一个居中播放键，
 * 宽了才给完整控制栏。全屏舞台（tall）永远给完整栏，不看宽度。
 */
const width = ref(0)
/** 小屏阈值：窄于它 = 小屏态。360px 约等于一张 3 列卡片再宽一点 */
const DENSE_MAX_WIDTH = 360
const dense = computed(() => width.value > 0 && width.value < DENSE_MAX_WIDTH && !props.tall)

/** 加载态：video 元素挂着但还没解码出第一帧（用户口径 2026-10-29：全屏别再是空白，
 *  之前那块黑底被删了，现在给一个"转圈 + 文字"的占位）。loadeddata / playing 翻假。 */
const loading = ref(false)
function markLoading(): void {
  if (!props.url || broken.value) { loading.value = false; return }
  loading.value = true
}
function markReady(): void { loading.value = false }

/** tall（全屏预览）时**自动播放**：用户点开就是看视频，不该还要再点一次播放。
 *  卡片里的小尺寸件不自动播（一屏几十张，全自动播会很吵、也费资源）。 */
const shouldAutoplay = computed(() => props.tall && !!props.url)

/**
 * 大舞台（全屏预览）里**按视频自己的宽高比**显示（用户口径 2026-10-28：
 * 「你这里只需要根据视频的宽高进行显示不就行了？我感觉你的背景后面有一片黑色区域」）。
 *
 * 做法：量到 videoWidth / videoHeight 后，把根容器的宽高比锁成它，并用 max-width/max-height
 * 收进可用空间 —— 画面外不再多出一圈黑底。小卡片（非 tall）保持原来的铺满行为。
 */
const aspect = ref(0)
const rootFitStyle = computed<Record<string, string> | undefined>(() => {
  if (!props.tall || !(aspect.value > 0)) return undefined
  return {
    aspectRatio: String(aspect.value),
    width: 'auto',
    height: 'auto',
    maxWidth: '100%',
    maxHeight: '100%',
  }
})

const videoRef = ref<HTMLVideoElement | null>(null)
const playing = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const broken = ref(false)
/** 鼠标是否停在画面上：控件只在此时显形（不常驻遮画面） */
const hovering = ref(false)
/** 控件条根元素（点外部关弹层要判它） */
const rootEl = ref<HTMLElement | null>(null)

// ===== 音量 =====
/** 当前音量 0..1（默认 1；用户拖过就记住） */
const volume = ref(1)
/** 是否静音（音量按钮点一下的快捷态） */
const muted = ref(false)
/** 音量竖滑杆是否展开 */
const volumeOpen = ref(false)
/**
 * 延迟收起音量竖滑杆的定时器。
 *
 * 为什么要延迟：弹出层与按钮之间有 10px 间距（视觉留白），鼠标从按钮移到滑杆会穿过这个
 * 间隙 —— 间隙里 pointerleave 立刻关掉的话，滑杆在鼠标到达前就消失了，根本用不了
 * （用户实测报的）。延迟 220ms 收起，期间回到按钮/滑杆就取消。
 */
let volumeCloseTimer: ReturnType<typeof setTimeout> | null = null

function openVolume(): void {
  if (volumeCloseTimer) { clearTimeout(volumeCloseTimer); volumeCloseTimer = null }
  volumeOpen.value = true
}
function scheduleCloseVolume(): void {
  if (volumeCloseTimer) clearTimeout(volumeCloseTimer)
  volumeCloseTimer = setTimeout(() => { volumeOpen.value = false; volumeCloseTimer = null }, 220)
}
function closeVolumeNow(): void {
  if (volumeCloseTimer) { clearTimeout(volumeCloseTimer); volumeCloseTimer = null }
  volumeOpen.value = false
}

/** 当前倍速（默认 1） */
const rate = ref(1)
/** 倍速菜单是否展开 */
const rateOpen = ref(false)

/** 点倍速菜单里的一档：写回 video.playbackRate */
function pickRate(r: number): void {
  rate.value = r
  rateOpen.value = false
  const el = videoRef.value
  if (el) el.playbackRate = r
}

// ===== 循环 =====
/** 是否循环（默认关） */
const loop = ref(false)
function toggleLoop(): void {
  loop.value = !loop.value
  const el = videoRef.value
  if (el) el.loop = loop.value
}

async function togglePlay(): Promise<void> {
  const el = videoRef.value
  if (!el || !props.url) return
  if (el.paused) {
    try {
      await el.play()
    } catch {
      playing.value = false
    }
  } else {
    el.pause()
  }
}

/** 共用条回传数值版 seek（VideoPlayerBar 已把 input 事件转成秒数） */
function onSeekValue(v: number): void {
  const el = videoRef.value
  if (!el || !Number.isFinite(v)) return
  try {
    el.currentTime = v
  } catch { /* 元数据还没到 */ }
}

/** 共用条回传数值版音量（语义与 onVolume 一致：>0 解除静音） */
function onVolumeValue(v: number): void {
  const el = videoRef.value
  if (!Number.isFinite(v)) return
  volume.value = Math.min(1, Math.max(0, v))
  if (el) {
    el.volume = volume.value
    if (volume.value > 0) {
      el.muted = false
      muted.value = false
    }
  }
}

/** 点音量图标：静音/取消静音（快捷开关） */
function toggleMute(): void {
  const el = videoRef.value
  muted.value = !muted.value
  if (el) el.muted = muted.value
  if (!muted.value && volume.value <= 0) {
    // 从静音恢复时若音量是 0，给一个可听的默认值，免得"点了没声音"
    volume.value = 1
    if (el) el.volume = 1
  }
}

function onLoadedMetadata(): void {
  const el = videoRef.value
  if (el && Number.isFinite(el.duration) && el.duration > 0) duration.value = el.duration
  // 记下真实宽高比（大舞台据此收掉多余黑底；量不到就维持原样）
  if (el && el.videoWidth > 0 && el.videoHeight > 0) aspect.value = el.videoWidth / el.videoHeight
  // 比例已量到 → 加载占位可以按真实画面尺寸铺了
  markReady()
  // 组件记着的设置，元数据就绪时同步给新 video（换 src 会重置元素状态）
  if (el) {
    el.volume = volume.value
    el.muted = muted.value
    el.playbackRate = rate.value
    el.loop = loop.value
    // tall 模式（全屏预览）自动播：autoplay 属性在懒挂载时不一定生效（与卡片那次同一个坑）
    if (shouldAutoplay.value) void el.play?.().catch(() => { /* 浏览器可能拦：静默，用户可点播放 */ })
  }
}
function onTimeUpdate(): void {
  const el = videoRef.value
  if (el) currentTime.value = el.currentTime
}
function onVideoError(): void {
  broken.value = true
  playing.value = false
}

// 点控件以外的地方，收起展开的弹层（音量竖条 / 倍速菜单）
function onDocPointerDown(e: PointerEvent): void {
  if (!rootEl.value || !rootEl.value.contains(e.target as Node)) return
  const t = e.target as HTMLElement
  // 点在按钮/滑杆/**展开的弹层**上不收起（由各自的 click 处理）。
  // ⚠️ 弹层（倍速菜单 / 音量竖条）必须一起放过：本监听在**捕获阶段**跑（document 最先），
  //    若在这里就收掉，菜单会被 v-show 先藏起来、随后的 click 落不到菜单项上 ——
  //    表现就是"下拉点不中"（用户实测报的）。
  if (t.closest(".vpv-btn") || t.closest("input") || t.closest(".vpv-menu") || t.closest(".vpv-vol-pop")) return
  volumeOpen.value = false
  rateOpen.value = false
}

/** 立即收起全部弹层（换视频时用；不走延迟，免得旧弹层挂着消失） */
function closePopoversNow(): void {
  closeVolumeNow()
  rateOpen.value = false
}

onMounted(() => document.addEventListener("pointerdown", onDocPointerDown, true))
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointerDown, true)
  if (volumeCloseTimer) clearTimeout(volumeCloseTimer)
  const el = videoRef.value
  if (el) el.pause()
})

/**
 * 量自己的宽度：ResizeObserver 盯着根元素，宽度变化就重算 dense。
 * 没有 ResizeObserver（极老环境 / SSR）就退化成"量一次，量不到当大屏"，不会崩。
 */
let widthObserver: ResizeObserver | null = null
onMounted(() => {
  const el = rootEl.value
  if (!el) return
  width.value = el.clientWidth
  if (typeof ResizeObserver === "function") {
    widthObserver = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width
      if (typeof w === "number") width.value = w
    })
    widthObserver.observe(el)
  }
})
onBeforeUnmount(() => {
  widthObserver?.disconnect()
  widthObserver = null
})

watch(
  () => props.url,
  () => {
    playing.value = false
    currentTime.value = 0
    duration.value = 0
    broken.value = false
    markLoading()
    closePopoversNow()
  },
)
</script>

<template>
  <div
    ref="rootEl"
    class="vpv-root"
    :class="{ 'is-tall': tall, 'is-idle': !hovering && !rateOpen }"
    :style="rootFitStyle"
    @pointerenter="hovering = true"
    @pointerleave="hovering = false"
  >
    <template v-if="url && !broken">
      <video
        ref="videoRef"
        class="vpv-media"
        :src="url"
        playsinline
        preload="metadata"
        :autoplay="shouldAutoplay"
        @loadeddata="markReady"
        @playing="markReady"
        @loadedmetadata="onLoadedMetadata"
        @timeupdate="onTimeUpdate"
        @play="playing = true"
        @pause="playing = false"
        @error="onVideoError"
        @click.stop="togglePlay"
      />

      <!-- ===== 小屏态：只留一个居中播放/暂停键 =====
           窄容器里完整控件条排不下（进度条实测被裁得只剩几十像素），只保留必需的这一个交互。 -->
      <div v-if="dense" class="vpv-dense" :class="{ 'is-playing': playing }">
        <button class="vpv-dense-play" type="button" :title="playing ? '暂停' : '播放'"
          :aria-label="playing ? '暂停' : '播放'" @click.stop="togglePlay">
          <svg v-if="!playing" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="7,4 19,12 7,20" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        </button>
        <button v-if="expandable" class="vpv-dense-expand" type="button" title="进入预览" aria-label="进入预览"
          @click.stop="emit('expand')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" />
          </svg>
        </button>
      </div>

      <!-- 大屏态：完整控制条 = 共用组件（视觉标准在视频节点那一侧，2026-10-29 用户拍板）。
           全屏与节点的差异只有循环开关（这里给、节点没有 —— 那里是截图按钮）。 -->
      <VideoPlayerBar
        v-else
        class="vpv-bar-host"
        :playing="playing"
        :current-time="currentTime"
        :duration="duration"
        :rate="rate"
        :rate-menu-open="rateOpen"
        :muted="muted || volume <= 0"
        :volume="volume"
        :volume-menu-open="volumeOpen"
        :loop="loop"
        @play="togglePlay"
        @seek="onSeekValue"
        @rate-toggle="rateOpen = !rateOpen"
        @rate-pick="pickRate"
        @loop-toggle="toggleLoop"
        @mute-toggle="toggleMute"
        @volume="onVolumeValue"
        @volume-open="openVolume"
        @volume-close="scheduleCloseVolume"
      />

      <!-- 加载占位（用户口径：视频没就绪时别再是一片空白）：转圈 + 文字。
           底色只铺在这层元素上，且容器已按视频比例收边 —— 不会多出黑边。 -->
      <div v-if="loading && !dense" class="vpv-loading" role="status" aria-live="polite">
        <span class="vpv-loading-spinner" aria-hidden="true"></span>
        <span class="vpv-loading-text">视频加载中…</span>
      </div>
    </template>
    <div v-else-if="broken" class="vpv-empty">视频加载失败</div>
  </div>
</template>

<style scoped>
/* ============================================================================
   视频控件是**浮在画面上的深色层**（chrome），用什么颜色与应用的亮/暗主题无关：
   画面本身可能是任何颜色，控件要在它上面始终看得清。所以这一整套用**固定中性色**
   （黑底 + 白色半透明），**不引用任何 --ui-* 主题 token**。

   为什么不能跟主题走（两条实测教训）：
   1. --ui-line 在亮色主题下是浅灰白（#e2e5ea）→ 压在深色画面上是一圈白边，很难看；
   2. --ui-hover 在亮色主题下是黑系（rgba(0,0,0,.06)）→ 压在深色控件条上等于看不见，
      悬停反馈与进度条一起失效。

   用户口径（2026-10-07）：不要主题色（尤其倍速菜单选中项那个强调色），
   亮/暗两套主题下这套控件的观感保持一致。
   ============================================================================ */
.vpv-root {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 主题色白名单: 视频底衬恒为黑（与 VideoContent 信箱黑边同口径），随画面内容而非主题 */
  background: #000;
  overflow: hidden;
  /* 主题色白名单: 视频控件自带的固定中性色板（不随应用主题；理由见上方注释块） */
  --vpv-panel: rgb(18 20 24 / 0.82);
  /* 主题色白名单: 同上（固定中性色板） */
  --vpv-ink: #fff;
  /* 主题色白名单: 同上（固定中性色板） */
  --vpv-ink-dim: rgb(255 255 255 / 0.55);
  /* 主题色白名单: 同上（固定中性色板） */
  --vpv-hover: rgb(255 255 255 / 0.14);
  /* 主题色白名单: 同上（固定中性色板） */
  --vpv-on: rgb(255 255 255 / 0.22);
  /* 主题色白名单: 同上（固定中性色板） */
  --vpv-track: rgb(255 255 255 / 0.3);
  /* 主题色白名单: 同上（固定中性色板） */
  --vpv-border: rgb(255 255 255 / 0.12);
  /* 主题色白名单: 同上（固定中性色板） */
  --vpv-ring: rgb(255 255 255 / 0.6);
  /* 主题色白名单: 同上（固定中性色板） */
  --vpv-shadow: 0 10px 30px rgb(0 0 0 / 0.45);
}
.vpv-media { width: 100%; height: 100%; object-fit: contain; display: block; cursor: pointer; }
.vpv-empty { display: grid; place-items: center; width: 100%; min-height: 120px; color: var(--vpv-ink-dim); font-size: 12px; }

/* ===== 小屏态：只有一个居中播放键（+ 可选右下角「进入预览」） =====
   为什么单独一套而不是把控制栏缩小：窄容器里进度条是**排不下**的（实测控件条内容要 263px，
   而历史卡片只有 237px），硬缩会把进度条挤没。小屏只给必需的播放/暂停。 */
.vpv-dense {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  place-items: center;
  pointer-events: none;
}
.vpv-dense-play {
  pointer-events: auto;
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  /* 主题色白名单: 播放键压在任意画面上，用固定中性黑底 + 白色图标（同下面的按钮） */
  background: rgb(0 0 0 / 0.45);
  color: var(--vpv-ink);
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: transform 0.16s ease, background 0.16s ease;
}
.vpv-dense-play svg { width: 18px; height: 18px; margin-left: 1px; }
.vpv-dense-play:hover { transform: scale(1.06); background: var(--vpv-panel); }
.vpv-dense-play:focus-visible { outline: 2px solid var(--vpv-ring); outline-offset: 2px; }
/* 正在播放且鼠标不在画面上：把播放键收起来（别一直挡着画面）；悬停或暂停时显形 */
.vpv-root.is-dense:not(:hover) .vpv-dense.is-playing .vpv-dense-play { opacity: 0; pointer-events: none; }

.vpv-dense-expand {
  position: absolute;
  right: 8px;
  bottom: 8px;
  pointer-events: auto;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  /* 主题色白名单: 同上，压在画面上的固定中性色 */
  background: rgb(0 0 0 / 0.42);
  color: var(--vpv-ink);
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: background 0.16s ease;
}
.vpv-dense-expand svg { width: 14px; height: 14px; }
.vpv-dense-expand:hover { background: var(--vpv-panel); }
.vpv-dense-expand:focus-visible { outline: 2px solid var(--vpv-ring); outline-offset: 2px; }

/* ===== 控件条：居中悬浮胶囊 =====
   为什么居中而不铺满：铺满（left/right:8px）在窄舞台里会被左右裁切、按钮挤成一团（用户实测报过）。 */
.vpv-bar {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-radius: 14px;
  max-width: calc(100% - 24px);
  background: var(--vpv-panel);
  border: 1px solid var(--vpv-border);
  box-shadow: var(--vpv-shadow);
  backdrop-filter: blur(14px);
  opacity: 0;
  translate: 0 6px;
  transition: opacity 0.18s ease, translate 0.18s ease;
}
/* hover 显形（键盘 focus 也显形，触屏点一下会先显形） */
.vpv-root:not(.is-idle) .vpv-bar,
.vpv-root:focus-within .vpv-bar { opacity: 1; translate: 0 0; }
/* 大舞台（全屏预览）：略微放大一档 */
.vpv-root.is-tall .vpv-bar { bottom: 16px; padding: 8px 12px; border-radius: 16px; gap: 8px; }

/* ===== 加载占位（用户口径 2026-10-29：视频没就绪时别是一片空白） =====
   铺满舞台、黑底（这是"视频还在加载"的底色，不是画面外多余的边 ——
   容器已按视频比例收边，所以这块黑只在画面范围内）。 */
.vpv-loading {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: #000; /* 主题色白名单: 视频加载底衬恒为黑（与画面同口径），与主题无关 */
}
.vpv-loading-spinner {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.25); /* 主题色白名单: 视频覆盖层里的转圈 */
  border-top-color: rgba(255, 255, 255, 0.95); /* 主题色白名单: 同上 */
  animation: vpv-loading-spin 0.75s linear infinite;
}
.vpv-loading-text {
  color: rgba(255, 255, 255, 0.75); /* 主题色白名单: 同上 */
  font-size: 12px;
}
@keyframes vpv-loading-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .vpv-loading-spinner { animation: none; }
}
.vpv-root.is-tall .vpv-btn { width: 30px; height: 30px; }
.vpv-root.is-tall .vpv-btn svg { width: 15px; height: 15px; }
.vpv-root.is-tall .vpv-range { min-width: 120px; }

.vpv-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; flex: none; padding: 0;
  border: 0; border-radius: 8px; background: transparent;
  color: var(--vpv-ink); cursor: pointer;
  transition: background 0.15s ease;
}
.vpv-btn svg { width: 14px; height: 14px; }
.vpv-btn:hover { background: var(--vpv-hover); }
.vpv-btn:focus-visible { outline: 2px solid var(--vpv-ring); outline-offset: 1px; }
/* 开关态 / 非默认态（循环开、倍速不是 1x）：中性白底点亮，不用主题强调色 */
.vpv-btn.is-on { background: var(--vpv-on); }

.vpv-time { font-size: 11px; color: var(--vpv-ink); font-variant-numeric: tabular-nums; white-space: nowrap; flex: none; }

/* 进度条 */
.vpv-range { flex: 1 1 auto; min-width: 48px; height: 3px; appearance: none; -webkit-appearance: none; background: var(--vpv-track); border-radius: 2px; cursor: pointer; }
.vpv-range::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 10px; height: 10px; border-radius: 50%; background: var(--vpv-ink); }
.vpv-range::-moz-range-thumb { width: 10px; height: 10px; border: 0; border-radius: 50%; background: var(--vpv-ink); }

/* ===== 倍速：按钮 + 向上弹出的小菜单 ===== */
.vpv-rate { position: relative; flex: none; }
.vpv-rate-btn { width: auto; min-width: 34px; padding: 0 6px; }
.vpv-rate-label { font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; }
.vpv-menu {
  position: absolute; left: 50%; bottom: calc(100% + 10px); transform: translateX(-50%);
  display: flex; flex-direction: column; gap: 2px; padding: 5px;
  border-radius: 12px; min-width: 64px;
  background: var(--vpv-panel);
  border: 1px solid var(--vpv-border);
  box-shadow: var(--vpv-shadow);
  backdrop-filter: blur(14px);
}
.vpv-menu-item {
  padding: 5px 10px; border: 0; border-radius: 8px; background: transparent;
  color: var(--vpv-ink); font-size: 11px; font-variant-numeric: tabular-nums;
  text-align: center; cursor: pointer; white-space: nowrap;
}
.vpv-menu-item:hover { background: var(--vpv-hover); }
/* 当前档：中性白底 + 加粗（不用主题强调色 —— 用户口径：只要中性色） */
.vpv-menu-item.is-active { background: var(--vpv-on); font-weight: 700; }
.vpv-menu-item:focus-visible { outline: 2px solid var(--vpv-ring); outline-offset: 1px; }

/* ===== 音量：按钮 + 向上弹出的竖直滑杆 ===== */
/* 热区：容器把按钮与弹层都包住 —— 给容器 padding-bottom 覆盖那段 10px 间隙，
   弹层也用 bottom 定位到 padding 内。这样鼠标在“按钮 → 弹层”之间移动时
   始终在容器里，pointerenter/leave 不会中途触发（纯 CSS，比延迟更稳）。 */
.vpv-vol { position: relative; display: flex; align-items: center; flex: none; padding-bottom: 12px; margin-bottom: -12px; }
.vpv-vol-pop {
  position: absolute; left: 50%; bottom: calc(100% + 4px);
  transform: translateX(-50%) scale(0.94); transform-origin: bottom center;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 10px 7px; border-radius: 999px;
  background: var(--vpv-panel);
  border: 1px solid var(--vpv-border);
  box-shadow: var(--vpv-shadow);
  backdrop-filter: blur(14px);
  opacity: 0; pointer-events: none;
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.vpv-vol-pop.is-open { opacity: 1; pointer-events: auto; transform: translateX(-50%) scale(1); }
.vpv-vol-pct { font-size: 9.5px; color: var(--vpv-ink); font-variant-numeric: tabular-nums; }
/* 竖直 range：writing-mode 是标准做法；老内核退化成"旋转一个横向 range" */
.vpv-vrange {
  writing-mode: vertical-lr; direction: rtl;
  appearance: none; -webkit-appearance: none;
  width: 4px; height: 88px; border-radius: 2px;
  background: var(--vpv-track); cursor: pointer;
}
.vpv-vrange::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: var(--vpv-ink); }
.vpv-vrange::-moz-range-thumb { width: 12px; height: 12px; border: 0; border-radius: 50%; background: var(--vpv-ink); }
@supports not (writing-mode: vertical-lr) {
  .vpv-vrange { writing-mode: horizontal-tb; width: 88px; height: 4px; transform: rotate(-90deg); }
}
.vpv-vol-pop {
  position: absolute; left: 50%; bottom: calc(100% + 10px);
  transform: translateX(-50%) scale(0.94); transform-origin: bottom center;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 10px 7px; border-radius: 999px;
  background: var(--vpv-panel);
  border: 1px solid var(--vpv-border);
  box-shadow: var(--vpv-shadow);
  backdrop-filter: blur(14px);
  opacity: 0; pointer-events: none;
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.vpv-vol-pop.is-open { opacity: 1; pointer-events: auto; transform: translateX(-50%) scale(1); }
.vpv-vol-pct { font-size: 9.5px; color: var(--vpv-ink); font-variant-numeric: tabular-nums; }
/* 竖直 range：writing-mode 是标准做法；老内核退化成"旋转一个横向 range" */
.vpv-vrange {
  writing-mode: vertical-lr; direction: rtl;
  appearance: none; -webkit-appearance: none;
  width: 4px; height: 88px; border-radius: 2px;
  background: var(--vpv-track); cursor: pointer;
}
.vpv-vrange::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: var(--vpv-ink); }
.vpv-vrange::-moz-range-thumb { width: 12px; height: 12px; border: 0; border-radius: 50%; background: var(--vpv-ink); }
@supports not (writing-mode: vertical-lr) {
  .vpv-vrange { writing-mode: horizontal-tb; width: 88px; height: 4px; transform: rotate(-90deg); }
}

@media (prefers-reduced-motion: reduce) {
  .vpv-bar, .vpv-vol-pop, .vpv-btn { transition: none !important; }
}
</style>
