<script setup lang="ts">
/** ThemeStudio —— 设置页「外观 → 主题工作台」入口；实现与模板在 theme-studio-panel/。 */
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'
import ThemeStudioView from './theme-studio-panel/ThemeStudioView.vue'

defineProps<{
  settingsSource: SettingsPanelSource
}>()
</script>

<template>
  <ThemeStudioView v-bind="$props" />
</template>
