<script setup lang="ts">
/**
 * AudioContent —— audio 节点的内容段：播放音频（data.audioUrl）。
 *
 * 画布此前没有音频节点类型，本插件补一个（web2api 的 TTS / 音频生成要落到画布上）。
 * 保持最小：一个带元信息的播放条 + 空态占位。端口/标题由 BaseNode 壳负责，这里不碰。
 */
import { computed } from 'vue'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const audioUrl = computed(() => (typeof props.data?.audioUrl === 'string' ? props.data.audioUrl : ''))
const audioName = computed(() => (typeof props.data?.audioName === 'string' ? props.data.audioName : ''))
const speaker = computed(() => (typeof props.data?.audioSpeaker === 'string' ? props.data.audioSpeaker : ''))
</script>

<template>
  <div class="ac-root">
    <div v-if="audioUrl" class="ac-player">
      <!-- eslint-disable-next-line vue/multiline-html-element-content-newline -->
      <audio class="ac-audio" :src="audioUrl" controls preload="metadata" />
      <div v-if="audioName || speaker" class="ac-meta">
        <span v-if="audioName" class="ac-meta-item" :title="audioName">{{ audioName }}</span>
        <span v-if="speaker" class="ac-meta-item" :title="speaker">{{ speaker }}</span>
      </div>
    </div>
    <div v-else class="ac-empty">
      <span class="ac-empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3v10.5" />
          <path d="M9 6v4.5" />
          <path d="M15 6v4.5" />
          <path d="M7 8.5v6" />
          <path d="M17 8.5v6" />
          <path d="M23 10.5v3" />
          <path d="M1 10.5v3" />
        </svg>
      </span>
      <span class="ac-empty-text">下方控制栏里选一个音频动作生成语音</span>
    </div>
  </div>
</template>

<style scoped>
.ac-root {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 10px;
  overflow: hidden;
}
.ac-player {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}
.ac-audio {
  width: 100%;
  height: 36px;
}
.ac-meta {
  display: flex;
  gap: 8px;
  min-width: 0;
}
.ac-meta-item {
  overflow: hidden;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ac-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 12px;
  text-align: center;
}
.ac-empty-icon {
  display: inline-flex;
  width: 22px;
  height: 22px;
}
.ac-empty-icon svg {
  width: 22px;
  height: 22px;
}
</style>
