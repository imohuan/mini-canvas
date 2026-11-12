<script setup lang="ts">
/**
 * ToolbarIcon —— 节点控制栏按钮的图标位。
 *
 * 图标句柄是 opaque 的：SVG 字符串走 v-html，Vue 组件走 <component :is>。
 * 判定统一交给内核的 iconRenderMode，与节点类型图标同一套规则。
 * 只负责「画图标」，按钮本体与图标尺寸都由 shadcn Button 自己决定。
 */
import { computed } from 'vue'
import { iconRenderMode } from '@plume-canvas/kernel'

const props = defineProps<{ icon?: unknown }>()

const mode = computed(() => iconRenderMode(props.icon))
</script>

<template>
  <span class="pk-toolbar-icon">
    <span v-if="mode === 'html'" v-html="icon" />
    <component v-else-if="mode === 'component'" :is="icon" />
  </span>
</template>
