<script setup lang="ts">
defineProps<{
  performancePanelEnabled: boolean
  performancePanelShowCharts: boolean
  performancePanelShowMemory: boolean
}>()

const emit = defineEmits<{
  (e: 'update:performancePanelEnabled', v: boolean): void
  (e: 'update:performancePanelShowCharts', v: boolean): void
  (e: 'update:performancePanelShowMemory', v: boolean): void
  (e: 'clearPerformanceSamples'): void
}>()

const btnBase = 'px-2 py-1 rounded text-[11px] font-semibold transition-colors border border-transparent cursor-pointer'
const btnActive = 'bg-[#3b82f6]/15 text-[#60a5fa] border-[#3b82f6]/30'
const btnInactive = 'bg-[#2d2b30] text-[#9c9aa3] hover:bg-[#3a3740] hover:text-[#f0f0f2]'
const sectionTitle = 'text-[11px] font-bold text-[#78767b] uppercase tracking-wider mt-3 mb-2'
const rowItem = 'flex items-center gap-2 text-[11px] text-[#b2b0b9]'
const rowToggle = `${rowItem} justify-between`
const infoText = 'text-[11px] leading-5 text-[#9c9aa3]'
const infoRow = 'flex items-center justify-between gap-4'
</script>

<template>
  <div :class="sectionTitle">性能检测</div>
  <div :class="rowToggle">
    <span>左上角卡顿雷达</span>
    <button :class="[btnBase, performancePanelEnabled ? btnActive : btnInactive]"
      @click="emit('update:performancePanelEnabled', !performancePanelEnabled)">
      {{ performancePanelEnabled ? '开' : '关' }}
    </button>
  </div>

  <div :class="sectionTitle">显示选项</div>
  <div :class="rowToggle">
    <span>曲线</span>
    <button :class="[btnBase, performancePanelShowCharts ? btnActive : btnInactive]"
      @click="emit('update:performancePanelShowCharts', !performancePanelShowCharts)">
      {{ performancePanelShowCharts ? '开' : '关' }}
    </button>
  </div>
  <div :class="rowToggle">
    <span>内存</span>
    <button :class="[btnBase, performancePanelShowMemory ? btnActive : btnInactive]"
      @click="emit('update:performancePanelShowMemory', !performancePanelShowMemory)">
      {{ performancePanelShowMemory ? '开' : '关' }}
    </button>
  </div>

  <div :class="sectionTitle">采样</div>
  <div :class="rowToggle">
    <span>采样数据</span>
    <button :class="[btnBase, btnInactive]" @click="emit('clearPerformanceSamples')">
      清空
    </button>
  </div>

  <div :class="sectionTitle">判断规则</div>
  <div :class="infoText">
    <p :class="infoRow"><span>≥ 55 FPS</span><span>流畅</span></p>
    <p :class="infoRow"><span>45–54 FPS</span><span>波动</span></p>
    <p :class="infoRow"><span>30–44 FPS</span><span>偏卡</span></p>
    <p :class="infoRow"><span>&lt; 30 FPS / 单帧 ≥ 100ms</span><span>明显卡顿</span></p>
  </div>
</template>
