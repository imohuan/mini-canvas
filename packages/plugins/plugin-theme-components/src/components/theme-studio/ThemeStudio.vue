<script setup lang="ts">
/**
 * ThemeStudio —— 设置页「外观 → 主题 → 颜色配方」的正文。
 *
 * 颜色配方属于默认主题（它读写的也是默认主题与各插件申报的主题色板），
 * 所以整块界面住在这里，由 theme-components 注册成设置页的一节。
 */
import { computed } from 'vue'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'
import ThemeStudioView from './ThemeStudioView.vue'

/**
 * 设置外壳把这页当"整页正文"挂载时，下发的是 settings（与其它正文组件一致）；
 * 独立验收页传的是 settingsSource。两个名字都收，取到哪个用哪个。
 */
const props = defineProps<{
  settingsSource?: SettingsPanelSource
  settings?: SettingsPanelSource
}>()

const source = computed(() => props.settingsSource ?? props.settings)
</script>

<template>
  <ThemeStudioView v-if="source" :settings-source="source" />
</template>
