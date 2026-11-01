<script setup lang="ts">
// 设置面板左侧导航项的数据占位：外观由设置面板统一渲染，插件不再自绘。
defineProps<{ group: string; active?: boolean; onSelect?: (key: string) => void }>()
</script>

<template>
  <span class="showcase-nav-anchor" aria-hidden="true" />
</template>

<style scoped>
.showcase-nav-anchor { display: none; }
</style>
