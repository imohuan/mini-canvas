<!-- 文件：packages/docs/public/examples/canvas-render/settings-slot-host/src/DemoNavItem.vue -->
     兼容示例：旧 settings.nav 槽的自绘导航项；新插件优先用 ctx.settingsMenu
     位置：插件包内部；仍由设置面板渲染，但外观要自己画 -->
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
