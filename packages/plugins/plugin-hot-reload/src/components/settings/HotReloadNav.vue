<script setup lang="ts">
/**
 * 设置面板左侧的「调试插件」导航项。
 *
 * 与「插件管理」的导航项是**两个独立入口**：那边装清单里的插件，这边只管
 * watch 上报过的调试插件。两边不互相调用、不读对方的安装记录。
 */
import { Bug } from 'lucide-vue-next'

defineProps<{ group: string; active?: boolean; onSelect?: (key: string) => void }>()
</script>

<template>
  <button class="hrn" :class="{ active }" @click="onSelect && onSelect(group)">
    <Bug :size="15" />
    <span>调试插件</span>
  </button>
</template>

<style scoped>
.hrn { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 6px 10px; border: 0; border-radius: var(--radius-row, 10px); background: transparent; color: var(--ui-ink, #374151); font-size: 13px; font-weight: 600; text-align: left; cursor: pointer; transition: background var(--dur-hover, 0.18s) var(--ease-back, cubic-bezier(0.34, 1.56, 0.64, 1)); }
.hrn:hover { background: var(--ui-hover, rgb(0 0 0 / 0.05)); }
.hrn.active { background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)); color: var(--ui-accent-hover, #0e7490); }
.hrn:focus-visible { outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: -1px; }
</style>
