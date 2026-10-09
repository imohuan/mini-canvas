<script setup lang="ts">
/**
 * ImageViewer — 全屏图片查看器
 *
 * 支持：缩放/旋转/翻转/左右切换/键盘快捷键/下载。
 * 通过 props.visible 控制显隐。
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import AxIcon from './AxIcon.vue'

const props = defineProps<{
  /** 图片 URL 列表 */
  images: string[]
  /** 初始图片索引 */
  initialIndex?: number
  /** 是否可见 */
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  close: []
}>()

const currentIndex = ref(props.initialIndex ?? 0)
const scale = ref(1)
const rotation = ref(0)
const flip = ref(false)
const offsetX = ref(0)
const offsetY = ref(0)
const isDragging = ref(false)
const dragStartX = ref(0)
const dragStartY = ref(0)

const currentImage = computed(() => props.images[currentIndex.value] ?? '')
const isMultiple = computed(() => props.images.length > 1)

const imageStyle = computed(() => ({
  transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${scale.value}) rotate(${rotation.value}deg) scaleX(${flip.value ? -1 : 1})`,
  transition: isDragging.value ? 'none' : 'transform 0.2s ease',
}))

function close(): void {
  emit('update:visible', false)
  emit('close')
}

function prevImage(): void {
  if (!isMultiple.value) return
  currentIndex.value = (currentIndex.value - 1 + props.images.length) % props.images.length
  resetTransform()
}

function nextImage(): void {
  if (!isMultiple.value) return
  currentIndex.value = (currentIndex.value + 1) % props.images.length
  resetTransform()
}

function zoomIn(): void { scale.value = Math.min(scale.value + 0.25, 5) }
function zoomOut(): void { scale.value = Math.max(scale.value - 0.25, 0.25) }
function rotateImg(): void { rotation.value = (rotation.value + 90) % 360 }
function toggleFlip(): void { flip.value = !flip.value }
function reset(): void {
  scale.value = 1; rotation.value = 0
  flip.value = false; offsetX.value = 0; offsetY.value = 0
}
function resetTransform(): void {
  scale.value = 1; rotation.value = 0
  flip.value = false; offsetX.value = 0; offsetY.value = 0
}

function handleWheel(e: WheelEvent): void {
  e.preventDefault()
  scale.value = Math.min(Math.max(scale.value + (e.deltaY > 0 ? -0.1 : 0.1), 0.25), 5)
}

function handleMouseDown(e: MouseEvent): void {
  if ((e.target as HTMLElement).closest('.ax-image-viewer-controls')) return
  isDragging.value = true
  dragStartX.value = e.clientX - offsetX.value
  dragStartY.value = e.clientY - offsetY.value
}
function handleMouseMove(e: MouseEvent): void {
  if (!isDragging.value) return
  offsetX.value = e.clientX - dragStartX.value
  offsetY.value = e.clientY - dragStartY.value
}
function handleMouseUp(): void { isDragging.value = false }

async function downloadImage(): Promise<void> {
  if (!currentImage.value) return
  try {
    const resp = await fetch(currentImage.value)
    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `image_${currentIndex.value + 1}.jpg`
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    window.open(currentImage.value, '_blank')
  }
}

function handleKeydown(e: KeyboardEvent): void {
  switch (e.key) {
    case 'Escape': close(); break
    case 'ArrowLeft': case 'a': case 'A': prevImage(); break
    case 'ArrowRight': case 'd': case 'D': nextImage(); break
    case '+': case '=': zoomIn(); break
    case '-': zoomOut(); break
    case '0': reset(); break
    case 'r': case 'R': rotateImg(); break
    case 'f': case 'F': toggleFlip(); break
  }
}

watch(() => props.visible, (v) => {
  if (v) {
    currentIndex.value = props.initialIndex ?? 0
    reset()
    document.addEventListener('keydown', handleKeydown)
    document.body.style.overflow = 'hidden'
  } else {
    document.removeEventListener('keydown', handleKeydown)
    document.body.style.overflow = ''
  }
})

watch(() => props.initialIndex, (v) => { currentIndex.value = v ?? 0 })

onMounted(() => {
  if (props.visible) {
    document.addEventListener('keydown', handleKeydown)
    document.body.style.overflow = 'hidden'
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="ax-image-viewer"
      @click.self="close"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
    >
      <!-- 关闭按钮 -->
      <button class="ax-image-viewer-close" title="关闭 (Esc)" @click="close">
        <AxIcon name="close" :size="20" />
      </button>

      <!-- 主内容 -->
      <div class="ax-image-viewer-container">
        <!-- 上一张 -->
        <button v-if="isMultiple" class="ax-image-viewer-nav ax-image-viewer-nav-prev" title="上一张 (←)" @click.stop="prevImage">
          <AxIcon name="chevron_left" :size="24" />
        </button>

        <!-- 图片 -->
        <div class="ax-image-viewer-image-area" @wheel="handleWheel">
          <img
            v-if="currentImage"
            :src="currentImage"
            class="ax-image-viewer-image"
            :class="{ 'ax-image-viewer-image-dragging': isDragging }"
            :style="imageStyle"
            draggable="false"
          />
        </div>

        <!-- 下一张 -->
        <button v-if="isMultiple" class="ax-image-viewer-nav ax-image-viewer-nav-next" title="下一张 (→)" @click.stop="nextImage">
          <AxIcon name="chevron_right" :size="24" />
        </button>
      </div>

      <!-- 底部控制栏 -->
      <div class="ax-image-viewer-controls">
        <div class="ax-image-viewer-controls-inner">
          <template v-if="isMultiple">
            <span class="ax-image-viewer-page">{{ currentIndex + 1 }} / {{ images.length }}</span>
            <div class="ax-image-viewer-divider" />
          </template>

          <div class="ax-image-viewer-zoom-group">
            <button class="ax-image-viewer-btn" title="缩小 (-)" @click="zoomOut"><AxIcon name="zoom_out" :size="14" /></button>
            <span class="ax-image-viewer-zoom-label">{{ Math.round(scale * 100) }}%</span>
            <button class="ax-image-viewer-btn" title="放大 (+)" @click="zoomIn"><AxIcon name="zoom_in" :size="14" /></button>
          </div>

          <div class="ax-image-viewer-divider" />
          <button class="ax-image-viewer-btn" title="旋转 (R)" @click="rotateImg"><AxIcon name="rotate_right" :size="14" /></button>
          <button class="ax-image-viewer-btn" title="翻转 (F)" @click="toggleFlip"><AxIcon name="flip" :size="14" /></button>
          <button class="ax-image-viewer-btn" title="重置 (0)" @click="reset"><AxIcon name="refresh" :size="14" /></button>
          <div class="ax-image-viewer-divider" />
          <button class="ax-image-viewer-btn" title="下载" @click="downloadImage"><AxIcon name="download" :size="14" /></button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
