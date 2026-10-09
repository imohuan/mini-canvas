<script setup lang="ts">
/**
 * AudioPreview —— 音频预览组件（注册件，目录名 audioPreview）。
 *
 * 波形、播放头、整体进度条全部来自 AudioWavePlayer（与节点内容段共用同一套实现，
 * 别再分叉）；这里只是预览壳：用它 + 底部信息栏（播放/暂停按钮、时间、文件大小、文件名）。
 * 无 url 时整个组件不渲染任何东西 ——「无音频」占位符属于节点内容段（AudioContent）。
 *
 * 注册进 ui 目录（nodeAudioPlugin）后，任何宿主（生成历史卡片、全屏预览、其它插件）
 * 都能 useUiComponent 按名取用；换主题/换实现时一起换。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { formatClock } from "./audioPlayback"
import AudioWavePlayer from "./AudioWavePlayer.vue"

const props = withDefaults(
  defineProps<{
    /** 音频地址（URL / dataURL / blob:） */
    url?: string
    /** 文件名（空则不显示） */
    name?: string
    /** 整段概览（100 个整数；播放器拿不到按需 source 时兜底） */
    waveform?: number[]
    /** 紧凑模式（历史卡片用）：藏整体进度条行，波形本身就是进度条（可拖 seek） */
    compact?: boolean
  }>(),
  { url: "", name: "", waveform: undefined, compact: false },
)

const player = ref<InstanceType<typeof AudioWavePlayer> | null>(null)
const playerPlaying = computed(() => player.value?.playing ?? false)
const playerCurrent = computed(() => player.value?.current ?? 0)
const playerDuration = computed(() => player.value?.duration ?? 0)

/** 文件大小（字节数读不到就空着，不显示这一段） */
const sizeText = ref("")
let sizeAbort: AbortController | null = null

function formatSize(bytes: number): string {
  if (!(bytes > 0)) return ""
  const kb = 1024
  const mb = kb * 1024
  if (bytes >= mb) return (bytes / mb).toFixed(1) + " MB"
  if (bytes >= kb) return Math.round(bytes / kb) + " KB"
  return String(bytes) + " B"
}

/** 大小探测：先 HEAD content-length；拿不到再用 Range 请求读 content-range 总长 */
async function fetchSize(url: string): Promise<void> {
  sizeText.value = ""
  if (!url || typeof fetch !== "function") return
  sizeAbort?.abort()
  const ctl = new AbortController()
  sizeAbort = ctl
  try {
    let bytes = 0
    const head = await fetch(url, { method: "HEAD", signal: ctl.signal })
    if (head.ok) bytes = Number(head.headers.get("content-length") ?? 0)
    if (!(bytes > 0)) {
      const part = await fetch(url, { headers: { Range: "bytes=0-0" }, signal: ctl.signal })
      const total = (part.headers.get("content-range") ?? "").split("/")[1]
      bytes = Number(total ?? 0)
    }
    if (ctl.signal.aborted) return
    sizeText.value = formatSize(bytes)
  } catch {
    /* 拿不到大小就不显示 —— 预览不因它失败 */
  }
}

onMounted(() => {
  void fetchSize(props.url)
})

watch(
  () => props.url,
  () => {
    void fetchSize(props.url)
  },
)

onBeforeUnmount(() => {
  sizeAbort?.abort()
})
</script>

<template>
  <div v-if="url" class="apv-root">
    <!-- 红框部分（波形 + 播放头 + 进度条）来自共用播放器 -->
    <AudioWavePlayer ref="player" :url="url" :waveform="waveform" :compact="compact" />

    <!-- 预览壳自己的底栏：播放按钮 + 时长 + 大小 + 文件名 -->
    <div class="apv-bar">
      <button
        class="apv-btn"
        type="button"
        :title="playerPlaying ? '暂停' : '播放'"
        :aria-label="playerPlaying ? '暂停' : '播放'"
        @click.stop="player?.togglePlay()"
      >
        <svg v-if="!playerPlaying" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="7,4 19,12 7,20" /></svg>
        <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
      </button>
      <span class="apv-time">{{ formatClock(playerCurrent) }} / {{ formatClock(playerDuration) }}</span>
      <span v-if="sizeText" class="apv-size">{{ sizeText }}</span>
      <span v-if="name" class="apv-name" :title="name">{{ name }}</span>
    </div>
  </div>
</template>

<style scoped>
.apv-root {
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 8px 10px;
}

/* 控件条：播放按钮 + 时间 + 大小 + 文件名 */
.apv-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: none;
}
.apv-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
  color: var(--ui-ink, inherit);
  cursor: pointer;
  transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.18s ease;
}
.apv-btn:hover {
  background: var(--ui-hover, rgb(0 0 0 / 0.06));
}
.apv-btn:active {
  transform: scale(0.97);
}
.apv-btn svg {
  width: 13px;
  height: 13px;
}
.apv-time {
  flex: none;
  font-size: 11px;
  color: var(--ui-ink-dim, #666);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.apv-size {
  flex: none;
  font-size: 11px;
  color: var(--ui-ink-mute, #888);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.apv-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--ui-ink-mute, #888);
  text-align: right;
}
</style>
