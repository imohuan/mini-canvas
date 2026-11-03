<script setup lang="ts">
/**
 * AudioWavePlayer —— 音频播放器的可复用核心：波形 + 播放头 + 整体进度条。
 *
 * 从 AudioContent 抽出（交接文档 P0-1）：节点内容段（AudioContent）与预览件
 * （AudioPreview）共用这一套波形实现，别再分叉两份 —— 两份必然漂移。
 *
 * 本组件只管"给一段音频地址，画波形、能播放、能拖进度"：
 * - 不读节点数据、不碰插件服务（settings / doc 一概不知）—— 节点相关留在调用方；
 * - 上传按钮 / 刷新按钮 / 底部信息栏不在这里 —— 调用方各自拼装；
 * - 无 url 时内部 audio 元素不渲染（"无音频"占位符是节点内容段的事）。
 *
 * ## 波形的画法（用户口径，别再改回去）
 *
 * **从头到尾只有一条波形**。进度条做的事只有一件：把播放位置**左边**那些竖条染成主题色，
 * 右边保持灰。竖条**只有一层**，每根自己带 is-played（已播）标记 ——
 * 曾经写成"两层波形叠放、上层按进度宽度裁切"，上层容器一变窄，里面按百分比定位的竖条
 * 就被横向压扁，看起来像"又拉出来一条波纹"（用户实测截图报的 bug）。
 *
 * ## 轮播窗口
 *
 * 时间轴是一长条，可视区只是一扇窗。播放/拖动时**整条时间轴向左平移**（内容在动、窗口不动）。
 * 每根竖条宽度固定（barWidth px），"窗口里有多少根"由实测宽度决定，与缩放无关。
 * 短音频整条铺满，长音频按 WINDOW_SECONDS 的窗口滑动，格子锚在绝对时间上。
 *
 * ## 按需算峰值
 *
 * 只算可视窗口那一段（openAudioSource.peaks，算过的由 PeakCache 命中）；拿不到 source 时
 * 退回调用方传入的整段概览（waveform prop，100 个整数）。
 *
 * ## 手势契约（别回退）
 *
 * 只有播放头竖线 / 整体进度条拦画布手势（nodrag nopan nowheel）；波形本体放行 ——
 * 否则用户拖不动节点（实测 bug）。底栏按钮由调用方自己标注。
 *
 * ## 拖动出声（搓碟）
 *
 * 拖播放头/进度条时只有手在动才出声：每次指针移动重置一个 60ms 定时器（SCRUB_IDLE_MS），
 * 到点还没再动就暂停；松手恢复"拖之前"的播放/暂停状态。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useAudioTransport } from "./audio-wave-player/useAudioTransport"
import { useWaveformWindow } from "./audio-wave-player/useWaveformWindow"
import { usePeakWindow } from "./audio-wave-player/usePeakWindow"
import { useSeekGestures } from "./audio-wave-player/useSeekGestures"
import { useWaveSize } from "./audio-wave-player/useWaveSize"

const props = withDefaults(
  defineProps<{
    /** 音频地址（URL / dataURL / blob:）；空串时什么都不渲染 */
    url?: string
    /** 调用方存好的整段概览（100 个整数）；拿不到按需 source 时兜底 */
    waveform?: number[]
    /** 已知时长（秒）：元数据到达前先用它显示，避免时间闪 0:00 */
    duration?: number
    /** 紧凑模式（历史卡片）：藏整体进度条行，波形本身就是进度条 */
    compact?: boolean
    /** 每根竖条固定宽度（px）；节点设置可覆盖 */
    barWidth?: number
    /** 波形区最低高度（px）；节点设置可覆盖 */
    waveMinHeight?: number
  }>(),
  { url: "", waveform: undefined, duration: 0, compact: false, barWidth: 2, waveMinHeight: 28 },
)

const waveRef = ref<HTMLElement | null>(null)
const knobRef = ref<HTMLElement | null>(null)
const trackRef = ref<HTMLElement | null>(null)
/** 拖动中冻结的窗口左端（秒）；null = 跟随播放位置 */
const frozenStart = ref<number | null>(null)
/** 按需算出来的"当前窗口"峰值（0..1 原始振幅；null = 还没算出来） */
const windowPeaks = ref<number[] | null>(null)
/** 上面那批峰值对应的起始格号（与绝对格号对齐，滑动时才不会错位/抖动） */
let windowPeaksFrom = 0

const transport = useAudioTransport({
  url: () => props.url,
  knownDuration: () => props.duration,
  onProgress: () => {
    void refreshWindowPeaks()
  },
})
const {
  audioRef,
  ratio,
  playing,
  current,
  duration,
  progressPct,
  startLoop,
  stopLoop,
  togglePlay,
  onLoadedMetadata,
  onTimeUpdate,
  onEnded,
} = transport

const windowState = useWaveformWindow({
  waveform: () => props.waveform,
  barWidth: () => props.barWidth,
  duration: () => duration.value,
  current: () => current.value,
  frozenStart,
  windowPeaks,
  windowPeaksFrom: {
    get value() {
      return windowPeaksFrom
    },
    set value(v: number) {
      windowPeaksFrom = v
    },
  },
})
const { waveWidth, barCount, windowSeconds, windowStart, timelineShiftPx, bars, headPct } = windowState

