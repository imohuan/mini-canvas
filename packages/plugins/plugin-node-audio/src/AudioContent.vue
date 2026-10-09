<script setup lang="ts">
/**
 * AudioContent —— audio 节点的内容段（薄壳）。
 *
 * 波形 + 播放头 + 整体进度条已抽成 AudioWavePlayer（与 AudioPreview 共用同一套实现，
 * 交接文档 P0-1：两份波形实现必然漂移）。本文件只剩节点特有的东西：
 *
 * - 空态占位与上传：「有没有音频」是节点的事 —— 预览组件无 url 时什么都不渲染；
 * - 节点设置：波形最低高度 / 竖条粗细从 settings 读，以 props 传给播放器；
 * - 元数据维护：ensureAudioMeta 补时长与整段概览；地址变化强制重算（reanalyzeAudio）；
 * - 底栏：播放 / 时间 / 文件名 / 刷新（刷新只属于节点 —— 重新分析并落盘波形）。
 *
 * 手势契约（别回退）：底栏两个按钮拦画布手势（nodrag nopan nowheel）；
 * 底栏本体、时间、文件名放行 —— 否则拖不动节点（实测 bug）。
 * 播放器内部的播放头 / 进度条由它自己标注（同一套契约）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useCanvasRender } from "@mini-canvas/canvas-render"
import { formatClock } from "./audioPlayback"
import { isValidWaveform } from "./waveform"
import { createAudioOps, defaultTransform, ensureAudioMeta, reanalyzeAudio, uploadAudio } from "./audioOps"
import AudioWavePlayer from "./AudioWavePlayer.vue"

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()

/** 播放器实例：播放/暂停、重开波形源都经它的公开方法（底栏自己不再养 audio 元素） */
const player = ref<InstanceType<typeof AudioWavePlayer> | null>(null)
const playerPlaying = computed(() => player.value?.playing ?? false)
const playerCurrent = computed(() => player.value?.current ?? 0)
const playerDuration = computed(() => player.value?.duration ?? 0)

/** 每根竖条的固定宽度（px）—— 从设置读，传给播放器（轮播窗口数学的前提） */
const barWidth = ref(2)
/** 波形区最低高度（实际高度由 flex 撑满卡片剩余空间，不留空带） */
const waveMinHeight = ref(28)

const fileRef = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const refreshing = ref(false)

const audioUrl = computed(() => (typeof props.data?.audioUrl === "string" ? props.data.audioUrl : ""))
const audioName = computed(() => (typeof props.data?.audioName === "string" ? props.data.audioName : ""))
const audioDuration = computed(() => {
  const stored = typeof props.data?.audioDuration === "number" ? props.data.audioDuration : 0
  return stored > 0 ? stored : 0
})
/** 节点上存好的整段概览（100 个整数）；播放器拿不到按需 source 时用它兜底 */
const storedWaveform = computed<number[] | undefined>(() =>
  isValidWaveform(props.data?.audioWaveform) ? props.data.audioWaveform : undefined,
)

const ops = createAudioOps(ctx)

// ==================== 设置 ====================

let settingsOff: (() => void) | null = null

/** 读一次设置（波形最低高度 / 竖条宽度）—— 缺设置服务时保持默认，不抛错 */
function readSettings(): void {
  const settings = ctx.tryGet<{ get(key: string): unknown }>("settings")
  if (!settings || typeof settings.get !== "function") return
  const h = Number(settings.get("audioWaveHeight"))
  if (Number.isFinite(h) && h > 0) waveMinHeight.value = h
  const w = Number(settings.get("audioBarMinWidth"))
  if (Number.isFinite(w) && w > 0) barWidth.value = w
}

// ==================== 上传 / 刷新 ====================

async function onPickFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files && input.files[0]
  input.value = ""
  if (!file || uploading.value) return
  uploading.value = true
  try {
    await uploadAudio(ops, props.id, file, defaultTransform, async (blob) => {
      // 存进宿主资源库（本地 IndexedDB / 云端画布文件夹，由当前 adapter 决定）
      const resources = ctx.tryGet<{ put(b: Blob, o?: { kind?: string; name?: string }): Promise<string> }>("resources")
      if (!resources) return undefined
      return resources.put(blob, { kind: "audio", ...(blob instanceof File && blob.name ? { name: blob.name } : {}) })
    })
  } finally {
    uploading.value = false
  }
}

function openPicker(): void {
  fileRef.value?.click()
}

/** 刷新：重新分析一次（重算整段概览 + 让播放器重建按需 source） */
async function refreshMeta(): Promise<void> {
  if (refreshing.value || !audioUrl.value) return
  refreshing.value = true
  try {
    await reanalyzeAudio(ops, props.id, defaultTransform)
    await player.value?.reload()
  } finally {
    refreshing.value = false
  }
}

// ==================== 生命周期 ====================

onMounted(() => {
  readSettings()
  void ensureAudioMeta(ops, props.id, defaultTransform)
  const settings = ctx.tryGet<{ onChange(cb: () => void): { dispose(): void } }>("settings")
  const off = settings?.onChange?.(() => readSettings())
  settingsOff = () => off?.dispose()
})

