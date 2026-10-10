<!-- 文件：packages/docs/public/examples/canvas-render/settings-slot-host/src/DemoOverlay.vue -->
     格式：Vue 单文件组件（挂在 overlay 槽，被 SlotHost 渲染）
     位置：插件包内部；它只知道「我在 overlay 槽里」 -->
<script setup lang="ts">
import { computed } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'

const { flow } = useCanvasRender()
// ① 缩放值：flow.viewport 是响应式 Ref，缩放一变这里自动重算
const zoomPercent = computed(() => Math.round((flow.viewport.value?.zoom ?? 1) * 100))
</script>

<template>
  <!-- ② overlay 那层铺满画布且 pointer-events:none，所以「摆在哪、要不要接鼠标」由自己负责 -->
  <div class="demo-badge">{{ zoomPercent }}%</div>
</template>

<style scoped>
.demo-badge {
  position: absolute; right: 12px; top: 12px; padding: 2px 8px; border-radius: 6px;
  background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 12px;
  pointer-events: none;   /* 小角标不接鼠标，别抢画布交互 */
}
</style>
