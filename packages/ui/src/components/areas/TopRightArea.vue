<script setup lang="ts">
// 右上角：积分余额 / 主题切换 / 设置（照用户标注只保留这三个）
import { Zap, Palette, Settings } from 'lucide-vue-next'
import { useUi } from '../../composables/ui'

const ui = useUi()
const s = ui.state
</script>

<template>
  <div class="flex items-center gap-2">
    <button
      class="flex h-8 items-center gap-1 rounded-lg border border-line bg-panel/80 px-2.5 text-[13px] text-ink transition-colors hover:bg-hover"
      aria-label="积分余额" @click="ui.showToast('积分余额')"
    ><Zap :size="14" /> 20</button>
    <button
      class="grid size-8 place-items-center rounded-lg border border-line bg-panel/80 text-ink-dim transition-colors hover:bg-hover hover:text-ink"
      aria-label="主题切换" @click="ui.toggleTheme()"
    ><Palette :size="15" /></button>
    <button
      class="grid size-8 place-items-center rounded-lg border border-line bg-panel/80 transition-colors"
      :class="s.settingsOpen ? 'bg-panel-active text-ink' : 'text-ink-dim hover:bg-hover hover:text-ink'"
      aria-label="设置" @click="s.settingsOpen = !s.settingsOpen"
    ><Settings :size="15" /></button>
  </div>
</template>