onBeforeUnmount(() => {
  settingsOff?.()
})

watch(
  () => audioUrl.value,
  () => {
    // ★ 音频地址一变就强制重算波形与时长（解码源由播放器自己重开）。
    //   - 节点先建、音频后写入（web2api/后台生成）：挂载时 url 还是空的，ensureAudioMeta 直接
    //     return，之后再没人补 → "波形不显示，点刷新才出来"；
    //   - 先上传本地音频、再用 API 生成覆盖：新地址写进来了，但节点上还留着旧波形，
    //     ensureAudioMeta 见"波形+时长都在"会跳过 → 画的是旧音频的波形。
    //   两种都靠"地址变了就重算"根治：reanalyzeAudio 无条件按当前地址重新解码并覆盖。
    if (audioUrl.value) void reanalyzeAudio(ops, props.id, defaultTransform)
  },
)
</script>

<template>
  <div class="audio-node">
    <input ref="fileRef" class="aw-file" type="file" accept="audio/*" @change="onPickFile" />

    <!-- 波形 + 播放头 + 整体进度条：共用播放器（截图红框部分），节点只负责把数据递进来 -->
    <AudioWavePlayer
      v-if="audioUrl"
      ref="player"
      :url="audioUrl"
      :waveform="storedWaveform"
      :duration="audioDuration"
      :bar-width="barWidth"
      :wave-min-height="waveMinHeight"
    />

    <!-- 播放控件：只有按钮才拦画布手势 —— 整条都拦的话，时间/文件名也拖不动节点 -->
    <div v-if="audioUrl" class="aw-bar">
      <button
        class="aw-btn nodrag nopan nowheel"
        type="button"
        :title="playerPlaying ? '暂停' : '播放'"
        :aria-label="playerPlaying ? '暂停' : '播放'"
        @click.stop="player?.togglePlay()"
      >
        <svg v-if="!playerPlaying" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <polygon points="7,4 19,12 7,20" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
      </button>
      <span class="aw-time">{{ formatClock(playerCurrent) }} / {{ formatClock(playerDuration || audioDuration) }}</span>
      <span v-if="audioName" class="aw-name" :title="audioName">{{ audioName }}</span>
      <button
        class="aw-btn aw-btn-ghost nodrag nopan nowheel"
        type="button"
        title="刷新波形与时长"
        aria-label="刷新"
        :disabled="refreshing"
        @click.stop="refreshMeta"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <polyline points="3 4 3 10 9 10" />
        </svg>
      </button>
    </div>

    <div v-else class="audio-empty">
      <svg
        class="audio-empty-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M3 10v4" />
        <path d="M7 6v12" />
        <path d="M11 3v18" />
        <path d="M15 7v10" />
        <path d="M19 10v4" />
      </svg>
      <span class="audio-empty-text">（无音频）</span>
      <button
        class="aw-btn aw-btn-upload"
        type="button"
        title="上传音频"
        aria-label="上传音频"
        :disabled="uploading"
        @click.stop="openPicker"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span class="aw-btn-text">上传音频</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.audio-node {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 10px 12px;
  gap: 6px;
  overflow: hidden;
  color: var(--canvas-node-text-body, #374151);
}

/* 文件选择器不显示：点按钮时由脚本 click 它 */
.aw-file {
  display: none;
}

/* —— 控件条 —— */
.aw-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: none;
}
.aw-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
  color: var(--canvas-node-text-body, #374151);
  cursor: pointer;
  transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.18s ease;
}
.aw-btn:hover {
  background: var(--ui-hover, rgb(0 0 0 / 0.06));
}
.aw-btn:active {
  transform: scale(0.97);
}
.aw-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 1px;
}
.aw-btn svg {
  width: 14px;
  height: 14px;
}
/* 刷新：贴着时间行右侧，弱化处理（次要动作，不抢播放按钮） */
.aw-btn-ghost {
  margin-left: auto;
  background: transparent;
  color: var(--canvas-node-text-muted, #8c95a3);
}
.aw-btn-ghost:hover {
  background: var(--ui-hover, rgb(0 0 0 / 0.06));
  color: var(--canvas-node-text-body, #374151);
}
/* 空态的上传按钮：带文字，是这条空态的唯一出路 */
.aw-btn-upload {
  width: auto;
  gap: 6px;
  padding: 0 10px;
  height: 28px;
}
.aw-btn-text {
  font-size: 12px;
}

.aw-time {
  flex: none;
  color: var(--canvas-node-text-muted, #8c95a3);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.aw-name {
  overflow: hidden;
  color: var(--canvas-node-text-muted, #8c95a3);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* —— 空态 —— */
.audio-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--canvas-node-text-muted, #9ca3af);
  font-size: 12px;
  text-align: center;
}
.audio-empty-icon {
  width: 22px;
  height: 22px;
}

@media (prefers-reduced-motion: reduce) {
  .aw-btn {
    transition: none;
  }
  .aw-btn:active {
    transform: none;
  }
}
</style>
