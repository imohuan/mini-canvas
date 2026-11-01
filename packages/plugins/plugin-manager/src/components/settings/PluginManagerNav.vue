<script setup lang="ts">
/**
 * PluginManagerNav —— 插件设置入口的数据占位。
 *
 * 导航外观统一由设置面板渲染（settings.nav 的 meta.title / category / icon / page）；
 * 保留文件是为了兼容旧装配，不再画按钮。
 */
defineProps<{ group: string; active?: boolean; onSelect?: (key: string) => void }>()
</script>

<template>
  <span class="pm-nav-anchor" aria-hidden="true" />
</template>

<style scoped>
.pm-nav-anchor { display: none; }
</style>
