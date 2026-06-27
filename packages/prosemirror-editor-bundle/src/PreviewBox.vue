<template>
  <div
    v-show="visible"
    class="preview-box"
    :style="{ left: position.left, top: position.top, transform: position.transform || 'translateX(-50%)' }"
  >
    <div class="preview-header">{{ title }}</div>
    <div class="preview-content">
      <!-- 图片预览 -->
      <img v-if="type === 'image' && url" :src="url" class="preview-image" draggable="false" />
      <!-- 视频预览 - 直接播放 -->
      <video
        v-if="type === 'video' && url"
        ref="videoRef"
        :src="url"
        class="preview-video"
        autoplay
        muted
        loop
        playsinline
        @loadedmetadata="onVideoLoaded"
      />
    </div>
    <!-- 视频时间显示 -->
    <div v-if="type === 'video'" class="preview-footer">
      {{ formattedTime }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from "vue";
import type { PreviewPosition } from "./types";

const props = defineProps<{
  visible: boolean;
  url: string;
  title: string;
  type: "image" | "video";
  position: PreviewPosition;
}>();

const videoRef = ref<HTMLVideoElement | null>(null);
const remainingTime = ref(0);

let videoTimer: ReturnType<typeof setInterval> | null = null;

// 格式化时间 - 显示剩余时间，无减号
const formattedTime = computed(() => {
  const totalSeconds = Math.floor(remainingTime.value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
});

function startVideoTimer() {
  // 清除之前的计时器
  if (videoTimer) clearInterval(videoTimer);

  videoTimer = setInterval(() => {
    if (videoRef.value) {
      const duration = videoRef.value.duration || 0;
      const current = videoRef.value.currentTime || 0;
      // 计算剩余时间
      remainingTime.value = Math.max(0, duration - current);
    }
  }, 1000);
}

function stopVideoTimer() {
  if (videoTimer) {
    clearInterval(videoTimer);
    videoTimer = null;
  }
}

// 监听 visible 变化，控制视频播放和计时器
watch(
  () => props.visible,
  (visible) => {
    if (visible && props.type === "video") {
      // 显示时启动计时器
      setTimeout(startVideoTimer, 100);
    } else {
      // 隐藏时停止计时器
      stopVideoTimer();
    }
  },
);

// 监听视频 loadedmetadata 事件，获取总时长
function onVideoLoaded() {
  if (videoRef.value) {
    remainingTime.value = videoRef.value.duration || 0;
  }
}

onUnmounted(() => {
  stopVideoTimer();
});
</script>
