<script setup lang="ts">
/**
 * ThemeLabNav —— 主题工作台在设置左导航里的数据占位。
 *
 * 真正的导航行由设置面板按 `settings.nav.meta`（标题 / 分类 / 图标 / page）统一渲染；
 * 保留组件是为了兼容 settings.nav 的注册契约。
 */
defineProps<{ group: string; active?: boolean; onSelect?: (key: string) => void }>()
</script>

<template>
  <span class="theme-lab-nav-anchor" aria-hidden="true" />
</template>

<style scoped>
.theme-lab-nav-anchor { display: none; }
</style>
