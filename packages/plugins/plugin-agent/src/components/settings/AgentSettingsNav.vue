<script setup lang="ts">
/**
 * AgentSettingsNav —— Agent 设置入口的数据件。
 *
 * 设置面板从 `settings.nav` 的 `meta.icon` / `meta.page` 取标题、图标与整页组件，
 * 外观由面板统一渲染（ShadcnSettingsNav）；这里不再画按钮，也不带任何样式。
 *
 * 保留这个文件是向后兼容：老装配仍把它作为 settings.nav 的 component 注册。
 */
defineProps<{ group: string; active?: boolean; onSelect?: (key: string) => void }>()
</script>

<template>
  <span class="agent-settings-nav-anchor" aria-hidden="true" />
</template>

<style scoped>
/* 只做占位：真正的导航按钮由 ShadcnSettingsNav 画，样式只有一份 */
.agent-settings-nav-anchor { display: none; }
</style>
