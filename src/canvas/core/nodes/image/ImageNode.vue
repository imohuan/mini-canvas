<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { ref, computed, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import ImageCropper from './ImageCropper.vue'
import ImageExpander from './ImageExpander.vue'
import ImageMasker from './ImageMasker.vue'
import { useCanvasRuntime } from '../../runtime/useCanvasRuntime'
import type { MaskConfig } from '../../types/CanvasNodeData'

defineOptions({ inheritAttrs: false })

const props = defineProps<NodeProps>()
const { updateNode } = useVueFlow()
const runtime = useCanvasRuntime()
const error = ref(false)

const isCropping = computed(() => props.data?._overlay?._cropMode === true)
const isExpanding = computed(() => props.data?._overlay?._expandMode === true)
const isMasking = computed(() => props.data?._overlay?._maskMode === true)
const maskConfig = computed<MaskConfig>(() => props.data?._overlay?._maskConfig || { brushSize: 20, brushColor: '#ff0000', brushOpacity: 0.5, isErasing: false })

function onCropUpdate(rect: { x: number; y: number; width: number; height: number }) {
  updateNode(props.id, { data: { ...props.data, _overlay: { ...props.data._overlay, _cropRect: rect } } })
}

function onExpandUpdate(rect: { x: number; y: number; width: number; height: number }) {
  updateNode(props.id, { data: { ...props.data, _overlay: { ...props.data._overlay, _expandRect: rect } } })
}

function onExpandCancel() {
  runtime.commandRegistry.execute('image.expandCancel', { runtime, node: props } as any)
}
function onExpandConfirm() {
  runtime.commandRegistry.execute('image.expandConfirm', { runtime, node: props } as any)
}

function onMaskUpdate(blobUrl: string | null) {
  updateNode(props.id, { data: { ...props.data, maskUrl: blobUrl } })
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
      :class="{ '-opacity-30': isCropping || isExpanding || isMasking }"
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

    <ImageExpander
      v-if="isExpanding && data?.imageUrl"
      :node-id="id"
      :image-url="data.imageUrl"
      :image-width="(data.imageWidth as number) || 0"
      :image-height="(data.imageHeight as number) || 0"
      @update:expand="onExpandUpdate"
      @cancel="onExpandCancel"
      @confirm="onExpandConfirm"
    />

    <ImageMasker
      v-if="isMasking && data?.imageUrl"
      :node-id="id"
      :image-url="data.imageUrl"
      :image-width="(data.imageWidth as number) || 0"
      :image-height="(data.imageHeight as number) || 0"
      :mask-config="maskConfig"
      :mask-data-url="(data?.maskUrl as string) || null"
      @update:mask-data="onMaskUpdate"
    />
  </div>
</template>
