<script setup lang="ts">
defineProps<{
  themePreset?: string
  themeAccent?: string
  themeSurface?: string
}>()

const emit = defineEmits<{
  (e: 'applyThemePreset', name: string): void
  (e: 'applyCustomTheme', accent: string): void
}>()

const themePresets = [
  { name: 'slate-blue', label: '灰蓝', color: '#64748b' },
  { name: 'tech-blue', label: '科技蓝', color: '#3b82f6' },
  { name: 'emerald', label: '翠绿', color: '#10b981' },
  { name: 'warm-brown', label: '暖棕', color: '#d97706' },
]

const btnBase = 'px-2 py-1 rounded text-[11px] font-semibold transition-colors border border-transparent cursor-pointer'
const btnActive = 'bg-[#3b82f6]/15 text-[#60a5fa] border-[#3b82f6]/30'
const sectionTitle = 'text-[11px] font-bold text-[#78767b] uppercase tracking-wider mt-3 mb-2'
const rowItem = 'flex items-center gap-2 text-[11px] text-[#b2b0b9]'
</script>

<template>
  <div :class="sectionTitle">预设主题</div>
  <div class="flex gap-1">
    <button v-for="preset in themePresets" :key="preset.name"
      :class="[btnBase, 'flex-1 text-center', themePreset === preset.name && btnActive]"
      :style="{ borderColor: themePreset === preset.name ? preset.color : 'transparent' }"
      @click="emit('applyThemePreset', preset.name)">
      {{ preset.label }}
    </button>
  </div>

  <div :class="sectionTitle">自定义</div>
  <div :class="rowItem">
    <span>Accent</span>
    <div class="w-6 h-5 rounded border border-[#3a3740] overflow-hidden cursor-pointer relative">
      <input type="color" :value="themeAccent || '#111827'"
        class="absolute inset-0 opacity-0 cursor-pointer"
        @input="emit('applyCustomTheme', ($event.target as HTMLInputElement).value)" />
      <div class="w-full h-full"
        :style="{ background: themeAccent || '#111827' }"
        :title="themeAccent || '#111827'" />
    </div>
    <span class="text-[10px] text-[#78767b] font-mono truncate">{{ themeAccent || '#111827' }}</span>
  </div>
  <div :class="rowItem" v-if="themeSurface">
    <span>Surface</span>
    <div class="w-6 h-5 rounded border border-[#3a3740] overflow-hidden"
      :style="{ background: themeSurface }"
      :title="themeSurface" />
    <span class="text-[10px] text-[#78767b] font-mono truncate">{{ themeSurface }}</span>
  </div>
</template>