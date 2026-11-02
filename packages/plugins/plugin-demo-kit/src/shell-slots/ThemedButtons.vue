<script setup lang="ts">
/**
 * ThemedButtons —— 外壳插槽里的按钮演示。
 *
 * 按钮从画布 ctx 的 ui 注册表按名取（默认主题插件登记的 shadcn 原始件），
 * 复用全局工具栏类 `.mck-toolbar-btn`，不再由宿主下发按钮组件。
 */
import { useUiComponent } from '@mini-canvas/canvas-render'

const props = defineProps<{
  variant?: 'icon' | 'text'
}>()

const ICON_GRID =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>'
const Button = useUiComponent('Button')
</script>

<template>
  <span class="ssd-themed" data-testid="ssd-themed">
    <Button
      v-if="Button"
      class="mck-toolbar-btn is-icon-only"
      variant="ghost"
      size="sm"
      type="button"
      title="插槽演示：网格视图"
      aria-label="插槽演示：网格视图"
      @click="() => {}"
    >
      <span class="mck-toolbar-icon-raw" v-html="ICON_GRID" />
    </Button>
  </span>
</template>

<style scoped>
.ssd-themed { display: inline-flex; align-items: center; gap: 4px; flex: none; }
</style>