const peakWindow = usePeakWindow({
  url: () => props.url,
  duration: () => duration.value,
  windowStart,
  windowSeconds,
  secondsPerBar: windowState.secondsPerBar,
  barCount: windowState.barCount,
  windowPeaks,
  windowPeaksFrom: {
    get value() {
      return windowPeaksFrom
    },
    set value(v: number) {
      windowPeaksFrom = v
    },
  },
  setDecodedDuration: transport.setDecodedDuration,
})
const { refreshWindowPeaks, openSource, invalidatePeakRequest } = peakWindow

const gestures = useSeekGestures({
  url: () => props.url,
  compact: () => props.compact,
  audioRef,
  waveRef,
  knobRef,
  trackRef,
  duration: () => duration.value,
  current,
  ratio,
  playing,
  frozenStart,
  windowStart,
  windowSeconds,
  startLoop,
  stopLoop,
  refreshWindowPeaks,
  invalidatePeakRequest,
})
const {
  onTrackPointerDown,
  onTrackPointerMove,
  onTrackPointerUp,
  onKnobPointerDown,
  onKnobPointerMove,
  onKnobPointerUp,
  onWavePointerDown,
  onWavePointerMove,
  onWavePointerUp,
  cancelScrubIdle,
  stopEdgeScroll,
  isSeeking,
} = gestures

// ==================== 生命周期 ====================

const waveSize = useWaveSize({
  waveWidth,
  waveRef,
  onWidthChange: () => {
    invalidatePeakRequest()
    void refreshWindowPeaks()
  },
})

onMounted(() => {
  waveSize.measure()
  // 再量一次：挂载这一帧宽度可能还没定下来（卡片尺寸是异步落位的）
  void nextTick(() => {
    waveSize.measure()
    requestAnimationFrame(() => waveSize.measure())
  })
  void openSource()
})

watch(
  () => props.url,
  () => {
    transport.resetForNewUrl()
    void openSource()
  },
)

/** 波形元素出现时才量得到宽度（先建卡片、音频后写进来的场景靠它） */
watch(
  waveRef,
  (el) => {
    waveSize.observeWave(el)
  },
  { flush: "post" },
)

/** 跟随播放位置时，窗口一变就补算新进入可视区的峰值（拖动中窗口冻结，不重算） */
watch([windowStart, barCount], () => {
  if (!isSeeking()) void refreshWindowPeaks()
})

onBeforeUnmount(() => {
  stopLoop()
  stopEdgeScroll()
  cancelScrubIdle()
  waveSize.disconnect()
  peakWindow.dispose()
})

/** 对调用方公开：播放态（defineExpose 会自动解包 ref）+ 播放/暂停 + 重开解码源 */
defineExpose({
  playing,
  current,
  duration,
  togglePlay,
  reload: openSource,
})
</script>

<template>
  <div class="awp-root" :class="{ 'is-playing': playing }">
    <audio
      v-if="url"
      ref="audioRef"
      class="awp-audio"
      :src="url"
      preload="metadata"
      @loadedmetadata="onLoadedMetadata"
      @timeupdate="onTimeUpdate"
      @ended="onEnded"
      @pause="playing = false"
    />

    <!-- 波形：**只有一条**。整条时间轴按轮播方式向左平移，可视区只是一扇窗。
         每根竖条自己带 is-played —— 播放头左边的染主题色，右边保持灰。 -->
    <div
      ref="waveRef"
      class="aw-wave"
      :class="{ 'is-empty': !bars.length, 'is-compact': compact }"
      :style="{ minHeight: waveMinHeight + 'px', '--aw-bar-width': barWidth + 'px' }"
      @pointerdown="onWavePointerDown"
      @pointermove="onWavePointerMove"
      @pointerup="onWavePointerUp"
      @pointercancel="onWavePointerUp"
    >
      <div
        v-if="bars.length"
        class="aw-timeline"
        :style="{ transform: 'translateX(' + timelineShiftPx + 'px)' }"
      >
        <span
          v-for="b in bars"
          :key="b.key"
          class="aw-wave-bar"
          :class="{ 'is-played': b.played }"
          :style="b.style"
        />
      </div>
      <span v-else class="aw-hint">波形分析中…</span>

      <!-- 播放头：一条贯穿整个波形高度的竖线。它同时是**唯一**的拖拽 seek 入口 -->
      <span
        v-if="bars.length"
        ref="knobRef"
        class="aw-knob nodrag nopan nowheel"
        :style="{ left: headPct }"
        title="拖动调整播放进度"
        @pointerdown="onKnobPointerDown"
        @pointermove="onKnobPointerMove"
        @pointerup="onKnobPointerUp"
        @pointercancel="onKnobPointerUp"
      />
    </div>

    <!-- 整体进度条：控制**整条音频**的进度（波纹只看得见一小段窗口）。
         它和播放头是两条不同的尺子：这条是全局比例，波纹上那条是窗口内位置。 -->
    <div
      v-if="!compact"
      ref="trackRef"
      class="aw-progress nodrag nopan nowheel"
      role="slider"
      tabindex="0"
      aria-label="整体播放进度"
      :aria-valuemin="0"
      :aria-valuemax="Math.round(duration)"
      :aria-valuenow="Math.round(current)"
      title="拖动调整整体进度"
      @pointerdown="onTrackPointerDown"
      @pointermove="onTrackPointerMove"
      @pointerup="onTrackPointerUp"
      @pointercancel="onTrackPointerUp"
    >
      <span class="aw-progress-rail" />
      <span class="aw-progress-fill" :style="{ width: progressPct }" />
      <span class="aw-progress-thumb" :style="{ left: progressPct }" />
    </div>
  </div>
