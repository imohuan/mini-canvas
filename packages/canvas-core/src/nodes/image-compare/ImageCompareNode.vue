<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { useVueFlow } from '@vue-flow/core'
import { ref, computed, inject, watch } from 'vue'
import { NodeIdInjection } from '@vue-flow/core'
import type { Edge, Node } from '@vue-flow/core'

defineOptions({ inheritAttrs: false })
const props = defineProps<NodeProps>()
const nodeId = inject(NodeIdInjection, null) as string | null
const { getEdges, findNode, updateNode } = useVueFlow()

const containerRef = ref<HTMLDivElement | null>(null)
const dividerPos = ref(50)
const isDragging = ref(false)

const MAX_CARD_WIDTH = 640
const MAX_CARD_HEIGHT = 480
const MIN_CARD_WIDTH = 200
const MIN_CARD_HEIGHT = 150

interface ImageInfo {
  url: string
  name: string
  width: number
  height: number
}

/** 从左到右按连接顺序取得 2 个上游图片信息 */
const connectedImages = computed<ImageInfo[]>(() => {
  if (!nodeId) return []
  const edges = getEdges.value as Edge[]
  return edges
    .filter(e => e.target === nodeId && e.targetHandle === 'target')
    .map(e => {
      const sourceNode = findNode(e.source) as Node | undefined
      const data = sourceNode?.data as any
      return {
        url: (data?.imageUrl as string) || '',
        name: (data?.imageName as string) || (data?.label as string) || '',
        width: (data?.imageWidth as number) || 0,
        height: (data?.imageHeight as number) || 0,
      }
    })
    .filter(item => item.url)
    .slice(0, 2)
})

const leftImage = computed(() => connectedImages.value[0]?.url || '')
const rightImage = computed(() => connectedImages.value[1]?.url || '')
const leftName = computed(() => connectedImages.value[0]?.name || '')
const rightName = computed(() => connectedImages.value[1]?.name || '')
const hasTwoImages = computed(() => !!leftImage.value && !!rightImage.value)
const hasOneImage = computed(() => !!leftImage.value && !rightImage.value)

/** 根据连接图片的原始尺寸计算卡片宽高：取两张图的最大宽和最大高，按宽高比缩放到 MAX 范围内 */
function calcCardSize(images: ImageInfo[]): { w: number; h: number } {
  if (images.length === 0) return { w: 500, h: 350 }

  const maxW = Math.max(...images.map(i => i.width || 1))
  const maxH = Math.max(...images.map(i => i.height || 1))

  if (maxW <= 0 || maxH <= 0) return { w: 500, h: 350 }

  const ratio = maxW / maxH

  let w: number, h: number
  if (ratio > MAX_CARD_WIDTH / MAX_CARD_HEIGHT) {
    w = MAX_CARD_WIDTH
    h = Math.round(MAX_CARD_WIDTH / ratio)
  } else {
    h = MAX_CARD_HEIGHT
    w = Math.round(MAX_CARD_HEIGHT * ratio)
  }

  return {
    w: Math.max(MIN_CARD_WIDTH, Math.min(MAX_CARD_WIDTH, w)),
    h: Math.max(MIN_CARD_HEIGHT, Math.min(MAX_CARD_HEIGHT, h)),
  }
}

/** 图片尺寸变化时更新节点 cardWidth/cardHeight */
watch(
  () => connectedImages.value.map(i => `${i.width}x${i.height}`).join(','),
  () => {
    if (!nodeId) return
    const size = calcCardSize(connectedImages.value)
    const current = props.data as any
    if (current?.cardWidth === size.w && current?.cardHeight === size.h) return
    updateNode(nodeId, {
      data: { ...(props.data as any), cardWidth: size.w, cardHeight: size.h },
    })
  },
  { immediate: true },
)

function onDividerPointerDown(e: PointerEvent) {
  e.preventDefault()
  e.stopPropagation()
  isDragging.value = true
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}

