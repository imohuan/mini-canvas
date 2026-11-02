<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'
import ThemeStudio from './ThemeStudio.vue'
import { createStudioPreviewSource } from './themeStudioPreview'

// 这个独立页服务「目验 ThemeStudio」：不再挂旧的 ThemeLab 画布工作台，
// 否则两套界面叠在一起，看不出设置页里真正的效果。
const source = ref<SettingsPanelSource | null>(null)

onMounted(() => {
  source.value = createStudioPreviewSource().source
})
</script>

<template>
  <div class="theme-lab-page">
    <div class="theme-studio-shell">
      <ThemeStudio v-if="source" :settings-source="source" />
      <p v-else class="theme-studio-loading">正在载入真实配置…</p>
    </div>
  </div>
</template>
