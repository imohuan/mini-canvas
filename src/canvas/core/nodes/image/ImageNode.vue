<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { ref, computed, watch } from 'vue'
import { useVueFlow, Position } from '@vue-flow/core'
import BaseNode from '../../components/Decoration/BaseNode.vue'
import NodeToolbar from '../../components/Decoration/NodeToolbar.vue'
import BaseToolbar from '../../components/Toolbar/BaseToolbar.vue'
import ImageCropper from './ImageCropper.vue'
import ImageExpander from './ImageExpander.vue'
import ImageMasker from './ImageMasker.vue'
import ImageBottomToolbar from './ImageBottomToolbar.vue'
import { useCanvasRuntime } from '../../runtime/useCanvasRuntime'
import { useCanvasStore } from '../../composables/useCanvasStore'
import type { MaskConfig } from '../../types/CanvasNodeData'

defineOptions({ inheritAttrs: false })

const props = defineProps<NodeProps>()
const { updateNode } = useVueFlow()
const runtime = useCanvasRuntime()
const canvas = useCanvasStore()
const error = ref(false)

const isCropping = computed(() => props.data?._overlay?._cropMode === true)
const isExpanding = computed(() => props.data?._overlay?._expandMode === true)
const isMasking = computed(() => props.data?._overlay?._maskMode === true)
const maskConfig = computed<MaskConfig>(() =>
  props.data?._overlay?._maskConfig || { brushSize: 20, brushColor: '#ff0000', brushOpacity: 0.5, isErasing: false },
)

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

// ---- 标题栏 ----
const nodeLabel = computed(() => (props.data?.label as string) || (props.data?.nodeType as string) || '图片')

const dims = computed(() => {
  const w = props.data?.imageWidth as number
  const h = props.data?.imageHeight as number
  if (w && h) return `${w}\u00d7${h}`
  return ''
})

const titleIconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/><path d="M21 15l-5-5L5 21" stroke-linecap="round" stroke-linejoin="round"/></svg>'

const bottomOffset = computed(() => canvas.state.core.bottomToolbarOffset)
</script>

<template>
  <BaseNode v-bind="$props">
    <!-- 标题栏图标 -->
    <template #title-icon>
      <span class="w-3.5 h-3.5 shrink-0 inline-flex items-center" v-html="titleIconSvg" />
    </template>

    <!-- 标题文字 -->
    <template #title-label>
      <span class="truncate">{{ nodeLabel }}</span>
    </template>

    <!-- 额外信息：原图分辨率 1920×1080 -->
    <template #title-extra>
      <span v-if="dims" class="text-gray-400 shrink-0 ml-auto">{{ dims }}</span>
    </template>

    <!-- 顶部工具栏：裁剪/扩展/蒙版/滤镜等 -->
    <template #top-toolbar>
      <BaseToolbar v-bind="$props" toolbar-position="top" />
    </template>

    <!-- 图片内容 -->
    <template #content>
      <div class="w-full h-full relative">
        <img
          v-if="data?.imageUrl && !error"
          :src="data.imageUrl"
          :alt="data?.label || '图片'"
          class="w-full h-full object-cover bg-gray-50"
          :class="{ 'opacity-30': isCropping || isExpanding || isMasking }"
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

    <!-- 底部工具栏：旋转/下载 -->
    <template #bottom-toolbar>
      <NodeToolbar :node-id="id" :position="Position.Bottom" :offset="bottomOffset">
        <ImageBottomToolbar v-bind="$props" />
      </NodeToolbar>
    </template>
  </BaseNode>
</template>