function onDividerPointerMove(e: PointerEvent) {
  if (!isDragging.value || !containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  const x = e.clientX - rect.left
  const pct = Math.max(0, Math.min(100, (x / rect.width) * 100))
  dividerPos.value = pct
}

function onDividerPointerUp(_e: PointerEvent) {
  isDragging.value = false
}
</script>

<template>
  <div ref="containerRef" class="compare-root">
    <!-- 无连接占位 -->
    <div v-if="!connectedImages.length" class="compare-empty">
      <svg class="compare-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="8" height="18" rx="1"/>
        <rect x="13" y="3" width="8" height="18" rx="1"/>
        <circle cx="12" cy="12" r="2" fill="currentColor"/>
      </svg>
      <span class="compare-empty-text">连接 2 个图片节点进行对比</span>
    </div>

    <!-- 只有一张图：直接显示 -->
    <template v-if="hasOneImage">
      <img :src="leftImage" class="compare-img-full" draggable="false" />
      <div class="compare-hint">再连接一个图片节点进行对比</div>
    </template>

    <!-- 两张图：分割对比 -->
    <template v-if="hasTwoImages">
      <!-- 右图（底层） -->
      <img :src="rightImage" class="compare-img-full" draggable="false" />
      <!-- 左图（上层，clip 到分割线左侧） -->
      <img :src="leftImage" class="compare-img-full" :style="{ clipPath: `inset(0 ${100 - dividerPos}% 0 0)` }" draggable="false" />

      <!-- 分割线 + 手柄 -->
      <div class="compare-divider" :style="{ left: `${dividerPos}%` }"
        @pointerdown="onDividerPointerDown"
        @pointermove="onDividerPointerMove"
        @pointerup="onDividerPointerUp">
        <div class="compare-divider-line" />
        <!-- 拖拽手柄 -->
        <div class="compare-handle">
          <svg class="compare-handle-arrows" viewBox="0 0 16 16" fill="none">
            <path d="M10.5 2.5L13.5 5.5L10.5 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M5.5 13.5L2.5 10.5L5.5 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </div>

      <!-- 左右标签 -->
      <div class="compare-label compare-label-left">{{ leftName || '左' }}</div>
      <div class="compare-label compare-label-right">{{ rightName || '右' }}</div>
    </template>
  </div>
</template>

<style scoped>
.compare-root {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  user-select: none;
  background: #f3f4f6;
}

/* 占位 */
.compare-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #f9fafb;
}
.compare-empty-icon {
  width: 36px;
  height: 36px;
  color: #d1d5db;
}
.compare-empty-text {
  font-size: 12px;
  color: #9ca3af;
}

/* 全图显示 */
.compare-img-full {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* 提示 */
.compare-hint {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 4px;
  pointer-events: none;
  white-space: nowrap;
}

/* 分割线容器 */
.compare-divider {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 10;
  cursor: col-resize;
  touch-action: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  transform: translateX(-50%);
}

/* 分割线 */
.compare-divider-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #fff;
  box-shadow: 0 0 6px rgba(0, 0, 0, 0.35);
}

/* 拖拽手柄 */
.compare-handle {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 32px;
  height: 32px;
  background: #fff;
  border: 1.5px solid #d1d5db;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  transition: box-shadow 0.15s;
}
.compare-handle:hover {
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
}

/* 手柄内箭头 */
.compare-handle-arrows {
  width: 16px;
  height: 16px;
  color: #6b7280;
}

/* 标签 */
.compare-label {
  position: absolute;
  top: 6px;
  font-size: 10px;
  color: #fff;
  background: rgba(0, 0, 0, 0.45);
  padding: 1px 6px;
  border-radius: 3px;
  pointer-events: none;
}
.compare-label-left {
  left: 6px;
}
.compare-label-right {
  right: 6px;
}
</style>

