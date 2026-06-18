<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { ref } from 'vue'

const props = defineProps<NodeProps>()
const playing = ref(false)
</script>

<template>
  <div class="w-full h-full flex items-center justify-center rounded-xl overflow-hidden">
    <div v-if="!playing" class="flex flex-col items-center gap-2 cursor-pointer" @click="playing = true">
      <div class="w-16 h-16 rounded-full bg-white/80 flex items-center justify-center shadow-lg">
        <svg class="w-8 h-8 text-gray-800 ml-1" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5,3 19,12 5,21" />
        </svg>
      </div>
      <span class="text-white text-sm">{{ props.data?.label || '视频' }}</span>
    </div>
    <video v-else :src="props.data?.videoUrl" class="w-full h-full object-cover" controls autoplay />
  </div>
</template>
