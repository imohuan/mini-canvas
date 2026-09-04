<script setup lang="ts">
// DefaultEdge —— 主题插件提供的连线渲染组件（示例，自包含）。
// 关键 vue-flow 契约(见 docs/tmp/vueflow-contract)：
//  - 根是 SVG <g>；端点坐标来自 EdgeProps(sourceX/Y, targetX/Y, sourcePosition/targetPosition)。
//  - 选中/动画状态用 props.selected / props.animated（外框 .vue-flow__edge 的类不落到根，壳要自管）。
//  - 流光动画：.vue-flow__edge.animated path 的默认动画要覆盖 → 用非 scoped <style> 盖。
// 用最简单的直/贝塞尔路径画一条可拖连的边 + 箭头 marker。
import { computed } from 'vue'
import type { EdgeProps } from '@vue-flow/core'
import { getBezierPath } from '@vue-flow/core'

const props = defineProps<EdgeProps>()

// 计算贝塞尔路径（返回 [d, labelX, labelY, offsetX, offsetY]）
const path = computed(() => {
  const [d] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  })
  return d
})

// 端点中心用来放 marker 箭头
const mid = computed(() => ({
  x: (props.sourceX + props.targetX) / 2,
  y: (props.sourceY + props.targetY) / 2,
}))
</script>

<template>
  <g class="theme-default-edge" :class="{ selected: selected, animated: animated }">
    <!-- 宽透明点击热区（便于选中/双击） -->
    <path :d="path" class="hit" fill="none" stroke="transparent" stroke-width="18" />
    <!-- 可见线 -->
    <path :d="path" class="line" fill="none" />
    <!-- 箭头 -->
    <circle
      :cx="mid.x"
      :cy="mid.y"
      r="4"
      class="arrow"
      v-if="selected || animated"
    />
  </g>
</template>

<style scoped>
.hit {
  cursor: pointer;
}
</style>

<!-- 非 scoped：要盖 .vue-flow__edge 相关与流光动画，scoped 选择器够不到 vue-flow 外框 -->
<style>
.theme-default-edge .line {
  stroke: #10b981;
  stroke-width: 2;
  stroke-linecap: round;
}
.theme-default-edge .arrow {
  fill: #10b981;
}
.theme-default-edge.selected .line {
  stroke: #f59e0b;
  stroke-width: 3;
}
/* 流光动画：path stroke-dasharray 动起来 */
.theme-default-edge.animated .line {
  stroke-dasharray: 6 6;
  animation: theme-edge-flow 1s linear infinite;
}
@keyframes theme-edge-flow {
  to {
    stroke-dashoffset: -12;
  }
}
</style>
