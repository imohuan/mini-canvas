<script setup lang="ts">
/**
 * CursorSettingsNav —— 光标设置入口的数据占位。
 *
 * 真正的导航按钮由设置面板按 settings.nav 的 meta（title / category / icon / page）统一渲染，
 * 插件不再自绘一套样式。保留文件是为了兼容旧的注册写法。
 */
defineProps<{ group: string; active?: boolean; onSelect?: (key: string) => void }>()
</script>

<template>
  <span class="cursor-nav-anchor" aria-hidden="true" />
</template>

<style scoped>
.cursor-nav-anchor { display: none; }
</style>