</template>

<style scoped>
.awp-root {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  width: 100%;
}

/* audio 元素只用于解码播放，本身不显示（画面全由波形构成） */
.awp-audio {
  display: none;
}

/* 波形区 = 可视窗口。窗口本身不动，动的是里面那条时间轴（轮播图模型） */
.aw-wave {
  position: relative;
  flex: 1 1 auto;
  width: 100%;
  min-height: 24px;
  overflow: hidden;
  touch-action: none;
}

/* 紧凑模式（历史卡）：整条波形是 seek 区，给个手型提示 */
.aw-wave.is-compact {
  cursor: pointer;
}

.aw-timeline {
  position: absolute;
  inset: 0;
  will-change: transform;
}

/* 每根竖条：宽度固定（--aw-bar-width），定位在时间轴坐标上 */
.aw-wave-bar {
  position: absolute;
  top: 0;
  bottom: 0;
  width: var(--aw-bar-width, 2px);
  border-radius: 1px;
  background: var(--canvas-node-text-muted, #9ca3af);
  opacity: 0.7;
  transition: background 0.18s ease, opacity 0.18s ease;
}
.aw-wave-bar.is-played {
  background: var(--ui-accent, #0891b2);
  opacity: 1;
}

/* hover 到波形上：**只提亮波形本身，不铺灰底**（用户明确不喜欢那块灰背景） */
.aw-wave:hover .aw-wave-bar {
  background: var(--canvas-node-text, #6b7280);
  opacity: 0.95;
}
.aw-wave:hover .aw-wave-bar.is-played {
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 78%, var(--ui-panel, #ffffff));
}

/* 播放头：贯穿整个波形高度的竖线，也是唯一能拖的"滑块" */
.aw-knob {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 14px;
  margin-left: -7px;
  cursor: grab;
  touch-action: none;
}
.aw-knob::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 3px;
  margin-left: -1.5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--canvas-node-text-strong, #111827) 28%, transparent);
  /*
   * 平时：就是一条半透明的线，不画边框、不用阴影。
   * 不要用 border 做高亮：全局 border-box 会把边框从线宽里扣掉，hover 反而变细；
   * 高亮一律走 outline —— 它画在盒子外面，线宽永远不变。
   */
  outline: 1px solid transparent;
  outline-offset: 0;
  transition: background 0.18s ease, outline-color 0.18s ease;
}
.aw-knob:hover::after,
.aw-knob:active::after {
  background: var(--ui-accent, #0891b2);
  outline-color: var(--ui-panel, #ffffff);
}
.aw-knob:active {
  cursor: grabbing;
}

/* 播放中：已播部分轻微呼吸（唯一允许的循环动画；只动 opacity，不动几何） */
.is-playing .aw-wave-bar.is-played {
  animation: aw-breathe 1.6s ease-in-out infinite;
}
@keyframes aw-breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.72;
  }
}

.aw-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--canvas-node-text-muted, #9ca3af);
  font-size: 12px;
}

/* 整体进度条：一条细轨 + 已播填充 + 圆点把手（整条音频的全局比例） */
.aw-progress {
  position: relative;
  flex: none;
  width: 100%;
  height: 14px;
  cursor: pointer;
  touch-action: none;
}
.aw-progress:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 2px;
  border-radius: 999px;
}
.aw-progress-rail {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 3px;
  margin-top: -1.5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--canvas-node-text-muted, #9ca3af) 45%, transparent);
}
.aw-progress-fill {
  position: absolute;
  left: 0;
  top: 50%;
  height: 3px;
  margin-top: -1.5px;
  border-radius: 999px;
  background: var(--ui-accent, #0891b2);
  pointer-events: none;
}
.aw-progress-thumb {
  position: absolute;
  top: 50%;
  width: 9px;
  height: 9px;
  margin: -4.5px 0 0 -4.5px;
  border-radius: 999px;
  background: var(--ui-panel, #ffffff);
  border: 2px solid var(--ui-accent, #0891b2);
  pointer-events: none;
  transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.aw-progress:hover .aw-progress-thumb {
  transform: scale(1.15);
}

@media (prefers-reduced-motion: reduce) {
  .is-playing .aw-wave-bar.is-played {
    animation: none;
  }
  .aw-knob::after {
    transition: none;
  }
}
</style>
