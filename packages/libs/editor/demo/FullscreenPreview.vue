<template>
  <div
    v-if="visible"
    class="fullscreen-preview"
    @click="$emit('close')"
  >
    <div class="close-btn">×</div>
    <img
      v-if="type === 'image' && url"
      :src="url"
    />
    <video
      v-if="type === 'video' && url"
      ref="videoRef"
      :src="url"
      controls
      autoplay
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  visible: boolean;
  url: string;
  type: 'image' | 'video';
}>();

defineEmits<{
  close: [];
}>();

const videoRef = ref<HTMLVideoElement | null>(null);

watch(
  () => props.visible,
  (visible) => {
    if (!visible && videoRef.value) {
      videoRef.value.pause();
    }
  }
);
</script>
