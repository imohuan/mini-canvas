<script setup lang="ts">
/**
 * ThemedButtons —— 全部使用宿主下发的内置按钮（coreButton）。
 *
 * 按钮组件由 SlotComposer 的 sharedProps 下发，本文件不再自绘任何按钮：
 * - 第一个：固定 icon 形态（网格图标）；
 * - 第二个：按 variant 决定 icon / text（缺省 icon）。
 *
 * 宿主没给 coreButton 时不渲染按钮（内置按钮是外壳提供的，插件不复制一套样式）。
 */
import { type Component } from 'vue'

const props = defineProps<{
  variant?: 'icon' | 'text'
  /** 宿主下发的默认按钮组件（SlotComposer sharedProps） */
  coreButton?: unknown
  /** 宿主下发的按钮档位：dock / status / tab（同一组件换尺寸） */
  buttonTone?: 'dock' | 'status' | 'tab'
}>()

const ICON_GRID =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>'
/**
 * 宿主下发的按钮组件本身就是组件，直接赋给本地名字当标签用：
 *   <CoreButton … />
 * 不再 defineComponent 包一层适配器。
 */
const CoreButton = props.coreButton as Component | undefined
</script>

<template>
  <span class="ssd-themed" data-testid="ssd-themed">
    <CoreButton
      v-if="CoreButton"
      :tone="buttonTone ?? 'dock'"
      variant="icon"
      title="插槽演示：网格视图"
      :icon="ICON_GRID"
      @click="() => {}"
    />
  </span>
</template>

<style scoped>
.ssd-themed { display: inline-flex; align-items: center; gap: 4px; flex: none; }
</style>
