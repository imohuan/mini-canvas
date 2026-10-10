<!-- 文件：packages/docs/public/examples/canvas-render/settings-slot-host/src/DemoNavItem.vue -->
     格式：Vue 单文件组件（挂在 settingsNav 槽，被设置面板的左导航渲染）
     位置：插件包内部；它声明 props.settings 就能拿到统一设置数据源 -->
<script setup lang="ts">
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'

// 默认设置皮会把设置数据源与导航回调当 props 传给导航项（不给就会是 undefined）
const props = defineProps<{
  settings?: SettingsPanelSource
  group?: string
  active?: string
  onSelect?: (key: string) => void
}>()
</script>

<template>
  <button class="nav-item" :class="{ active: props.active === '我的演示' }" @click="props.onSelect?.('我的演示')">
    我的演示
  </button>
</template>

<style scoped>
.nav-item { display: block; width: 100%; padding: 6px 10px; text-align: left; border: none; background: transparent; cursor: pointer; border-radius: 6px; }
.nav-item.active { background: var(--ui-hover, rgba(0,0,0,.06)); }
</style>
