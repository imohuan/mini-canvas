<script setup lang="ts">
/**
 * ThemedButtons —— 复用内置 UI 的按钮组（形态 A / B 的载体）。
 *
 * 经 useUiComponent('button') 按名取主题登记的按钮（默认 = NodeToolbarButton）：
 * - variant="icon"：32×32 图标按钮，与底栏内置按钮完全同款（用户要的“用默认 UI”）；
 * - variant="text"：文本按钮（title + slot），带文案与 hover。
 * 换主题时这个组件会一起换 —— 这就是“复用内置 UI”的意义（业务插件零改动）。
 */
import { computed } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'

const props = defineProps<{ variant?: 'icon' | 'text' }>()
const ThemedButton = useUiComponent('button')

const ICON_GRID =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>'
const ICON_ZAP =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg>'

const isIcon = computed(() => (props.variant ?? 'icon') === 'icon')
</script>

<template>
  <span class="ssd-themed" data-testid="ssd-themed">
    <component
      :is="ThemedButton"
      title="插槽演示：网格视图"
      :icon="ICON_GRID"
      @click="() => {}"
    />
    <component
      :is="ThemedButton"
      :title="isIcon ? '插槽演示：主题按钮' : '插槽演示：文本按钮'"
      :icon="isIcon ? ICON_ZAP : undefined"
      @click="() => {}"
    >
      <template v-if="!isIcon">{{ isIcon ? '' : '主题按钮' }}</template>
    </component>
  </span>
</template>

<style scoped>
.ssd-themed { display: inline-flex; align-items: center; gap: 4px; flex: none; }
</style>
