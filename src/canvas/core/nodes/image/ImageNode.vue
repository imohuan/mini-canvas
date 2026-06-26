<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { ref, computed, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import ImageCropper from './ImageCropper.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<NodeProps>()
const { updateNode } = useVueFlow()
const error = ref(false)

// 裁剪模式 → 读 _overlay._cropMode，退出时 delete _overlay 一步恢复
const isCropping = computed(() => props.data?._overlay?._cropMode === true)

// 同步裁剪区域到 node.data._cropRect，供确认命令读取
function onCropUpdate(rect: { x: number; y: number; width: number; height: number }) {
  updateNode(props.id, { data: { ...props.data, _cropRect: rect } })
}

watch(
  () => props.data?.imageUrl,
  () => { error.value = false },
)
</script>

<template>
  <div class="w-full h-full relative">
    <img
      v-if="data?.imageUrl && !error"
      :src="data.imageUrl"
      :alt="data?.label || '图片'"
      class="w-full h-full object-cover bg-gray-50"
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
      @update:crop="onCropUpdate"
    />
  </div>
</template>
