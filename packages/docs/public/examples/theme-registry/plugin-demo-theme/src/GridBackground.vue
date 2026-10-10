<!-- 文件：packages/docs/public/examples/theme-registry/plugin-demo-theme/src/GridBackground.vue -->
     格式：Vue 单文件组件（themeRegistry 的 background 槽赢家，被宿主垫在节点之下渲染）
     位置：插件包内部；拿不到 props，全靠渲染上下文与自身 CSS -->
<script setup lang="ts">
// ① 渲染上下文里的 viewport 是响应式的：x/y/zoom 一变，style 自动重算
import { computed } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'

const { flow } = useCanvasRender()

const GRID = 24   // 一个格子的内容坐标大小（px）

const gridStyle = computed(() => {
  const vx = flow.viewport.value?.x ?? 0
  const vy = flow.viewport.value?.y ?? 0
  const zoom = Math.max(flow.viewport.value?.zoom ?? 1, 0.01)
  return {
    backgroundPosition: vx + 'px ' + vy + 'px',                 // ② 跟着画布平移
    backgroundSize: GRID * zoom + 'px ' + GRID * zoom + 'px',   // ③ 跟着画布缩放
  }
})
</script>

<template>
  <!-- ④ 铺满 + 不挡交互：和默认背景同一套约束 -->
  <div class="demo-grid-bg" :style="gridStyle" />
</template>

<style scoped>
.demo-grid-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-color: #0f172a;
  background-image:
    linear-gradient(rgba(148, 163, 184, 0.25) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.25) 1px, transparent 1px);
}
</style>

