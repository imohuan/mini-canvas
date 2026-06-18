<script setup lang="ts">
defineProps<{
  layoutDirection?: string
  layoutIntraSpacingX?: number
  layoutIntraSpacingY?: number
  layoutInterSpacingX?: number
  layoutInterSpacingY?: number
  layoutFocusHeightRatio?: number
}>()

const emit = defineEmits<{
  (e: 'autoLayout'): void
  (e: 'focusSelected'): void
  (e: 'update:layoutDirection', v: string): void
  (e: 'update:layoutIntraSpacingX', v: number): void
  (e: 'update:layoutIntraSpacingY', v: number): void
  (e: 'update:layoutInterSpacingX', v: number): void
  (e: 'update:layoutInterSpacingY', v: number): void
  (e: 'update:layoutFocusHeightRatio', v: number): void
}>()

const btnBase = 'px-2 py-1 rounded text-[11px] font-semibold transition-colors border border-transparent cursor-pointer'
const btnActive = 'bg-[#3b82f6]/15 text-[#60a5fa] border-[#3b82f6]/30'
const btnInactive = 'bg-[#2d2b30] text-[#9c9aa3] hover:bg-[#3a3740] hover:text-[#f0f0f2]'
const sectionTitle = 'text-[11px] font-bold text-[#78767b] uppercase tracking-wider mt-3 mb-2'
const rowItem = 'flex items-center gap-2 text-[11px] text-[#b2b0b9]'
</script>

<template>
  <div class="flex gap-1 mb-2">
    <button :class="[btnBase, btnInactive]" @click="emit('autoLayout')">自动布局</button>
    <button :class="[btnBase, btnInactive]" @click="emit('focusSelected')">F 聚焦</button>
  </div>

  <div :class="sectionTitle">方向</div>
  <div class="flex gap-1">
    <button v-for="d in ['TB', 'LR', 'BT', 'RL']" :key="d"
      :class="[btnBase, 'flex-1 text-center', layoutDirection === d && btnActive]"
      @click="emit('update:layoutDirection', d)">
      {{ d }}
    </button>
  </div>

  <div :class="sectionTitle">簇内间距</div>
  <div :class="rowItem">
    <span>X</span>
    <input type="range" min="20" max="200" :value="layoutIntraSpacingX"
      class="w-24 h-1 accent-[#3b82f6]"
      @input="emit('update:layoutIntraSpacingX', Number(($event.target as HTMLInputElement).value))" />
    <span class="text-[11px] text-[#78767b] w-10 text-right">{{ layoutIntraSpacingX }}px</span>
  </div>
  <div :class="rowItem">
    <span>Y</span>
    <input type="range" min="20" max="200" :value="layoutIntraSpacingY"
      class="w-24 h-1 accent-[#3b82f6]"
      @input="emit('update:layoutIntraSpacingY', Number(($event.target as HTMLInputElement).value))" />
    <span class="text-[11px] text-[#78767b] w-10 text-right">{{ layoutIntraSpacingY }}px</span>
  </div>

  <div :class="sectionTitle">簇间间距</div>
  <div :class="rowItem">
    <span>X</span>
    <input type="range" min="40" max="300" :value="layoutInterSpacingX"
      class="w-24 h-1 accent-[#3b82f6]"
      @input="emit('update:layoutInterSpacingX', Number(($event.target as HTMLInputElement).value))" />
    <span class="text-[11px] text-[#78767b] w-10 text-right">{{ layoutInterSpacingX }}px</span>
  </div>
  <div :class="rowItem">
    <span>Y</span>
    <input type="range" min="40" max="300" :value="layoutInterSpacingY"
      class="w-24 h-1 accent-[#3b82f6]"
      @input="emit('update:layoutInterSpacingY', Number(($event.target as HTMLInputElement).value))" />
    <span class="text-[11px] text-[#78767b] w-10 text-right">{{ layoutInterSpacingY }}px</span>
  </div>

  <div :class="sectionTitle">聚焦高度比例</div>
  <div :class="rowItem">
    <input type="range" min="0.2" max="0.9" step="0.05" :value="layoutFocusHeightRatio ?? 0.5"
      class="w-24 h-1 accent-[#3b82f6]"
      @input="emit('update:layoutFocusHeightRatio', Number(($event.target as HTMLInputElement).value))" />
    <span class="text-[11px] text-[#78767b] w-10 text-right">{{ Math.round((layoutFocusHeightRatio ?? 0.5) * 100) }}%</span>
  </div>
</template>