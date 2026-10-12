<script setup lang="ts">
// 设置面板左侧的一级导航项（settingsNav occupant），与 plugin-agent 的 AgentSettingsNav 同款。
// 面板注入 { group, active, onSelect }；id 命中自定义项，所以只画名字与图标。
import { Puzzle } from 'lucide-vue-next'

defineProps<{ group: string; active?: boolean; onSelect?: (key: string) => void }>()
</script>

<template>
  <button class="pmn" :class="{ active }" @click="onSelect && onSelect(group)">
    <Puzzle :size="15" />
    <span>插件</span>
  </button>
</template>

<style scoped>
.pmn { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 6px 10px; border: 0; border-radius: 10px; background: transparent; color: var(--ui-ink, #374151); font-size: 13px; font-weight: 600; text-align: left; cursor: pointer; transition: background 0.18s cubic-bezier(0.34, 1.56, 0.64, 1); }
.pmn:hover { background: var(--ui-hover, rgb(0 0 0 / 0.05)); }
.pmn.active { background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)); color: var(--ui-accent-hover, #0e7490); }
.pmn:focus-visible { outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: -1px; }
</style>
