<script setup lang="ts">
/**
 * 项目页「风格库」整页页签：直接把画布里的浮层内嵌进来。
 * 广场 / 详情 / 收藏 / 加入画布都是同一份组件，不另写一套。
 */
import StyleLibraryOverlay from './StyleLibraryOverlay.vue'
</script>

<template>
  <StyleLibraryOverlay inline />
</template>
