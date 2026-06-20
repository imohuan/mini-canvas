<script setup lang="ts">
defineOptions({ inheritAttrs: false })

import type { NodeProps } from '@vue-flow/core'
import { Position, useVueFlow } from '@vue-flow/core'
import { ref, computed } from 'vue'
import { useCanvasStore } from '../../composables/useCanvasStore'
import NodeToolbar from '../../components/Decoration/NodeToolbar.vue'
import ToolbarButton from '../../components/Decoration/ToolbarButton.vue'
import ImageCropper from './ImageCropper.vue'
import { usePluginApi } from '../../runtime'
import type { StorageAPI } from '../../plugins/storage/StoragePlugin'

const props = defineProps<NodeProps>()
const canvas = useCanvasStore()
const { getNodes, updateNode, fitView } = useVueFlow()
const fileInputRef = ref<HTMLInputElement | null>(null)
const MAX_PREVIEW_WIDTH = 420
const MAX_PREVIEW_HEIGHT = 300

// ==================== Crop State ====================
const isCropping = computed(() => (props.data?._cropMode as boolean) ?? false)

// ==================== Upload ====================
function openImagePicker() {
  fileInputRef.value?.click()
}

function fitCardSize(width: number, height: number) {
  const ratio = Math.min(MAX_PREVIEW_WIDTH / width, MAX_PREVIEW_HEIGHT / height, 1)
  return {
    cardWidth: Math.max(120, Math.round(width * ratio)),
    cardHeight: Math.max(80, Math.round(height * ratio)),
  }
}

function readImageDims(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image()
    const url = URL.createObjectURL(file)
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
      URL.revokeObjectURL(url)
    }
    image.onerror = () => {
      resolve(null)
      URL.revokeObjectURL(url)
    }
    image.src = url
  })
}

async function uploadImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const imageUrl = URL.createObjectURL(file)
  const dims = await readImageDims(file)
  const nextSize = dims ? fitCardSize(dims.width, dims.height) : null
  const node = getNodes.value.find(n => n.id === props.id)

  // 通过 storage 单例持久化
  const assetManager = usePluginApi<StorageAPI>('storage')?.assets
  let assetId: string | undefined
  if (assetManager) {
    try {
      const storeType = assetManager.getStore()?.constructor.name ?? 'null'
      console.log(`[ImageTopToolbar] 保存图片到 ${storeType}`, file.name)
      assetId = await assetManager.saveAsset(file, file.name, file.type)
      console.log(`[ImageTopToolbar] 图片已保存, assetId:`, assetId)
    } catch (err) {
      console.error('[ImageTopToolbar] 保存图片资产失败:', err)
    }
  } else {
    console.warn('[ImageTopToolbar] assetManager 未初始化，图片未持久化')
  }

  updateNode(props.id, {
    data: {
      ...(node?.data ?? {}),
      assetId,
      imageUrl,
      imageName: file.name,
      imageType: file.type,
      imageWidth: dims?.width,
      imageHeight: dims?.height,
      cardWidth: nextSize?.cardWidth ?? node?.data?.cardWidth,
      cardHeight: nextSize?.cardHeight ?? node?.data?.cardHeight,
      resizable: true,
    },
  })
  input.value = ''
}

// ==================== Crop ====================
function startCrop() {
  const node = getNodes.value.find(n => n.id === props.id)
  if (!node?.data?.imageUrl || !node.data.imageWidth || !node.data.imageHeight) return

  // Enter crop mode
  updateNode(props.id, {
    data: { ...(node.data as any), _cropMode: true },
  })

  // Focus node in viewport
  fitView({
    nodes: [props.id],
    padding: 0.15,
    maxZoom: canvas.state.core.maxZoom,
    duration: 250,
  })
}

function cancelCrop() {
  const node = getNodes.value.find(n => n.id === props.id)
  updateNode(props.id, {
    data: { ...(node?.data as any), _cropMode: false, _cropRect: undefined },
  })
}

function confirmCrop() {
  const node = getNodes.value.find(n => n.id === props.id)
  const rect = (node?.data as any)?._cropRect as { x: number; y: number; width: number; height: number } | undefined
  if (!rect || rect.width < 1 || rect.height < 1) return

  const imgUrl = node?.data?.imageUrl as string
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = rect.width
    canvas.height = rect.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
    canvas.toBlob(async (blob) => {
      if (!blob) return
      const am = usePluginApi<StorageAPI>('storage')?.assets

      let newAssetId: string | undefined
      if (am) {
        try {
          newAssetId = await am.saveAsset(blob, 'cropped-image.png', 'image/png')
          console.log(`[ImageTopToolbar] 裁切图片已保存, assetId: ${newAssetId}`)
        } catch (err) {
          console.error('[ImageTopToolbar] 保存裁切图片失败:', err)
        }
      }

      const newUrl = URL.createObjectURL(blob)
      const oldUrl = node?.data?.imageUrl as string
      if (oldUrl?.startsWith('blob:')) URL.revokeObjectURL(oldUrl)

      const nextSize = fitCardSize(rect.width, rect.height)
      updateNode(props.id, {
        data: {
          ...(node?.data as any),
          assetId: newAssetId,
          imageUrl: newUrl,
          imageWidth: rect.width,
          imageHeight: rect.height,
          cardWidth: nextSize.cardWidth,
          cardHeight: nextSize.cardHeight,
          _cropMode: false,
          _cropRect: undefined,
        },
      })
    }, 'image/png')
  }
  img.src = imgUrl
}
</script>

<template>
  <NodeToolbar :position="Position.Top" :offset="canvas.state.core.topToolbarOffset" :is-visible="isCropping || undefined">
    <!-- Normal mode -->
    <div v-if="!isCropping" class="flex items-center gap-0.5 bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
      <input ref="fileInputRef" type="file" accept="image/*" class="hidden" @change="uploadImage" />
      <ToolbarButton @click="openImagePicker">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span>上传图片</span>
      </ToolbarButton>
      <ToolbarButton @click="startCrop">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" />
        </svg>
        <span>裁剪</span>
      </ToolbarButton>
      <ToolbarButton>
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke-linecap="round" />
        </svg>
        <span>滤镜</span>
      </ToolbarButton>
    </div>

    <!-- Crop mode -->
    <div v-else class="flex items-center gap-0.5 bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
      <ToolbarButton @click="cancelCrop">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
        <span>取消</span>
      </ToolbarButton>
      <ToolbarButton variant="primary" @click="confirmCrop">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span>确认裁剪</span>
      </ToolbarButton>
    </div>
  </NodeToolbar>

  <!-- Crop overlay (self-teleports to viewport) -->
  <ImageCropper
    v-if="isCropping && (props.data?.imageUrl as string) && (props.data?.imageWidth as number)"
    :node-id="props.id"
    :image-url="props.data?.imageUrl as string"
    :image-width="(props.data?.imageWidth as number) ?? 0"
    :image-height="(props.data?.imageHeight as number) ?? 0"
    @update:crop="(r:any) => updateNode(props.id, { data: { ...(props.data as any), _cropRect: r } })"
  />
</template>
