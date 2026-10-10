<!-- 文件：packages/docs/public/examples/slots/plugin-demo-badge/src/ZoomBadgeOverlay.vue -->
     格式：Vue 单文件组件（被 ctx.slots 挂到 overlay 槽，由渲染层的 SlotHost 渲染）
     位置：插件包内部；它只知道"我在 overlay 槽里"，不知道是谁渲染的 -->
<script setup lang="ts">
// ① 从渲染层拿画布上下文（走 useCanvasRender，它带着 viewport 这份响应式数据）
import { computed } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'

const { flow } = useCanvasRender()

// ② 缩放值：viewport 是响应式的，zoom 一变这里自动重算
const zoomPercent = computed(() => Math.round((flow.viewport.value?.zoom ?? 1) * 100))
</script>

<template>
  <!-- ③ overlay 槽铺满画布，所以"摆在哪、要不要接鼠标"由本组件自己负责 -->
  <div class="demo-zoom-badge">{{ zoomPercent }}%</div>
</template>

<style scoped>
.demo-zoom-badge {
  position: absolute;
  right: 12px;
  top: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 12px;
  pointer-events: none; /* 小角标不接鼠标，别抢画布的交互 */
}
</style>

