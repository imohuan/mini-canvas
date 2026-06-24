<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { ref, computed, watch } from 'vue'
import ImageCropper from './ImageCropper.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<NodeProps>()
const error = ref(false)

const isCropping = computed(() => (props.data?._cropMode as boolean) ?? false)

watch(
  () => props.data?.imageUrl,
  () => { error.value = false },
)
</script>

<template>
  <div class="w-full h-full overflow-hidden rounded-xl relative">
    <img
      v-if="data?.imageUrl && !error"
      :src="data.imageUrl"
      :alt="data?.label || '图片'"
      class="w-full h-full object-contain bg-gray-50"
      :class="{ 'opacity-30': isCropping }"
      @error="error = true"
    />
    <div v-else class="w-full h-full flex items-center justify-center bg-gray-100">
      <svg class="w-12 h-12 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none" />
        <path d="M21 15l-5-5L5 21" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </div>

    <ImageCropper
      v-if="isCropping && data?.imageUrl"
      :node-id="id"
      :image-url="data.imageUrl"
      :image-width="(data.imageWidth as number) || 0"
      :image-height="(data.imageHeight as number) || 0"
    />
  </div>
</template>
