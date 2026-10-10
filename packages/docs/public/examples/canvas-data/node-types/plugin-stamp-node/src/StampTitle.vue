<!-- 文件：packages/docs/public/examples/canvas-data/node-types/plugin-stamp-node/src/StampTitle.vue -->
     格式：Vue 单文件组件（title 区域：标题那一行）
     位置：插件包内部；由 ctx.nodes.register 的 title 字段挂进展示注册表 -->
<script setup lang="ts">
const props = defineProps<{ data?: Record<string, unknown> }>()
</script>

<template>
  <span class="stamp-title">{{ String(props.data?.label ?? '邮票') }}</span>
</template>

<style scoped>
.stamp-title { color: var(--ui-ink-dim, #6b7280); font-size: 12px; }
</style>

