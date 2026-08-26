<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { useVueFlow } from '@vue-flow/core'
import { computed, ref, onMounted, onUnmounted, useTemplateRef, nextTick } from 'vue'
import { useCanvasStore } from '../../composables/useCanvasStore'

defineOptions({ inheritAttrs: false })
const props = defineProps<NodeProps>()
const text = ref((props.data?.text as string) || '双击编辑文本...')
const editing = ref(false)
const editRef = useTemplateRef('editRef')

const canvas = useCanvasStore()
const { viewport } = useVueFlow('main-canvas')

const zoom = computed(() => Math.max(viewport.value.zoom || 1, 0.01))

/**
 * 缩放分级（LOD）：
 * - full：正常显示全部文本（随画布一起缩放，不反向缩放，避免每帧重算 transform/fontSize）
 * - condensed：缩到较小时只显示首行截断，减少文字重排成本
 * - icon：极小缩放时只显示一个缩略标识符，几乎零重绘成本
 * 阈值取自画布全局设置，可在面板里调。
 */
const fullZoom = computed(() => Math.max(canvas.state.core.nodeTitleScaleMinZoom, 0.2))
const iconZoom = computed(() => Math.max(canvas.state.core.textLodIconZoom ?? 0.18, 0.05))

const lod = computed<'full' | 'condensed' | 'icon'>(() => {
  if (zoom.value >= fullZoom.value) return 'full'
  if (zoom.value < iconZoom.value) return 'icon'
  return 'condensed'
})

function startEdit() {
  if (lod.value === 'icon') return // 极小缩放下不进入编辑，避免误操作
  editing.value = true
  nextTick(() => {
    editRef.value?.focus()
  })
}

function finishEdit() {
  editing.value = false
}

function isTextInputTarget(target: EventTarget | null): target is HTMLTextAreaElement | HTMLInputElement {
  return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
}

function stopInputPropagation(event: Event) {
  if (!editing.value) return
  if (isTextInputTarget(event.target)) {
    event.stopPropagation()
    event.stopImmediatePropagation?.()
  }
}

function onCanvasDoubleClick(e: Event) {
  const detail = (e as CustomEvent).detail as { nodeId: string }
  if (detail?.nodeId === props.id && !editing.value) {
    startEdit()
  }
}

onMounted(() => {
  window.addEventListener('nodeDoubleClick', onCanvasDoubleClick)
})

onUnmounted(() => {
  window.removeEventListener('nodeDoubleClick', onCanvasDoubleClick)
})
</script>

<template>
  <div class="w-full h-full p-4 overflow-hidden">
    <!-- 极小缩放：整块灰色扫光背景占位，零文本重排 -->
    <div v-if="lod === 'icon'" class="text-node-lod-icon w-full h-full" aria-hidden="true">
      <div class="text-node-skel" />
    </div>

    <!-- 编辑态：textarea（仅 full / condensed 显示真实文本） -->
    <textarea
      v-else-if="editing"
      ref="editRef"
      v-model="text"
      class="text-node-content w-full h-full resize-none border-none outline-none bg-transparent text-gray-700 leading-relaxed"
      placeholder="输入文本..."
      @blur="finishEdit"
      @keydown.escape="finishEdit"
      @pointerdown="stopInputPropagation"
      @pointerup="stopInputPropagation"
      @mousedown="stopInputPropagation"
      @click="stopInputPropagation"
      autofocus />

    <!-- 只读展示：随画布自然缩放，不做反向 scale -->
    <div
      v-else
      class="text-node-content w-full h-full text-gray-700 leading-relaxed whitespace-pre-wrap overflow-hidden cursor-text"
      :class="{ 'is-condensed': lod === 'condensed' }"
      @dblclick="startEdit">
      {{ text }}
    </div>
  </div>
</template>

<style scoped>
.text-node-content {
  text-rendering: geometricPrecision;
  -webkit-font-smoothing: antialiased;
  /* 不再使用 will-change: transform — 取消逐帧合成层，交给浏览器统一处理缩放 */
  contain: content;
}
/* condensed：只显示首行，减少文字重排/绘制面积 */
.text-node-content.is-condensed {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  white-space: normal;
}
.text-node-lod-icon {
  color: #9ca3af;
  user-select: none;
}
/* icon 模式：整块灰色 + 扫光高亮，作为缩略占位 */
.text-node-skel {
  width: 100%;
  height: 100%;
  background: #eceef1;
  position: relative;
  overflow: hidden;
}
.text-node-skel::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: -60%;
  width: 45%;
  background: linear-gradient(105deg, transparent 0%, rgba(255, 255, 255, 0.65) 50%, transparent 100%);
  transform: skewX(-18deg);
  animation: text-node-shimmer 1.3s infinite ease-in-out;
  will-change: left, transform;
}
@keyframes text-node-shimmer {
  0% { left: -60%; }
  60%, 100% { left: 140%; }
}
</style>
(file uses CRLF line endings)
