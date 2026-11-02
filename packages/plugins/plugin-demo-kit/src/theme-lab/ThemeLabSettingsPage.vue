<script setup lang="ts">
/**
 * ThemeLabSettingsPage —— 设置面板里「外观 / 主题工作台」的整页正文。
 *
 * 颜色直接读写主应用的真实 settings；预览不用第二块内核（那会把主题变量和亮暗模式
 * 再写到 <html> 上），而是用主应用已有的主题组件做一张实时样张。
 * 标题、滚动、关闭都由设置外壳提供。
 */
import ThemeStudio from './ThemeStudio.vue'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'

defineProps<{ group: string; settings: SettingsPanelSource }>()
</script>

<template>
  <ThemeStudio :settings-source="settings" />
</template>
