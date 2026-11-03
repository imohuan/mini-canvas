<script setup lang="ts">
import ShadcnSettingsNav from '@mini-canvas/plugin-theme-default/components/settings/ShadcnSettingsNav.vue'
import type { SettingsNavItem } from './settingsMenuModel'

defineProps<{
  items: SettingsNavItem[]
  active: string
}>()

const emit = defineEmits<{
  (e: 'select', key: string): void
}>()
</script>

<template>
  <!-- 左：第 0 级分类 + 一级图标菜单（统一外观） -->
  <ShadcnSettingsNav
    class="asp-nav"
    :items="items"
    :active="active"
    @select="emit('select', $event)"
  />
</template>

<style scoped>
/* 导航外观在 ShadcnSettingsNav 里；这里只让它在弹性行里占固定宽度 */
.asp-nav {
  width: 192px;
}

@media (max-width: 560px) {
  .asp-nav {
    width: 150px;
  }
}
</style>
