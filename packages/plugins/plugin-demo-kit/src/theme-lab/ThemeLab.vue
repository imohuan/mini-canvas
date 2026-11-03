<script setup lang="ts">
/** ThemeLab —— 主题工作台入口；实现与模板在 theme-lab-panel/。 */
import type { ThemeLabProps } from './theme-lab-panel/state'
import ThemeLabView from './theme-lab-panel/ThemeLabView.vue'

withDefaults(defineProps<ThemeLabProps>(), { height: 660, embedded: false, settingsSource: undefined })
</script>

<template>
  <ThemeLabView v-bind="$props" />
</template>
