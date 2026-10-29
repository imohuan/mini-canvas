<script setup lang="ts">
/**
 * ImageExpandPanel —— 扩展模式的底栏面板（mode 固定成 'expand'）。
 * 与 ImageCropPanel 分两个组件的原因见那个文件顶部：避免 Vue 复用同一实例、标题不刷新。
 */
import ImageEditPanel from './ImageEditPanel.vue'

defineProps<{ id: string; data: Record<string, unknown> }>()
</script>

<template>
  <ImageEditPanel :id="id" :data="data" mode="expand" />
</template>
