<script setup lang="ts">
/**
 * ImageCropPanel —— 裁剪模式的底栏面板。
 *
 * 只是一层薄包装：把 mode 固定成 'crop' 交给 ImageEditPanel。
 * 为什么要分开两个组件：裁剪与扩展是两个**不同的底栏动作**，若共用同一个 panel 组件，
 * Vue 会在切换动作时复用同一个实例（props 只有 id/data 没变），面板标题就停在上一个模式上。
 */
import ImageEditPanel from './ImageEditPanel.vue'

defineProps<{ id: string; data: Record<string, unknown> }>()
</script>

<template>
  <ImageEditPanel :id="id" :data="data" mode="crop" />
</template>
