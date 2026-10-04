<script setup lang="ts">
// 设置面板左侧一级导航项（settingsNav occupant）。面板注入 { group, active, onSelect }。
import { MousePointer2 } from 'lucide-vue-next'

defineProps<{ group: string; active?: boolean; onSelect?: (key: string) => void }>()
</script>

<template>
  <button class="csn" :class="{ active }" @click="onSelect && onSelect(group)">
    <MousePointer2 :size="15" />
    <span>光标</span>
  </button>
</template>

<style scoped>
.csn { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 6px 10px; border: 0; border-radius: 10px; background: transparent; color: var(--ui-ink, #374151); font-size: 13px; font-weight: 600; text-align: left; cursor: pointer; }
.csn:hover { background: var(--ui-hover, rgb(0 0 0 / 0.05)); }
.csn.active { background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)); color: var(--ui-accent-hover, #0e7490); }
</style>

